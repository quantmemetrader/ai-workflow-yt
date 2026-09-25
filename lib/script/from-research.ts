import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scripts, seriesCache, topics, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { cleanCodes, draftSources, type ProjectSource } from "@/lib/projects/topic";
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
  /** Write into this script instead of making a new one (a project's own). */
  intoScriptId?: string | null;
  /**
   * The facts the writer may use, already written out. When absent and the
   * draft goes into an existing script, they are read from the script's
   * topic and its project (`sourcesForScript`).
   */
  sources?: string | null;
};

/* --------------------------------------------------------- the facts */

/** A topic's own summary and the headlines its chart collected. */
async function topicFacts(tenantId: string, topicId: string): Promise<{ id: string; name: string; facts: string } | null> {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, tenantId)))
    .limit(1);
  if (!topic) return null;
  const [cached] = await db
    .select({ articles: seriesCache.articles })
    .from(seriesCache)
    .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
    .limit(1);
  const articles = cached?.articles ?? [];
  const facts = [
    topic.summary ? `What is happening: ${topic.summary}` : "",
    ...articles.slice(0, 30).map((a) => `- ${a.title} (${a.domain}, ${a.at.slice(0, 10)})`),
  ]
    .filter(Boolean)
    .join("\n");
  return { id: topic.id, name: topic.name, facts };
}

/**
 * The project a script belongs to (the first live one), with its snapshot.
 * Read directly rather than through `lib/projects/service`, which imports
 * this module's neighbours; one small query is simpler than an import cycle.
 */
async function projectOfScript(tenantId: string, scriptId: string) {
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, brief: workProjects.brief, source: workProjects.source, topicId: workProjects.topicId, channelId: workProjects.channelId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt)))
    .orderBy(workProjects.createdAt)
    .limit(1);
  return row ?? null;
}

/**
 * Which backlog topic a script is about: its own `topic_id`, else its
 * project's (the column, or the snapshot's `topicId`). Only ever a real
 * `topics` row: a project started from an idea keeps the idea's id there.
 */
export async function topicIdForScript(tenantId: string, scriptId: string): Promise<string | null> {
  const [script] = await db.select({ topicId: scripts.topicId }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, tenantId))).limit(1);
  const project = await projectOfScript(tenantId, scriptId);
  const candidates = [script?.topicId, project?.topicId, (project?.source as ProjectSource | null)?.topicId].filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!candidates.length) return null;
  const found = await db.select({ id: topics.id }).from(topics).where(and(eq(topics.tenantId, tenantId), inArray(topics.id, candidates)));
  const ids = new Set(found.map((f) => f.id));
  return candidates.find((c) => ids.has(c)) ?? null;
}

/**
 * Everything the writer should have in front of it for this script: the
 * project's topic snapshot (why now, the hook, the angle, the evidence rows
 * with their own numbers) and the backlog topic's headlines. "Generate from
 * brief" and the writer's own tool both read this, so a regenerate no longer
 * loses the research the first draft was written from.
 */
export async function sourcesForScript(viewer: Viewer, scriptId: string, topicId?: string | null): Promise<string> {
  const project = await projectOfScript(viewer.tenantId, scriptId);
  const snapshot = (project?.source as ProjectSource | null) ?? null;
  const tid = topicId ?? (await topicIdForScript(viewer.tenantId, scriptId));
  const topic = tid ? await topicFacts(viewer.tenantId, tid) : null;
  const fromProject = draftSources(snapshot) || (project?.brief ? `项目简介：${cleanCodes(project.brief).slice(0, 400)}` : "");
  return [fromProject, topic?.facts ?? ""].filter(Boolean).join("\n\n").slice(0, 4000);
}

export type ScriptResult =
  | { ok: true; id: string; title: string; beats: number; model: string | null; note: string | null }
  | { ok: false; error: string };

