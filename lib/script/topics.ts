import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages, ideas, scripts, settings, topics, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { proposalsFor, type Proposals } from "@/lib/agents/proposals";
import { cleanCodes, fromSignal, isWriting, type ProjectSource, type SignalLike, type SourceEvidence, type TopicRef } from "@/lib/projects/topic";

/**
 * The Script module's 选题 (topics) queue: what is waiting to be written.
 *
 * The client's words: "the topic after selection should go straight to the
 * script part, but I don't see a topic page in the script part". Topics were
 * chosen on Home, in Research and in the backlog, and the Script module
 * showed none of them. This is that page's list, merged from what already
 * exists and nothing generated on the way in:
 *
 *   1. Projects whose script has no beats yet: a topic was chosen and the
 *      draft is still to come (or is being written right now).
 *   2. This morning's signals and today's own picks with no project yet.
 *   3. Saved ideas from Home, and adopted or saved backlog topics, with no
 *      project and no script yet.
 *   4. Today's plan to-dos addressed to 编剧.
 *
 * Each item carries the pointer (`ref`) its button hands to
 * `startFromTopicAction`, so writing one goes through the same door as
 * every other start.
 */
export type TopicQueueItem = {
  key: string;
  kind: "project" | "signal" | "own" | "idea" | "backlog" | "plan";
  title: string;
  /** Where it came from, in words ("晨报信号", "选题储备", "今天的计划"). */
  label: string;
  why: string | null;
  hook: string | null;
  angle: string | null;
  strength: number | null;
  evidence: SourceEvidence[];
  projectId: string | null;
  scriptId: string | null;
  scriptStatus: string | null;
  beats: number;
  topicId: string | null;
  /** A draft is being written for it now. */
  writing: boolean;
  createdAt: string | null;
  ref: TopicRef;
};

const hkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

