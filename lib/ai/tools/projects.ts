import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMembers, hotSnapshots, ideas, scripts, topics } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { requesterOf } from "@/lib/auth/types";
import type { ToolDef } from "@/lib/ai/openrouter";
import { audit } from "@/lib/audit";
import { takePreparedDraft } from "@/lib/agents/autorun";
import { agentViewer } from "@/lib/agents";
import { postMessage } from "@/lib/chat/service";
import { createWorkProject, projectForTopic, resolveTopicRef, scriptState, type ResolvedTopic } from "@/lib/projects/service";
import { briefText, formatHints, isWriting, type ProjectSource, type TopicRef } from "@/lib/projects/topic";
import { isListKey, type HotRow } from "@/lib/research/platform-catalog";
import { draftInBackground } from "@/lib/script/background";
import { scriptWriting } from "@/lib/script/writing";
import { NO_PERSON, personOf } from "./people";
import { str, type Artifact, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * A topic becomes work, by conversation.
 *
 * "把这个选题开成项目，写初稿" is the 开始 / 写脚本 button on a topic card,
 * said in a sentence: the same path (`startFromTopicAction`), so the project
 * gets the topic's clean brief and evidence, its script the topic's angle and
 * must-cover points, and choosing the same topic twice opens the project
 * already started from it.
 *
 * The project is the person's: they own it and its chat, so it is started as
 * them and never as the employee answering (which can see every project and
 * would make a project nobody asked to own). With no person behind the turn,
 * nothing is started.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "start_project_from_topic",
      description:
        "Start a project from a topic, as the person asking, and (by default) have 文案 write the first script draft in the background. The topic is a watched/backlog topic id (top_…), an idea id (idea_…), or the topic's words — matched against the studio's watched topics, 研究员's ideas, today's hot lists and the morning brief, else taken as the person's own topic. If a project was already started from it, that project is returned (and its script written if it has none yet). Returns the project's script link.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "A topic id or idea id, or the topic's words." },
          write: { type: "boolean", description: "Start writing the first draft too. Default true." },
          instruction: { type: "string", description: "Anything the writer should follow for the draft. Optional." },
          seconds: { type: "number", description: "Target length in seconds when the person gave one (\"60 秒\" is 60, \"3 分钟\" is 180). Optional." },
        },
        required: ["topic"],
      },
    },
  },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Exact, then contained either way (only for words long enough to mean something). */
function matches(candidate: string, wanted: string, exact: boolean): boolean {
  const c = norm(candidate);
  if (!c) return false;
  if (exact) return c === wanted;
  return c.includes(wanted) || (c.length >= 4 && wanted.includes(c));
}

/**
 * What the model wrote, as the `TopicRef` a topic card would have sent.
 * Ids are taken as they are; words are looked for where a person would
 * have picked them from, in the order the screens offer them.
 */
async function refFor(viewer: Viewer, raw: string): Promise<TopicRef> {
  const ref = raw.trim();
  if (/^top_[0-9a-z]{20,32}$/i.test(ref)) return { kind: "topic", id: ref.toLowerCase() };
  if (/^idea_[0-9a-z]{20,32}$/i.test(ref)) return { kind: "idea", id: ref.toLowerCase() };
  const wanted = norm(ref.replace(/^[《「“"]|[》」”"]$/g, ""));

  const watched = await db
    .select({ id: topics.id, name: topics.name, nameLocal: topics.nameLocal, query: topics.query, status: topics.status })
    .from(topics)
    .where(and(eq(topics.tenantId, viewer.tenantId), sql`${topics.status} <> 'rejected'`))
    .orderBy(desc(topics.heat))
    .limit(500);
  const recent = await db
    .select({ id: ideas.id, title: ideas.title })
    .from(ideas)
    .where(and(eq(ideas.tenantId, viewer.tenantId), sql`${ideas.status} <> 'dismissed'`))
    .orderBy(desc(ideas.createdAt))
    .limit(200);
  for (const exact of [true, false]) {
    const t = watched.find((x) => [x.name, x.nameLocal ?? "", x.query].some((c) => matches(c, wanted, exact)));
    if (t) return { kind: "topic", id: t.id };
    const i = recent.find((x) => matches(x.title, wanted, exact));
    if (i) return { kind: "idea", id: i.id };
  }

  /* The newest stored list of each platform from the last three days: a
     row of today's hot list, read from storage, never a live (billed) call. */
  const lists = await db
    .selectDistinctOn([hotSnapshots.platform], { platform: hotSnapshots.platform, rows: hotSnapshots.rows })
    .from(hotSnapshots)
    .where(gt(hotSnapshots.fetchedAt, sql`now() - interval '3 days'`))
    .orderBy(hotSnapshots.platform, desc(hotSnapshots.fetchedAt));
  for (const exact of [true, false]) {
    for (const l of lists) {
      if (!isListKey(l.platform)) continue;
      const row = (l.rows as HotRow[]).find((r) => r && typeof r.phrase === "string" && matches(r.phrase, wanted, exact));
      if (row) return { kind: "hot", platform: l.platform, phrase: row.phrase };
    }
  }

  /* A morning-brief signal, by its title. */
  const signal: TopicRef = { kind: "signal", title: ref.slice(0, 200) };
  if (await resolveTopicRef(viewer, { kind: "signal", date: null, index: null, title: ref.slice(0, 200) }).then((r) => r && r.source.kind !== "digest").catch(() => false)) return signal;

  return { kind: "own", text: ref.slice(0, 200) };
}

