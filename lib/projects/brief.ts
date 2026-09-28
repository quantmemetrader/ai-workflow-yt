import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, scriptBeats, scriptVersions, scripts, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";

/**
 * The script as the person cutting the video needs it: which version is the
 * approved one, who approved it and when, and its words — or, before anybody
 * has approved it, the draft as it stands, marked as a draft.
 *
 * The client (28 Sep): "for the video page, there is no part that the video
 * maker knows which script is approved". The editor's 脚本与资料 panel reads
 * this. The caller has already checked the person may see the project the
 * script belongs to (`projectForPage`).
 */
export type EditorBrief = {
  scriptId: string;
  title: string;
  /** The approved version, when there is one. */
  approved: { version: number; by: string | null; at: string | null } | null;
  /** The newest version written, for "第 3 版在写" beside an older approval. */
  latestVersion: number;
  beats: { ord: number; visual: string; voiceover: string }[];
};

export async function editorBrief(viewer: Viewer, scriptId: string | null, zh: boolean): Promise<EditorBrief | null> {
  if (!scriptId) return null;
  const [s] = await db
    .select({ id: scripts.id, title: scripts.title, titleLocal: scripts.titleLocal, version: scripts.version, lockedVersion: scripts.lockedVersion })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!s) return null;
  const title = (zh && s.titleLocal) || s.title;

  if (s.lockedVersion) {
    const [[v], [a]] = await Promise.all([
      db
        .select({ beats: scriptVersions.beats })
        .from(scriptVersions)
        .where(and(eq(scriptVersions.scriptId, s.id), eq(scriptVersions.versionNo, s.lockedVersion)))
        .limit(1),
      db
        .select({ at: approvals.decidedAt, name: users.name, nameLocal: users.nameLocal })
        .from(approvals)
        .leftJoin(users, eq(users.id, approvals.decidedBy))
        .where(and(eq(approvals.tenantId, viewer.tenantId), eq(approvals.objectType, "script"), eq(approvals.objectId, s.id), eq(approvals.state, "approved")))
        .orderBy(desc(approvals.decidedAt))
        .limit(1),
    ]);
    if (v) {
      return {
        scriptId: s.id,
        title,
        approved: { version: s.lockedVersion, by: a ? (zh && a.nameLocal) || a.name : null, at: a?.at ? a.at.toISOString() : null },
        latestVersion: s.version,
        beats: v.beats.map((b) => ({ ord: b.ord, visual: b.visual, voiceover: b.voiceover })),
      };
    }
  }

  const draft = await db
    .select({ ord: scriptBeats.ord, visual: scriptBeats.visual, voiceover: scriptBeats.voiceover })
    .from(scriptBeats)
    .where(eq(scriptBeats.scriptId, s.id))
    .orderBy(scriptBeats.ord);
  return { scriptId: s.id, title, approved: null, latestVersion: s.version, beats: draft };
}