export async function writeScript(viewer: Viewer, req: ScriptRequest): Promise<ScriptResult> {
  let title = (req.subject ?? "").trim();
  let sources = (req.sources ?? "").trim();
  let topicId: string | null = null;

  /* Inside a project the project knows its topic. The writer's tool matches
     topics by name, which is a guess; the script's own topic, or the one the
     project was started from, is not, so it wins. */
  const intoTopic = req.intoScriptId ? await topicIdForScript(viewer.tenantId, req.intoScriptId) : null;
  const wantedTopic = intoTopic ?? req.topicId ?? null;

  if (wantedTopic) {
    const topic = await topicFacts(viewer.tenantId, wantedTopic);
    if (!topic && !intoTopic) return { ok: false, error: "That topic does not exist." };
    if (topic) {
      topicId = topic.id;
      if (!title) title = req.angle?.trim() || topic.name;
      if (!sources && !req.intoScriptId) sources = topic.facts;
    }
  }
  /* A project's script: its snapshot's evidence and the topic's headlines,
     unless the caller already wrote the facts out. */
  if (!sources && req.intoScriptId) sources = await sourcesForScript(viewer, req.intoScriptId, topicId);

  if (!title) return { ok: false, error: "Say what the script is about." };

  const seconds = req.seconds && Number.isFinite(req.seconds) ? Math.max(15, Math.min(3600, Math.round(req.seconds))) : null;
  const aspect =
    req.aspect && ["16:9", "9:16", "1:1"].includes(req.aspect)
      ? req.aspect
      : /short|tiktok|reel|抖音|视频号|shorts/i.test(req.channel ?? "")
        ? "9:16"
        : "16:9";

  /* In a project the draft goes into the project's own script; a new one
     each time left the project's script empty and scattered drafts about. */
  const [into] = req.intoScriptId
    ? await db.select({ id: scripts.id, title: scripts.title }).from(scripts).where(and(eq(scripts.id, req.intoScriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt))).limit(1)
    : [];
  if (into) {
    await db
      .update(scripts)
      .set({
        /* The wire the project's script was missing: the draft now says
           which backlog topic it was written from. */
        topicId: topicId ?? undefined,
        angle: req.angle?.trim() || undefined,
        targetChannel: req.channel?.trim() || undefined,
        /* Only when the caller said something about it: a project's script
           keeps the aspect its brief was given (a rewrite used to reset a
           9:16 script to 16:9). */
        aspect: req.aspect || req.channel ? aspect : undefined,
        targetSeconds: seconds ?? undefined,
        language: req.language?.trim() || undefined,
        subtitleLanguage: req.subtitleLanguage?.trim() || undefined,
        updatedAt: new Date(),
      })
      .where(eq(scripts.id, into.id));
  }
  const id = into ? into.id : await createScript(viewer, {
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

  /* Being written is "Scripting" on the backlog board. "Handed to Video"
     is for when the script is approved and goes to the edit; it used to be
     set here, the moment a script existed. A topic already further along
     stays where it is. */
  if (topicId) {
    await db
      .update(topics)
      .set({ stage: "scripting", updatedAt: new Date() })
      .where(and(eq(topics.id, topicId), inArray(topics.stage, ["adopted", "briefing"])));
  }

  let beats = 0;
  let model: string | null = null;
  let note: string | null = null;
  /* The drafting model now and then answers with something unreadable; a
     second try almost always lands, and a script with no beats is useless. */
  for (let attempt = 0; attempt < 2 && beats === 0; attempt++) {
    try {
      const draft = await draftFromBrief(viewer, id, { sources });
      if ("error" in draft) note = draft.error ?? "The draft could not be written.";
      else {
        beats = draft.beats;
        model = draft.model;
        note = null;
      }
    } catch (err) {
      note = err instanceof Error ? err.message : "The draft could not be written.";
    }
  }

  await audit(viewer, "script.write", {
    objectType: "script",
    objectId: id,
    module: "script",
    meta: { topicId, beats, model, channel: req.channel ?? null },
  });

  return { ok: true, id, title, beats, model, note };
}
