import "server-only";
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, jobs, publishPosts, topics, users, videoExports, videoProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { AGENTS } from "@/lib/agents";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { readCardActions, readCardDone, type CardAction } from "@/lib/agents/cards";
import { audit } from "@/lib/audit";
import { pendingApprovals } from "@/lib/script/service";
import { openCommentCount } from "@/lib/social/service";
import { canReadProjects } from "@/lib/video/access";
import type { HomeRole } from "@/lib/home/roles";

/**
 * What the studio's five AI employees are doing, right now, on one screen.
 *
 * The client's ask was not for a dashboard to read: *"less like a working
 * platform with a AI, but more agentic"*, and then plainly — come in, see what
 * each one is up to, say yes, move to the next thing. So this reads the state
 * the work already leaves behind rather than adding a state machine of its
 * own:
 *
 *   — **the queue** says what is running (a render, a transcript, a first cut);
 *   — **the last thing each employee said** says where it got to;
 *   — **a card with buttons nobody has pressed** is the studio's turn.
 *
 * Nothing here writes. It is one read of three tables, so the home screen
 * cannot be the thing that breaks a render.
 */
export type AgentState = {
  key: AgentKey;
  name: string;
  nameLocal: string;
  title: string;
  /** working: a job of its own is running. waiting: it has asked and nobody
   *  has answered. idle: neither. */
  status: "working" | "waiting" | "idle";
  /** One line on what it is doing, or the last thing it said. */
  line: string | null;
  /** Where that line was said, so the card can open it. */
  channelSlug: string | null;
  at: Date | null;
};

export type Decision = {
  messageId: string;
  channelSlug: string;
  channelName: string;
  agent: AgentKey | null;
  author: string;
  /** For a card a colleague posted: who, and their own picture, so it is
   * drawn with their face (or their default, `lib/avatars/default`). */
  authorId: string | null;
  authorAvatar: string | null;
  body: string;
  actions: CardAction[];
  at: Date;
};

export type Running = {
  id: string;
  type: string;
  status: "queued" | "running";
  progress: number;
  /** Who asked, when a person did. */
  who: string | null;
  at: Date;
};

export type Home = {
  agents: AgentState[];
  decisions: Decision[];
  running: Running[];
  /** The team channel the prompt box posts into. */
  teamChannel: { id: string; slug: string; name: string } | null;
};

/** Which job types belong to which employee, for "工作中". */
export const JOB_OWNER: Record<string, AgentKey> = {
  "video.export": "video",
  "video.direct": "video",
  "video.autoedit": "video",
  "video.transcribe": "video",
  "video.peaks": "video",
  "files.proxy": "video",
  "files.poster": "video",
  "research.refreshTopic": "research",
  "research.series": "research",
  "research.refreshFeeds": "research",
  "social.syncComments": "research",
  "social.classifyComments": "research",
  "agent.footage": "planning",
  "publish.send": "article",
  "creator.sync": "research",
  "social.syncDailyViews": "research",
  "social.syncCompetitors": "research",
  "social.syncPosts": "research",
  "social.syncChannels": "research",
  "research.digest": "research",
};

/** What a running job is, in the studio's words rather than the queue's. */
const JOB_NAMES: Record<string, [string, string]> = {
  "video.export": ["正在渲染", "Rendering"],
  "video.direct": ["正在做整条片", "Making the whole cut"],
  "video.autoedit": ["正在粗剪", "Cutting"],
  "video.transcribe": ["正在转写字幕", "Transcribing"],
  "video.peaks": ["正在读音轨", "Reading the audio"],
  "files.proxy": ["正在转预览", "Making a preview copy"],
  "files.poster": ["正在取封面", "Taking a poster frame"],
  "research.refreshTopic": ["正在刷新话题", "Refreshing a topic"],
  "research.refreshFeeds": ["正在收资讯", "Collecting sources"],
  "social.syncComments": ["正在收评论", "Collecting comments"],
  "social.classifyComments": ["正在读评论", "Reading comments"],
  "agent.footage": ["正在看新素材", "Reading new footage"],
  "publish.send": ["正在发布", "Publishing"],
  "creator.sync": ["正在同步本频道数据", "Syncing the channel"],
  "social.syncDailyViews": ["正在收播放数据", "Collecting view counts"],
  "social.syncCompetitors": ["正在同步对标账号", "Syncing rivals"],
  "research.digest": ["正在写晨报", "Writing the brief"],
  "social.syncPosts": ["正在同步本频道发布", "Syncing the channel posts"],
  "social.syncChannels": ["正在同步频道信息", "Syncing channel details"],
};

