"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { ensureKeys, isKeyName, removeKey, saveKey, testKey } from "@/lib/keys/store";

/**
 * Changing the studio's API keys from 员工管理 › 渠道与凭据 (6 Oct). Owners and
 * administrators only. A new key is checked with its provider before it is
 * saved, so a mistyped key cannot take the AI or publishing down; the audit
 * log records who changed which key, never the key.
 */
async function admin() {
  const viewer = await getViewer();
  if (!viewer || (viewer.role !== "owner" && viewer.role !== "admin")) return null;
  return viewer;
}

export async function saveKeyAction(name: unknown, value: unknown) {
  const viewer = await admin();
  if (!viewer) return { error: "只有所有者和管理员能改密钥" };
  if (!isKeyName(name)) return { error: "不认识的密钥" };
  const v = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";
  if (v.length < 8 || v.length > 400 || /\s/.test(v)) return { error: "这看起来不是一个完整的密钥，检查一下有没有多复制空格或少复制几位" };
  const check = await testKey(name, v);
  if (!check.ok) return { error: `没有保存：${check.note}` };
  await saveKey(name, v, viewer.id);
  await audit(viewer, "admin.key.set", { module: "admin", objectType: "api_key", objectId: name });
  revalidatePath("/admin");
  return { note: check.note };
}

/** Back to the key in the server's configuration file, if it has one. */
export async function removeKeyAction(name: unknown) {
  const viewer = await admin();
  if (!viewer) return { error: "只有所有者和管理员能改密钥" };
  if (!isKeyName(name)) return { error: "不认识的密钥" };
  await removeKey(name);
  await audit(viewer, "admin.key.remove", { module: "admin", objectType: "api_key", objectId: name });
  revalidatePath("/admin");
  return {};
}

/** Check the key in use now, without changing it. */
export async function testCurrentKeyAction(name: unknown) {
  const viewer = await admin();
  if (!viewer) return { error: "只有所有者和管理员能看" };
  if (!isKeyName(name)) return { error: "不认识的密钥" };
  await ensureKeys();
  const now = name === "TIKHUB_TOKEN" ? process.env.TIKHUB_TOKEN || process.env.TICKHUB_TOKEN : process.env[name];
  if (!now) return { error: "还没有设置这个密钥" };
  return testKey(name, now);
}
