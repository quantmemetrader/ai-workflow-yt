"use server";

import { recordFeedback } from "@/lib/agents/learning";
import { toSimplified } from "@/lib/text/simplified";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import {
  createWorkProject,
  deleteProject,
  otherProjectWithScript,
  projectForTopic,
  projectsVisibleTo,
  resolveTopicRef,
  rewriteChannelTopic,
  scriptState,
  setProjectAccess,
  setProjectStatus,
  visibleProject,
  setProjectLink,
} from "@/lib/projects/service";
import { postMessage } from "@/lib/chat/service";
import { agentViewer } from "@/lib/agents";
import { isStepKey, readSentBack, recordSendBack, settleSendBack } from "@/lib/projects/sendback";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { db } from "@/lib/db/client";
import { ideas, scripts, workProjects } from "@/lib/db/schema";
import { linkScript } from "@/lib/video/service";
import { share } from "@/lib/authz/rebac";
import { and, eq, isNull, sql } from "drizzle-orm";
import { briefText, formatHints, isWriting, refFromChoice, type ProjectSource, type ScriptChips, type TopicRef } from "@/lib/projects/topic";
import { draftInBackground } from "@/lib/script/background";
import { scriptWriting } from "@/lib/script/writing";
import { markPublished, unmarkPublished, type PublishInput } from "@/lib/projects/published";
import { armAutoCut, disarmAutoCut, setAutoCut } from "@/lib/projects/live";
import { describeOutcome, startCutForProject } from "@/lib/projects/start-cut";
import { canEditProject } from "@/lib/video/access";
import { parseVoiceId } from "@/lib/video/tts/voices";

/** A title from what somebody typed: the tags and the filler taken out. */
function titleFrom(text: string): string {
  const clean = text
    .replace(/@\S+/g, " ")
    .replace(/^(请|帮我|麻烦|能不能|可以)?\s*(做|拍|写|剪|出)?(一个|一条|个|条)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || text).slice(0, 40);
}

/**
 * Start a project from a sentence, a pick, or a button, and say the first
 * thing in its chat. The employees tagged in that first message start at
 * once; one tagged alone (say 剪辑师 for a stock clip) makes a "direct"
 * project whose earlier steps are skipped.
 *
 * The brief is what the project is about, never the chat command: an
 * explicit `brief`, the topic snapshot's own words, or the sentence the
 * person typed with its tags taken out. It used to store "@编剧 按这个选题写
 * 脚本初稿《…》" and then copy that into the script's angle.
 *
 * Quick on purpose: the model calls run after the response.
 */
