import "server-only";
import { platformHot } from "@/lib/research/platforms";
import { onFocus, relevanceLabel, type HotRow, type PlatformKey, type Relevance } from "@/lib/research/platform-catalog";

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
 */
export type Evidence = {
  id: string;
  platform: PlatformKey;
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
};

/** Which lists, how many rows of each, and the letter their ids start with. */
const POOL: { platform: PlatformKey; letter: string; source: string; take: number }[] = [
  { platform: "dy_breakout", letter: "B", source: "抖音低粉爆款（小账号，近7天）", take: 20 },
  { platform: "dy_finance", letter: "F", source: "抖音财经热门视频（24小时）", take: 15 },
  { platform: "dy_tech", letter: "T", source: "抖音科技热门视频（24小时）", take: 15 },
  { platform: "dy_rising", letter: "R", source: "抖音上升热点", take: 20 },
  { platform: "douyin", letter: "D", source: "抖音热搜", take: 20 },
  { platform: "weibo", letter: "W", source: "微博热搜", take: 20 },
  { platform: "xiaohongshu", letter: "X", source: "小红书创作灵感", take: 10 },
  { platform: "bilibili", letter: "L", source: "B站热搜", take: 10 },
  { platform: "youtube", letter: "Y", source: "YouTube 香港热门", take: 15 },
  { platform: "google", letter: "G", source: "Google 香港热搜", take: 20 },
];

export async function evidencePool(): Promise<{ rows: Evidence[]; fetchedAt: Record<string, number> }> {
  const lists = await Promise.all(POOL.map((p) => platformHot(p.platform).catch(() => null)));
  const rows: Evidence[] = [];
  const fetchedAt: Record<string, number> = {};
  POOL.forEach((p, i) => {
    const hot = lists[i];
    if (!hot) return;
    fetchedAt[p.platform] = hot.fetchedAt;
    const rel = hot.relevance ?? null;
    const kept = rel ? hot.rows.filter((r) => onFocus(rel[r.phrase], 1)) : hot.rows;
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
  if (s.views != null) parts.push(`播放 ${wan(s.views)}`);
  else if (e.heatLabel) parts.push(`热度 ${e.heatLabel}`);
  else if (e.heat != null) parts.push(`热度 ${wan(e.heat)}`);
  if (s.likes != null) parts.push(`点赞 ${wan(s.likes)}${s.likeRate != null ? `（${(s.likeRate * 100).toFixed(1)}%）` : ""}`);
  else if (s.likeRate != null) parts.push(`点赞率 ${(s.likeRate * 100).toFixed(1)}%`);
  if (s.comments != null) parts.push(`评论 ${wan(s.comments)}`);
  if (s.fans != null) parts.push(`账号粉丝 ${wan(s.fans)}${s.views ? `（播放是粉丝的 ${wan(Math.round(s.views / Math.max(1, s.fans)))} 倍）` : ""}`);
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
    out.push(`[${e.id}] ${e.phrase.slice(0, 80)}${e.extra ? ` ｜ ${e.extra.slice(0, 30)}` : ""} ｜ ${evidenceNumbers(e) || "—"}${e.rel ? ` ｜ ${relevanceLabel(e.rel, true)}` : ""}`);
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
