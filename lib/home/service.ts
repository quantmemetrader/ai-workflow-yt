import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, jobs, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { AGENTS } from "@/lib/agents";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { readCardActions, readCardDone, type CardAction } from "@/lib/agents/cards";

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
const JOB_OWNER: Record<string, AgentKey> = {
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
};

export function jobName(type: string, zh: boolean): string {
  const pair = JOB_NAMES[type];
  return pair ? (zh ? pair[0] : pair[1]) : type;
}

const RECENT_MESSAGES = 60;

export async function readHome(viewer: Viewer, zh: boolean): Promise<Home> {
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

  const busy = new Set(running.map((j) => JOB_OWNER[j.type]).filter(Boolean) as AgentKey[]);

  /* A card with buttons and nobody's answer on it. Oldest first: the thing
     that has been waiting longest is the thing to do next. */
  const decisions: Decision[] = [];
  for (const m of recent) {
    const actions = readCardActions(m.meta).filter((a) => a.kind === "say");
    if (!actions.length || readCardDone(m.meta)) continue;
    const channel = byId.get(m.channelId);
    if (!channel) continue;
    decisions.push({
      messageId: m.id,
      channelSlug: channel.slug,
      channelName: channel.name,
      agent: m.authorId ? (keyByUserId.get(m.authorId) ?? null) : null,
      author: (zh && m.authorNameLocal) || m.authorName || "—",
      body: m.body,
      actions: readCardActions(m.meta),
      at: m.createdAt,
    });
  }
  decisions.reverse();

  const agents: AgentState[] = AGENT_KEYS.map((key) => {
    const label = AGENT_LABELS[key];
    const last = recent.find((m) => m.authorId && keyByUserId.get(m.authorId) === key);
    const channel = last ? byId.get(last.channelId) : undefined;
    const asking = last ? decisions.some((d) => d.messageId === last.id) : false;
    return {
      key,
      name: label.name,
      nameLocal: label.nameLocal,
      title: zh ? label.title : label.titleEn,
      status: busy.has(key) ? "working" : asking ? "waiting" : "idle",
      line: last ? firstLine(last.body) : null,
      channelSlug: channel?.slug ?? null,
      at: last?.createdAt ?? null,
    };
  });

  const production = readable.find((c) => c.name === "制作") ?? readable.find((c) => c.kind !== "announce") ?? null;

  return {
    agents,
    decisions,
    running: running.map((j) => ({
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

/** Unused import guard: `sql` is kept for the query above if it grows a
 * window function; drizzle's types need it imported where it is used. */
void sql;
