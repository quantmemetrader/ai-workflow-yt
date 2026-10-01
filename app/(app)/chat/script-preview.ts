"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { reachableThroughProjects } from "@/lib/projects/service";
import { docForBeats, unitsOf, type RichNode } from "@/lib/script/rich";
import { spokenSeconds } from "@/lib/script/service";

export type ScriptPreview = {
  title: string;
  status: string;
  locked: boolean;
  /** Every spoken line in document order (empty ones are shot notes only). */
  lines: string[];
  paragraphs: string[];
  /** The script's own numbers, so the card and the reply agree (QA, 2 Oct:
   * the card said 「2 段 · 约 12 秒」 under a reply about 3 shots and 15 s):
   * its shots, the spoken length worked out the editor's way, the target. */
  beats: number;
  seconds: number;
  targetSeconds: number | null;
};

/**
 * A script's words, for the chat to show under the reply that wrote it (the
 * owner, 29 Sep: "how can someone change the script without seeing it").
 * Only for someone who may read it: an admin, a member of its project, or
 * someone it is shared with.
 */
/* "gone": the script was deleted since the reply wrote it, so the card says
   so instead of offering presses that lead nowhere (QA, 2 Oct). */
export async function scriptPreviewAction(scriptId: unknown): Promise<ScriptPreview | "gone" | null> {
  const viewer = await getViewer();
  if (!viewer || typeof scriptId !== "string" || !/^scr_[0-9a-z]+$/i.test(scriptId)) return null;
  const [s] = await db
    .select({ title: scripts.title, status: scripts.status, doc: scripts.doc, lockedVersion: scripts.lockedVersion, targetSeconds: scripts.targetSeconds, deletedAt: scripts.deletedAt })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!s) return null;
  if (s.deletedAt) return "gone";
  const may = viewer.isAdmin || (await reachableThroughProjects(viewer, { scriptId })) || (await relationOn(viewer, "script", scriptId).catch(() => null)) !== null;
  if (!may) return null;
  const beats = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual, spokenSeconds: scriptBeats.spokenSeconds }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  const lines = unitsOf(docForBeats((s.doc ?? null) as RichNode | null, beats)).map((u) => u.text);
  const seconds = beats.reduce((sum, b) => sum + (b.spokenSeconds ?? spokenSeconds(b.voiceover)), 0);
  return {
    title: s.title,
    status: s.status,
    locked: s.lockedVersion !== null,
    lines,
    paragraphs: lines.map((l) => l.trim()).filter(Boolean),
    beats: beats.filter((b) => b.voiceover.trim() || b.visual.trim()).length,
    seconds: Math.round(seconds),
    targetSeconds: s.targetSeconds ?? null,
  };
}