/** The job types that are one employee's work, for a role Home's 正在进行. */
export function jobTypesOf(owner: AgentKey): string[] {
  return Object.entries(JOB_OWNER)
    .filter(([, o]) => o === owner)
    .map(([type]) => type);
}

export function jobName(type: string, zh: boolean): string {
  const pair = JOB_NAMES[type];
  return pair ? (zh ? pair[0] : pair[1]) : type;
}

const RECENT_MESSAGES = 60;

/**
 * `runningFor`: a role Home shows only that employee's jobs in 正在进行.
 * Filtered in the query, not afterwards — eight of the studio's jobs, then
 * filtered, is usually none of the editor's when research is syncing. The
 * studio-wide eight are still read for the team's 工作中 badges.
 */
export async function readHome(viewer: Viewer, zh: boolean, opts: { runningFor?: AgentKey | null } = {}): Promise<Home> {
  const tenantId = viewer.tenantId;

  /* The channels this person may actually read. A decision waiting in a
     private channel they are not in is not their decision. */
  const channels = await db
    .select({
      id: chatChannels.id,
      slug: chatChannels.slug,
      name: chatChannels.name,
      isPrivate: chatChannels.isPrivate,
      kind: chatChannels.kind,
    })
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, tenantId), isNull(chatChannels.archivedAt)));

  const mine = await db
    .select({ channelId: chatMembers.channelId })
    .from(chatMembers)
    .where(eq(chatMembers.userId, viewer.id));
  const member = new Set(mine.map((m) => m.channelId));
  const readable = channels
    .filter((c) => c.slug !== null && (!c.isPrivate || member.has(c.id)))
    .map((c) => ({ ...c, slug: c.slug as string }));
  const byId = new Map(readable.map((c) => [c.id, c]));

  const agentRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.isAgent, true),
        inArray(
          users.email,
          AGENT_KEYS.map((k) => AGENTS[k].email),
        ),
      ),
    );
  const keyByUserId = new Map<string, AgentKey>();
  for (const row of agentRows) {
    const key = AGENT_KEYS.find((k) => AGENTS[k].email === row.email);
    if (key) keyByUserId.set(row.id, key);
  }

  /* One sweep of recent messages answers both questions: what each employee
     last said, and which cards are still waiting. */
  const recent = readable.length
    ? await db
        .select({
          id: chatMessages.id,
          channelId: chatMessages.channelId,
          authorId: chatMessages.authorId,
          body: chatMessages.body,
          meta: chatMessages.meta,
          createdAt: chatMessages.createdAt,
          authorName: users.name,
          authorNameLocal: users.nameLocal,
          authorAvatar: users.avatarUrl,
        })
        .from(chatMessages)
        .leftJoin(users, eq(users.id, chatMessages.authorId))
        .where(
          and(
            inArray(
              chatMessages.channelId,
              readable.map((c) => c.id),
            ),
            isNull(chatMessages.deletedAt),
          ),
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(RECENT_MESSAGES)
    : [];

  const running = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      progress: jobs.progress,
      createdAt: jobs.createdAt,
      who: users.nameLocal,
      whoEn: users.name,
    })
    .from(jobs)
    .leftJoin(users, eq(users.id, jobs.createdBy))
    .where(and(eq(jobs.tenantId, tenantId), inArray(jobs.status, ["queued", "running"])))
    .orderBy(desc(jobs.createdAt))
    .limit(8);

  const ownTypes = opts.runningFor ? jobTypesOf(opts.runningFor) : null;
  const own = ownTypes
    ? ownTypes.length
      ? await db
          .select({
            id: jobs.id,
            type: jobs.type,
            status: jobs.status,
            progress: jobs.progress,
            createdAt: jobs.createdAt,
            who: users.nameLocal,
            whoEn: users.name,
          })
          .from(jobs)
          .leftJoin(users, eq(users.id, jobs.createdBy))
          .where(and(eq(jobs.tenantId, tenantId), inArray(jobs.status, ["queued", "running"]), inArray(jobs.type, ownTypes)))
          .orderBy(desc(jobs.createdAt))
          .limit(8)
      : []
    : null;

  const busy = new Set([...running, ...(own ?? [])].map((j) => JOB_OWNER[j.type]).filter(Boolean) as AgentKey[]);

  /* A card with buttons and nobody's answer on it. Oldest first: the thing
     that has been waiting longest is the thing to do next. */
  const decisions: Decision[] = [];
  for (const m of recent) {
    /* A decision is a press that does something: a line to a colleague, or
       one of the project page's own operations (剪辑师's "先用素材库画面"
       beside "上传素材" when it is waiting for the host's clips). */
    const actions = readCardActions(m.meta).filter((a) => a.kind === "say" || a.kind === "run");
    if (!actions.length || readCardDone(m.meta)) continue;
    const channel = byId.get(m.channelId);
    if (!channel) continue;
    decisions.push({
      messageId: m.id,
      channelSlug: channel.slug,
      channelName: channel.name,
      agent: m.authorId ? (keyByUserId.get(m.authorId) ?? null) : null,
      author: (zh && m.authorNameLocal) || m.authorName || "—",
      authorId: m.authorId,
      authorAvatar: m.authorAvatar,
      body: m.body,
      actions: readCardActions(m.meta),
      at: m.createdAt,
    });
  }
  decisions.reverse();

  const agents: AgentState[] = AGENT_KEYS.map((key) => {
    const label = AGENT_LABELS[key];
    const theirs = recent.filter((m) => m.authorId && keyByUserId.get(m.authorId) === key);
    const last = theirs[0];
    /* The line under the name is the last thing it said that says
       something. "你好！请问有什么需要我协助的吗？" — its answer to somebody
       saying hello — is not where its work got to; the line before it is.
       Only when it has said nothing else does the greeting stand. */
    const shown = theirs.find((m) => !isGreeting(firstLine(m.body))) ?? last;
    const channel = shown ? byId.get(shown.channelId) : undefined;
    const asking = last ? decisions.some((d) => d.messageId === last.id) : false;
    return {
      key,
      name: label.name,
      nameLocal: label.nameLocal,
      title: zh ? label.title : label.titleEn,
      status: busy.has(key) ? "working" : asking ? "waiting" : "idle",
      line: shown ? firstLine(shown.body) : null,
      channelSlug: channel?.slug ?? null,
      at: last?.createdAt ?? null,
    };
  });

  const production = readable.find((c) => c.name === "制作") ?? readable.find((c) => c.kind !== "announce") ?? null;

  return {
    agents,
    decisions,
    running: (own ?? running).map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status as "queued" | "running",
      progress: j.progress,
      who: (zh && j.who) || j.whoEn || null,
      at: j.createdAt,
    })),
    teamChannel: production ? { id: production.id, slug: production.slug, name: production.name } : null,
  };
}

