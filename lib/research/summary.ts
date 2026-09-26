import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { toSimplified } from "@/lib/text/simplified";
import { isBeatFeedKey, onFocus, type HotRow, type ListKey, type RelevanceMap } from "@/lib/research/platform-catalog";

/**
 * 研究员's line on a hot list: what is going viral here, in one or two
 * sentences, and the pattern behind it.
 *
 * Written once when the list is collected (`collectPlatform`) and stored with
 * it, so the page shows it instantly and nobody waits on a model call. It
 * may only describe what the rows say; numbers are quoted from the rows.
 *
 * Only about the rows on the studio's beat. Summarising the whole list
 * produced lines like "中秋、亚运、中美元首" on every platform, which is
 * the noise restated. When the classifier marked the list, the line is
 * about its business and tech rows alone, and a list with none says so in
 * a fixed sentence without asking a model. An unmarked list (the classifier
 * failed) is summarised whole, as before.
 *
 * A beat feed (`beat_*`, `lib/research/beat-feeds.ts`) is on the beats by
 * construction — the rows were searched for AI, crypto, tech and business
 * and the off-beat ones already dropped — so its line is about the whole
 * feed: which subjects did best on that platform in the last few days, and
 * what they have in common. `beat_all` is the cross-platform top of the
 * feeds, for the first tab.
 */
const NAMES: Partial<Record<ListKey | "beat_all", string>> = {
  google: "Google 香港热搜",
  youtube: "YouTube 香港热门",
  dy_breakout: "抖音低粉爆款",
  dy_finance: "抖音财经热门视频",
  dy_tech: "抖音科技热门视频",
  dy_rising: "抖音上升热点",
  douyin: "抖音热搜",
  xiaohongshu: "小红书创作灵感",
  weibo: "微博热搜",
  bilibili: "B站热搜",
  tiktok: "TikTok 在推的视频",
  beat_douyin: "抖音赛道热门视频",
  beat_xiaohongshu: "小红书赛道热门笔记",
  beat_weibo: "微博科技热搜与赛道热门微博",
  beat_bilibili: "B站赛道热门视频",
  beat_tiktok: "TikTok 赛道热门视频",
  beat_youtube: "YouTube 赛道热门视频（近三天）",
  beat_news: "港台新闻（AI、加密、科技、商业）",
  beat_crypto: "加密市场（CoinGecko 热搜与涨跌）",
  beat_all: "各平台 AI、加密、科技、商业赛道的热门内容",
};

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${Math.round(n / 1e4)}万` : String(Math.round(n)));

const REFUSAL = /努力学习|无法回答|不能回答|无法提供|换个话题|抱歉|I can.t|I cannot/;

/** The line a list with nothing on the beat gets, without a model call. */
export const NOTHING_ON_BEAT = "这份榜此刻没有 AI、加密、科技或商业相关的条目。";

export async function summarizeHot(platform: ListKey | "beat_all", all: HotRow[], relevance?: RelevanceMap | null): Promise<string | null> {
  if (!all.length) return null;
  const feed = platform === "beat_all" || isBeatFeedKey(platform);
  /* Each row keeps its place on the platform's list, so "第 10 名" in the
     line means what the platform said. */
  const ranked = all.map((r, i) => ({ r, rank: i + 1 }));
  const rows = relevance && !feed ? ranked.filter(({ r }) => onFocus(relevance[r.phrase])) : ranked;
  if (!rows.length) return NOTHING_ON_BEAT;
  const list = rows.slice(0, 25).map(({ r, rank }) => {
    const s = r.stats ?? {};
    const nums = (
      s.change24h != null
        ? [`24h${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(1)}%`, s.price != null ? `价格$${s.price < 1 ? s.price.toPrecision(3) : Math.round(s.price).toLocaleString("en-US")}` : "", s.capRank ? `市值第${s.capRank}` : ""]
        : [
            s.views != null ? `播放${wan(s.views)}` : s.likes != null ? `点赞${wan(s.likes)}` : r.heatLabel ? `热度${r.heatLabel}` : r.heat != null ? `热度${wan(r.heat)}` : "",
            s.likeRate != null ? `点赞率${(s.likeRate * 100).toFixed(1)}%` : "",
            s.views == null && s.comments != null ? `评论${wan(s.comments)}` : "",
            s.fans && s.views ? `粉丝${wan(s.fans)}` : "",
          ]
    ).filter(Boolean).join(" ");
    return `${rank}. ${r.phrase.slice(0, 60)}${r.extra ? `（${r.extra.slice(0, 20)}）` : ""} ${nums}`;
  });
  const prompt = feed
    ? [
        `你是一家香港财经科技自媒体工作室的研究员。下面是「${NAMES[platform] ?? platform}」：按频道的赛道（AI、加密、科技、商业等）搜出来、最近几天表现最好的 ${rows.length} 条（序号是名次，按互动和新近程度排）。`,
        "用一到两句话（合计不超过 80 个字）告诉主持人：这里什么题材表现最好、共同点是什么（题材、角度或情绪），哪个赛道最热。说题材本身，不要罗列序号。",
        "只根据列表说话，引用数字时照抄列表里的数字，不要编。不要客套，不要列表，不要加引号。简体中文。",
        "",
        ...list,
      ].join("\n")
    : [
    relevance
      ? `你是一家香港财经科技自媒体工作室的研究员。下面是「${NAMES[platform] ?? platform}」此刻榜单里跟 AI、加密、科技、商业相关的 ${rows.length} 条（整份榜 ${all.length} 条，其余是娱乐、体育、节日之类，已略去；序号是它在榜上的名次）。`
      : `你是一家香港财经科技自媒体工作室的研究员。下面是「${NAMES[platform] ?? platform}」此刻的榜单。`,
    relevance
      ? "用一到两句话（合计不超过 70 个字）告诉主持人：这些条目里什么在火、共同点是什么（题材、形式或情绪）。只说这些条目，不要提被略去的内容。"
      : "用一到两句话（合计不超过 70 个字）告诉主持人：这里现在什么在火、火的共同点是什么（题材、形式或情绪）。",
    "只根据榜单说话，引用数字时照抄榜单里的数字，不要编。不要客套，不要列表，不要加引号。简体中文。",
    "",
    ...list,
  ].join("\n");
  /* A model that declines (political lists trip some filters) answers with a
     canned line; that is not a summary, so the next model tries, and failing
     all of them the page shows nothing rather than the refusal. */
  for (const model of [modelFor.utility(), modelFor.assistant()]) {
    try {
      const res = await complete({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, maxTokens: 400 });
      const text = toSimplified(res.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()).replace(/^["“「]|["”」]$/g, "");
      if (text && !REFUSAL.test(text)) return text.slice(0, 160);
    } catch (err) {
      console.error(`[research] summary for ${platform} by ${model}`, err);
    }
  }
  return null;
}
