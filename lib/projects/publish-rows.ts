import { OWN_ACCOUNTS } from "@/lib/social/own-accounts";
import type { PublishPlatform } from "@/lib/projects/publication";

/**
 * The rows of a project's 发布 page, and what each allows. Client-safe (the
 * page counts characters against these while you type).
 *
 * A row is either one of the studio's own Chinese accounts (posted by hand,
 * `OWN_ACCOUNTS`) or a channel connected in the Publish module (posted
 * through it, keyed `ch:<channel id>`).
 */
export type PublishRowKey = string;

export type PublishDraft = {
  /** The video picked to post: a final cut or a render. */
  fileId: string | null;
  rows: Record<PublishRowKey, { on: boolean; title: string; body: string }>;
};

/** The own-account platform as the 已发布 record names it. */
export const OWN_TO_PLACE: Record<(typeof OWN_ACCOUNTS)[number]["platform"], PublishPlatform> = {
  douyin: "douyin",
  xiaohongshu: "xiaohongshu",
  wechat_channels: "shipinhao",
  bilibili: "bilibili",
};

/** What the page and 撰稿人 are told about each platform. */
export const PUBLISH_ROWS: { key: string; zh: string; style: string; title: number; body: number; shape: string }[] = [
  { key: "douyin", zh: "抖音", style: "竖版 9:16，前 3 秒要有钩子，口语化。", title: 55, body: 1000, shape: "竖版 9:16 · 标题 ≤ 55 字" },
  { key: "xiaohongshu", zh: "小红书", style: "标题像笔记标题，干货感，正文分点，带话题。", title: 20, body: 1000, shape: "竖版 · 标题 ≤ 20 字" },
  { key: "wechat_channels", zh: "微信视频号", style: "稳重可信，适合转发到朋友圈和公众号。", title: 16, body: 1000, shape: "竖版 9:16 · 短标题 ≤ 16 字" },
  { key: "bilibili", zh: "B站", style: "标题可长一点、信息量大，简介写清楚看点。", title: 80, body: 2000, shape: "横竖均可 · 标题 ≤ 80 字" },
  { key: "youtube", zh: "YouTube", style: "标题含关键词，描述写看点。", title: 100, body: 5000, shape: "标题 ≤ 100 字" },
  { key: "linkedin", zh: "LinkedIn", style: "专业、观点清晰。", title: 150, body: 3000, shape: "文案 ≤ 3000 字" },
];

/** A row key's limits: an own account by platform, a channel by its platform (`ch:<id>:<platform>` is not stored — the page passes the platform). */
export function captionLimits(key: string): { title: number; body: number } {
  const platform = key.startsWith("ch:") ? key.split(":")[2] ?? "" : key;
  const row = PUBLISH_ROWS.find((r) => r.key === platform);
  return row ? { title: row.title, body: row.body } : { title: 100, body: 3000 };
}
