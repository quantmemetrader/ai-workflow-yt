import "server-only";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channels, comments, creatorVideos } from "@/lib/db/schema";

/**
 * The studio's own numbers — which is the research that was missing.
 *
 * The morning brief was built from Google Daily Search Trends, GDELT and
 * Google News: what Hong Kong is *searching*. That is a fine second opinion
 * and a poor first one, and the client said so — the brief read as generic
 * news because it was generic news. Meanwhile 125 of the channel's own videos,
 * their view counts, their like rates and the questions the audience actually
 * typed underneath them were sitting in this database, unread by anything.
 *
 * So this is the first half of every brief now: what *this* channel did, what
 * worked on it, and what its own viewers asked. Outside signals come after,
 * and are labelled as outside.
 *
 * Every number here is measured and stored, never inferred. A model given this
 * text can quote it; it cannot invent a figure that is not in it, and the
 * prompt says as much.
 */
const DAYS = 90;

export type StudioBrief = {
  /** Plain text, ready to hand to a model or print in a channel. */
  text: string;
  /** Whether there was anything real to say. */
  hasData: boolean;
  videos: number;
  medianViews: number;
};

type Row = {
  title: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  publishedAt: Date | null;
};

const pct = (a: number | null, b: number | null) =>
  a !== null && b ? `${((100 * a) / b).toFixed(1)}%` : "—";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "?");

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function studioBrief(tenantId: string): Promise<StudioBrief> {
  const since = new Date(Date.now() - DAYS * 86_400_000);

  const own = await db
    .select({
      platform: channels.platform,
      username: channels.username,
      displayName: channels.displayName,
      followers: channels.followers,
    })
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.status, "healthy")));

  const rows: Row[] = await db
    .select({
      title: creatorVideos.title,
      views: creatorVideos.views,
      likes: creatorVideos.likes,
      comments: creatorVideos.comments,
      publishedAt: creatorVideos.publishedAt,
    })
    .from(creatorVideos)
    .where(and(eq(creatorVideos.tenantId, tenantId), isNotNull(creatorVideos.views)))
    .orderBy(desc(creatorVideos.publishedAt))
    .limit(200);

  const recent = rows.filter((r) => r.publishedAt && r.publishedAt >= since);
  const views = rows.map((r) => r.views ?? 0).filter((v) => v > 0);
  const mid = median(views);

  /*
   * Ranked by like rate, not by views.
   *
   * Views measure how far a video was pushed; the share of viewers who liked
   * it measures whether the ones who arrived wanted it. On a 253-subscriber
   * channel the second is the only one that says anything about the subject —
   * and it is what separates 加工费不到一块 (10.8%) from a video with twice the
   * views and a tenth of the reaction.
   */
  const byRate = rows
    .filter((r) => (r.views ?? 0) >= 150)
    .sort((a, b) => (b.likes ?? 0) / (b.views || 1) - (a.likes ?? 0) / (a.views || 1))
    .slice(0, 6);

  const byViews = [...rows].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5);

  /*
   * What the audience asked, in its own words.
   *
   * A comment with a question in it is a topic somebody has already asked for.
   * Ranked by likes, because a question other viewers also wanted answered is
   * worth more than one nobody noticed.
   */
  const asked = await db
    .select({
      body: comments.body,
      author: comments.authorName,
      likes: comments.likeCount,
      sentiment: comments.sentiment,
      at: comments.postedAt,
    })
    .from(comments)
    .where(and(eq(comments.tenantId, tenantId), gte(comments.postedAt, since)))
    .orderBy(desc(comments.likeCount), desc(comments.postedAt))
    .limit(25);

  const questions = asked.filter((c) => /[?？]/.test(c.body ?? "")).slice(0, 6);
  const loudest = asked.slice(0, 6);

  const lines: string[] = [];

  lines.push("## 本频道自己的数据（这是第一手的，可以引用）");
  if (own.length) {
    lines.push(
      ...own.map(
        (c) =>
          `- ${c.platform}｜${c.displayName ?? c.username ?? "—"}${c.followers !== null ? `｜${c.followers} 关注` : ""}`,
      ),
    );
  } else {
    lines.push("- 还没有连接任何账号。");
  }
  lines.push(
    `- 已收录 ${rows.length} 条视频，最近 ${DAYS} 天发了 ${recent.length} 条，播放量中位数 ${mid}。`,
  );

  if (byRate.length) {
    lines.push("", "### 点赞率最高的（点赞 ÷ 播放，说明看到的人有多想看）");
    for (const r of byRate) {
      lines.push(
        `- ${day(r.publishedAt)}｜${r.title ?? "—"}｜播放 ${r.views ?? 0}｜点赞 ${r.likes ?? 0}（${pct(r.likes, r.views)}）｜评论 ${r.comments ?? 0}`,
      );
    }
  }

  if (byViews.length) {
    lines.push("", "### 播放量最高的");
    for (const r of byViews) {
      lines.push(`- ${day(r.publishedAt)}｜${r.title ?? "—"}｜播放 ${r.views ?? 0}｜点赞率 ${pct(r.likes, r.views)}`);
    }
  }

  if (questions.length) {
    lines.push("", "### 观众自己问的问题（原话）");
    for (const c of questions) {
      lines.push(`- ${c.author ?? "观众"}：${(c.body ?? "").trim().slice(0, 140)}`);
    }
  }
  if (!questions.length && loudest.length) {
    lines.push("", "### 最近的观众留言（原话）");
    for (const c of loudest) {
      lines.push(`- ${c.author ?? "观众"}（${c.sentiment ?? "—"}）：${(c.body ?? "").trim().slice(0, 140)}`);
    }
  }
  if (!asked.length) {
    lines.push("", "### 观众留言", `- 最近 ${DAYS} 天没有收到评论数据。`);
  }

  return {
    text: lines.join("\n"),
    hasData: rows.length > 0,
    videos: rows.length,
    medianViews: mid,
  };
}

/** Unused-import guard for the query builder's types. */
void sql;
