"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import {
  createWorkProject,
  deleteProject,
  otherProjectWithScript,
  projectForTopic,
  resolveTopicRef,
  rewriteChannelTopic,
  scriptState,
  setProjectAccess,
  setProjectStatus,
  visibleProject,
} from "@/lib/projects/service";
import { postMessage } from "@/lib/chat/service";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { db } from "@/lib/db/client";
import { ideas, scripts, workProjects } from "@/lib/db/schema";
import { linkScript } from "@/lib/video/service";
import { share } from "@/lib/authz/rebac";
import { and, eq } from "drizzle-orm";
import { briefText, formatHints, isWriting, refFromChoice, type ProjectSource, type ScriptChips, type TopicRef } from "@/lib/projects/topic";
import { draftInBackground } from "@/lib/script/background";

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
export async function startProjectAction(input: { message?: string; title?: string; brief?: string | null; source?: ProjectSource | { kind: string; label?: string; url?: string | null } | null }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 2000) : "";
  const title = (typeof input.title === "string" && input.title.trim()) || titleFrom(message);
  if (!title) return { error: "A project needs a name or a first message" };

  const tagged = message ? parseAgentMentions(message) : [];
  const mode = tagged.length === 1 && tagged[0] === "video" ? "direct:video" : "full";
  const source = (input.source ?? null) as ProjectSource | null;
  const typed = message.replace(/@\S+/g, " ").replace(/\s+/g, " ").trim();
  const brief = (typeof input.brief === "string" && input.brief.trim().slice(0, 1000)) || (source && (source.why || source.hook) ? briefText(source, title) : "") || typed || source?.label || null;
  let created: { id: string; channelSlug: string; channelId: string };
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
  /* No whole-app revalidation here: it re-rendered the shell before the
     page moved, which read as the site reloading. The caller navigates and
     then refreshes the sidebar quietly. */
  return { id: created.id };
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
  if (isWriting(src, Date.now())) return { writing: true };
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
  const chips = cleanChips(opts.chips);

  /* A project that already exists: write its script (or rewrite it). */
  if (ref.kind === "project") {
    const p = await visibleProject(viewer, ref.id);
    if (!p) return { error: zh ? "没有这个项目" : "No such project" };
    const w = write ? await writeFromTopic(viewer, p, { rewrite: opts.rewrite === true, chips }) : { writing: false };
    return { projectId: p.id, scriptId: p.scriptId, existed: true, writing: w.writing, note: w.note ?? null };
  }

  let resolved;
  try {
    resolved = await resolveTopicRef(viewer, ref);
  } catch (err) {
    console.error("[projects] could not read the topic", err);
    resolved = null;
  }
  if (!resolved) return { error: zh ? "找不到这个选题了（可能已经过期）" : "That topic is no longer there" };

  const existing = await projectForTopic(viewer.tenantId, { topicId: resolved.projectTopicId, key: resolved.source.key, title: resolved.title, kind: resolved.source.kind });
  if (existing) {
    if (ref.kind === "idea") await db.update(ideas).set({ status: "started", projectId: existing.id, updatedAt: new Date() }).where(and(eq(ideas.id, ref.id), eq(ideas.tenantId, viewer.tenantId)));
    const w = write ? await writeFromTopic(viewer, existing, { chips, mandatoryPoints: resolved.mandatoryPoints, topicId: resolved.scriptTopicId }) : { writing: false };
    return { projectId: existing.id, scriptId: existing.scriptId, existed: true, writing: w.writing, note: w.note ?? null };
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
  return { projectId: created.id, scriptId: created.scriptId, existed: false, writing, note: null as string | null };
}

export async function setProjectStatusAction(id: string, status: "active" | "done" | "archived") {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (!["active", "done", "archived"].includes(status)) return { error: "No such status" };
  await setProjectStatus(viewer, id, status);
  revalidatePath("/", "layout");
  return {};
}

/** Rename a project. */
export async function renameProjectAction(id: string, title: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const t = String(title ?? "").trim().slice(0, 80);
  if (!t) return { error: "A project needs a name" };
  await db.update(workProjects).set({ title: t, updatedAt: new Date() }).where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId)));
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
  const [p] = await db.select().from(workProjects).where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId))).limit(1);
  if (!p) return { error: "No such project" };
  const [sc] = await db.select({ id: scripts.id, title: scripts.title }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!sc) return { error: "No such script" };
  const other = await otherProjectWithScript(viewer.tenantId, sc.id, p.id);
  if (other) return { error: zh ? `这个脚本已经是项目《${other.title}》的了` : `That script already belongs to “${other.title}”` };
  await db.update(workProjects).set({ scriptId: sc.id, updatedAt: new Date() }).where(eq(workProjects.id, p.id));
  if (p.videoProjectId) await linkScript(viewer, p.videoProjectId, sc.id).catch(() => {});
  await share(viewer, { type: "script", id: sc.id }, "editor", { type: "tenant", id: viewer.tenantId }).catch(() => null);
  await rewriteChannelTopic(p.id);
  /* The page refreshes itself; a whole-app revalidation read as a reload. */
  return {};
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
      .set({ title, brief: String(input.brief ?? "").slice(0, 1000) || title, source: { kind: "pick", label: input.label ?? "选题" }, updatedAt: new Date() })
      .where(eq(workProjects.id, p.id));
    await rewriteChannelTopic(p.id);
    return { scriptUpdated: false };
  }

  const resolved = await resolveTopicRef(viewer, ref);
  if (!resolved) return { error: zh ? "找不到这个选题了" : "That topic is no longer there" };
  await db
    .update(workProjects)
    .set({ title: resolved.title, brief: briefText(resolved.source, resolved.title), source: resolved.source, topicId: resolved.projectTopicId, updatedAt: new Date() })
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
