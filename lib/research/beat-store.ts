import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { DEFAULT_BEATS, normalizeBeats, type BeatConfig } from "@/lib/research/beats";

/**
 * A studio's beats, as it set them on the Research page (管理赛道), read and
 * written in one place.
 *
 * One small row in the settings table per studio, `research:beats:<tenantId>`,
 * holding the list itself (`BeatConfig[]`). No row means the studio never
 * edited its list and reads the four defaults. A row that no longer passes
 * the checks (edited by hand, a limit tightened since) is read as the
 * defaults too, and says so in the log, rather than breaking the collector.
 *
 * Read by the collector (which words to search, `beat-feeds.ts`), the
 * classifier (which beats to sort into, `relevance.ts`, through the hourly
 * charts in `platforms.ts`), the Research agent's `trending_now`, and the
 * page (`/api/research/beats`). Kept for a minute per process: the collector
 * reads it once per list, and a saved change reaches every reader within the
 * minute — at once in the process that saved it.
 */

const key = (tenantId: string) => `research:beats:${tenantId}`;
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; beats: BeatConfig[]; stored: boolean }>();

/** The studio's beats in its order, switched-off ones included. */
export async function readBeats(tenantId: string, opts: { fresh?: boolean } = {}): Promise<BeatConfig[]> {
  return (await readBeatsWithOrigin(tenantId, opts)).beats;
}

/** The same, and whether the list is the studio's own or the defaults. */
export async function readBeatsWithOrigin(tenantId: string, opts: { fresh?: boolean } = {}): Promise<{ beats: BeatConfig[]; stored: boolean }> {
  const hit = memo.get(tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit;
  let beats: BeatConfig[] = [...DEFAULT_BEATS];
  let stored = false;
  try {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(tenantId))).limit(1);
    if (row) {
      const parsed = normalizeBeats(row.value);
      if ("beats" in parsed) {
        beats = parsed.beats;
        stored = true;
      } else console.error(`[research] beats for ${tenantId} do not pass the checks (${parsed.errorEn}); reading the defaults`);
    }
  } catch (err) {
    /* A failed read costs the studio's own list for a minute, never the
       collection: the defaults are what the collector searched before. */
    console.error("[research] beats read", err);
    if (hit) return hit;
  }
  const out = { at: Date.now(), beats, stored };
  memo.set(tenantId, out);
  return out;
}

/** Check and store a studio's list. The saved (cleaned) list comes back. */
export async function saveBeats(viewer: Viewer, input: unknown): Promise<{ beats: BeatConfig[] } | { error: string; errorEn: string }> {
  const parsed = normalizeBeats(input);
  if (!("beats" in parsed)) return parsed;
  const value = parsed.beats;
  await db
    .insert(settings)
    .values({ key: key(viewer.tenantId), value, updatedBy: viewer.id })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: viewer.id, updatedAt: new Date() } });
  memo.set(viewer.tenantId, { at: Date.now(), beats: value, stored: true });
  return { beats: value };
}
