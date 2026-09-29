"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { reachableThroughProjects } from "@/lib/projects/service";
import { docForBeats, unitsOf, type RichNode } from "@/lib/script/rich";

export type ScriptPreview = { title: string; status: string; locked: boolean; /** Every spoken line in document order (empty ones are shot notes only). */ lines: string[]; paragraphs: string[] };

/**
 * A script's words, for the chat to show under the reply that wrote it (the
 * owner, 29 Sep: "how can someone change the script without seeing it").
 * Only for someone who may read it: an admin, a member of its project, or
 * someone it is shared with.
 */
export async function scriptPreviewAction(scriptId: unknown): Promise<ScriptPreview | null> {
  const viewer = await getViewer();
  if (!viewer || typeof scriptId !== "string" || !/^scr_[0-9a-z]+$/i.test(scriptId)) return null;
  const [s] = await db
    .select({ title: scripts.title, status: scripts.status, doc: scripts.doc, lockedVersion: scripts.lockedVersion })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!s) return null;
  const may = viewer.isAdmin || (await reachableThroughProjects(viewer, { scriptId })) || (await relationOn(viewer, "script", scriptId).catch(() => null)) !== null;
  if (!may) return null;
  const beats = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  const lines = unitsOf(docForBeats((s.doc ?? null) as RichNode | null, beats)).map((u) => u.text);
  return { title: s.title, status: s.status, locked: s.lockedVersion !== null, lines, paragraphs: lines.map((l) => l.trim()).filter(Boolean) };
}
