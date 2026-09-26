import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, chatChannels, chatMessages, conversations, scripts, settings, toolCalls, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { audit } from "@/lib/audit";
import { relationOn, share } from "@/lib/authz/rebac";
import { postMessage } from "@/lib/chat/service";
import { createWorkProject, projectFor, projectsVisibleTo, setProjectAccess, visibleProject } from "@/lib/projects/service";
import { VIDEO_READ_ONLY, videoPack } from "@/lib/ai/tools/video";
import { budgetState, recordUsage } from "@/lib/ai/ledger";
import { modelFor } from "@/lib/ai/models";
import { askTitle, firstAsk, withoutTags } from "@/lib/chat/project-title";

/**
 * A private conversation with an employee (or the person's own assistant),
 * and the project it belongs to.
 *
 * The owner: "on chat, once I start texting with an agent I should get an
 * option to create / open this on the project page." Everything lives under
 * a project, and a good question to 研究员 on the chat screen used to end
 * there: the answer sat in a private thread nobody else could see, and
 * starting a project from it meant retyping it on the Projects page.
 *
 * Three ways a conversation is already a project's:
 *
 *   1. It was turned into one here (`createFromConversation`), which leaves
 *      a link: a `settings` row keyed by the conversation (no migration),
 *      and the project's `source.conversationId`.
 *   2. An employee did project work in it: 编剧's `write_script` starts or
 *      writes into a project, 剪辑师's edits act on one, and `assign_task`
 *      hands work on inside one. Those are the turn's receipts; the ids are
 *      read back from the tool rows of this conversation, newest first.
 *      Reads (list_projects, list_scripts) are not receipts: a list of every
 *      project does not make the conversation about any of them.
 *   3. The screen the side panel sits on is a project's (its video, its
 *      script, its page).
 *
 * Every project named is checked against the person (`visibleProject`,
 * `projectsVisibleTo`): a private project somebody else started is not
 * offered, even when an employee — who is in every project — worked in it.
 */

const linkKey = (conversationId: string) => `chat:conversation-project:${conversationId}`;

type LinkValue =
  | { projectId: string; tenantId: string; userId: string; at: string }
  | { state: "creating"; tenantId: string; userId: string; at: string };

const ID = /\b(wp|scr|prj|msg)_[0-9a-z]{26}\b/g;

/** Tools whose success means work was done in a project (their receipts). */
function workTools(): ReadonlySet<string> {
  const video = videoPack.defs.map((d) => d.function.name).filter((n) => !VIDEO_READ_ONLY.includes(n));
  return new Set(["write_script", "assign_task", ...video]);
}

export type BridgeHints = { projectId?: string | null; videoProjectId?: string | null; scriptId?: string | null };

export type BridgeProject = { id: string; title: string; via: "link" | "work" | "screen" };

export type BridgeState = {
  project: BridgeProject | null;
  /** A person who may start projects (not a guest, holds Chat). */
  canCreate: boolean;
  /** The name to suggest: the person's first real ask, cleaned. */
  title: string;
  /** A script an employee wrote here that no project holds; a new project takes it. */
  looseScript: { id: string; title: string } | null;
};

/** This person's own conversation, or nothing (someone else's id is not found). */
async function ownConversation(viewer: Viewer, conversationId: string) {
  if (!/^cnv_[0-9a-z]{10,40}$/.test(conversationId)) return null;
  const [row] = await db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, viewer.id), isNull(conversations.archivedAt)))
    .limit(1);
  return row ?? null;
}

export function mayCreate(viewer: Viewer): boolean {
  return viewer.role !== "guest" && viewer.modules.includes("chat");
}

async function readLink(conversationId: string): Promise<LinkValue | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, linkKey(conversationId))).limit(1);
  const v = row?.value as Partial<LinkValue> | undefined;
  return v && typeof v === "object" && typeof v.tenantId === "string" ? (v as LinkValue) : null;
}