export async function startProjectAction(input: { message?: string; title?: string; brief?: string | null; source?: { kind: string; label?: string; url?: string | null } | null }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 2000) : "";
  const title = (typeof input.title === "string" && input.title.trim()) || titleFrom(message);
  if (!title) return { error: "A project needs a name or a first message" };

  const tagged = message ? parseAgentMentions(message) : [];
  const mode = tagged.length === 1 && tagged[0] === "video" ? "direct:video" : "full";
  /* Where it came from, in words only: a page cannot hand in evidence or a
     "why" for the project to carry. Topics with research behind them start
     through `startFromTopicAction`, which reads it on the server. */
  const raw = input.source && typeof input.source === "object" ? input.source : null;
  const source: ProjectSource | null = raw && typeof raw.kind === "string" ? { kind: raw.kind.slice(0, 20), label: typeof raw.label === "string" ? raw.label.slice(0, 60) : undefined, url: typeof raw.url === "string" ? raw.url.slice(0, 500) : null } : null;
  const typed = message.replace(/@\S+/g, " ").replace(/\s+/g, " ").trim();
  const brief = (typeof input.brief === "string" && input.brief.trim().slice(0, 1000)) || typed || source?.label || null;
  let created: { id: string; channelSlug: string; channelId: string; scriptId: string | null };
  try {
    created = await createWorkProject(viewer, { title, brief, mode, source: source ?? { kind: "person", label: viewer.nameLocal || viewer.name } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start the project" };
  }

  if (message) {
    await postMessage(viewer, created.channelId, message, {});
    if (tagged.length) {
      after(async () => {
        try {
          await dispatchAgentMentions({ viewer, channelId: created.channelId, body: message });
        } catch (err) {
          console.error("[projects] the first colleague could not be reached", err);
        }
      });
    }
  }
  /* Every new project starts with 编剧's first draft (the owner, 29 Sep: "when
     any topic creates a project, why don't you draft the first script
     automatically"), unless the first message already handed the work to
     someone (an @ in it) or the project skips the script. */
  let writing = false;
  if (mode === "full" && !tagged.length && created.scriptId && viewer.modules.includes("script")) {
    const w = await writeFromTopic(viewer, { id: created.id, title, scriptId: created.scriptId, channelId: created.channelId, source: source ?? null }, { chips: { angle: brief ? brief.slice(0, 400) : null } }).catch(() => ({ writing: false }));
    writing = w.writing;
  }
  /* No whole-app revalidation here: it re-rendered the shell before the
     page moved, which read as the site reloading. The caller navigates and
     then refreshes the sidebar quietly. */
  return { id: created.id, writing };
}

/* ------------------------------------------------ starting from a topic */

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The research board's chips, cleaned: they come from the browser. */
function cleanChips(chips: ScriptChips | null | undefined): ScriptChips {
  if (!chips || typeof chips !== "object") return {};
  const seconds = Number(chips.seconds);
  return {
    angle: str(chips.angle, 400) || null,
    channel: str(chips.channel, 60) || null,
    aspect: ["16:9", "9:16", "1:1"].includes(String(chips.aspect)) ? String(chips.aspect) : null,
    seconds: Number.isFinite(seconds) && seconds >= 15 && seconds <= 3600 ? Math.round(seconds) : null,
    language: str(chips.language, 40) || null,
    subtitleLanguage: str(chips.subtitleLanguage, 40) || null,
  };
}

function cleanRef(ref: unknown): TopicRef | null {
  if (!ref || typeof ref !== "object") return null;
  const r = ref as Record<string, unknown>;
  switch (r.kind) {
    case "signal":
      return { kind: "signal", date: str(r.date, 10) || null, index: Number.isInteger(r.index) ? (r.index as number) : null, title: str(r.title, 200) || null };
    case "topic":
    case "idea":
    case "project":
      return str(r.id, 64) ? ({ kind: r.kind, id: str(r.id, 64) } as TopicRef) : null;
    case "own":
      return str(r.text, 200) ? { kind: "own", text: str(r.text, 200) } : null;
    case "hot":
      return str(r.platform, 40) && str(r.phrase, 300) ? { kind: "hot", platform: str(r.platform, 40), phrase: str(r.phrase, 300) } : null;
    case "proposal":
      return str(r.text, 240) && ["plan", "backlog", "audience"].includes(String(r.source)) ? { kind: "proposal", text: str(r.text, 240), source: r.source as "plan" | "backlog" | "audience" } : null;
    default:
      return null;
  }
}

/**
 * Start writing a project's script from its topic, after the response.
 * `rewrite` keeps the beats that are there as a version first. Nothing
 * starts when a draft is already being written, or the script is locked.
 */
async function writeFromTopic(
  viewer: Viewer,
  project: { id: string; title: string; scriptId: string | null; channelId: string; source: unknown },
  opts: { rewrite?: boolean; chips?: ScriptChips; mandatoryPoints?: string[]; topicId?: string | null } = {},
): Promise<{ writing: boolean; note?: string }> {
  if (!project.scriptId) return { writing: false, note: "这个项目没有脚本。" };
  const src = (project.source as ProjectSource | null) ?? null;
  /* A draft already on its way into this script: from this project, or from
     another live project that shares the script (a pair made before sharing
     was refused), which would otherwise get a second writer at once. */
  if (isWriting(src, Date.now()) || (await scriptWriting(viewer.tenantId, project.scriptId)).writing) return { writing: true };
  const state = await scriptState(viewer.tenantId, project.scriptId);
  if (!state) return { writing: false, note: "脚本不见了。" };
  if (state.locked) return { writing: false, note: "脚本已锁定，先解锁再重写。" };
  if (state.beats > 0 && !opts.rewrite) return { writing: false };
  const chips = opts.chips ?? {};
  const hints = formatHints(src?.format);
  await draftInBackground(viewer, {
    projectId: project.id,
    channelId: project.channelId,
    scriptId: project.scriptId,
    rewrite: state.beats > 0,
    req: {
      topicId: opts.topicId ?? src?.topicId ?? null,
      subject: project.title,
      angle: chips.angle ?? src?.angle ?? null,
      channel: chips.channel ?? null,
      aspect: chips.aspect ?? hints.aspect,
      seconds: chips.seconds ?? hints.seconds,
      language: chips.language ?? null,
      subtitleLanguage: chips.subtitleLanguage ?? null,
      mandatoryPoints: opts.mandatoryPoints ?? [],
    },
  });
  return { writing: true };
}

/**
 * The one way a picked topic becomes work.
 *
 * Every "start this" and "write the script" button points here with what was
 * picked (`TopicRef`), and the snapshot is resolved on the server: the
 * project gets the clean brief, the topic's id and its evidence; its script
 * gets the title, the angle and the must-cover points. Choosing the same
 * thing twice returns the project already started from it.
 *
 * With `write`, the draft is started after the response
 * (`lib/script/background.ts`): the caller goes straight to
 * `/script/{scriptId}?writing=1`, which shows 编剧 writing and refreshes
 * when the draft lands. Starting a project needs Chat; writing needs Script,
 * and someone without it gets the project and no draft.
 */
export async function startFromTopicAction(rawRef: TopicRef, opts: { write?: boolean; rewrite?: boolean; chips?: ScriptChips } = {}) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const ref = cleanRef(rawRef);
  if (!ref) return { error: "Not allowed" };
  const write = opts.write === true && viewer.modules.includes("script");
  /* Asked to write without the Script module: the project still starts
     (or opens), and the answer says why no draft is coming rather than
     leaving the press to look like it did nothing. */
  const denied =
    opts.write === true && !write
      ? zh
        ? "写脚本需要脚本模块的权限，这次没有开始写初稿。"
        : "Writing the script needs the Script module, so no draft was started."
      : null;
  const chips = cleanChips(opts.chips);

  /* A project that already exists: write its script (or rewrite it). */
  if (ref.kind === "project") {
    const p = await visibleProject(viewer, ref.id);
    if (!p) return { error: zh ? "没有这个项目" : "No such project" };
    const w = write ? await writeFromTopic(viewer, p, { rewrite: opts.rewrite === true, chips }) : { writing: false };
    return { projectId: p.id, scriptId: p.scriptId, existed: true, writing: w.writing, note: w.note ?? denied };
  }

  let resolved;
  try {
    resolved = await resolveTopicRef(viewer, ref);
  } catch (err) {
    console.error("[projects] could not read the topic", err);
    resolved = null;
  }
  if (!resolved) return { error: zh ? "找不到这个选题了（可能已经过期）" : "That topic is no longer there" };

  /* An idea kept in the backlog may already have been started from its
     backlog topic (on the board, or in Script's queue): that project too. */
  const existing =
    (await projectForTopic(viewer, { topicId: resolved.projectTopicId, key: resolved.source.key, title: resolved.title, kind: resolved.source.kind })) ??
    (resolved.scriptTopicId && resolved.scriptTopicId !== resolved.projectTopicId ? await projectForTopic(viewer, { topicId: resolved.scriptTopicId }) : null);
  if (existing) {
    if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: existing.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, viewer.tenantId)));
    const w = write ? await writeFromTopic(viewer, existing, { chips, mandatoryPoints: resolved.mandatoryPoints, topicId: resolved.scriptTopicId }) : { writing: false };
    return { projectId: existing.id, scriptId: existing.scriptId, existed: true, writing: w.writing, note: w.note ?? denied };
  }

  const hints = formatHints(resolved.source.format);
  let created: { id: string; channelId: string; scriptId: string };
  try {
    created = await createWorkProject(viewer, {
      title: resolved.title,
      brief: briefText(resolved.source, resolved.title),
      source: resolved.source,
      topicId: resolved.projectTopicId,
      script: {
        topicId: resolved.scriptTopicId,
        angle: chips.angle ?? resolved.source.angle ?? null,
        mandatoryPoints: resolved.mandatoryPoints,
        targetChannel: chips.channel ?? null,
        aspect: chips.aspect ?? hints.aspect,
        targetSeconds: chips.seconds ?? hints.seconds,
        language: chips.language ?? null,
        subtitleLanguage: chips.subtitleLanguage ?? null,
      },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start the project" };
  }
  if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: created.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, viewer.tenantId)));

  let writing = false;
  if (write) {
    const w = await writeFromTopic(viewer, { id: created.id, title: resolved.title, scriptId: created.scriptId, channelId: created.channelId, source: resolved.source }, { chips, mandatoryPoints: resolved.mandatoryPoints, topicId: resolved.scriptTopicId });
    writing = w.writing;
  }
  /* No revalidatePath: the caller navigates, and the sidebar refreshes quietly. */
  return { projectId: created.id, scriptId: created.scriptId, existed: false, writing, note: denied };
}

