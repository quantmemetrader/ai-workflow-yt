"use server";

import { getViewer } from "@/lib/auth/dal";
import { dmChannelWith, listChannels, listPeople } from "@/lib/chat/service";
import { projectChannelIds } from "@/lib/projects/service";
import { distinctNames } from "@/lib/chat/people";
import { sendChannelMessage } from "./actions";

/**
 * 转发 from a chat with the assistant to a colleague or a group (Catherine,
 * 6 Oct: "a part of my conversation with the assistant that needs to be
 * shared should go straight to my chat with 谢总"). The people and groups are
 * the ones the 消息 sidebar lists; the message goes through
 * `sendChannelMessage`, which checks the channel and the person again.
 */
export async function forwardTargetsAction() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "没有权限" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [channels, people, hidden] = await Promise.all([listChannels(viewer), listPeople(viewer), projectChannelIds(viewer.tenantId)]);
  const others = people.filter((p) => p.id !== viewer.id && !p.isGuest);
  const label = distinctNames(others.map((p) => ({ id: p.id, name: zh && p.nameLocal ? p.nameLocal : p.name, email: p.email, title: p.title })));
  const skip = new Set(hidden);
  return {
    people: others.map((p) => ({ id: p.id, name: label.get(p.id) ?? (zh && p.nameLocal ? p.nameLocal : p.name), avatarUrl: p.avatarUrl ?? null })),
    groups: channels
      .filter((c) => c.slug && !c.slug.startsWith("dm-") && !skip.has(c.id))
      .map((c) => ({ slug: c.slug as string, name: c.name, isPrivate: c.isPrivate })),
  };
}

export async function forwardMessageAction(target: { person?: string; group?: string }, text: string, note: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "没有权限" };
  const body = String(text ?? "").trim();
  if (!body) return { error: "没有要转发的内容" };
  let slug: string | null = null;
  if (typeof target?.person === "string" && target.person) {
    if (target.person === viewer.id) return { error: "不能转发给自己" };
    const dm = await dmChannelWith(viewer, target.person);
    slug = dm?.channel.slug ?? null;
  } else if (typeof target?.group === "string" && target.group) slug = target.group;
  if (!slug) return { error: "找不到要转发到的对话" };
  const quoted = body.split("\n").map((l) => `> ${l}`).join("\n");
  const head = String(note ?? "").trim().slice(0, 2000);
  const message = `${head ? `${head}\n\n` : ""}**转发自我和助理的对话**\n${quoted}`.slice(0, 20000);
  const r = await sendChannelMessage(slug, message);
  if (r && "error" in r && r.error) return { error: r.error };
  return { slug };
}