/**
 * The ids this conversation's receipts name, newest first: from the work
 * tools' arguments and results, and — for a hand-off — from the checked
 * artifacts on the message `assign_task` posted.
 */
async function receiptRefs(viewer: Viewer, conversationId: string): Promise<{ refs: { kind: "wp" | "scr" | "prj"; id: string }[]; written: string[] }> {
  const rows = await db
    .select({ name: toolCalls.name, args: toolCalls.args, result: toolCalls.result })
    .from(toolCalls)
    .innerJoin(agentMessages, eq(agentMessages.id, toolCalls.messageId))
    .where(and(eq(agentMessages.conversationId, conversationId), eq(toolCalls.status, "ok")))
    .orderBy(desc(agentMessages.createdAt), desc(toolCalls.createdAt))
    .limit(200);
  const work = workTools();
  const refs: { kind: "wp" | "scr" | "prj"; id: string }[] = [];
  const written: string[] = [];
  const handoffs: string[] = [];
  const seen = new Set<string>();
  const add = (kind: "wp" | "scr" | "prj", id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    refs.push({ kind, id });
  };
  for (const r of rows) {
    if (!work.has(r.name)) continue;
    const text = `${JSON.stringify(r.args ?? {})}\n${typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? "")}`;
    for (const m of text.matchAll(ID)) {
      const kind = m[1] as "wp" | "scr" | "prj" | "msg";
      if (kind === "msg") {
        if (r.name === "assign_task") handoffs.push(m[0]);
        continue;
      }
      if (kind === "scr" && r.name === "write_script") written.push(m[0]);
      add(kind, m[0]);
    }
  }
  /* A hand-off names its project on the message it posted, checked there. */
  if (handoffs.length) {
    const posted = await db
      .select({ id: chatMessages.id, meta: chatMessages.meta })
      .from(chatMessages)
      .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
      .where(and(inArray(chatMessages.id, handoffs.slice(0, 20)), eq(chatChannels.tenantId, viewer.tenantId)));
    for (const id of handoffs) {
      const meta = posted.find((p) => p.id === id)?.meta as { handoff?: { artifacts?: { kind?: unknown; id?: unknown }[] } } | undefined;
      for (const a of meta?.handoff?.artifacts ?? []) {
        if (typeof a?.id !== "string") continue;
        if (a.kind === "work_project") add("wp", a.id);
        else if (a.kind === "script") add("scr", a.id);
        else if (a.kind === "video_project") add("prj", a.id);
      }
    }
  }
  return { refs, written: [...new Set(written)] };
}

/** The first of these refs that is a live project this person may see. */
async function firstVisible(viewer: Viewer, refs: { kind: "wp" | "scr" | "prj"; id: string }[]) {
  if (!refs.length) return null;
  const ids = (k: string) => refs.filter((r) => r.kind === k).map((r) => r.id).slice(0, 100);
  const [wp, scr, prj] = [ids("wp"), ids("scr"), ids("prj")];
  const anyOf = [wp.length ? inArray(workProjects.id, wp) : null, scr.length ? inArray(workProjects.scriptId, scr) : null, prj.length ? inArray(workProjects.videoProjectId, prj) : null].filter(
    (c): c is NonNullable<typeof c> => c !== null,
  );
  const rows = await db
    .select({ id: workProjects.id, title: workProjects.title, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer), sql`(${sql.join(anyOf.map((c) => sql`(${c})`), sql` or `)})`))
    .orderBy(asc(workProjects.createdAt));
  for (const r of refs) {
    const hit = rows.find((p) => (r.kind === "wp" ? p.id === r.id : r.kind === "scr" ? p.scriptId === r.id : p.videoProjectId === r.id));
    if (hit) return { id: hit.id, title: hit.title };
  }
  return null;
}

