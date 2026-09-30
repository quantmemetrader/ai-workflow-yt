import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

/**
 * 首页 tasks a person put away (「不再提醒」), per person, by "project:step"
 * — so the same video's next step still shows up (Ryan, 30 Sep: "even if AI
 * generates a task they don't like they can do nothing about it").
 */
const key = (userId: string) => `home.hidden:${userId}`;

export async function hiddenTodos(userId: string): Promise<Set<string>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(userId))).limit(1).catch(() => []);
  const v = row?.value;
  return new Set(v && typeof v === "object" ? Object.keys(v as Record<string, unknown>) : []);
}

export async function hideTodo(userId: string, todoKey: string): Promise<void> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(userId))).limit(1);
  const now = (row?.value && typeof row.value === "object" ? (row.value as Record<string, string>) : {}) ?? {};
  /* Keep the newest 300; older ones are for videos long gone. */
  const next = Object.fromEntries([...Object.entries(now), [todoKey, new Date().toISOString()]].slice(-300));
  await db
    .insert(settings)
    .values({ key: key(userId), value: next, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedBy: userId, updatedAt: new Date() } });
}
