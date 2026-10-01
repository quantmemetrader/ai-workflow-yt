import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channelPosts, creatorVideos, ownAccountSnapshots, postMetrics, projectPostMetrics, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { readPublication } from "@/lib/projects/publication";
import { toSimplified } from "@/lib/text/simplified";
import { EMPTY_STATS, STAT_KEYS, type AccountPost, type Stats, type VideoRow } from "@/lib/review/types";

/**
 * Every upload on the studio's accounts, one row each, for 账号数据's
 * 每条视频 and each video's own page (the owner, 29 Sep: "per video analytics
 * of every uploaded video").
 *
 * Read from what is already stored, never a paid call: 抖音 · 小红书 · B站
 * from the account readings (every 6 hours, each reading keeps the latest
 * posts, so a post's history is its row in each reading), YouTube from the
 * channel sync (`creator_videos`) with its daily numbers (`post_metrics`).
 */
export async function allVideos(viewer: Viewer): Promise<VideoRow[]> {
  const [snaps, yt, posts, projects, tracked] = await Promise.all([
    db
      .select({ platform: ownAccountSnapshots.platform, posts: ownAccountSnapshots.posts, at: ownAccountSnapshots.fetchedAt })
      .from(ownAccountSnapshots)
      .where(eq(ownAccountSnapshots.tenantId, viewer.tenantId))
      .orderBy(asc(ownAccountSnapshots.fetchedAt)),
    db.select().from(creatorVideos).where(eq(creatorVideos.tenantId, viewer.tenantId)),
    db.select({ id: channelPosts.id, externalId: channelPosts.externalId, platform: channelPosts.platform }).from(channelPosts).where(eq(channelPosts.tenantId, viewer.tenantId)),
    db
      .select({ id: workProjects.id, title: workProjects.title, source: workProjects.source })
      .from(workProjects)
      .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer))),
    db.select({ projectId: projectPostMetrics.projectId, url: projectPostMetrics.url }).from(projectPostMetrics).where(eq(projectPostMetrics.tenantId, viewer.tenantId)),
  ]);

  /* Which project a post belongs to: its 已发布 links and the posts tracked on its 复盘. */
  const byUrl = new Map<string, { id: string; title: string }>();
  const titleOf = new Map(projects.map((p) => [p.id, p.title]));
  for (const p of projects) for (const x of readPublication(p.source)?.platforms ?? []) if (x.url) byUrl.set(norm(x.url), { id: p.id, title: p.title });
  for (const t of tracked) if (t.url && titleOf.has(t.projectId) && !byUrl.has(norm(t.url))) byUrl.set(norm(t.url), { id: t.projectId, title: titleOf.get(t.projectId)! });
  const projectOf = (url: string | null) => (url ? (byUrl.get(norm(url)) ?? null) : null);

  const out: VideoRow[] = [];

  /* 抖音 · 小红书 · B站: newest numbers per post, and one point per reading. */
  const cn = new Map<string, VideoRow>();
  for (const s of snaps) {
    if (!Array.isArray(s.posts)) continue;
    for (const p of s.posts as AccountPost[]) {
      if (!p?.id) continue;
      const key = `${s.platform}_${p.id}`;
      const stats: Stats = { ...EMPTY_STATS, ...(p.stats ?? {}) };
      const seriesOf = stats.plays !== null && stats.plays !== undefined ? "plays" : "likes";
      const v = seriesOf === "plays" ? stats.plays : stats.likes;
      const row = cn.get(key) ?? {
        key,
        platform: s.platform,
        title: toSimplified(p.title ?? ""),
        url: p.url ?? null,
        thumb: null,
        at: p.at ?? null,
        stats,
        series: [],
        seriesOf,
        project: projectOf(p.url ?? null),
      };
      row.stats = stats;
      row.seriesOf = seriesOf;
      if (typeof v === "number") row.series.push({ at: s.at.toISOString(), v });
      cn.set(key, row);
    }
  }

  /* YouTube: the channel sync, with the daily readings where the post is tracked. */
  const postIdOf = new Map(posts.filter((p) => p.platform === "youtube").map((p) => [p.externalId, p.id]));
  const ids = [...postIdOf.values()];
  const metrics = ids.length
    ? await db
        .select({ postId: postMetrics.postId, at: postMetrics.asOf, views: postMetrics.views, likes: postMetrics.likes, comments: postMetrics.comments, shares: postMetrics.shares, saves: postMetrics.saves })
        .from(postMetrics)
        .where(inArray(postMetrics.postId, ids))
        .orderBy(asc(postMetrics.asOf))
    : [];
  const readings = new Map<string, typeof metrics>();
  for (const m of metrics) (readings.get(m.postId) ?? readings.set(m.postId, []).get(m.postId)!).push(m);
  const thumbs: { t: string; thumb: string }[] = [];
  for (const v of yt) {
    const url = `https://www.youtube.com/watch?v=${v.externalId}`;
    const rs = readings.get(postIdOf.get(v.externalId) ?? "") ?? [];
    const last = rs[rs.length - 1];
    const stats: Stats = {
      plays: Math.max(v.views ?? 0, last?.views ?? 0),
      likes: Math.max(v.likes ?? 0, last?.likes ?? 0),
      comments: Math.max(v.comments ?? 0, last?.comments ?? 0),
      // YouTube never reports shares or saves publicly; the sync writes 0,
      // which read as "nobody shared it" (QA, 2 Oct). Left unknown instead.
      shares: null,
      collects: null,
      completion: null,
    };
    const title = toSimplified(v.title);
    if (v.thumbnailUrl) thumbs.push({ t: key12(title), thumb: v.thumbnailUrl });
    out.push({
      key: `youtube_${v.externalId}`,
      platform: "youtube",
      title,
      url,
      thumb: v.thumbnailUrl,
      at: v.publishedAt?.toISOString() ?? null,
      stats,
      series: rs.filter((r) => typeof r.views === "number").slice(-60).map((r) => ({ at: r.at.toISOString(), v: r.views as number })),
      seriesOf: "plays",
      project: projectOf(url),
    });
  }

  /* The same video goes up everywhere: a 抖音 post borrows its YouTube cover. */
  for (const row of cn.values()) {
    const k = key12(row.title);
    row.thumb = thumbs.find((x) => x.t === k)?.thumb ?? null;
    out.push(row);
  }

  return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** One video's page: it, the same video on the other platforms, and the account's typical post there. */
export async function videoDetail(viewer: Viewer, key: string): Promise<{ video: VideoRow; siblings: VideoRow[]; typical: Stats | null } | null> {
  const all = await allVideos(viewer);
  const video = all.find((v) => v.key === key);
  if (!video) return null;
  const k = key12(video.title);
  const siblings = all.filter((v) => v.key !== key && v.platform !== video.platform && key12(v.title) === k);
  const same = all.filter((v) => v.platform === video.platform).slice(0, 30);
  const typical: Stats = { ...EMPTY_STATS };
  for (const s of STAT_KEYS) {
    const xs = same.map((v) => v.stats[s]).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
    typical[s] = xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }
  return { video, siblings, typical: same.length > 2 ? typical : null };
}

/** A title's first twelve letters, without hashtags, spaces or punctuation: the same video across platforms. */
function key12(title: string): string {
  return Array.from(
    title
      .replace(/#\S+/g, "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, ""),
  )
    .slice(0, 12)
    .join("");
}

function norm(url: string): string {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${v ? `?v=${v}` : ""}`;
  } catch {
    return url;
  }
}