/** The project the screen is about, when the person may see it. */
async function screenProject(viewer: Viewer, hints: BridgeHints) {
  const clip = (v: string | null | undefined) => (typeof v === "string" && v.length <= 64 ? v : null);
  const wp = clip(hints.projectId);
  if (wp) {
    const p = await visibleProject(viewer, wp);
    if (p) return { id: p.id, title: p.title };
  }
  const prj = clip(hints.videoProjectId);
  if (prj) {
    const p = await projectFor(viewer, { videoProjectId: prj });
    if (p) return { id: p.id, title: p.title };
  }
  const scr = clip(hints.scriptId);
  if (scr) {
    const p = await projectFor(viewer, { scriptId: scr });
    if (p) return { id: p.id, title: p.title };
  }
  return null;
}

/**
 * A script 编剧 wrote in this conversation that belongs to no live project.
 *
 * Since the project-first change `write_script` always writes into a
 * project, so this is only ever an older draft; one the person holds some
 * relation on (the library's scripts are shared with the studio).
 */
async function looseScriptOf(viewer: Viewer, written: string[]) {
  for (const id of written.slice(0, 5)) {
    const [sc] = await db
      .select({ id: scripts.id, title: scripts.title, ownerId: scripts.ownerId })
      .from(scripts)
      .where(and(eq(scripts.id, id), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
      .limit(1);
    if (!sc) continue;
    if (await projectFor(viewer.tenantId, { scriptId: sc.id })) continue;
    if (!(await relationOn(viewer, "script", sc.id))) continue;
    return sc;
  }
  return null;
}

/** The linked project, when the link is this studio's and the project is still one the person may see. */
async function linkedProject(viewer: Viewer, conversationId: string) {
  const link = await readLink(conversationId);
  if (!link || !("projectId" in link) || link.tenantId !== viewer.tenantId) return null;
  const p = await visibleProject(viewer, link.projectId);
  return p ? { id: p.id, title: p.title } : null;
}

/**
 * What the chat bar shows: the project this conversation is already in (a
 * link, the receipts, the screen), or whether a new one may be made.
 * Null when the conversation is not this person's.
 */
export async function bridgeState(viewer: Viewer, conversationId: string, hints: BridgeHints = {}): Promise<BridgeState | null> {
  const convo = await ownConversation(viewer, conversationId);
  if (!convo) return null;
  const [linked, receipts, firstUser] = await Promise.all([
    linkedProject(viewer, conversationId),
    receiptRefs(viewer, conversationId),
    db
      .select({ role: agentMessages.role, content: agentMessages.content })
      .from(agentMessages)
      .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.role, "user")))
      .orderBy(asc(agentMessages.createdAt))
      .limit(6),
  ]);
  const title = askTitle(firstAsk(firstUser));
  let project: BridgeProject | null = linked ? { ...linked, via: "link" } : null;
  if (!project) {
    const worked = await firstVisible(viewer, receipts.refs);
    if (worked) project = { ...worked, via: "work" };
  }
  if (!project) {
    const screen = await screenProject(viewer, hints);
    if (screen) project = { ...screen, via: "screen" };
  }
  const canCreate = mayCreate(viewer);
  const loose = !project && canCreate ? await looseScriptOf(viewer, receipts.written) : null;
  return { project, canCreate, title, looseScript: loose ? { id: loose.id, title: loose.title } : null };
}

/* ------------------------------------------------ the conversation, as text */

type Turn = { role: "user" | "assistant"; content: string; speaker: AgentKey | null };

async function turnsOf(conversationId: string): Promise<Turn[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content, speaker: agentMessages.speaker, status: agentMessages.status })
    .from(agentMessages)
    .where(and(eq(agentMessages.conversationId, conversationId), inArray(agentMessages.role, ["user", "assistant"])))
    .orderBy(asc(agentMessages.createdAt))
    .limit(200);
  return rows
    .filter((r) => r.content.trim())
    .map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      speaker: r.role === "assistant" && r.speaker && (AGENT_KEYS as readonly string[]).includes(r.speaker) ? (r.speaker as AgentKey) : null,
    }));
}

/** Who the person was talking to: the employees who answered, in order of first answer. */
function employeesOf(turns: Turn[]): AgentKey[] {
  return [...new Set(turns.filter((t) => t.role === "assistant" && t.speaker).map((t) => t.speaker as AgentKey))];
}