/* ------------------------------------------------------------ role extras */

/**
 * The one panel only a job's Home has: the thing that job checks first.
 *
 *   script    scripts waiting on this person's approval
 *   video     renders queued, rendering or failed (latest per project, 14 days)
 *   article   posts not out yet: drafts, awaiting approval, failed
 *   research  how deep the backlog is and how many comments are unanswered
 *
 * Null when the job has none, or the person lacks the module the panel
 * would link to — `requireModule` would only bounce them back here.
 */
export type RoleExtra =
  | { kind: "approvals"; total: number; items: { id: string; scriptId: string; title: string; version: number | null; who: string | null }[] }
  | { kind: "renders"; total: number; items: { id: string; projectId: string; title: string; state: "queued" | "rendering" | "failed"; progress: number; error: string | null }[] }
  | { kind: "posts"; total: number; items: { id: string; title: string; state: string }[] }
  | { kind: "research"; backlog: number; inbox: number };

const EXTRA_ITEMS = 6;

export async function roleExtra(viewer: Viewer, role: HomeRole): Promise<RoleExtra | null> {
  const has = (m: Viewer["modules"][number]) => viewer.modules.includes(m);

  if (role === "script" && has("script")) {
    const rows = await pendingApprovals(viewer);
    return {
      kind: "approvals",
      total: rows.length,
      items: rows.slice(0, EXTRA_ITEMS).map((r) => ({ id: r.id, scriptId: r.objectId, title: r.title, version: r.versionNo, who: r.requesterName ?? null })),
    };
  }

  if (role === "video" && has("video")) {
    /* The latest render of each project the person can open. An older
       failure under a newer good render is history, not work. */
    const rows = await db
      .select({
        id: videoExports.id,
        projectId: videoExports.projectId,
        title: videoProjects.title,
        state: videoExports.state,
        progress: videoExports.progress,
        error: videoExports.error,
      })
      .from(videoExports)
      .innerJoin(videoProjects, eq(videoProjects.id, videoExports.projectId))
      .where(
        and(
          eq(videoExports.tenantId, viewer.tenantId),
          isNull(videoProjects.deletedAt),
          inArray(videoExports.state, ["queued", "rendering", "failed"]),
          gt(videoExports.createdAt, sql`now() - interval '14 days'`),
          sql`not exists (select 1 from ${videoExports} as newer where newer.project_id = ${videoExports.projectId} and newer.created_at > ${videoExports.createdAt})`,
          canReadProjects(viewer),
        ),
      )
      .orderBy(desc(videoExports.createdAt))
      .limit(20);
    return {
      kind: "renders",
      total: rows.length,
      items: rows.slice(0, EXTRA_ITEMS).map((r) => ({
        id: r.id,
        projectId: r.projectId,
        title: r.title,
        state: r.state as "queued" | "rendering" | "failed",
        progress: r.progress,
        error: r.error ? r.error.slice(0, 160) : null,
      })),
    };
  }

  if (role === "article" && has("publish")) {
    const where = and(eq(publishPosts.tenantId, viewer.tenantId), isNull(publishPosts.deletedAt), inArray(publishPosts.state, ["draft", "awaiting_approval", "failed"]));
    const [rows, [total]] = await Promise.all([
      db.select({ id: publishPosts.id, title: publishPosts.title, state: publishPosts.state }).from(publishPosts).where(where).orderBy(desc(publishPosts.updatedAt)).limit(EXTRA_ITEMS),
      db.select({ n: count() }).from(publishPosts).where(where),
    ]);
    return { kind: "posts", total: total?.n ?? rows.length, items: rows };
  }

  if (role === "research" && has("research")) {
    /* The same two numbers the research sidebar shows: the backlog page's
       adopted-or-saved topics and the inbox's open comments. */
    const [[backlog], inbox] = await Promise.all([
      db
        .select({ n: count() })
        .from(topics)
        .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"]))),
      openCommentCount(viewer),
    ]);
    return { kind: "research", backlog: backlog?.n ?? 0, inbox };
  }

  return null;
}

