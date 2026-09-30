import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

/**
 * 热点榜 rows the studio put away (「不再显示」), per studio, by the stored
 * phrase — the list refreshes every few hours and the same post keeps coming
 * back until somebody says it is not for us.
 */
const key = (tenantId: string) => `research.hot.hidden:${tenantId}`;

export async function hiddenHot(tenantId: string): Promise<Set<string>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(tenantId))).limit(1).catch(() => []);
  const v = row?.value;
  return new Set(v && typeof v === "object" ? Object.keys(v as Record<string, unknown>) : []);
}

async function write(tenantId: string, userId: string, next: Record<string, string>) {
  await db
    .insert(settings)
    .values({ key: key(tenantId), value: next, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: userId, updatedAt: new Date() } });
}

export async function hideHot(tenantId: string, userId: string, phrase: string): Promise<void> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(tenantId))).limit(1);
  const now = row?.value && typeof row.value === "object" ? (row.value as Record<string, string>) : {};
  await write(tenantId, userId, Object.fromEntries([...Object.entries(now), [phrase, new Date().toISOString()]].slice(-500)));
}

export async function restoreHot(tenantId: string, userId: string): Promise<void> {
  await write(tenantId, userId, {});
}
