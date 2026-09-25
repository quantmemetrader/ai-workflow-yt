import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages, comments, topics } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import type { AgentKey } from "@/lib/agents/catalog";

/**
 * What the AI employees think this page should be making next.
 *
 * The client's ask, verbatim: *"When I enter article page I can already see
 * ideas proposed. Same for script."* So each maker's page opens on a short
 * list of things to make, with one press to start, rather than on an empty
 * library and a New button.
 *
 * Three sources, in order of how much thought went into them:
 *
 *   1. **Today's plan.** 策划 already writes the day's to-dos each morning
 *      and names who each one is for. Those addressed to this page's employee
 *      are the proposals — real judgement, made this morning, about this
 *      studio.
 *   2. **The topic backlog.** What the studio itself decided to make, when
 *      the plan has nothing for this page or it is a day nobody planned.
 *   3. **The audience's questions.** A viewer who typed a question has asked
 *      for a video. Nothing else is as direct.
 *
 * Nothing here is generated on the way in: it reads what already exists, so
 * the page opens as fast as the library did and the ideas are ones a person
 * can find again in the channel they came from.
 */
export type Proposal = {
  text: string;
  why: string | null;
  source: "plan" | "backlog" | "audience";
};

export type Proposals = {
  /** The employee these are for, so the strip says who proposed them. */
  owner: AgentKey;
  items: Proposal[];
  /** The plan's date when the first item came from one, so the strip can say
   *  "this morning" rather than implying it. */
  planDate: string | null;
};

type Todo = { text?: unknown; owner?: unknown; why?: unknown };

const LIMIT = 4;
const AUDIENCE_DAYS = 90;

/** How a backlog topic or a question is turned into something to start. */
const PHRASE: Record<AgentKey, { topic: (name: string) => string; question: (q: string) => string }> = {
  script: {
    topic: (n) => `写《${n}》的脚本`,
    question: (q) => `写一条回答观众提问的脚本：「${q}」`,
  },
  article: {
    topic: (n) => `写一篇关于「${n}」的文章`,
    question: (q) => `写一篇回答观众提问的文章：「${q}」`,
  },
  video: {
    topic: (n) => `用现有素材做一条关于「${n}」的短片`,
    question: (q) => `剪一条回答观众提问的短片：「${q}」`,
  },
  research: {
    topic: (n) => `把「${n}」这个选题挖深，找数据和对标`,
    question: (q) => `查一下观众问的这个：「${q}」`,
  },
  planning: {
    topic: (n) => `决定「${n}」这个选题做不做、怎么做`,
    question: (q) => `看看观众问的这个值不值得做：「${q}」`,
  },
};