export async function setProjectStatusAction(id: string, status: "active" | "archived") {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  /* Not "done": finishing a project is 「已发布 · 标记完成」
     (`markPublishedAction`), which checks who may and keeps where it went —
     this action would be a way round both. */
  if (!["active", "archived"].includes(status)) return { error: "No such status" };
  /* Only a project this person may see and manage (`setProjectStatus`
     checks): an action can be called with any id, not just the ones on screen. */
  if (!(await setProjectStatus(viewer, String(id ?? ""), status))) {
    return { error: (viewer.locale ?? "zh-CN").startsWith("zh") ? "没有这个项目" : "No such project" };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * 「已发布 · 标记完成」: the project is done, and where it went is kept
 * (platforms, links, a note; who and when are added here). Checked and
 * cleaned in `markPublished`: a project this person may see, not a guest's
 * to close unless it is theirs, links only http(s).
 *
 * The whole app is revalidated like any status change: the sidebar, Home and
 * the projects list all move it out of "in progress".
 */
export async function markPublishedAction(id: string, input: PublishInput) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const res = await markPublished(viewer, String(id ?? ""), input && typeof input === "object" ? input : {}, zh);
  if ("error" in res) return { error: res.error };
  revalidatePath("/", "layout");
  return { at: res.publication.at };
}

/** 「撤回，改回进行中」: undo 已发布 — back in progress, the record gone. */
export async function unpublishAction(id: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const res = await unmarkPublished(viewer, String(id ?? ""), zh);
  if ("error" in res) return { error: res.error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Rename a project. Only one this person may see, and not a deleted one:
 * the action is reachable with any id, and a private project's name is
 * its members' to change.
 */
export async function renameProjectAction(id: string, title: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const t = toSimplified(String(title ?? "").trim()).slice(0, 80);
  if (!t) return { error: "A project needs a name" };
  const renamed = await db
    .update(workProjects)
    .set({ title: t, updatedAt: new Date() })
    .where(and(eq(workProjects.id, String(id ?? "")), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .returning({ id: workProjects.id });
  if (!renamed.length) return { error: (viewer.locale ?? "zh-CN").startsWith("zh") ? "没有这个项目" : "No such project" };
  revalidatePath("/", "layout");
  return {};
}

/** Who can see and work on a project. */
export async function setProjectAccessAction(id: string, access: { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  try {
    await setProjectAccess(viewer, String(id), access);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change who sees it" };
  }
  revalidatePath("/", "layout");
  return {};
}

/** 有链接的人: nobody extra, can view, or can edit (the share box). */
export async function setProjectLinkAction(id: string, link: "view" | "edit" | null) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (link !== null && link !== "view" && link !== "edit") return { error: "Not allowed" };
  try {
    await setProjectLink(viewer, String(id), link);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成" };
  }
  revalidatePath(`/projects/${String(id)}`, "layout");
  return {};
}

export async function deleteProjectAction(id: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  try {
    await deleteProject(viewer, String(id));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete it" };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Use a script the studio already has for this project: it becomes the
 * project's script (and the video project's), shared with who can see the
 * project, and the chat's description names it for the employees.
 *
 * Not a script another live project already uses: two projects on one
 * script made "which project is this script in" unanswerable, and left the
 * second project's own script orphaned.
 */
export async function chooseScriptAction(projectId: string, scriptId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* Only a project this person may see, and not a deleted one. It used to
     be any project in the studio by id: pointing somebody's private project
     at a script of one's own re-wrote its chat's description, and every
     employee in that chat then wrote into a script the caller can read. */
  const p = await visibleProject(viewer, String(projectId ?? ""));
  if (!p) return { error: zh ? "没有这个项目" : "No such project" };
  const [sc] = await db.select({ id: scripts.id, title: scripts.title }).from(scripts).where(and(eq(scripts.id, String(scriptId ?? "")), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt))).limit(1);
  if (!sc) return { error: zh ? "没有这个脚本" : "No such script" };
  const other = await otherProjectWithScript(viewer.tenantId, sc.id, p.id);
  if (other) {
    /* Named only when this person may see that project: the refusal was a
       way to read any private project's title from its script's id. */
    const named = await visibleProject(viewer, other.id);
    return {
      error: named
        ? zh
          ? `这个脚本已经是项目《${named.title}》的了`
          : `That script already belongs to “${named.title}”`
        : zh
          ? "这个脚本已经属于另一个项目"
          : "That script already belongs to another project",
    };
  }
  await db.update(workProjects).set({ scriptId: sc.id, updatedAt: new Date() }).where(eq(workProjects.id, p.id));
  if (p.videoProjectId) await linkScript(viewer, p.videoProjectId, sc.id).catch(() => {});
  await share(viewer, { type: "script", id: sc.id }, "editor", { type: "tenant", id: viewer.tenantId }).catch(() => null);
  await rewriteChannelTopic(p.id);
  /* The page refreshes itself; a whole-app revalidation read as a reload. */
  return {};
}

/**
 * A new topic snapshot for `work_projects.source`, keeping the draft mark
 * the row holds when the update runs.
 *
 * Not the mark read before resolving the topic: that read is a few
 * round trips old by the time of the write, and a background draft that
 * finished in between (`setProjectWriting(null)`) had its "done" written
 * over with the stale "writing". For ten minutes the project then said 编剧
 * was writing when nothing was, and every 写初稿 press did nothing. The
 * right-hand side of an UPDATE reads the row as it is under the row lock,
 * so a mark set or cleared meanwhile survives.
 */
function keepWriting(next: ProjectSource | { kind: string; label?: string }) {
  const rest: Record<string, unknown> = { ...next };
  delete rest.writing;
  delete rest.published;
  delete rest.publishDraft;
  /* The 已发布 record rides in the same column (lib/projects/publication.ts)
     and is not the topic's: changing the topic keeps it, read the same way. */
  return sql`${JSON.stringify(rest)}::jsonb || jsonb_build_object('writing', coalesce(${workProjects.source} -> 'writing', 'null'::jsonb)) || (case when ${workProjects.source} ? 'published' then jsonb_build_object('published', ${workProjects.source} -> 'published') else '{}'::jsonb end) || (case when ${workProjects.source} ? 'publishDraft' then jsonb_build_object('publishDraft', ${workProjects.source} -> 'publishDraft') else '{}'::jsonb end)`;
}

/**
 * Point the project at a topic already picked.
 *
 * The picker sends the choice's id ("signal:<date>:<n>", "topic:<id>",
 * "idea:<id>", "own:<text>") and the topic is resolved here, like every
 * other start: the project gets its title, clean brief and snapshot. Its
 * script follows while it has no beats yet (title, angle, topic); once the
 * writer has written, the words are left alone and the answer says so, so
 * the page can offer a rewrite from the new topic.
 */
export async function chooseTopicAction(projectId: string, input: { id?: string; title?: string; brief?: string; label?: string }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await visibleProject(viewer, String(projectId ?? ""));
  if (!p) return { error: zh ? "没有这个项目" : "No such project" };

  const ref = input.id ? refFromChoice(String(input.id)) : null;
  if (!ref) {
    /* An older picker with only words: title and brief as given. */
    const title = String(input.title ?? "").trim().slice(0, 80);
    if (!title) return { error: "A topic needs a name" };
    await db
      .update(workProjects)
      .set({ title, brief: String(input.brief ?? "").slice(0, 1000) || title, source: keepWriting({ kind: "pick", label: input.label ?? "选题" }), updatedAt: new Date() })
      .where(eq(workProjects.id, p.id));
    await rewriteChannelTopic(p.id);
    return { scriptUpdated: false };
  }

  const resolved = await resolveTopicRef(viewer, ref);
  if (!resolved) return { error: zh ? "找不到这个选题了" : "That topic is no longer there" };
  await db
    .update(workProjects)
    /* A draft already being written keeps its mark: the page waiting on it
       would otherwise stop waiting before it lands. */
    .set({ title: resolved.title, brief: briefText(resolved.source, resolved.title), source: keepWriting(resolved.source), topicId: resolved.projectTopicId, updatedAt: new Date() })
    .where(eq(workProjects.id, p.id));

  let scriptUpdated = false;
  if (p.scriptId) {
    const state = await scriptState(viewer.tenantId, p.scriptId);
    if (state && !state.locked && state.beats === 0) {
      await db
        .update(scripts)
        .set({
          title: resolved.title.slice(0, 300),
          angle: resolved.source.angle ?? null,
          topicId: resolved.scriptTopicId,
          ...(resolved.mandatoryPoints.length ? { mandatoryPoints: resolved.mandatoryPoints } : {}),
          updatedAt: new Date(),
        })
        .where(eq(scripts.id, p.scriptId));
      scriptUpdated = true;
    }
  }
  if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: p.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, viewer.tenantId)));
  await rewriteChannelTopic(p.id);
  return { scriptUpdated, hasBeats: !scriptUpdated && Boolean(p.scriptId) };
}

/* --------------------------------------------- 素材传好了 · 开始剪 */

/** A project this person may see and whose video they may edit, with what
 *  starting the cut needs; the reason otherwise. */
async function cuttable(viewer: Viewer, projectId: string, zh: boolean) {
  if (typeof projectId !== "string" || !/^wp_[0-9a-z]{10,40}$/i.test(projectId)) return { error: zh ? "没有这个项目" : "No such project" } as const;
  if (!viewer.modules.includes("video")) return { error: zh ? "需要视频模块的权限" : "This needs the Video module" } as const;
  const p = await visibleProject(viewer, projectId);
  if (!p?.videoProjectId) return { error: zh ? "没有这个项目" : "No such project" } as const;
  if (!(await canEditProject(viewer, p.videoProjectId))) {
    return { error: zh ? "这个项目的视频只分享给你查看，请找负责人要编辑权限。" : "This project's video was shared with you to view. Ask its owner for edit access." } as const;
  }
  return { project: { id: p.id, title: p.title, channelId: p.channelId, videoProjectId: p.videoProjectId } } as const;
}

/**
 * The clips card's "素材传好了 · 开始剪": the one-go from the project page,
 * through the same starter the chat uses (`lib/projects/start-cut.ts`), so
 * 剪辑师 says in the project's chat what it is doing and the chat follows
 * it. The page's own prompt and voice choices travel with it, as they do
 * on the video card's button.
 */
export async function startCutFromPageAction(projectId: string, input: { prompt?: unknown; narrate?: unknown; voiceId?: unknown; aspect?: unknown } = {}) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const ok = await cuttable(viewer, projectId, zh);
  if ("error" in ok) return { error: ok.error };
  const narrate = input.narrate === "on" || input.narrate === "off" ? input.narrate : "auto";
  const voiceId = typeof input.voiceId === "string" && parseVoiceId(input.voiceId) ? input.voiceId.slice(0, 64) : null;
  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 2000) : undefined;
  const aspect = input.aspect === "16:9" ? "16:9" : "9:16";
  const outcome = await startCutForProject(viewer, ok.project, { via: "page", prompt: prompt || undefined, narrate, voiceId, aspect, quietWhenEmpty: true });
  const note = describeOutcome(outcome, ok.project.title, zh);
  if (outcome.kind === "error") return { error: outcome.error };
  if (outcome.kind === "no-clips") return { error: note };
  return { ok: true as const, kind: outcome.kind, note };
}

