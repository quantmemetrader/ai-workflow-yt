import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";

/**
 * Topics people add themselves to "Picked for today", kept per Hong Kong day
 * in the settings table (one small list per tenant). Yesterday's fall away
 * on their own.
 */
export type OwnPick = { text: string; by: string; at: string; date: string };

const key = (tenantId: string) => `research:own-picks:${tenantId}`;
const hkDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

export async function ownPicksToday(tenantId: string): Promise<OwnPick[]> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(tenantId))).limit(1);
  const list = Array.isArray(row?.value) ? (row!.value as OwnPick[]) : [];
  const today = hkDate();
  return list.filter((p) => p.date === today);
}

export async function addOwnPick(viewer: Viewer, text: string): Promise<void> {
  const today = hkDate();
  const list = (await ownPicksToday(viewer.tenantId)).filter((p) => p.text !== text);
  list.push({ text, by: viewer.nameLocal || viewer.name, at: new Date().toISOString(), date: today });
  const value = list.slice(-10);
  await db
    .insert(settings)
    .values({ key: key(viewer.tenantId), value, updatedBy: viewer.id })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: viewer.id, updatedAt: new Date() } });
}