export async function proposalsFor(viewer: Viewer, owner: AgentKey): Promise<Proposals> {
  const items: Proposal[] = [];
  let planDate: string | null = null;

  /* 1. The latest plan 策划 posted, and the to-dos in it addressed to this
        page's employee. */
  const [plan] = await db
    .select({ meta: chatMessages.meta, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, viewer.tenantId),
        sql`${chatMessages.deletedAt} is null`,
        sql`(${chatMessages.meta} -> 'plan' -> 'list') is not null`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  const list = ((plan?.meta as { plan?: { list?: unknown; date?: unknown } } | null)?.plan?.list ?? []) as Todo[];
  for (const todo of Array.isArray(list) ? list : []) {
    if (todo.owner !== owner || typeof todo.text !== "string" || !todo.text.trim()) continue;
    items.push({
      text: todo.text.trim().slice(0, 240),
      why: typeof todo.why === "string" && todo.why.trim() ? todo.why.trim().slice(0, 240) : null,
      source: "plan",
    });
    if (items.length >= LIMIT) break;
  }
  if (items.length) {
    const date = (plan?.meta as { plan?: { date?: unknown } } | null)?.plan?.date;
    planDate = typeof date === "string" ? date : null;
  }

  /* 2. The backlog: what the studio itself decided to make. Hottest first.
        Only topics that were actually researched (they have a summary): a
        watch phrase somebody typed to try the board — "goat", "arsenal" —
        is not a proposal. And never for 剪辑师, which cuts what it is given
        rather than picking subjects. */
  if (items.length < LIMIT && owner !== "video") {
    const backlog = await db
      .select({ name: topics.name, summary: topics.summary })
      .from(topics)
      .where(and(eq(topics.tenantId, viewer.tenantId), eq(topics.stage, "adopted"), sql`coalesce(${topics.summary}, '') <> ''`))
      .orderBy(desc(topics.heat))
      .limit(LIMIT);
    for (const t of backlog) {
      if (items.length >= LIMIT) break;
      const text = PHRASE[owner].topic(t.name);
      if (items.some((i) => i.text === text)) continue;
      items.push({ text, why: t.summary ? t.summary.slice(0, 160) : "选题储备里的，团队自己定的。", source: "backlog" });
    }
  }

  /* 3. A viewer's own question, when there is one. The most-liked first,
        because a question other viewers also wanted answered is worth more. */
  if (items.length < LIMIT) {
    const since = new Date(Date.now() - AUDIENCE_DAYS * 86_400_000);
    const asked = await db
      .select({ body: comments.body, author: comments.authorName })
      .from(comments)
      .where(and(eq(comments.tenantId, viewer.tenantId), gte(comments.postedAt, since), sql`${comments.body} ~ '[?？]'`))
      .orderBy(desc(comments.likeCount), desc(comments.postedAt))
      .limit(LIMIT);
    for (const c of asked) {
      if (items.length >= LIMIT) break;
      const q = (c.body ?? "").trim().slice(0, 80);
      if (!q) continue;
      items.push({ text: PHRASE[owner].question(q), why: `${c.author ?? "一位观众"} 在评论里问的。`, source: "audience" });
    }
  }

  return { owner, items, planDate };
}

export type LatestPlan = {
  messageId: string;
  channelId: string;
  channelName: string;
  body: string;
  /** The plan's own date (Hong Kong), as the morning script wrote it. */
  date: string | null;
  postedAt: Date;
  list: { text: string; owner: string; why: string | null }[];
  /** A hand-off button somebody pressed on it, if anyone did. */
  done: { actionId: string; by: string; at: string } | null;
};

/**
 * The newest plan 策划 posted, whole: every to-do and whom it is for, and
 * whether anybody pressed one of its hand-off buttons.
 *
 * The same message `proposalsFor` reads from, for the employees themselves:
 * "有什么新的策划案" is a question about this, and 策划 had no way to read its
 * own plan except as a line of chat. Only a plan in a channel the whole
 * studio can see — which is where the morning script posts it.
 */
export async function latestPlan(viewer: Viewer): Promise<LatestPlan | null> {
  const [row] = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      channelName: chatChannels.name,
      body: chatMessages.body,
      meta: chatMessages.meta,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, viewer.tenantId),
        eq(chatChannels.isPrivate, false),
        sql`${chatMessages.deletedAt} is null`,
        sql`(${chatMessages.meta} -> 'plan' -> 'list') is not null`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  if (!row) return null;

  const meta = (row.meta ?? {}) as { plan?: { list?: unknown; date?: unknown }; done?: unknown };
  const raw = Array.isArray(meta.plan?.list) ? (meta.plan.list as Todo[]) : [];
  const done = meta.done as { actionId?: unknown; by?: unknown; at?: unknown } | undefined;
  return {
    messageId: row.id,
    channelId: row.channelId,
    channelName: row.channelName,
    body: row.body,
    date: typeof meta.plan?.date === "string" ? meta.plan.date : null,
    postedAt: row.createdAt,
    list: raw
      .filter((t) => typeof t.text === "string" && t.text.trim())
      .map((t) => ({
        text: String(t.text).trim(),
        owner: typeof t.owner === "string" ? t.owner : "human",
        why: typeof t.why === "string" && t.why.trim() ? t.why.trim() : null,
      })),
    done:
      done && typeof done.actionId === "string"
        ? { actionId: done.actionId, by: typeof done.by === "string" ? done.by : "", at: typeof done.at === "string" ? done.at : "" }
        : null,
  };
}
