import "server-only";
import { HOT_TENANT, latestStored, platformHot } from "@/lib/research/platforms";
import { beatOf, onFocus, relevanceLabel, type BeatFeedKey, type HotRow, type ListKey, type PlatformKey, type Relevance } from "@/lib/research/platform-catalog";
import { readBeats } from "@/lib/research/beat-store";
import { DEFAULT_BEATS } from "@/lib/research/beats";

/**
 * The evidence the morning signal is chosen from, with numbers nobody typed.
 *
 * Every row of every stored hot list gets a short id ("B3", "F1"), and the
 * brief's model is given the rows with those ids. It picks a topic and names
 * the ids that support it; the brief then prints the rows' own numbers from
 * here. So a figure in the brief is always the platform's figure, and a
 * made-up statistic has nowhere to go.
 *
 * Only rows on the studio's beat go in. The pool was 165 rows of which about
 * fourteen were business or tech, and a prompt that asked for two pieces of
 * evidence per topic got a trucker's video and a summit banquet cited for
 * "AI时代普通人如何不被淘汰？". Rows marked business or tech at score 1 or
 * more are kept (looser than the screen's 2, so a summit that may move
 * trade can still back a topic); a list the classifier never marked goes in
 * whole, as before.
 *
 * The beat feeds lead (`lib/research/beat-feeds.ts`): each platform searched
 * for AI, crypto, tech and business, thirty posts each with their own
 * numbers, so the brief chooses from a full, on-beat pool rather than the
 * handful of business rows a day's charts happen to carry. The charts
 * follow, their on-beat rows only: a subject on both a feed and a chart is
 * being pushed by the platform itself, which is the strongest sign there is.
 *
 * The beats are the studio's own list (`readBeats`, for the collector's
 * studio, whose feeds these are): a row under a beat it switched off or
 * deleted stays out, and a row's beat is named as the studio named it
 * ("港股 · 恒指"), so the brief reads a beat the studio added by its name.
 */
export type Evidence = {
  id: string;
  /** A platform's own chart or a beat feed. */
  platform: ListKey;
  source: string;
  phrase: string;
  url: string | null;
  thumbnail: string | null;
  extra: string | null;
  heat: number | null;
  heatLabel: string | null;
  stats: HotRow["stats"] | null;
  /** The row's business / tech mark, when its list was classified. */
  rel?: Relevance | null;
  /** The mark in words with the studio's own beat names ("港股 · 恒指"). */
  label?: string | null;
};

/** The beat feeds: which, how many rows of each (in the feed's own order,
 *  best first), and the letter their ids start with. */
const FEEDS: { platform: BeatFeedKey; letter: string; source: string; take: number }[] = [
  { platform: "beat_douyin", letter: "A", source: "抖音赛道热门视频（AI/加密/科技/商业，近7天）", take: 15 },
  { platform: "beat_weibo", letter: "E", source: "微博科技热搜与赛道热门微博", take: 12 },
  { platform: "beat_xiaohongshu", letter: "H", source: "小红书赛道热门笔记（近7天）", take: 10 },
  { platform: "beat_bilibili", letter: "V", source: "B站赛道热门视频（近3天）", take: 10 },
  { platform: "beat_youtube", letter: "U", source: "YouTube 赛道热门视频（近3天）", take: 10 },
  { platform: "beat_tiktok", letter: "K", source: "TikTok 赛道热门视频（英文）", take: 8 },
  { platform: "beat_news", letter: "N", source: "港台新闻（近2天）", take: 12 },
  { platform: "beat_crypto", letter: "C", source: "加密市场（CoinGecko 热搜与涨跌）", take: 6 },
];

/** The platforms' own charts, their on-beat rows: the 上榜 signal. */
const POOL: { platform: PlatformKey; letter: string; source: string; take: number }[] = [
  { platform: "dy_breakout", letter: "B", source: "抖音低粉爆款（小账号，近7天）", take: 12 },
  { platform: "dy_finance", letter: "F", source: "抖音财经热门视频（24小时）", take: 8 },
  { platform: "dy_tech", letter: "T", source: "抖音科技热门视频（24小时）", take: 8 },
  { platform: "dy_rising", letter: "R", source: "抖音上升热点", take: 10 },
  { platform: "douyin", letter: "D", source: "抖音热搜", take: 10 },
  { platform: "weibo", letter: "W", source: "微博热搜", take: 10 },
  { platform: "xiaohongshu", letter: "X", source: "小红书创作灵感", take: 6 },
  { platform: "bilibili", letter: "L", source: "B站热搜", take: 6 },
  { platform: "youtube", letter: "Y", source: "YouTube 香港热门", take: 8 },
  { platform: "google", letter: "G", source: "Google 香港热搜", take: 10 },
];