/**
 * A person choosing their own Home ("设为我的默认").
 *
 * Only their own row, only a work role or nothing. Unlike the admin's
 * `setWorkRole` this grants no module: someone on Home already holds chat,
 * and choosing a layout is not a reason to be given anything else.
 */
export async function setMyWorkRole(viewer: Viewer, role: AgentKey | null): Promise<void> {
  if (role !== null && !(AGENT_KEYS as readonly string[]).includes(role)) throw new Error("No such job");
  await db
    .update(users)
    .set({ workRole: role })
    .where(and(eq(users.id, viewer.id), eq(users.tenantId, viewer.tenantId)));
  await audit(viewer, "user.workRole", { objectType: "user", objectId: viewer.id, module: "chat", meta: { workRole: role } });
}

/** The first line of a message, with its Markdown furniture taken off — a
 * status strip has room for a sentence, not a report. */
function firstLine(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw
      .replace(/^[#>\-*\s]+/, "")
      .replace(/\*\*/g, "")
      .replace(/[_`]/g, "")
      .trim();
    if (line) return line.slice(0, 120);
  }
  return "";
}

/**
 * An empty greeting: a hello and an offer to help, and nothing else — what
 * an employee answers to "你好" ("你好！请问需要我写脚本，还是协助处理某个
 * 具体项目？"). Short on purpose: a line that opens with 你好 and goes on to
 * report work is not one.
 */
const HELLO = /^(?:你好|您好|嗨|哈喽|(?:hi|hello|hey)(?=[\s!,.！，。~]|$))[\s!,.！，。~]*/i;
const OFFER = /请问|有什么|需要我|可以帮|能帮|帮你|帮您|协助|what can i|how can i|anything/i;

function isGreeting(line: string): boolean {
  const m = HELLO.exec(line.trim());
  if (!m) return false;
  const rest = line.trim().slice(m[0].length);
  return rest.length === 0 || (rest.length <= 60 && OFFER.test(rest));
}

/** Unused import guard: `sql` is kept for the query above if it grows a
 * window function; drizzle's types need it imported where it is used. */
void sql;