export async function scriptTopicQueue(viewer: Viewer, opts: { proposals?: Proposals } = {}): Promise<TopicQueueItem[]> {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const tenantId = viewer.tenantId;
  const now = Date.now();
  const out: TopicQueueItem[] = [];

  /* What has a project already, so nothing below is offered twice. */
  const live = await db
    .select({
      id: workProjects.id,
      title: workProjects.title,
      brief: workProjects.brief,
      status: workProjects.status,
      source: workProjects.source,
      topicId: workProjects.topicId,
      scriptId: workProjects.scriptId,
      createdAt: workProjects.createdAt,
      scriptStatus: scripts.status,
      beats: sql<number>`(select count(*)::int from script_beats b where b.script_id = ${workProjects.scriptId})`,
    })
    .from(workProjects)
    .leftJoin(scripts, and(eq(scripts.id, workProjects.scriptId), isNull(scripts.deletedAt)))
    .where(and(eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt)))
    .orderBy(desc(workProjects.createdAt))
    .limit(200);
  const takenKeys = new Set(live.map((p) => (p.source as ProjectSource | null)?.key).filter((k): k is string => Boolean(k)));
  const takenTopics = new Set(live.map((p) => p.topicId).filter((k): k is string => Boolean(k)));

  /* 1. Projects waiting for their script. */
  for (const p of live) {
    if (p.status !== "active" || !p.scriptId || Number(p.beats) > 0 || p.scriptStatus === "locked") continue;
    const src = (p.source as ProjectSource | null) ?? null;
    out.push({
      key: `project:${p.id}`,
      kind: "project",
      title: p.title,
      label: src?.label ?? (zh ? "项目" : "Project"),
      why: src?.why ?? (p.brief ? cleanCodes(p.brief).split("\n")[0].slice(0, 200) || null : null),
      hook: src?.hook ?? null,
      angle: src?.angle ?? null,
      strength: typeof src?.strength === "number" ? src.strength : null,
      evidence: (src?.evidence ?? []).slice(0, 3),
      projectId: p.id,
      scriptId: p.scriptId,
      scriptStatus: p.scriptStatus ?? null,
      beats: 0,
      topicId: p.topicId,
      writing: isWriting(src, now),
      createdAt: p.createdAt.toISOString(),
      ref: { kind: "project", id: p.id },
    });
  }

  /* 2. This morning's signals and today's own picks, not yet a project. */
  const [digest] = await db
    .select({ meta: chatMessages.meta, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(and(eq(chatChannels.tenantId, tenantId), isNull(chatMessages.deletedAt), sql`(${chatMessages.meta} -> 'digest' ->> 'date') is not null`))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  const d = (digest?.meta as { digest?: { date?: unknown; signals?: unknown } } | null)?.digest;
  const date = typeof d?.date === "string" ? d.date : null;
  const signals = Array.isArray(d?.signals) ? (d!.signals as SignalLike[]).filter((x) => x && typeof x.title === "string") : [];
  if (date) {
    signals.forEach((sg, index) => {
      const src = fromSignal(sg, date, index);
      if (src.key && takenKeys.has(src.key)) return;
      out.push({
        key: src.key ?? `signal:${date}:${index}`,
        kind: "signal",
        title: sg.title,
        label: zh ? `晨报信号 · ${date}` : `Morning signal · ${date}`,
        why: src.why ?? null,
        hook: src.hook ?? null,
        angle: src.angle ?? null,
        strength: src.strength ?? null,
        evidence: (src.evidence ?? []).slice(0, 3),
        projectId: null,
        scriptId: null,
        scriptStatus: null,
        beats: 0,
        topicId: null,
        writing: false,
        createdAt: digest!.createdAt.toISOString(),
        ref: { kind: "signal", date, index, title: sg.title },
      });
    });
  }
  const [own] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, `research:own-picks:${tenantId}`)).limit(1);
  const today = hkToday();
  for (const pick of Array.isArray(own?.value) ? (own!.value as { text?: string; by?: string; at?: string; date?: string }[]) : []) {
    if (!pick.text || pick.date !== today || takenKeys.has(`own:${today}:${pick.text.slice(0, 120)}`)) continue;
    out.push({
      key: `own:${pick.text}`,
      kind: "own",
      title: pick.text,
      label: zh ? `${pick.by ?? ""}加的选题` : `Added by ${pick.by ?? "someone"}`,
      why: null,
      hook: null,
      angle: null,
      strength: null,
      evidence: [],
      projectId: null,
      scriptId: null,
      scriptStatus: null,
      beats: 0,
      topicId: null,
      writing: false,
      createdAt: pick.at ?? null,
      ref: { kind: "own", text: pick.text },
    });
  }

  /* 3. Ideas saved from Home, and backlog topics, with no project yet. */
  const saved = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.tenantId, tenantId), eq(ideas.status, "saved")))
    .orderBy(desc(ideas.updatedAt))
    .limit(12);
  for (const idea of saved) {
    if (takenTopics.has(idea.id) || idea.projectId) continue;
    out.push({
      key: `idea:${idea.id}`,
      kind: "idea",
      title: idea.title,
      label: zh ? "研究员的选题灵感" : "Researcher's idea",
      why: idea.why,
      hook: idea.hook,
      angle: idea.angle,
      strength: idea.strength,
      evidence: ((idea.evidence as SourceEvidence[]) ?? []).slice(0, 3),
      projectId: null,
      scriptId: null,
      scriptStatus: null,
      beats: 0,
      topicId: null,
      writing: false,
      createdAt: idea.createdAt.toISOString(),
      ref: { kind: "idea", id: idea.id },
    });
  }
  const backlog = await db
    .select({ id: topics.id, name: topics.name, nameLocal: topics.nameLocal, summary: topics.summary, angles: topics.angles, updatedAt: topics.updatedAt })
    .from(topics)
    .where(and(eq(topics.tenantId, tenantId), inArray(topics.status, ["adopted", "saved"]), sql`${topics.stage} <> 'handed'`))
    .orderBy(desc(topics.heat))
    .limit(20);
  const scripted = backlog.length
    ? new Set(
        (
          await db
            .select({ topicId: scripts.topicId })
            .from(scripts)
            .where(and(eq(scripts.tenantId, tenantId), isNull(scripts.deletedAt), inArray(scripts.topicId, backlog.map((b) => b.id))))
        ).map((r) => r.topicId),
      )
    : new Set<string | null>();
  for (const t of backlog) {
    if (takenTopics.has(t.id) || scripted.has(t.id)) continue;
    out.push({
      key: `topic:${t.id}`,
      kind: "backlog",
      title: (zh && t.nameLocal) || t.name,
      label: zh ? "选题储备" : "Topic backlog",
      why: t.summary ? t.summary.slice(0, 200) : null,
      hook: null,
      angle: t.angles[0] ?? null,
      strength: null,
      evidence: [],
      projectId: null,
      scriptId: null,
      scriptStatus: null,
      beats: 0,
      topicId: t.id,
      writing: false,
      createdAt: t.updatedAt.toISOString(),
      ref: { kind: "topic", id: t.id },
    });
  }

  /* 4. Today's plan: the to-dos 策划 addressed to 编剧. */
  const proposals: Pick<Proposals, "items" | "planDate"> = opts.proposals ?? (await proposalsFor(viewer, "script").catch(() => ({ owner: "script" as const, items: [], planDate: null })));
  for (const p of proposals.items) {
    if (p.source !== "plan" || takenKeys.has(`proposal:plan:${p.text.slice(0, 120)}`)) continue;
    out.push({
      key: `plan:${p.text}`,
      kind: "plan",
      title: p.text,
      label: zh ? `今天的计划${proposals.planDate ? ` · ${proposals.planDate}` : ""}` : `Today's plan${proposals.planDate ? ` · ${proposals.planDate}` : ""}`,
      why: p.why,
      hook: null,
      angle: null,
      strength: null,
      evidence: [],
      projectId: null,
      scriptId: null,
      scriptStatus: null,
      beats: 0,
      topicId: null,
      writing: false,
      createdAt: null,
      ref: { kind: "proposal", text: p.text, source: "plan" },
    });
  }

  return out.slice(0, 40);
}