/** startFromTopicAction's writeFromTopic: the draft, after the reply, unless one is on its way or the script is locked or written. */
async function writeFromTopic(
  viewer: Viewer,
  project: { id: string; title: string; scriptId: string | null; channelId: string; source: unknown },
  opts: { mandatoryPoints?: string[]; topicId?: string | null; instruction?: string | null; seconds?: number | null },
): Promise<{ writing: boolean; note?: string }> {
  if (!project.scriptId) return { writing: false, note: "The project has no script." };
  const src = (project.source as ProjectSource | null) ?? null;
  if (isWriting(src, Date.now()) || (await scriptWriting(viewer.tenantId, project.scriptId)).writing) return { writing: true, note: "A draft was already being written." };
  const state = await scriptState(viewer.tenantId, project.scriptId);
  if (!state) return { writing: false, note: "The script is gone." };
  if (state.locked) return { writing: false, note: "The script is locked (approved); unlock it before rewriting." };
  if (state.beats > 0) return { writing: false, note: "The script already has a draft; to change it, use write_script with the script's id." };
  const hints = formatHints(src?.format);
  await draftInBackground(viewer, {
    projectId: project.id,
    channelId: project.channelId,
    scriptId: project.scriptId,
    rewrite: false,
    req: {
      topicId: opts.topicId ?? src?.topicId ?? null,
      subject: project.title,
      angle: src?.angle ?? null,
      channel: null,
      aspect: hints.aspect,
      seconds: opts.seconds ?? hints.seconds,
      language: null,
      subtitleLanguage: null,
      mandatoryPoints: opts.mandatoryPoints ?? [],
      instruction: opts.instruction ?? null,
    },
  });
  return { writing: true };
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name !== "start_project_from_topic") return { text: `Unknown tool ${name}.` };
  if (ctx.readOnly) return { text: "This turn may only look things up; nothing was started." };
  const person = personOf(ctx);
  if (!person) return { text: NO_PERSON };
  if (!person.modules.includes("chat")) return { text: "The person asking cannot start projects (no Chat module). Nothing was started." };

  const raw = str(args.topic, 300);
  if (!raw) return { text: "Say which topic." };
  const wantWrite = args.write !== false;
  const write = wantWrite && person.modules.includes("script");
  const denied = wantWrite && !write ? "Writing the script needs the Script module, which the person does not have, so no draft was started." : null;
  const instruction = str(args.instruction, 1500) || null;
  /* The length the person asked for (QA, 10 Oct: "60 秒" became a 30-second target and a 2-minute draft). */
  const secondsOf = (): number | null => {
    const n = Number(args.seconds);
    if (Number.isFinite(n) && n >= 10 && n <= 3600) return Math.round(n);
    const said = `${instruction ?? ""} ${str(args.topic, 300)}`;
    const m = /(\d+(?:\.\d+)?)\s*(秒|s\b|sec|seconds?|分钟|min(?:ute)?s?)/i.exec(said);
    if (!m) return null;
    const v = Number(m[1]) * (/分|min/i.test(m[2]) ? 60 : 1);
    return v >= 10 && v <= 3600 ? Math.round(v) : null;
  };
  const seconds = secondsOf();

  const ref = await refFor(person, raw);
  let resolved: ResolvedTopic | null;
  try {
    resolved = await resolveTopicRef(person, ref);
  } catch (err) {
    console.error("[tools] could not read the topic", err);
    resolved = null;
  }
  if (!resolved) return { text: "That topic is no longer there (it may have expired). Nothing was started." };

  const link = (id: string) => `/projects/${id}/script`;
  const existing =
    (await projectForTopic(person, { topicId: resolved.projectTopicId, key: resolved.source.key, title: resolved.title, kind: resolved.source.kind })) ??
    (resolved.scriptTopicId && resolved.scriptTopicId !== resolved.projectTopicId ? await projectForTopic(person, { topicId: resolved.scriptTopicId }) : null);
  if (existing) {
    if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: existing.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, person.tenantId)));
    if (seconds && existing.scriptId) await db.update(scripts).set({ targetSeconds: seconds }).where(and(eq(scripts.id, existing.scriptId), eq(scripts.tenantId, person.tenantId)));
    const w = write ? await writeFromTopic(person, existing, { mandatoryPoints: resolved.mandatoryPoints, topicId: resolved.scriptTopicId, instruction, seconds }) : { writing: false };
    const startedNow = w.writing && !w.note;
    return {
      text: [
        `A project was already started from this topic: "${existing.title}". Open it at ${link(existing.id)} (id: ${existing.id}).`,
        startedNow ? "文案 is writing its first draft now; it lands in a minute or two and is announced in the project's chat." : w.note ?? "",
        denied ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      changed: startedNow,
      ...(startedNow && existing.scriptId ? { artifacts: [{ kind: "script", id: existing.scriptId, title: existing.title, action: "started" }] as Artifact[] } : {}),
    };
  }

  const hints = formatHints(resolved.source.format);
  const prepared = write ? await takePreparedDraft(person, resolved.title).catch(() => null) : null;
  let created: { id: string; channelId: string; scriptId: string };
  try {
    created = await createWorkProject(person, {
      title: resolved.title,
      brief: briefText(resolved.source, resolved.title),
      source: resolved.source,
      topicId: resolved.projectTopicId,
      ...(prepared ? { scriptId: prepared } : {}),
      script: {
        topicId: resolved.scriptTopicId,
        angle: resolved.source.angle ?? null,
        mandatoryPoints: resolved.mandatoryPoints,
        targetChannel: null,
        aspect: hints.aspect,
        targetSeconds: seconds ?? hints.seconds,
        language: null,
        subtitleLanguage: null,
      },
    });
  } catch (err) {
    return { text: `The project was not started: ${err instanceof Error ? err.message : "unknown error"}` };
  }
  if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: created.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, person.tenantId)));

  let writing = false;
  let note: string | undefined;
  if (write && !prepared) {
    const w = await writeFromTopic(person, { id: created.id, title: resolved.title, scriptId: created.scriptId, channelId: created.channelId, source: resolved.source }, { mandatoryPoints: resolved.mandatoryPoints, topicId: resolved.scriptTopicId, instruction, seconds });
    writing = w.writing;
    note = w.note;
  }
  if (prepared) {
    const writer = await agentViewer(person.tenantId, "script", requesterOf(person)).catch(() => null);
    if (writer) {
      await db.insert(chatMembers).values({ channelId: created.channelId, userId: writer.id }).onConflictDoNothing().catch(() => {});
      await postMessage(writer, created.channelId, `《${resolved.title}》的初稿我早上就写好了，已经在脚本里。看一遍，哪里要改直接说。`, { draft: { scriptId: created.scriptId } }).catch(() => {});
    }
  }
  await audit(person, "project.start_from_topic", { objectType: "project", objectId: created.id, module: "chat", meta: { kind: ref.kind, title: resolved.title, write: writing, via: "agent" } });

  const artifacts: Artifact[] = [{ kind: "work_project", id: created.id, title: resolved.title, action: "created" }];
  if (writing) artifacts.push({ kind: "script", id: created.scriptId, title: resolved.title, action: "started" });
  return {
    text: [
      `Started the project "${resolved.title}" (from ${resolved.source.label ?? ref.kind}). Open it at ${link(created.id)} (id: ${created.id}).`,
      prepared ? "文案 had already written this draft this morning; it is in the script now." : writing ? "文案 is writing the first draft now; it lands in a minute or two and is announced in the project's chat. It is not finished yet." : note ?? "",
      denied ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    changed: true,
    artifacts,
  };
}

export const projectsPack: ToolPack = { module: "chat", defs, run };
