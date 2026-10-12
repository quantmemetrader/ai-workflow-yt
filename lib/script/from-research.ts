import "server-only";
import { modelFor } from "@/lib/ai/models";
import { AiError } from "@/lib/ai/openrouter";
import { readFileText } from "@/lib/ai/retrieval";
import { fileTextWithin } from "@/lib/files/extract";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scripts, seriesCache, topics, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { cleanCodes, draftSources, type ProjectSource } from "@/lib/projects/topic";
import { draftFromBrief } from "./ai";
import { googleNewsSearch } from "@/lib/research/beat-sources";

/** The latest headlines on a subject, both editions, as lines the writer can cite. */
async function liveNewsFor(subject: string): Promise<string> {
  const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [hk, us] = await Promise.all([within(googleNewsSearch(subject, "HK", 10), 12_000), within(googleNewsSearch(subject, "US", 10), 12_000)]);
  const rows = [...(hk ?? []), ...(us ?? [])].slice(0, 16);
  if (!rows.length) return "";
  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
  return ["最新新闻（写稿时可引用其中的事实、数字和日期；注明来源媒体）：", ...rows.map((n) => `- ${day(n.stats?.publishedAt)} · ${n.extra ?? "news"} — ${n.phrase}${n.url ? ` (${n.url})` : ""}`)].join("\n");
}
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
  /** The step being worked on, for the page waiting on it. */
  onStage?: (stage: "draft" | "extend" | "polish") => void;
  /**
   * The facts the writer may use, already written out. When absent and the
   * draft goes into an existing script, they are read from the script's
   * topic and its project (`sourcesForScript`).
   */
  sources?: string | null;
  /** What the person asked for in their own words (typed into the AI bar on an empty page). */
  instruction?: string | null;
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
  const refs = await sampleText(viewer, scriptId).catch(() => "");
  return [[fromProject, topic?.facts ?? ""].filter(Boolean).join("\n\n").slice(0, 4000), refs].filter(Boolean).join("\n\n");
}

/**
 * The script's 参考资料 for a first draft: a sample to write like, or notes to use
 * (Ryan, 1 Oct: scripts "based on different samples and styles"). A file attached
 * a moment ago is given up to a minute to be read.
 */
async function sampleText(viewer: Viewer, scriptId: string): Promise<string> {
  const [s] = await db.select({ ids: scripts.sourceFileIds }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  const ids = (s?.ids ?? []).slice(0, 5);
  if (!ids.length) return "";
  const parts: string[] = [];
  for (const id of ids) {
    await fileTextWithin(id, 60_000).catch(() => null);
    const f = await readFileText(viewer, id, 8000).catch(() => null);
    if (f?.text?.trim()) parts.push(`### ${f.name}\n${f.text}`);
  }
  return parts.length
    ? `同事附的范例 / 参考资料（选题永远是主线，不能被资料带跑题）：是范例稿的，只学它的结构、语气、节奏和开头方式，不要照搬它的内容和话题；是资料的，只有和这个选题直接相关的事实才可以用，和选题无关的内容一句都不要写进稿子。\n${parts.join("\n\n").slice(0, 16000)}`
    : "";
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
  /* Thin sources: the news about the subject right now, Chinese and English editions, so the draft
     has dates, numbers and outlets to lean on rather than the model's memory (13 Oct). */
  if (sources.length < 1500) {
    const live = await liveNewsFor(title).catch(() => "");
    if (live) sources = [sources, live].filter(Boolean).join("\n\n").slice(0, 6000);
  }

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
    ? await db.select({ id: scripts.id, title: scripts.title, lockedVersion: scripts.lockedVersion }).from(scripts).where(and(eq(scripts.id, req.intoScriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt))).limit(1)
    : [];
  /* Approved words are read-only, and every other write path refuses a
     locked script before touching it. This one used to rewrite its angle,
     channel and length first and only then have the draft refused, leaving
     an approved version's brief changed with nothing to show for it. */
  if (into && into.lockedVersion !== null) return { ok: false, error: "That script is locked: it was approved. Unlock it on its page before writing a new draft. Nothing was written and no project was created." };
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
      /* The second try goes to a different model at once: a provider that
         answered empty or unreadable a moment ago usually does it again, and
         that cost a client three minutes (stress run, 2 Oct). */
      const retryModel = attempt ? (modelFor.assistant() !== (modelFor.agent("script") ?? modelFor.drafting()) ? modelFor.assistant() : "deepseek/deepseek-v4-flash") : undefined;
      const draft = await draftFromBrief(viewer, id, { sources, instruction: req.instruction ?? undefined, onStage: req.onStage, ...(retryModel ? { model: retryModel } : {}) });
      if ("error" in draft) note = draft.error ?? "The draft could not be written.";
      else {
        beats = draft.beats;
        model = draft.model;
        note = null;
      }
    } catch (err) {
      note = err instanceof AiError ? err.userMessage : err instanceof Error ? err.message : "初稿没写成。";
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