export async function evidencePool(): Promise<{ rows: Evidence[]; fetchedAt: Record<string, number> }> {
  /* The feeds from storage only (they are the collector's to read, never a
     brief's); the charts as before. A feed older than a day is left out
     rather than passed off as today's. */
  const [feeds, lists, beats] = await Promise.all([
    Promise.all(FEEDS.map((f) => latestStored(f.platform).catch(() => null))),
    Promise.all(POOL.map((p) => platformHot(p.platform).catch(() => null))),
    readBeats(HOT_TENANT).catch(() => [...DEFAULT_BEATS]),
  ]);
  const followed = new Set(beats.filter((b) => b.enabled).map((b) => b.key));
  const label = (mark: Relevance | null) => (mark ? relevanceLabel(mark, true, beats) : null);
  const rows: Evidence[] = [];
  const fetchedAt: Record<string, number> = {};
  FEEDS.forEach((f, i) => {
    const feed = feeds[i];
    if (!feed || Date.now() - feed.fetchedAt > 26 * 3_600_000) return;
    fetchedAt[f.platform] = feed.fetchedAt;
    const markOf = (r: HotRow): Relevance | null => feed.relevance?.[r.phrase] ?? (r.beat ? { t: r.beat, s: 2 as const } : null);
    feed.rows
      .filter((r) => {
        const b = r.beat ?? beatOf(markOf(r));
        return !b || followed.has(b);
      })
      .slice(0, f.take)
      .forEach((r, j) => {
        const mark = markOf(r);
        rows.push({ id: `${f.letter}${j + 1}`, platform: f.platform, source: f.source, phrase: r.phrase, url: r.url, thumbnail: r.thumbnail, extra: r.extra, heat: r.heat, heatLabel: r.heatLabel, stats: r.stats ?? null, rel: mark, label: label(mark) });
      });
  });
  POOL.forEach((p, i) => {
    const hot = lists[i];
    if (!hot) return;
    fetchedAt[p.platform] = hot.fetchedAt;
    const rel = hot.relevance ?? null;
    const kept = rel
      ? hot.rows.filter((r) => {
          const b = beatOf(rel[r.phrase]);
          return onFocus(rel[r.phrase], 1) && !!b && followed.has(b);
        })
      : hot.rows;
    kept.slice(0, p.take).forEach((r, j) => {
      rows.push({
        id: `${p.letter}${j + 1}`,
        platform: p.platform,
        source: p.source,
        phrase: r.phrase,
        url: r.url,
        thumbnail: r.thumbnail,
        extra: r.extra,
        heat: r.heat,
        heatLabel: r.heatLabel,
        stats: r.stats ?? null,
        rel: rel?.[r.phrase] ?? null,
        label: label(rel?.[r.phrase] ?? null),
      });
    });
  });
  return { rows, fetchedAt };
}

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万` : String(Math.round(n)));

function ago(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 24 ? `${Math.max(1, Math.round(h))}小时前` : `${Math.round(h / 24)}天前`;
}

/** The numbers of one row, in words, from the row itself. */
export function evidenceNumbers(e: Evidence): string {
  const s = e.stats ?? {};
  const parts: string[] = [];
  if (s.change24h != null) {
    // A coin: its price and move, not plays.
    if (s.price != null) parts.push(`价格 $${s.price >= 1 ? Math.round(s.price).toLocaleString("en-US") : s.price.toPrecision(3)}`);
    parts.push(`24小时 ${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(1)}%`);
    if (s.capRank) parts.push(`市值第 ${s.capRank}`);
    return parts.join(" · ");
  }
  if (s.views != null) parts.push(`播放 ${wan(s.views)}`);
  else if (e.heatLabel) parts.push(`热度 ${e.heatLabel}`);
  else if (e.heat != null) parts.push(`热度 ${wan(e.heat)}`);
  if (s.likes != null) parts.push(`点赞 ${wan(s.likes)}${s.likeRate != null ? `（${(s.likeRate * 100).toFixed(1)}%）` : ""}`);
  else if (s.likeRate != null) parts.push(`点赞率 ${(s.likeRate * 100).toFixed(1)}%`);
  if (s.comments != null) parts.push(`评论 ${wan(s.comments)}`);
  if (s.shares != null) parts.push(`转发 ${wan(s.shares)}`);
  if (s.saves != null) parts.push(`收藏 ${wan(s.saves)}`);
  /* The multiple only when the video travelled past its own audience: the
     beat feeds carry big accounts too, and "播放是粉丝的 0 倍" on a news
     account's clip read to the brief's model as a flop. */
  if (s.fans != null) parts.push(`账号粉丝 ${wan(s.fans)}${s.views && s.views >= s.fans ? `（播放是粉丝的 ${wan(Math.round(s.views / Math.max(1, s.fans)))} 倍）` : ""}`);
  if (s.videos != null) parts.push(`相关视频 ${wan(s.videos)}`);
  if (s.rankUp) parts.push(`排名上升 ${s.rankUp}`);
  if (s.publishedAt) parts.push(ago(s.publishedAt));
  return parts.join(" · ");
}

/** One line per row for the model: id, source, title, account, numbers. */
export function evidenceForModel(rows: Evidence[]): string {
  let last = "";
  const out: string[] = [];
  for (const e of rows) {
    if (e.source !== last) {
      out.push(`\n### ${e.source}`);
      last = e.source;
    }
    out.push(`[${e.id}] ${e.phrase.slice(0, 80)}${e.extra ? ` ｜ ${e.extra.slice(0, 30)}` : ""} ｜ ${evidenceNumbers(e) || "—"}${e.rel ? ` ｜ ${e.label ?? relevanceLabel(e.rel, true)}` : ""}`);
  }
  return out.join("\n");
}

/** One line per row for people: source, linked title, numbers. */
export function evidenceForPeople(e: Evidence): string {
  const title = e.phrase.length > 40 ? `${e.phrase.slice(0, 40)}…` : e.phrase;
  const linked = e.url ? `[「${title}」](${e.url})` : `「${title}」`;
  const who = e.extra && e.stats?.views != null ? ` @${e.extra.slice(0, 20)}` : "";
  const nums = evidenceNumbers(e);
  return `${e.source.replace(/（.*?）/, "")} · ${linked}${who}${nums ? ` · ${nums}` : ""}`;
}