/** Markdown to one plain paragraph, for a brief. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*+\s]+/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, n: number): string {
  const s = text.trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** The brief when no model writes one: what was asked, and the start of the latest answer. */
function fallbackBrief(turns: Turn[]): string {
  const ask = firstAsk(turns);
  const answer = [...turns].reverse().find((t) => t.role === "assistant");
  return [ask ? clip(plain(ask), 160) : "", answer ? clip(plain(answer.content), 260) : ""].filter(Boolean).join("\n").slice(0, 600);
}

/**
 * A title and a one-paragraph brief for the project, written by the utility
 * model from the conversation, with the cleaned first ask and the latest
 * answer's opening as the fallback for either. Capped both ways: the
 * transcript it reads (about 6,000 characters, newest kept), and what it
 * may write (40 and 400 characters). Metered like every call, and skipped
 * for a person at their cap.
 */
export async function suggestFromConversation(viewer: Viewer, conversationId: string): Promise<{ title: string; brief: string; model: string | null } | null> {
  const convo = await ownConversation(viewer, conversationId);
  if (!convo) return null;
  const turns = await turnsOf(conversationId);
  const fallback = { title: askTitle(firstAsk(turns)) || convo.title.slice(0, 40), brief: fallbackBrief(turns), model: null };
  if (!turns.some((t) => t.role === "user")) return fallback;

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const who = (t: Turn) => (t.role === "user" ? (zh ? "我" : "Me") : t.speaker ? (zh ? AGENT_LABELS[t.speaker].nameLocal : AGENT_LABELS[t.speaker].name) : zh ? "助理" : "Assistant");
  const lines: string[] = [];
  let used = 0;
  for (const t of [...turns].reverse()) {
    const body = clip(plain(t.role === "user" ? withoutTags(t.content) : t.content), t.role === "user" ? 400 : 900);
    if (!body) continue;
    const line = `${who(t)}：${body}`;
    if (used + line.length > 6000 && lines.length) break;
    lines.unshift(line);
    used += line.length;
  }

  try {
    const state = await budgetState(viewer);
    if (state.stopped) return fallback;
    const { complete } = await import("@/lib/ai/openrouter");
    const res = await complete({
      model: modelFor.utility(),
      /* Room for a reasoning model to reach its answer (see titleConversation). */
      maxTokens: 1200,
      temperature: 0.3,
      signal: AbortSignal.timeout(25_000),
      messages: [
        {
          role: "system",
          content:
            "你在帮一个视频工作室把一段对话整理成一个视频项目。只根据对话内容，不要编造数字或事实。用对话的语言写。" +
            "只输出一行 JSON：{\"title\":\"项目名\",\"brief\":\"简介\"}。" +
            "title：这个视频的选题名，不超过 24 个字，不要书名号、引号或句末标点。" +
            "brief：一段话，不超过 150 个字：这个视频做什么、为什么值得做、对话里已经定下的要点或数据。",
        },
        { role: "user", content: lines.join("\n") },
      ],
    });
    await recordUsage({
      viewer,
      module: "chat",
      model: res.model,
      provider: res.provider,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costMicros: res.costMicros,
      conversationId,
      requestId: res.requestId,
    });
    const json = res.text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? (JSON.parse(json) as { title?: unknown; brief?: unknown }) : {};
    const title =
      typeof parsed.title === "string"
        ? parsed.title
            .replace(/^[《「“"']+|[》」”"']+$/g, "")
            .replace(/[。.!！?？]+$/u, "")
            .trim()
            .slice(0, 40)
        : "";
    const brief = typeof parsed.brief === "string" ? clip(plain(parsed.brief), 400) : "";
    return { title: title || fallback.title, brief: brief || fallback.brief, model: title || brief ? res.model : null };
  } catch (err) {
    console.error("[chat-project] could not write a suggestion", err);
    return fallback;
  }
}

/* ------------------------------------------------ making the project */

export type CreateResult = { ok: true; id: string; title: string; existed: boolean } | { ok: false; error: string; status: number };

/**
 * Turn a conversation into a project.
 *
 * The project is started as every other (`createWorkProject`: its chat, its
 * script, its video project, shared with who can see it), with the brief
 * the person confirmed and `source = { kind: "chat", conversationId }`; a
 * script 编剧 wrote here outside any project (an older draft) becomes its
 * script instead of a new empty one. A short note is posted in the
 * project's chat as the person — who it came from, the brief, and the way
 * back to the conversation — and the link is recorded so the bar says
 * "打开项目" from then on.
 *
 * Claimed before anything is made: the link row is inserted first, so a
 * double press (or the side panel and the chat screen at once) cannot start
 * two projects for one conversation. A conversation that already has one —
 * linked, or through an employee's work — answers with it.
 */
export async function createFromConversation(viewer: Viewer, conversationId: string, input: { title?: unknown; brief?: unknown; access?: unknown }): Promise<CreateResult> {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const t = (a: string, b: string) => (zh ? a : b);
  if (!mayCreate(viewer)) return { ok: false, error: t("你的账号不能新建项目", "Your account cannot start projects"), status: 403 };
  const convo = await ownConversation(viewer, conversationId);
  if (!convo) return { ok: false, error: t("没有这个对话", "No such conversation"), status: 404 };

  const receipts = await receiptRefs(viewer, conversationId);
  const already = (await linkedProject(viewer, conversationId)) ?? (await firstVisible(viewer, receipts.refs));
  if (already) return { ok: true, id: already.id, title: already.title, existed: true };

  const key = linkKey(conversationId);
  const now = new Date();
  const claim: LinkValue = { state: "creating", tenantId: viewer.tenantId, userId: viewer.id, at: now.toISOString() };
  const claimed = await db.insert(settings).values({ key, value: claim, updatedBy: viewer.id }).onConflictDoNothing().returning({ key: settings.key });
  if (!claimed.length) {
    /* A row already there: a project being made right now, or a link to one
       since deleted (or made private to others). The first waits; the
       second is taken over, by exactly the row that was read. */
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
    const v = row?.value as Partial<LinkValue> | undefined;
    if (v && "state" in v && v.state === "creating" && Date.now() - Date.parse(String(v.at)) < 90_000) {
      return { ok: false, error: t("项目正在建，稍等一下", "The project is being made; one moment"), status: 409 };
    }
    const took = await db
      .update(settings)
      .set({ value: claim, updatedBy: viewer.id, updatedAt: now })
      .where(and(eq(settings.key, key), sql`${settings.value} = ${JSON.stringify(row?.value ?? null)}::jsonb`))
      .returning({ key: settings.key });
    if (!took.length) return { ok: false, error: t("项目正在建，稍等一下", "The project is being made; one moment"), status: 409 };
  }

  try {
    const turns = await turnsOf(conversationId);
    const title = (typeof input.title === "string" ? input.title : "").replace(/\s+/g, " ").trim().slice(0, 80) || askTitle(firstAsk(turns)) || convo.title.slice(0, 40) || t("新项目", "New project");
    const brief = (typeof input.brief === "string" ? input.brief : "").trim().slice(0, 1000) || fallbackBrief(turns) || null;
    const access = input.access === "private" ? "private" : "everyone";
    const staff = employeesOf(turns);
    const staffNames = staff.map((k) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name));
    const withWhom = staffNames.length ? staffNames.join(zh ? "、" : ", ") : t("助理", "the assistant");
    const person = (zh && viewer.nameLocal) || viewer.name;

    /* An older draft 编剧 wrote here, in no project: the project takes it,
       and the video project already made for it, if one is still loose. */
    const loose = await looseScriptOf(viewer, receipts.written);
    let video: { id: string } | undefined;
    if (loose) {
      [video] = await db
        .select({ id: videoProjects.id })
        .from(videoProjects)
        .where(
          and(
            eq(videoProjects.scriptId, loose.id),
            eq(videoProjects.tenantId, viewer.tenantId),
            isNull(videoProjects.deletedAt),
            /* Spelled out: in a one-table select drizzle writes columns
               unqualified, and "id" inside the subquery would be w's. */
            sql`not exists (select 1 from work_projects w where w.video_project_id = "video_projects"."id" and w.deleted_at is null)`,
          ),
        )
        .orderBy(desc(videoProjects.updatedAt))
        .limit(1);
      /* Taken over only when the person may share it with the studio (the
         project's video is edited together); otherwise the project starts
         its own, as any new project does. */
      if (video) {
        const vrel = await relationOn(viewer, "project", video.id);
        if (vrel !== "owner" && vrel !== "editor") video = undefined;
      }
      /* The studio edits a project's script together: shared by someone
         allowed to share it, as `ensureScriptProject` does, when the person
         holds less than editor on it. */
      const held = await relationOn(viewer, "script", loose.id);
      if (held !== "owner" && held !== "editor" && loose.ownerId) {
        const owner = await viewerById(loose.ownerId);
        if (owner) await share(owner, { type: "script", id: loose.id }, "editor", { type: "tenant", id: viewer.tenantId }).catch(() => null);
      }
    }

    const source = {
      kind: "chat",
      label: staffNames.length ? t(`来自和${withWhom}的对话`, `From a conversation with the ${withWhom}`) : t("来自对话", "From a conversation"),
      key: `chat:${conversationId}`,
      conversationId,
    };
    const made = await createWorkProject(viewer, {
      title,
      brief,
      mode: "full",
      source,
      ...(loose ? { scriptId: loose.id } : {}),
      ...(video ? { videoProjectId: video.id } : {}),
    });
    if (access === "private") await setProjectAccess(viewer, made.id, { mode: "private" });

    /* The note in the project's chat, as the person: plain text with one
       in-app link, which the project's chat and Chat both draw. */
    /* The conversation's own title when it has one yet (it is named after
       the first reply, in the background), else plain words. */
    const named = convo.title && convo.title !== "New chat" ? clip(convo.title, 40) : null;
    const back = named ? t(`《${named}》`, `“${named}”`) : t("回到对话", "back to it");
    const note = [
      t(`从 ${person} 和${withWhom}的对话建立。`, `Started from ${person}'s conversation with ${withWhom}.`),
      brief ? clip(brief, 600) : "",
      loose ? t(`编剧在对话里写的脚本《${loose.title}》已经放进这个项目。`, `The script the writer wrote there, “${loose.title}”, is now this project's.`) : "",
      t(`原对话：[${back}](/chat/t/${conversationId})（只有 ${person} 能打开）`, `The conversation: [${back}](/chat/t/${conversationId}) (only ${person} can open it)`),
    ]
      .filter(Boolean)
      .join("\n\n");
    await postMessage(viewer, made.channelId, note, { fromChat: { conversationId } }).catch((err) => console.error("[chat-project] could not post the note", err));

    const link: LinkValue = { projectId: made.id, tenantId: viewer.tenantId, userId: viewer.id, at: new Date().toISOString() };
    await db.update(settings).set({ value: link, updatedBy: viewer.id, updatedAt: new Date() }).where(eq(settings.key, key));
    await audit(viewer, "project.from_chat", { module: "chat", objectType: "project", objectId: made.id, meta: { conversationId, access, script: loose?.id ?? null } });
    return { ok: true, id: made.id, title: title.slice(0, 80), existed: false };
  } catch (err) {
    /* Nothing was linked: give the claim back so the press can be tried again. */
    await db
      .delete(settings)
      .where(and(eq(settings.key, key), sql`${settings.value} ->> 'state' = 'creating'`))
      .catch(() => {});
    console.error("[chat-project] could not start the project", err);
    return { ok: false, error: err instanceof Error ? err.message : t("没能建成项目", "Could not start the project"), status: 500 };
  }
}
