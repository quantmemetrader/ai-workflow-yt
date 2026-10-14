import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { cleanRailLayout, type RailLayout } from "@/lib/nav-layout";

/** One row per person in `settings`; no row means the studio's default rail. */
export const railLayoutKey = (userId: string) => `rail.layout:${userId}`;

export async function getRailLayout(userId: string): Promise<RailLayout | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, railLayoutKey(userId))).limit(1).catch(() => []);
  return cleanRailLayout(row?.value);
}

export async function setRailLayout(userId: string, layout: RailLayout | null): Promise<void> {
  if (!layout) {
    await db.delete(settings).where(eq(settings.key, railLayoutKey(userId)));
    return;
  }
  await db
    .insert(settings)
    .values({ key: railLayoutKey(userId), value: layout, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: layout, updatedBy: userId, updatedAt: new Date() } });
}