/** "传完自动开始剪", on or off, kept on the project. */
export async function setAutoCutAction(projectId: string, on: boolean) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const ok = await cuttable(viewer, projectId, zh);
  if ("error" in ok) return { error: ok.error };
  await setAutoCut(viewer, ok.project.id, Boolean(on));
  if (!on) await disarmAutoCut(viewer, ok.project.id);
  return {};
}

/**
 * An upload landed in the project's bin (the clips card): when the setting
 * is on, the cut is due a minute from now — a minute from the last one to
 * land, since every file moves it. Says when, so the card can count down.
 */
export async function clipLandedAction(projectId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const ok = await cuttable(viewer, projectId, zh);
  if ("error" in ok) return { error: ok.error };
  const dueAt = await armAutoCut(viewer, ok.project.id);
  return { dueAt };
}

/** "取消": the armed cut will not fire; the setting stays. */
export async function cancelAutoCutAction(projectId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const ok = await cuttable(viewer, projectId, zh);
  if ("error" in ok) return { error: ok.error };
  await disarmAutoCut(viewer, ok.project.id);
  return {};
}

/**
 * A line in the project's chat for a press on the flow bar
 * (「确认，交给剪辑师」, 「退回给 Catherine」), so the history says who moved
 * it on and why. Posted as the person and routed to nobody: an untagged
 * message in a project's chat goes to 剪辑师 as a reply, and 「素材齐了」
 * would start a second cut beside the one the press started.
 */
