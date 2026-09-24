import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { toSimplified } from "@/lib/text/simplified";
import type { HotRow, PlatformKey } from "@/lib/research/platform-catalog";

/**
 * 研究员's line on a hot list: what is going viral here, in one or two
 * sentences, and the pattern behind it.
 *
 * Written once when the list is collected (`collectPlatform`) and stored with
 * it, so the page shows it instantly and nobody waits on a model call. It
 * may only describe what the rows say; numbers are quoted from the rows.
 */
const NAMES: Partial<Record<PlatformKey, string>> = {
  google: "Google 香港热搜",
  youtube: "YouTube 香港热门",
  dy_breakout: "抖音低粉爆款（财经、科技）",
  dy_finance: "抖音财经热门视频",
  dy_tech: "抖音科技热门视频",
  dy_rising: "抖音上升热点",
  douyin: "抖音热搜",
  xiaohongshu: "小红书创作灵感",
  weibo: "微博热搜",
  bilibili: "B站热搜",
  tiktok: "TikTok 在推的视频",
};

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${Math.round(n / 1e4)}万` : String(Math.round(n)));

const REFUSAL = /努力学习|无法回答|不能回答|无法提供|换个话题|抱歉|I can.t|I cannot/;

export async function summarizeHot(platform: PlatformKey, rows: HotRow[]): Promise<string | null> {
  if (!rows.length) return null;
  const list = rows.slice(0, 25).map((r, i) => {
    const s = r.stats ?? {};
    const nums = [
      s.views != null ? `播放${wan(s.views)}` : r.heatLabel ? `热度${r.heatLabel}` : r.heat != null ? `热度${wan(r.heat)}` : "",
      s.likeRate != null ? `点赞率${(s.likeRate * 100).toFixed(1)}%` : "",
      s.fans && s.views ? `粉丝${wan(s.fans)}` : "",
    ].filter(Boolean).join(" ");
    return `${i + 1}. ${r.phrase.slice(0, 60)}${r.extra ? `（${r.extra.slice(0, 20)}）` : ""} ${nums}`;
  });
  const prompt = [
    `你是一家香港财经科技自媒体工作室的研究员。下面是「${NAMES[platform] ?? platform}」此刻的榜单。`,
    "用一到两句话（合计不超过 70 个字）告诉主持人：这里现在什么在火、火的共同点是什么（题材、形式或情绪）。",
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
