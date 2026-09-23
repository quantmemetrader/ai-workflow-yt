import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { seriesCache, topics } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { draftFromBrief } from "./ai";
import { createScript } from "./service";

/**
 * Research to a written script, in one move.
 *
 * The board had a hand-off that made a brief and stopped; the person then
 * opened the brief, pressed Generate, and waited. Choosing a topic and
 * reading a draft should be one decision apart, so this does both: the brief
 * from the topic and the angle, then the draft from the brief with the
 * headlines the topic collected as the facts it may use.
 *
 * Called by the Research screen's "Write the script" and by the agent's
 * `write_script`, so a person can do it with three chips or with a sentence.
 */
export type ScriptRequest = {
  /** A watched topic, when the script comes from one. */
  topicId?: string | null;
  /** Or any subject at all, in words. */
  subject?: string | null;
  angle?: string | null;
  /** "YouTube", "Shorts", "LinkedIn"… */
  channel?: string | null;
  aspect?: string | null;
  seconds?: number | null;
  language?: string | null;
  subtitleLanguage?: string | null;
  mandatoryPoints?: string[];
  folderId?: string | null;
};

export type ScriptResult =
  | { ok: true; id: string; title: string; beats: number; model: string | null; note: string | null }
  | { ok: false; error: string };

export async function writeScript(viewer: Viewer, req: ScriptRequest): Promise<ScriptResult> {
  let title = (req.subject ?? "").trim();
  let sources = "";
  let topicId: string | null = null;

  if (req.topicId) {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, req.topicId), eq(topics.tenantId, viewer.tenantId)))
      .limit(1);
    if (!topic) return { ok: false, error: "That topic does not exist." };
    topicId = topic.id;
    if (!title) title = req.angle?.trim() || topic.name;

    const [cached] = await db
      .select()
      .from(seriesCache)
      .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
      .limit(1);
    const articles = cached?.articles ?? [];
    sources = [
      topic.summary ? `What is happening: ${topic.summary}` : "",
      ...articles.slice(0, 30).map((a) => `- ${a.title} (${a.domain}, ${a.at.slice(0, 10)})`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (!title) return { ok: false, error: "Say what the script is about." };

  const seconds = req.seconds && Number.isFinite(req.seconds) ? Math.max(15, Math.min(3600, Math.round(req.seconds))) : null;
  const aspect =
    req.aspect && ["16:9", "9:16", "1:1"].includes(req.aspect)
      ? req.aspect
      : /short|tiktok|reel|抖音|视频号|shorts/i.test(req.channel ?? "")
        ? "9:16"
        : "16:9";

  const id = await createScript(viewer, {
    title: title.slice(0, 300),
    topicId,
    folderId: req.folderId ?? null,
    angle: req.angle?.trim() || null,
    targetChannel: req.channel?.trim() || null,
    aspect,
    targetSeconds: seconds,
    language: req.language?.trim() || null,
    subtitleLanguage: req.subtitleLanguage?.trim() || null,
    mandatoryPoints: (req.mandatoryPoints ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 12),
  });

  if (topicId) {
    await db.update(topics).set({ stage: "handed", updatedAt: new Date() }).where(eq(topics.id, topicId));
  }

  let beats = 0;
  let model: string | null = null;
  let note: string | null = null;
  try {
    const draft = await draftFromBrief(viewer, id, { sources });
    if ("error" in draft) note = draft.error ?? "The draft could not be written.";
    else {
      beats = draft.beats;
      model = draft.model;
    }
  } catch (err) {
    note = err instanceof Error ? err.message : "The draft could not be written.";
  }

  await audit(viewer, "script.write", {
    objectType: "script",
    objectId: id,
    module: "script",
    meta: { topicId, beats, model, channel: req.channel ?? null },
  });

  return { ok: true, id, title, beats, model, note };
}