export async function flowNoteAction(projectId: string, body: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const text = typeof body === "string" ? body.trim().slice(0, 2000) : "";
  if (!text) return { error: "Nothing to send" };
  const project = await visibleProject(viewer, String(projectId ?? ""));
  if (!project) return { error: (viewer.locale ?? "zh-CN").startsWith("zh") ? "没有这个项目" : "No such project" };
  const id = await postMessage(viewer, project.channelId, text, { flow: true });
  if (!id) return { error: "Not posted" };
  revalidatePath(`/projects/${project.id}`);
  return { ok: true };
}

/**
 * 退回 with a note: kept on the project for the step's card
 * (`lib/projects/sendback.ts`) and said in the project's chat. A script
 * sent back comes with 编剧's edits, beat by beat, posted under the note
 * as 编剧's reply; nothing is rewritten until someone presses 按建议改写.
 * The other steps keep their own follow-up (the researcher asked again, the
 * editor re-cutting), which the page starts as before.
 */
export async function sendBackAction(projectId: string, step: string, note: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  if (!text) return { error: (viewer.locale ?? "zh-CN").startsWith("zh") ? "写下要改什么" : "Say what to change" };
  if (!isStepKey(step)) return { error: "No such step" };
  const project = await visibleProject(viewer, String(projectId ?? ""));
  if (!project) return { error: (viewer.locale ?? "zh-CN").startsWith("zh") ? "没有这个项目" : "No such project" };
  const kept = await recordSendBack(viewer, project, step, text);
  {
    const learner = step === "script" ? "script" : step === "topic" ? "research" : step === "edit" ? "video" : null;
    if (learner) await recordFeedback(viewer, learner, { kind: "sendback", text }).catch(() => false);
  }
  const who = step === "script" ? "编剧" : step === "topic" ? "研究员" : step === "edit" ? "剪辑师" : null;
  if (step === "script" || step === "clips") {
    await postMessage(viewer, project.channelId, `退回给${who ?? "上一步"}：${text}`, { flow: true, sentBack: step });
  }
  if (step === "script") {
    const writer = await agentViewer(viewer.tenantId, "script");
    const body = kept.suggestions?.length
      ? [`收到退回意见。具体改法如下，项目页「脚本」卡上可以一键按建议改写：`, ...kept.suggestions.map((x) => `- 第 ${x.ord} 镜：「${x.before}」→「${x.after}」（${x.why}）`)].join("\n")
      : `收到退回意见：「${text}」。项目页「脚本」卡上按「按建议改写」，我就按这条意见改。`;
    await postMessage(writer, project.channelId, body, { agent: "script", sentBack: step });
  }
  revalidatePath(`/projects/${project.id}`);
  return { ok: true, suggestions: kept.suggestions?.length ?? 0 };
}

/** 按建议改写: 编剧 is asked to make the edits it suggested (or to act on the note), in the project's chat. */
export async function applySendBackAction(projectId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const project = await visibleProject(viewer, String(projectId ?? ""));
  if (!project) return { error: "No such project" };
  const [row] = await db.select({ source: workProjects.source }).from(workProjects).where(eq(workProjects.id, project.id)).limit(1);
  const back = readSentBack(row?.source).script;
  if (!back) return { error: "Nothing was sent back" };
  const body = [
    `@编剧 按退回意见改好项目里的脚本：${back.note}`,
    ...(back.suggestions ?? []).map((x) => `- 第 ${x.ord} 镜：「${x.before}」改成「${x.after}」`),
  ].join("\n");
  await postMessage(viewer, project.channelId, body, {});
  after(async () => {
    try {
      await dispatchAgentMentions({ viewer, channelId: project.channelId, body });
    } catch (err) {
      console.error("[projects] 编剧 could not be reached for the edits", err);
    }
  });
  await settleSendBack(project.id, "script", "applied");
  revalidatePath(`/projects/${project.id}`);
  return { ok: true };
}

/** 标记已处理: the note has been dealt with. */
export async function settleSendBackAction(projectId: string, step: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (!isStepKey(step)) return { error: "No such step" };
  const project = await visibleProject(viewer, String(projectId ?? ""));
  if (!project) return { error: "No such project" };
  await settleSendBack(project.id, step, "done");
  revalidatePath(`/projects/${project.id}`);
  return { ok: true };
}

/** The length picked when starting a video (1 / 3 / 5 / 8 minutes), set on its script before the first draft. */
export async function setScriptLengthAction(projectId: unknown, seconds: unknown) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const secs = typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds) : NaN;
  if (typeof projectId !== "string" || !(secs >= 15 && secs <= 1800)) return { error: "Not allowed" };
  const [p] = await db.select({ scriptId: workProjects.scriptId }).from(workProjects).where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt))).limit(1);
  if (!p?.scriptId) return { error: "Not allowed" };
  await db.update(scripts).set({ targetSeconds: secs, updatedAt: new Date() }).where(eq(scripts.id, p.scriptId));
  return { ok: true as const };
}
