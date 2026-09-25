"use client";

import * as React from "react";
import { ResearchAgentPanel } from "./ResearchAgentPanel";
import { PlatformMark, platformLabel } from "@/components/ui/PlatformMark";
import { Icon } from "@/components/ui/Icon";
import { useResizable } from "@/components/ui/Resizer";
import type { InboxComment, InboxGroup } from "@/lib/social/service";

/**
 * InboxScreen — a transcription of design/canvas/Res-Inbox.dc.html.
 *
 * Everything after the artboard's 52px rail and its 212px Market Research
 * sidebar (both are components of their own now — Rail and ResearchSidebar,
 * rendered by the page): the header bar, the filter row, the sentiment and
 * language band, the 330px grouped list and the detail pane. Markup, nesting,
 * class names, SVG paths, pixel values and colours are the artboard's; only the
 * content is lifted into props. The artboard is the source of truth — when it
 * changes, change this file with it, and do not "improve" anything here that
 * the artboard does not do.
 *
 * Four places where the artboard drew a picture and this screen has to be a
 * product:
 *
 *   1. The 240px search box was decoration. It is a real filter here, over
 *      comment text, translation and author, run client-side over `groups`.
 *   2. The Sentiment and Language chips were chips. They are pickers, and
 *      their options come from `summary` — the distributions actually present
 *      — rather than a list written out here.
 *   3. The draft was a static block of text. It is a textarea, edited in
 *      place, so "Edit" means editing rather than navigating somewhere else.
 *   4. The artboard captioned the language list "TikTok has no comment
 *      interface". TikTok's comment API landed; the caption is now false, so
 *      the slot carries what is true instead — how many comments are not yet
 *      read, or when the channels were last checked.
 *
 * The artboard's 312px Agent panel is drawn, through the shared
 * ResearchAgentPanel that every Research screen uses. Its scripted
 * conversation is not: the panel says what these rows actually contain.
 *
 * 2026-09: the studio asked for this screen to work better than the artboard
 * drew it, so the layout departs from it in five places: the counters are
 * filter tabs, the pickers sit in one tidy row, the charts fold away behind a
 * one-line summary, the list rows are cards with a sentiment bar, and the
 * detail pane is a card that carries the video, the comment and the reply.
 *
 * Not drawn: the artboard's notification bell, whose red dot claimed something
 * was waiting when there is no notification feed behind it (the same call
 * Trends and Backlog made).
 */

export type InboxScreenProps = {
  locale: string;
  groups: InboxGroup[];
  summary: {
    sentiment: Record<string, number>; // keys: very_negative|negative|neutral|positive|very_positive
    language: Record<string, number>; // BCP-47 tags: "yue", "zh-Hant", "zh-Hans", "en", ...
    open: number;
    unclassified: number;
  };
  channelCount: number;
  syncedAt: Date | null;
  /** currently open comment, or null */
  selectedId: string | null;
  /** how many earlier comments the selected commenter has left */
  priorCount: number;
  filters: { sentiment?: string; language?: string; flagged?: boolean; leads?: boolean };
  /** ids ticked for a bulk action */
  selected: string[];
  /** an action is in flight for this comment/draft id */
  pending: string | null;
  /** last error to show inline, if any */
  error: string | null;

  onSelect: (commentId: string) => void;
  onToggleSelect: (commentId: string) => void;
  onFilter: (next: InboxScreenProps["filters"]) => void;
  onApprove: (draftId: string, body: string) => void;
  onSaveEdit: (draftId: string, body: string) => void;
  onRegenerate: (commentId: string, steer?: string) => void;
  onModerate: (commentId: string, action: "hide" | "spam" | "ignore") => void;
  onBulk: (action: "hide" | "spam" | "ignore") => void;
  onSyncNow: () => void;
  /** The model answering in the right-hand panel, shown under its composer. */
  model: string;
  /** Hands a question to the agent, which answers on /chat where it can cite
   * the files the asker is allowed to read. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, rendered in the agent panel. */
  thread?: React.ReactNode;
  /** Controls above the composer: history, a new thread. */
  tools?: React.ReactNode;
};

/** The artboard's `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/** The histogram, left to right, with the artboard's five colours. */
const SENTIMENTS = ["very_negative", "negative", "neutral", "positive", "very_positive"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
const BAR_COLOUR: Record<Sentiment, string> = {
  very_negative: "#e03636",
  negative: "#f79596",
  neutral: "#c7c7c7",
  positive: "#86e0a8",
  very_positive: "#278f5e",
};
/** The tallest bar in the artboard is 44px; the rest are drawn against it. */
const BAR_MAX = 44;

/** The colour of a list card's left edge: the histogram's own colour for the
 * comment's sentiment, nothing for one no classifier has read yet. */
function sentimentColour(s: string | null): string {
  return s !== null && (SENTIMENTS as readonly string[]).includes(s) ? BAR_COLOUR[s as Sentiment] : "transparent";
}

/** Which slice of the inbox the tabs above the list are showing. Client-side,
 * like the platform picker: it sifts the rows already in hand. */
type ListView = "all" | "drafts" | "undrafted" | "unclassified";


/* --------------------------------------------------------------------- css */

/**
 * The artboard's own <style>, verbatim, minus the rail rules (.r — the rail is
 * not ours), the sidebar rules it shares with ResearchSidebar's own screens,
 * and the html/body rules (the artboard is a 1440x900 frame, the product fills
 * the viewport). Every selector is scoped to [data-inbox-screen] so these
 * one-letter class names cannot collide with — or be overridden by — the rest
 * of the app, which defines its own .n / .lbl / .btn. Source order is the
 * artboard's, so the cascade inside is unchanged.
 */
const CSS = `
[data-inbox-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-inbox-screen] * { box-sizing: border-box; }
[data-inbox-screen] a { color: #007be0; text-decoration: none; }
[data-inbox-screen] img { display: block; }
[data-inbox-screen] p { margin: 0; }

[data-inbox-screen] .lbl { font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-inbox-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-inbox-screen] .h1 { font-size: 15px; font-weight: 500; }
[data-inbox-screen] .mut { font-size: 12.5px; color: #999999; }
[data-inbox-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-inbox-screen] .btn.p { background: #171717; color: #fff; font-weight: 500; }
[data-inbox-screen] .btn.s { border: 1px solid #e2e2e2; background: #fff; color: #525252; }
[data-inbox-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-inbox-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid #e2e2e2; border-radius: 8px; background: #fff; font-size: 12px; color: #7c7c7c; white-space: nowrap; }
[data-inbox-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-inbox-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
[data-inbox-screen] .gray { background: #f3f3f3; color: #525252 }
[data-inbox-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-inbox-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-inbox-screen] .amb  { background: #fff7d3; color: #db7706 }
[data-inbox-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-inbox-screen] .kv { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f3f3f3; font-size: 12.5px; }
[data-inbox-screen] .kv span:first-child { color: #999999; }
[data-inbox-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
[data-inbox-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
[data-inbox-screen] .focus { box-shadow: 0 0 0 3px #EFF6FF; }
[data-inbox-screen] .cap { font-size: 11.5px; color: #999999; }

/* a list row (the artboard's selected row, and the rest) */
[data-inbox-screen] .cmt { position: relative; display: flex; gap: 10px; margin: 0 10px 6px; padding: 10px 12px 10px 14px; border: 1px solid #ececec; border-radius: 10px; background: #fff; overflow: hidden; cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease; }
[data-inbox-screen] .cmt::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--sb, transparent); }
[data-inbox-screen] .cmt:hover { border-color: #d6d6d6; }
[data-inbox-screen] .cmt:focus-visible { outline: none; box-shadow: 0 0 0 3px #eff6ff; border-color: var(--ac); }
[data-inbox-screen] .cmt.on { border-color: #9cc4f0; background: #fbfdff; box-shadow: 0 0 0 3px #eef5fe; }

/* the product needs a pointer on what it made clickable; the artboard is static */
[data-inbox-screen] .btn, [data-inbox-screen] .chip { cursor: pointer; }
[data-inbox-screen] .btn { border: 0; font-family: inherit; letter-spacing: inherit; }
[data-inbox-screen] .btn:disabled { opacity: .45; cursor: not-allowed; }

/* bulk selection: out of the way until it is wanted */
[data-inbox-screen] .cbx { opacity: 0; transition: opacity .12s ease; }
[data-inbox-screen] .cmt:hover .cbx,
[data-inbox-screen] .cmt:focus-within .cbx,
[data-inbox-screen] .cmt.anysel .cbx { opacity: 1; }

/* the draft box: the artboard drew its focus ring permanently, because it had
   nothing to focus */
[data-inbox-screen] .dr:focus { box-shadow: 0 0 0 3px #EFF6FF; }

/* the segmented control, copied from the Trends and Backlog artboards rather
   than invented: this one had nothing to switch, so its <style> never carried
   these rules, and grouping the list needs exactly the control they draw */
[data-inbox-screen] .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
[data-inbox-screen] .tf button { height: 24px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; display: flex; align-items: center; font-size: 11.5px; font-weight: 500; font-family: inherit; letter-spacing: inherit; color: #7c7c7c; cursor: pointer; }
[data-inbox-screen] .tf button.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }

/* 2026-09 layout: filter tabs, the folded summary, cards. Prefixed, because
   the rest of the app has its own .card and .tab. */
[data-inbox-screen] .btn.ib-q { height: 28px; padding: 0 9px; background: transparent; color: #525252; font-size: 12px; }
[data-inbox-screen] .btn.ib-q:hover:not(:disabled) { background: #f3f3f3; color: #171717; }
[data-inbox-screen] .btn.s:hover:not(:disabled) { background: #f8f8f8; }
[data-inbox-screen] .ib-row { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 0 20px; border-bottom: 1px solid #ececec; }
[data-inbox-screen] .ib-fchip { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px; border: 1px solid #e2e2e2; border-radius: 8px; background: #fff; font-family: inherit; font-size: 12px; letter-spacing: inherit; color: #525252; white-space: nowrap; cursor: pointer; }
[data-inbox-screen] .ib-fchip:hover { border-color: #cfcfcf; color: #171717; }
[data-inbox-screen] .ib-fchip .n { font-size: 11px; font-weight: 500; color: #999999; font-variant-numeric: tabular-nums; }
[data-inbox-screen] .ib-fchip.on { background: #eaf3fe; border-color: #b9d5f5; color: #0f4c8a; font-weight: 500; }
[data-inbox-screen] .ib-fchip.on .n { color: #3a78bf; }
[data-inbox-screen] .ib-vr { width: 1px; height: 16px; background: #e2e2e2; margin: 0 4px; flex-shrink: 0; }
[data-inbox-screen] .ib-sum { flex-shrink: 0; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 14px 0 20px; border-bottom: 1px solid #ececec; background: #fcfcfc; }
[data-inbox-screen] .ib-sumitems { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none; white-space: nowrap; }
[data-inbox-screen] .ib-sumitems::-webkit-scrollbar { display: none; }
[data-inbox-screen] .ib-sumk { font-size: 11.5px; font-weight: 500; color: #999999; margin-right: 4px; }
[data-inbox-screen] .ib-sumi { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-family: inherit; font-size: 12px; letter-spacing: inherit; color: #525252; cursor: pointer; white-space: nowrap; }
[data-inbox-screen] .ib-sumi:hover { background: #f0f0f0; color: #171717; }
[data-inbox-screen] .ib-sumi.on { background: #eaf3fe; border-color: #b9d5f5; color: #0f4c8a; }
[data-inbox-screen] .ib-sumi .n { font-variant-numeric: tabular-nums; color: #999999; }
[data-inbox-screen] .ib-dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }
[data-inbox-screen] .ib-gh { display: flex; align-items: center; gap: 10px; padding: 12px 12px 7px; }
[data-inbox-screen] .ib-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
[data-inbox-screen] .ib-card { max-width: 780px; background: #fff; border: 1px solid #e2e2e2; border-radius: 14px; overflow: hidden; }
[data-inbox-screen] .ib-sec { border-top: 1px solid #ececec; }
[data-inbox-screen] .ib-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
[data-inbox-screen] .ib-tabs::-webkit-scrollbar { display: none; }
[data-inbox-screen] .ib-bulk { flex-shrink: 0; height: 38px; display: flex; align-items: center; gap: 2px; padding: 0 14px 0 12px; border-bottom: 1px solid #d7e7fa; background: #f2f8ff; }
[data-inbox-screen] .ib-bulk .btn { height: 26px; font-size: 12px; padding: 0 7px; color: #0f4c8a; }
[data-inbox-screen] .ib-bulk .btn:hover:not(:disabled) { background: #e2eefc; }
[data-inbox-screen] .ib-tone { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border: 1px solid #e6e6e6; border-radius: 13px; background: #fff; font-family: inherit; font-size: 12px; letter-spacing: inherit; color: #525252; cursor: pointer; white-space: nowrap; }
[data-inbox-screen] .ib-tone:hover:not(:disabled) { border-color: #b9d5f5; background: #f5f9ff; color: #0f4c8a; }
[data-inbox-screen] .ib-tone:disabled { opacity: .45; cursor: not-allowed; }
[data-inbox-screen] .ib-steer { flex: 1 1 200px; min-width: 0; height: 30px; border: 1px solid #e6e6e6; border-radius: 8px; padding: 0 10px; font-family: inherit; font-size: 12.5px; letter-spacing: inherit; color: #171717; background: #fff; outline: none; }
[data-inbox-screen] .ib-steer:focus { border-color: #9cc4f0; box-shadow: 0 0 0 3px #eef5fe; }
[data-inbox-screen] .ib-nav { width: 26px; height: 26px; border: 1px solid #e6e6e6; border-radius: 7px; background: #fff; display: inline-flex; align-items: center; justify-content: center; color: #525252; cursor: pointer; }
[data-inbox-screen] .ib-nav:hover:not(:disabled) { border-color: #cfcfcf; color: #171717; }
[data-inbox-screen] .ib-nav:disabled { opacity: .35; cursor: default; }
[data-inbox-screen] .ib-nav svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
[data-inbox-screen] .ib-ctx { display: flex; gap: 10px; width: 100%; padding: 9px 16px; border: 0; border-top: 1px solid #f1f1f1; background: transparent; font-family: inherit; letter-spacing: inherit; text-align: left; cursor: pointer; }
[data-inbox-screen] .ib-ctx:hover { background: #fafcff; }
[data-inbox-screen] .ib-ai { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 7px; background: #f5d4e6; color: #8a3a66; flex-shrink: 0; }
`;

/* ---------------------------------------------------------------- language */

/** zh-CN strings. The app ships Simplified (lib/i18n DEFAULT_LOCALE, and the
 * note on app/layout.tsx), so the artboard's Traditional chrome is converted
 * rather than copied; the language names below stay in their own script. */
const ZH: Record<string, string> = {
  "Comment inbox": "评论收件箱",
  "replies require human approval": "回复需经人工批准",
  "Search comments and authors": "搜索评论与作者",
  Sentiment: "情绪",
  Language: "语言",
  /* A publishing destination is 渠道; a chat or YouTube channel is 频道. These
     comments come from the studio's own accounts on the platforms, so 渠道. */
  Platform: "渠道",
  "Group by": "分组",
  "By video": "按视频",
  "By platform": "按渠道",
  "Comments by platform": "各渠道评论",
  All: "全部",
  Flagged: "已标记",
  "Business leads": "商业线索",
  "Bulk:": "批量：",
  "selected": "已选",
  "Select all": "全选",
  "Clear selection": "取消选择",
  "Reply": "回复",
  "Warmer": "更亲切",
  "More formal": "更正式",
  "Shorter": "更简短",
  "Say thanks": "表达感谢",
  "Invite them to follow": "引导关注",
  "Or tell the AI how to reply…": "或者告诉 AI 怎么回…",
  "Write": "起草",
  "Previous comment": "上一条",
  "Next comment": "下一条",
  "More on this video": "这条视频下的其他评论",
  "The AI drafts, you approve. Pick a tone or say what to cover.": "AI 起草，你来批准。选个语气，或者说说要回什么。",
  Hide: "隐藏",
  "Mark as spam": "标记为垃圾",
  "Set aside": "搁置",
  "Tick a comment first": "请先勾选评论",
  "Sentiment distribution": "情绪分布",
  "Very negative": "非常负面",
  Negative: "负面",
  Neutral: "中性",
  Positive: "正面",
  "Very positive": "非常正面",
  Lead: "线索",
  "AI-suggested reply": "AI 建议回复",
  Draft: "草稿",
  "Approve & send": "批准并发送",
  Edit: "编辑",
  Save: "保存",
  Regenerate: "重新生成",
  "Draft a reply": "起草回复",
  // Shown above a draft the platform refused; it had no zh-CN string, so a
  // Chinese-first screen printed the one line it most needed read in English.
  "The last attempt was refused": "上次发送被拒绝",
  "Nothing sends without approval": "未经批准不会发送",
  "machine translation": "机器翻译",
  Working: "处理中",
  Replied: "已回复",
  Hidden: "已隐藏",
  "Marked as spam": "已标记为垃圾",
  "This comment is out of the inbox. Nothing is waiting on it.":
    "这条评论已不在收件箱中，没有待办。",
  "Pick a comment on the left to read it here.": "在左侧选择一条评论即可在这里查看。",
  "No comments waiting": "没有待处理的评论",
  "Nothing matches these filters": "没有符合当前筛选的评论",
  "Check now": "立即检查",
  "Never checked": "尚未检查过",
  "No channel is connected yet": "尚未连接任何频道",
  "Connect a channel in Publish and the comments on your videos land here, grouped by video, with a reply drafted for each one.":
    "在“发布”里连接一个频道，视频下的评论就会按视频分组出现在这里，并为每条评论准备一份回复草稿。",
  "no title": "无标题",
  "Ask about these comments…": "询问这些评论…",
  // The status strip above the list.
  "Waiting for a reply": "待回复",
  "Drafts to approve": "待批准草稿",
  "No draft yet": "尚无草稿",
  Unclassified: "未分类",
  // The 2026-09 layout.
  Show: "显示",
  "Clear filters": "清除筛选",
  "Show charts": "展开图表",
  "Hide charts": "收起图表",
  "Open on platform": "在平台上查看",
  "Reply drafted": "已备好回复草稿",
  Comment: "评论",
  "Comment data is personal data, HK PDPO applies": "评论数据属于个人资料，适用香港《个人资料（私隐）条例》",
};

/* ------------------------------------------------------------------ format */

function count(n: number, _locale: string): string {
  void _locale;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "2 h" — the artboard's stamp on a list row, short enough for one line. */
function shortAgo(at: Date | null, zh: boolean): string {
  if (at === null) return "";
  const s = Math.max(0, (Date.now() - at.getTime()) / 1000);
  if (s < 60) return zh ? "刚刚" : "now";
  const m = Math.floor(s / 60);
  if (m < 60) return zh ? `${m} 分钟` : `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return zh ? `${h} 小时` : `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return zh ? `${d} 天` : `${d} d`;
  return zh ? `${Math.floor(d / 7)} 周` : `${Math.floor(d / 7)} w`;
}

/** "2 hours ago" — the artboard's caption line, which has room for words. */
function longAgo(at: Date | null, locale: string): string {
  /* Written out rather than through Intl.RelativeTimeFormat: the server and
     the browser use different ICU data and put different spaces in the
     result, which was a hydration error on every load. */
  if (at === null) return "";
  const zh = locale.startsWith("zh");
  const s = Math.max(0, (Date.now() - at.getTime()) / 1000);
  const units: [number, string, string][] = [
    [31536000, "年", "year"],
    [2592000, "个月", "month"],
    [604800, "周", "week"],
    [86400, "天", "day"],
    [3600, "小时", "hour"],
    [60, "分钟", "minute"],
  ];
  for (const [size, cn, en] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return zh ? `${n} ${cn}前` : `${n} ${en}${n === 1 ? "" : "s"} ago`;
  }
  return zh ? "刚刚" : "just now";
}

/** "09:15" — when the channels were last checked. */
function clock(at: Date, locale: string): string {
  /* Hong Kong time, stated: left to the machine, the server rendered UTC
     and the browser local time, and the two disagreed on every load. */
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" }).format(at);
}

/* The platform's own name and its own mark come from components/ui/PlatformMark,
   which the channel board already uses. This file kept a second, shorter list
   of nine names, so a comment from a channel the board drew a Bilibili logo for
   read here as the bare string "bilibili". */

/** A BCP-47 tag as a person would read it; unknown tags keep the tag. */
function languageLabel(tag: string): string {
  const known: Record<string, string> = {
    yue: "粤语 Cantonese",
    "zh-Hant": "繁体中文",
    "zh-Hans": "简体中文",
    en: "English",
  };
  return known[tag] ?? tag;
}

/** "@kk_wong" if there is a handle, otherwise the name, otherwise nothing. */
function displayName(c: InboxComment, zh: boolean): string {
  if (c.authorHandle !== null && c.authorHandle !== "") {
    return c.authorHandle.startsWith("@") ? c.authorHandle : `@${c.authorHandle}`;
  }
  if (c.authorName !== null && c.authorName !== "") return c.authorName;
  return zh ? "匿名" : "Anonymous";
}

/** The circle's letter when there is no avatar to show. */
function initial(label: string): string {
  const trimmed = label.replace(/^@/, "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}

/* ---------------------------------------------------------------- fragments */

/**
 * The artboard's round avatar. A missing URL, and a URL that fails to load,
 * both land on the initial rather than on a broken image — the avatars come
 * from the platforms, and platform CDNs expire them.
 */
function Avatar({ url, label, size }: { url: string | null; label: string; size: number }): React.JSX.Element {
  const [broken, setBroken] = React.useState(false);
  const common: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size / 2,
    flexShrink: 0,
    objectFit: "cover",
  };
  if (url === null || url === "" || broken) {
    return (
      <div
        aria-hidden
        style={{
          ...common,
          background: "#f3f3f3",
          color: "#7c7c7c",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * 0.42),
          fontWeight: 500,
          letterSpacing: 0,
        }}
      >
        {initial(label)}
      </div>
    );
  }
  return (
    // `no-referrer` is not decoration: Google's avatar host (yt3.ggpht.com)
    // refuses requests that carry a cross-origin referrer, so without it every
    // commenter renders as a broken image.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={common} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  );
}

/** The artboard's 34x19 post thumbnail, and what stands in when there is none. */
function Thumb({ url, width = 34, height = 19 }: { url: string | null; width?: number; height?: number }): React.JSX.Element {
  const [broken, setBroken] = React.useState(false);
  const common: React.CSSProperties = {
    width,
    height,
    borderRadius: width >= 48 ? 6 : 3,
    objectFit: "cover",
    flexShrink: 0,
    border: width >= 48 ? "1px solid #ececec" : undefined,
  };
  if (url === null || url === "" || broken) {
    return <div aria-hidden style={{ ...common, background: "#f3f3f3" }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={common} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  );
}

/* --------------------------------------------------------------- component */

export function InboxScreen(props: InboxScreenProps): React.JSX.Element {
  const {
    locale,
    groups,
    summary,
    channelCount,
    syncedAt,
    selectedId,
    priorCount,
    filters,
    selected,
    pending,
    error,
    onSelect,
    onToggleSelect,
    onFilter,
    onApprove,
    onSaveEdit,
    onRegenerate,
    onModerate,
    onBulk,
    onSyncNow,
    model,
    onAsk,
    thread,
    tools,
  } = props;

  const zh = locale.startsWith("zh");
  const t = React.useCallback((key: string): string => (zh ? (ZH[key] ?? key) : key), [zh]);

  /** The artboard's search box, which searched nothing. */
  const [query, setQuery] = React.useState("");
  /*
   * Which platform, and how the list is stacked.
   *
   * The client: *"for analysis -> comment part, will need to differentiate by
   * platform"*. The rows already carry the platform — `channel_posts.platform`,
   * written at ingest and selected into `InboxComment.platform` — so nothing
   * new is stored or fetched; the inbox simply never showed it outside one word
   * in the detail caption.
   *
   * Local state rather than the URL, unlike sentiment and language. Those two
   * are the server's filters: they narrow the query before it runs. This one
   * narrows rows already in hand, exactly as the search box above does, and
   * putting it in the URL would mean a round trip and a prop the page does not
   * pass. The consequence is the same as the search box's: it sifts the 300
   * rows the query returned, not the whole table.
   */
  const [platform, setPlatform] = React.useState("");
  const [groupBy, setGroupBy] = React.useState<"post" | "platform">("post");
  const [view, setView] = React.useState<ListView>("all");
  /** The charts fold away by default: the list and the reply need the height. */
  const [chartsOpen, setChartsOpen] = React.useState(false);
  /** The draft as it stands in the textarea, before it is saved or sent. */
  const [edit, setEdit] = React.useState<{ draftId: string; body: string } | null>(null);
  const draftRef = React.useRef<HTMLTextAreaElement | null>(null);
  /** What the person typed to steer the next draft. */
  const [steer, setSteer] = React.useState("");

  const sentimentLabel = React.useCallback(
    (key: string): string => {
      const names: Record<Sentiment, string> = {
        very_negative: t("Very negative"),
        negative: t("Negative"),
        neutral: t("Neutral"),
        positive: t("Positive"),
        very_positive: t("Very positive"),
      };
      return (SENTIMENTS as readonly string[]).includes(key) ? names[key as Sentiment] : key;
    },
    [t],
  );

  const q = query.trim().toLowerCase();
  const shown = React.useMemo<InboxGroup[]>(() => {
    if (q === "" && platform === "" && view === "all") return groups;
    const inView = (c: InboxComment): boolean =>
      view === "all" ||
      (view === "drafts" && c.draft !== null) ||
      (view === "undrafted" && c.draft === null) ||
      (view === "unclassified" && c.sentiment === null);
    const hit = (c: InboxComment): boolean =>
      inView(c) &&
      (platform === "" || c.platform === platform) &&
      (q === "" ||
        c.body.toLowerCase().includes(q) ||
        (c.translation ?? "").toLowerCase().includes(q) ||
        (c.authorName ?? "").toLowerCase().includes(q) ||
        (c.authorHandle ?? "").toLowerCase().includes(q));
    return groups
      .map((g) => ({ ...g, comments: g.comments.filter(hit) }))
      .filter((g) => g.comments.length > 0);
  }, [groups, q, platform, view]);

  /**
   * How many comments came from each platform, commonest first.
   *
   * Counted over `groups` — the rows this inbox is holding — rather than taken
   * from `summary`, which is a tenant-wide count the page computes in SQL and
   * has no platform breakdown in. So this agrees with the list beside it, which
   * is what a person reading the two together needs, and it moves when the
   * sentiment or language filter does.
   */
  const platforms = React.useMemo<[string, number][]>(() => {
    const n = new Map<string, number>();
    for (const g of groups) for (const c of g.comments) n.set(c.platform, (n.get(c.platform) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }, [groups]);

  /**
   * The list, stacked the way the toolbar asks for.
   *
   * By video is the artboard's own grouping and stays the default — a reply
   * reads differently under a different video. By platform is the other
   * question the same rows answer: what is TikTok saying today. One shape for
   * both, so the row markup below is written once.
   */
  const sections = React.useMemo<{ key: string; platform: string; title: string | null; thumbnailUrl: string | null; comments: InboxComment[] }[]>(() => {
    if (groupBy === "post") {
      return shown.map((g) => ({
        key: g.postId,
        platform: g.platform,
        title: g.title,
        thumbnailUrl: g.thumbnailUrl,
        comments: g.comments,
      }));
    }
    const byPlatform = new Map<string, InboxComment[]>();
    for (const g of shown) {
      for (const c of g.comments) {
        const bucket = byPlatform.get(c.platform);
        if (bucket === undefined) byPlatform.set(c.platform, [c]);
        else bucket.push(c);
      }
    }
    return [...byPlatform.entries()]
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, comments]) => ({ key, platform: key, title: null, thumbnailUrl: null, comments }));
  }, [shown, groupBy]);

  /** The open comment is looked up across every group, not just the searched
   * ones, so typing in the search box never empties the detail pane. */
  const open = React.useMemo<{ comment: InboxComment; group: InboxGroup } | null>(() => {
    const hit = groups
      .map((g) => {
        const comment = g.comments.find((x) => x.id === selectedId);
        return comment === undefined ? null : { comment, group: g };
      })
      .find((x) => x !== null);
    return hit ?? null;
  }, [groups, selectedId]);

  const languages = React.useMemo(
    () => Object.entries(summary.language).sort((a, b) => b[1] - a[1]),
    [summary.language],
  );

  const barMax = React.useMemo(
    () => SENTIMENTS.reduce((m, k) => Math.max(m, summary.sentiment[k] ?? 0), 0),
    [summary.sentiment],
  );

  const anySelected = selected.length > 0;
  const frameStyle = { "--ac": ACCENT } as React.CSSProperties;

  /** Lead beats flag beats sentiment; an unclassified comment wears nothing. */
  function badgeFor(c: InboxComment): { cls: string; text: string; title: string | undefined } | null {
    if (c.isLead) return { cls: "blue", text: t("Lead"), title: c.leadReason ?? undefined };
    if (c.flagged) return { cls: "amb", text: t("Flagged"), title: c.flagReason ?? undefined };
    if (c.sentiment === null) return null;
    const cls =
      c.sentiment === "positive" || c.sentiment === "very_positive"
        ? "grn"
        : c.sentiment === "negative" || c.sentiment === "very_negative"
          ? "red"
          : c.sentiment === "neutral"
            ? "gray"
            : null;
    if (cls === null) return null;
    return { cls, text: sentimentLabel(c.sentiment), title: undefined };
  }

  function stateLabel(state: string): string {
    if (state === "replied") return t("Replied");
    if (state === "hidden") return t("Hidden");
    if (state === "spam") return t("Marked as spam");
    if (state === "ignored") return t("Set aside");
    return state;
  }

  const syncLine =
    syncedAt === null
      ? t("Never checked")
      : zh
        ? `上次检查 ${clock(syncedAt, locale)}`
        : `Last checked ${clock(syncedAt, locale)}`;

  /**
   * The inbox as a state rather than as a list.
   *
   * Every one of these was already on the screen — `summary.open` in the agent
   * note, the drafts as a block of text inside each row, the flagged ones as
   * an amber pill you had to scroll to find. A person opening this screen
   * wants to know whether anything is waiting on *them* before they start
   * reading, and "N drafts to approve" is that answer.
   */
  /* The artboard's 330px comment list. A Cantonese comment and its English
   * translation both live in this column, so the width somebody wants depends
   * on what their audience writes in. */
  const { width: listWidth, handle: listHandle } = useResizable("inbox-list", {
    min: 240,
    max: 560,
    initial: 330,
    edge: "right",
  });

  const waiting = React.useMemo(() => {
    const all = groups.flatMap((g) => g.comments);
    return {
      drafts: all.filter((c) => c.draft !== null).length,
      undrafted: all.filter((c) => c.draft === null).length,
      flagged: all.filter((c) => c.flagged).length,
      leads: all.filter((c) => c.isLead).length,
      unclassified: all.filter((c) => c.sentiment === null).length,
    };
  }, [groups]);

  /* ------------------------------------------------------------ the header */

  const header = (
    <div className="bar">
      <span className="h1">{t("Comment inbox")}</span>
      <span className="mut">{t("replies require human approval")}</span>
      <div style={{ flexGrow: 1 }} />
      <span className="cap" style={{ whiteSpace: "nowrap" }} suppressHydrationWarning>
        {syncLine}
      </span>
      <button type="button" className="btn ib-q" onClick={onSyncNow} style={{ flexShrink: 0 }}>
        {t("Check now")}
      </button>
      {channelCount === 0 ? null : (
        <div
          style={{
            width: 240,
            height: 28,
            border: "1px solid #ededed",
            borderRadius: 8,
            background: "#f8f8f8",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "0 9px",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: 13, height: 13, stroke: "#999999", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" }}
          >
            <circle cx="11" cy="11" r="6.4" />
            <path d="m15.8 15.8 4 4" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("Search comments and authors")}
            placeholder={t("Search comments and authors")}
            style={{
              flexGrow: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 12,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
            }}
          />
        </div>
      )}
      {/* The artboard's notification bell carried a red dot. There is no
          notification feed behind it, and a dot that always claims something
          is waiting is a lie told once a second, so it is not drawn. */}
    </div>
  );

  /* -------------------------------------------------- no channels at all */

  /**
   * The one line the panel can say from these rows alone.
   *
   * The artboard scripted a paragraph about a sponsorship enquiry that nobody
   * had received. This says what is actually in the inbox, and says nothing
   * when there is nothing to say.
   */
  const agentNote = React.useMemo(() => {
    const all = groups.flatMap((g) => g.comments);
    if (all.length === 0) {
      return zh ? "收件箱是空的。" : "The inbox is empty.";
    }
    const leads = all.filter((c) => c.isLead);
    const flagged = all.filter((c) => c.flagged);
    const drafted = all.filter((c) => c.draft !== null);

    const parts: string[] = [];
    if (leads.length) {
      parts.push(
        zh
          ? `${count(leads.length, locale)} 条看起来是商务咨询${leads[0].authorHandle ? `，其中一条来自 ${leads[0].authorHandle}` : ""}。`
          : `${count(leads.length, locale)} look like business enquiries${leads[0].authorHandle ? `, one of them from ${leads[0].authorHandle}` : ""}.`,
      );
    }
    if (flagged.length) {
      parts.push(
        zh
          ? `${count(flagged.length, locale)} 条被标记，原因写在每条旁边。`
          : `${count(flagged.length, locale)} are flagged, each with the reason beside it.`,
      );
    }
    parts.push(
      zh
        ? `${count(drafted.length, locale)} 条已备好回复草稿，全部需要人工批准才会发送。`
        : `${count(drafted.length, locale)} have a reply drafted. None of them sends without your approval.`,
    );
    if (summary.unclassified > 0) {
      parts.push(
        zh
          ? `另有 ${count(summary.unclassified, locale)} 条尚未判读。`
          : `${count(summary.unclassified, locale)} have not been read yet.`,
      );
    }
    // Where they came from, once there is more than one answer. Saying
    // "YouTube 42" when YouTube is the only channel connected is noise.
    if (platforms.length > 1) {
      const split = platforms.map(([k, n]) => `${platformLabel(k)} ${count(n, locale)}`).join(zh ? "、" : ", ");
      parts.push(zh ? `按渠道：${split}。` : `By platform: ${split}.`);
    }
    return parts.join(zh ? "" : " ");
  }, [groups, summary.unclassified, platforms, zh, locale]);

  if (channelCount === 0) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div
          data-inbox-screen=""
          style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
        >
          {header}
          <div style={{ padding: "40px 20px", maxWidth: 460 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("No channel is connected yet")}</div>
            <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
              {t(
                "Connect a channel in Publish and the comments on your videos land here, grouped by video, with a reply drafted for each one.",
              )}
            </p>
          </div>
        </div>
      </>
    );
  }

  /* -------------------------------------------------------- the filter row */

  const sentimentKeys = SENTIMENTS.filter((k) => (summary.sentiment[k] ?? 0) > 0);
  const currentSentiment = filters.sentiment ?? "";
  const currentLanguage = filters.language ?? "";
  const serverFiltered =
    currentSentiment !== "" || currentLanguage !== "" || filters.flagged === true || filters.leads === true;
  const anyFilter = serverFiltered || platform !== "" || view !== "all" || q !== "";

  /** Back to the whole inbox. The page is only asked to refilter when one of
   * its own filters is on; the rest is local state. */
  function clearFilters(): void {
    setPlatform("");
    setView("all");
    setQuery("");
    if (serverFiltered) onFilter({});
  }

  /*
   * The inbox as a state rather than as a list, and each state a way in.
   *
   * These were a strip of counters that answered "is anything waiting on me"
   * and then left the person to go and find it. Each one now narrows the list
   * to exactly the rows it counted. The first four are one choice (a comment
   * is drafted or it is not); flagged and leads are the page's own filters and
   * toggle on top of it.
   */
  const views: { key: ListView; label: string; n: number }[] = [
    { key: "all", label: t("Waiting for a reply"), n: summary.open },
    { key: "drafts", label: t("Drafts to approve"), n: waiting.drafts },
    { key: "undrafted", label: t("No draft yet"), n: waiting.undrafted },
    { key: "unclassified", label: t("Unclassified"), n: waiting.unclassified },
  ];

  const tabRow = (
    <div className="ib-row" style={{ height: 50 }}>
      <div role="group" aria-label={t("Show")} className="ib-tabs">
        {views
          .filter((v) => v.key === "all" || v.n > 0 || view === v.key)
          .map((v) => (
            <button
              key={v.key}
              type="button"
              className={`ib-fchip${view === v.key ? " on" : ""}`}
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label}
              <span className="n">{count(v.n, locale)}</span>
            </button>
          ))}
        {waiting.flagged > 0 || waiting.leads > 0 || filters.flagged === true || filters.leads === true ? (
          <span className="ib-vr" aria-hidden />
        ) : null}
        {waiting.flagged > 0 || filters.flagged === true ? (
          <button
            type="button"
            className={`ib-fchip${filters.flagged === true ? " on" : ""}`}
            aria-pressed={filters.flagged === true}
            onClick={() => onFilter({ ...filters, flagged: filters.flagged === true ? undefined : true })}
          >
            <span className="ib-dot" aria-hidden style={{ background: "#f0a53a" }} />
            {t("Flagged")}
            <span className="n">{count(waiting.flagged, locale)}</span>
          </button>
        ) : null}
        {waiting.leads > 0 || filters.leads === true ? (
          <button
            type="button"
            className={`ib-fchip${filters.leads === true ? " on" : ""}`}
            aria-pressed={filters.leads === true}
            onClick={() => onFilter({ ...filters, leads: filters.leads === true ? undefined : true })}
          >
            <span className="ib-dot" aria-hidden style={{ background: "#4a9be8" }} />
            {t("Business leads")}
            <span className="n">{count(waiting.leads, locale)}</span>
          </button>
        ) : null}
      </div>
      {anyFilter ? (
        <button type="button" className="btn ib-q" onClick={clearFilters} style={{ flexShrink: 0 }}>
          {t("Clear filters")}
        </button>
      ) : null}
    </div>
  );

  /*
   * The charts, folded to one line.
   *
   * Open, the band below is 140px of bars and tables above a list that needs
   * the height more. Folded, the same numbers read as a sentence — and each
   * number is still a way in: pressing "Negative 3" narrows the list to those
   * three, as the picker above does.
   */
  const summaryLine = (
    <div className="ib-sum">
      <div className="ib-sumitems">
        <span className="ib-sumk">{t("Sentiment")}</span>
        {sentimentKeys.length === 0 ? <span className="cap">{zh ? "暂无" : "none yet"}</span> : null}
        {sentimentKeys.map((k) => {
          const on = currentSentiment === k;
          return (
            <button
              key={k}
              type="button"
              className={`ib-sumi${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onFilter({ ...filters, sentiment: on ? undefined : k })}
            >
              <span className="ib-dot" aria-hidden style={{ background: BAR_COLOUR[k] }} />
              {sentimentLabel(k)}
              <span className="n">{count(summary.sentiment[k] ?? 0, locale)}</span>
            </button>
          );
        })}
        <span className="ib-vr" aria-hidden />
        <span className="ib-sumk">{t("Language")}</span>
        {languages.length === 0 ? <span className="cap">{zh ? "暂无" : "none yet"}</span> : null}
        {languages.map(([tag, n]) => {
          const on = currentLanguage === tag;
          return (
            <button
              key={tag}
              type="button"
              className={`ib-sumi${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onFilter({ ...filters, language: on ? undefined : tag })}
            >
              {languageLabel(tag)}
              <span className="n">{count(n, locale)}</span>
            </button>
          );
        })}
        {platforms.length > 1 ? (
          <>
            <span className="ib-vr" aria-hidden />
            <span className="ib-sumk">{t("Platform")}</span>
            {platforms.map(([key, n]) => {
              const on = platform === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`ib-sumi${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setPlatform(on ? "" : key)}
                >
                  <PlatformMark platform={key} size={11} />
                  {platformLabel(key)}
                  <span className="n">{count(n, locale)}</span>
                </button>
              );
            })}
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="btn ib-q"
        aria-expanded={chartsOpen}
        aria-controls="inbox-charts"
        onClick={() => setChartsOpen((v) => !v)}
        style={{ flexShrink: 0 }}
      >
        {chartsOpen ? t("Hide charts") : t("Show charts")}
        <svg
          viewBox="0 0 24 24"
          style={{ transform: chartsOpen ? "rotate(180deg)" : undefined, transition: "transform .15s ease" }}
        >
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </button>
    </div>
  );

  /* -------------------------------------------------- the distribution band */

  const band = (
    <div
      id="inbox-charts"
      style={{
        flexShrink: 0,
        display: "grid",
        // The artboard's two columns, plus the one the studio asked for. The
        // sentiment chart keeps whatever is left.
        gridTemplateColumns: "minmax(0,1fr) 170px 230px",
        gap: 18,
        padding: "14px 20px",
        borderBottom: "1px solid #ededed",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t("Sentiment distribution")}</span>
          <span className="cap">
            {/* 渠道, not 频道: these are the studio's publishing destinations,
                not chat or YouTube channels. The agent panel below already
                said 渠道 and this line said 频道 for the same number. */}
            {zh
              ? `${count(summary.open, locale)} 条新评论 · ${count(channelCount, locale)} 个渠道`
              : `${count(summary.open, locale)} new comments · ${count(channelCount, locale)} channels`}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 64 }}>
          {SENTIMENTS.map((k) => {
            const n = summary.sentiment[k] ?? 0;
            const h = barMax === 0 ? 2 : Math.max(2, Math.round((n / barMax) * BAR_MAX));
            return (
              <div
                key={k}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}
              >
                <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: "#525252" }}>
                  {count(n, locale)}
                </span>
                <div
                  style={{ width: "100%", height: h, background: BAR_COLOUR[k], borderRadius: "4px 4px 1px 1px" }}
                />
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
          {SENTIMENTS.map((k) => (
            <span key={k} style={{ flex: 1, textAlign: "center", fontSize: 11.5, color: "#999999" }}>
              {sentimentLabel(k)}
            </span>
          ))}
        </div>
      </div>
      {/*
        * Comments by platform.
        *
        * The analysis band had sentiment and language and nothing that said
        * where any of it came from, which is the gap the client named. Each row
        * is also the filter: reading "TikTok 14" and wanting to see those
        * fourteen is the next thought, and it should not need the picker above.
        */}
      <div style={{ borderLeft: "1px solid #ededed", paddingLeft: 18, minWidth: 0 }}>
        <div className="lbl" style={{ padding: 0, marginBottom: 10 }}>
          {t("Comments by platform")}
        </div>
        {platforms.length === 0 ? (
          <div className="cap">{zh ? "还没有评论。" : "No comments yet."}</div>
        ) : null}
        {platforms.map(([key, n], i) => {
          const on = platform === key;
          return (
            <button
              type="button"
              className="kv"
              key={key}
              aria-pressed={on}
              title={on ? (zh ? "取消筛选" : "Clear the filter") : (zh ? `只看 ${platformLabel(key)}` : `Only ${platformLabel(key)}`)}
              onClick={() => setPlatform(on ? "" : key)}
              style={{
                width: "calc(100% + 12px)",
                margin: "0 -6px",
                padding: "5px 6px",
                alignItems: "center",
                border: "none",
                borderBottom: i === platforms.length - 1 ? "none" : "1px solid #f3f3f3",
                borderRadius: 6,
                background: on ? "#f5faff" : "transparent",
                // `.kv`'s own metrics, spelled out: a <button> does not inherit
                // the screen's face, and the shorthand would undo the class.
                fontFamily: "inherit",
                fontSize: 12.5,
                letterSpacing: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <PlatformMark platform={key} size={13} />
                <span className="el">{platformLabel(key)}</span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{count(n, locale)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ borderLeft: "1px solid #ededed", paddingLeft: 18 }}>
        <div className="lbl" style={{ padding: 0, marginBottom: 10 }}>
          {t("Language")}
        </div>
        {languages.length === 0 ? (
          <div className="cap">{zh ? "尚未识别出语言。" : "No language read yet."}</div>
        ) : null}
        {languages.map(([tag, n], i) => (
          <div
            className="kv"
            key={tag}
            style={i === languages.length - 1 ? { padding: "5px 0", border: "none" } : { padding: "5px 0" }}
          >
            <span>{languageLabel(tag)}</span>
            <span>{count(n, locale)}</span>
          </div>
        ))}
        {/* The artboard captioned this "TikTok has no comment interface". That
            stopped being true, so the slot carries what still is: the comments
            no classifier has read yet, or when the channels were last checked. */}
        <div className="cap" style={{ marginTop: 6 }}>
          {summary.unclassified > 0
            ? zh
              ? `${count(summary.unclassified, locale)} 则尚未判读`
              : `${count(summary.unclassified, locale)} not yet read`
            : syncLine}
        </div>
      </div>
    </div>
  );

  /* ------------------------------------------------------------- the list */

  const listed = sections.reduce((n, g) => n + g.comments.length, 0);

  const list = (
    <div
      style={{
        width: listWidth,
        flexShrink: 0,
        position: "relative",
        borderRight: "1px solid #ececec",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "#fafafa",
      }}
    >
      {listHandle}
      {/*
        * How the list is stacked, above the list rather than in the filter row.
        *
        * Filtering to one platform answers "what is TikTok saying"; grouping by
        * platform answers "how do the two compare" without throwing the rest of
        * the inbox away. This one belongs over the thing it rearranges.
        */}
      {anySelected ? (
        <div className="ib-bulk" role="toolbar" aria-label={t("Bulk:")}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#0f4c8a", whiteSpace: "nowrap" }}>
            {t("selected")} {count(selected.length, locale)}
          </span>
          <button
            type="button"
            className="btn ib-q"
            onClick={() => {
              for (const g of sections) for (const c of g.comments) if (!selected.includes(c.id)) onToggleSelect(c.id);
            }}
          >
            {t("Select all")}
          </button>
          <div style={{ flexGrow: 1 }} />
          <button type="button" className="btn ib-q" disabled={pending !== null} onClick={() => onBulk("hide")}>
            {t("Hide")}
          </button>
          <button type="button" className="btn ib-q" disabled={pending !== null} onClick={() => onBulk("spam")}>
            {t("Mark as spam")}
          </button>
          <button type="button" className="btn ib-q" disabled={pending !== null} onClick={() => onBulk("ignore")}>
            {t("Set aside")}
          </button>
          <button
            type="button"
            className="ib-nav"
            aria-label={t("Clear selection")}
            title={t("Clear selection")}
            onClick={() => {
              for (const id of selected) onToggleSelect(id);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        </div>
      ) : (
      <div
          style={{
            flexShrink: 0,
            height: 38,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            borderBottom: "1px solid #ececec",
            background: "#fff",
          }}
        >
          <span className="lbl" style={{ padding: 0 }}>
            {t("Group by")}
          </span>
          <div className="tf" role="group" aria-label={t("Group by")}>
            <button
              type="button"
              className={groupBy === "post" ? "on" : ""}
              aria-pressed={groupBy === "post"}
              onClick={() => setGroupBy("post")}
            >
              {t("By video")}
            </button>
            <button
              type="button"
              className={groupBy === "platform" ? "on" : ""}
              aria-pressed={groupBy === "platform"}
              onClick={() => setGroupBy("platform")}
            >
              {t("By platform")}
            </button>
          </div>
          <span className="cap" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {zh ? `${count(listed, locale)} 条` : `${count(listed, locale)} shown`}
          </span>
        </div>
      )}
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", paddingBottom: 10 }}>
      {sections.map((g) => {
        const heading = groupBy === "post" ? (g.title ?? t("no title")) : platformLabel(g.platform);
        return (
          <section key={g.key} aria-label={heading}>
            {/* The group heading. By video it is the video's thumbnail and
                title, with the platform it went out on under it. By platform
                the platform *is* the heading. */}
            <div className="ib-gh">
              {groupBy === "post" ? (
                <Thumb url={g.thumbnailUrl} width={52} height={29} />
              ) : (
                <PlatformMark platform={g.platform} size={16} />
              )}
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <span className="el" title={heading} style={{ fontSize: 12, fontWeight: 600, color: "#171717" }}>
                  {heading}
                </span>
                {groupBy === "post" ? (
                  <span className="cap" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <PlatformMark platform={g.platform} size={10} />
                    {platformLabel(g.platform)}
                  </span>
                ) : null}
              </div>
              <span
                className="bd gray"
                title={zh ? `${count(g.comments.length, locale)} 条评论` : `${count(g.comments.length, locale)} comments`}
                style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
              >
                {count(g.comments.length, locale)}
              </span>
            </div>
            {g.comments.map((c) => {
              const on = c.id === selectedId;
              const badge = badgeFor(c);
              const name = displayName(c, zh);
              const ticked = selected.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`cmt${on ? " on" : ""}${anySelected ? " anysel" : ""}`}
                  style={{ "--sb": sentimentColour(c.sentiment) } as React.CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  onClick={() => onSelect(c.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(c.id);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    className="cbx"
                    checked={ticked}
                    aria-label={zh ? `选择 ${name} 的评论` : `Select the comment from ${name}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(c.id)}
                    style={{
                      width: 13,
                      height: 13,
                      margin: "8px 0 0",
                      accentColor: "#171717",
                      flexShrink: 0,
                      cursor: "pointer",
                      ...(ticked ? { opacity: 1 } : {}),
                    }}
                  />
                  <Avatar url={c.authorAvatarUrl} label={name} size={28} />
                  <div style={{ minWidth: 0, flexGrow: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="el" style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, minWidth: 0 }}>
                        {name}
                      </span>
                      {/* On the row as well as on the heading: the heading
                          scrolls away, and a comment a person is deciding how
                          to answer should say where it was said without being
                          opened. */}
                      <PlatformMark platform={c.platform} size={11} />
                      <span className="cap" style={{ flexShrink: 0 }} suppressHydrationWarning>
                        {shortAgo(c.postedAt, zh)}
                      </span>
                      {badge === null ? null : (
                        <span className={`bd ${badge.cls}`} title={badge.title} style={{ marginLeft: "auto", flexShrink: 0 }}>
                          {badge.text}
                        </span>
                      )}
                    </div>
                    <div
                      className="ib-clamp"
                      style={{ fontSize: 12.5, lineHeight: 1.5, color: on ? "#171717" : "#525252", marginTop: 3 }}
                    >
                      {c.body}
                    </div>
                    {c.draft === null ? null : (
                      <div
                        className="cap"
                        style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, color: "#db7706" }}
                      >
                        <Icon name="pen" size={11} />
                        {t("Reply drafted")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {sections.length === 0 ? (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div className="cap">{t("Nothing matches these filters")}</div>
          {anyFilter ? (
            <button type="button" className="btn s" style={{ height: 28, fontSize: 12, marginTop: 10 }} onClick={clearFilters}>
              {t("Clear filters")}
            </button>
          ) : null}
        </div>
      ) : null}
      </div>
    </div>
  );

  /* ------------------------------------------------------- the detail pane */

  const order = sections.flatMap((g) => g.comments.map((c) => c.id));
  const at = selectedId === null ? -1 : order.indexOf(selectedId);
  const prevId = at > 0 ? order[at - 1] : null;
  const nextId = at >= 0 && at < order.length - 1 ? order[at + 1] : null;

  let detail: React.JSX.Element;

  if (open === null) {
    detail = (
      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <Icon name="comment" size={22} color="#c7c7c7" />
          <div className="cap" style={{ marginTop: 8 }}>
            {t("Pick a comment on the left to read it here.")}
          </div>
        </div>
      </div>
    );
  } else {
    const c = open.comment;
    const draft = c.draft;
    const name = displayName(c, zh);
    const badge = badgeFor(c);
    const isOpen = c.state === "open";
    const busy = pending !== null && (pending === c.id || (draft !== null && pending === draft.id));
    const draftBody = draft === null ? "" : edit !== null && edit.draftId === draft.id ? edit.body : draft.body;
    const dirty = draft !== null && draftBody !== draft.body;
    const videoTitle = open.group.title !== null && open.group.title !== "" ? open.group.title : t("no title");

    // The platform and the video have their own strip at the top of the card
    // now, so the caption under the name keeps only what is about the person.
    const caption: string[] = [];
    const rel = longAgo(c.postedAt, locale);
    if (rel !== "") caption.push(rel);
    if (priorCount > 0) {
      caption.push(
        zh
          ? `此前 ${count(priorCount, locale)} 条评论`
          : priorCount === 1
            ? "1 prior comment"
            : `${count(priorCount, locale)} prior comments`,
      );
    }

    const tones: { label: string; steer: string }[] = [
      { label: t("Warmer"), steer: zh ? "语气更亲切自然，像朋友聊天，可以轻松一点。" : "Warmer and more natural, like talking to a friend." },
      { label: t("More formal"), steer: zh ? "语气更正式、专业、礼貌。" : "More formal, professional and polite." },
      { label: t("Shorter"), steer: zh ? "更简短，一两句话说完。" : "Much shorter, one or two sentences." },
      { label: t("Say thanks"), steer: zh ? "先真诚感谢对方的评论和支持。" : "Open by sincerely thanking them for the comment and support." },
      { label: t("Invite them to follow"), steer: zh ? "结尾自然地邀请对方关注频道、看下一期。" : "End by naturally inviting them to follow for the next episode." },
    ];
    const toneChips = tones.map((tone) => (
      <button
        key={tone.label}
        type="button"
        className="ib-tone"
        disabled={busy}
        title={tone.steer}
        onClick={() => onRegenerate(c.id, tone.steer)}
      >
        {tone.label}
      </button>
    ));
    const steerLine = (
      <form
        style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          const v = steer.trim();
          if (v === "" || busy) return;
          onRegenerate(c.id, v);
          setSteer("");
        }}
      >
        <input
          className="ib-steer"
          value={steer}
          maxLength={300}
          onChange={(e) => setSteer(e.target.value)}
          placeholder={t("Or tell the AI how to reply…")}
          aria-label={t("Or tell the AI how to reply…")}
        />
        <button type="submit" className="btn s" style={{ height: 30 }} disabled={busy || steer.trim() === ""}>
          {t("Write")}
        </button>
      </form>
    );

    const others = open.group.comments.filter((x) => x.id !== c.id).slice(0, 6);

    const approvalNote = (
      <span className="cap" style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
        <Icon name="lock" size={12} />
        {t("Nothing sends without approval")}
      </span>
    );

    detail = (
      <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", background: "#fafafa", padding: 16 }}>
        <article className="ib-card" aria-label={`${t("Comment")} · ${name}`}>
          {/* The video the comment was left on: a reply reads differently
              under a different video, so it is the first thing on the card. */}
          {/* Allowed to wrap. At 1280 this card is ~250px wide, and the
              thumbnail, the open-on-platform button and the pager took all
              of it: the video title was squeezed to zero width and vanished,
              leaving its link icon floating under "YouTube". The title keeps
              a floor now and the controls drop to a second line instead. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, rowGap: 8, padding: "12px 16px", background: "#fcfcfc" }}>
            <Thumb url={open.group.thumbnailUrl} width={72} height={40} />
            <div style={{ minWidth: 0, flex: "1 1 130px" }}>
              <div className="cap" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <PlatformMark platform={c.platform} size={11} />
                {platformLabel(c.platform)}
              </div>
              {open.group.permalink !== null && open.group.permalink !== "" ? (
                <a
                  href={open.group.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={videoTitle}
                  style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, marginTop: 2, color: "#171717", fontSize: 13, fontWeight: 500 }}
                >
                  <span className="ib-clamp" style={{ minWidth: 0, lineHeight: 1.4 }}>
                    {videoTitle}
                  </span>
                  <Icon name="external" size={12} color="#999999" />
                </a>
              ) : (
                <span className="el" title={videoTitle} style={{ marginTop: 2, fontSize: 13, fontWeight: 500 }}>
                  {videoTitle}
                </span>
              )}
            </div>
            {/* One group, so when it wraps it wraps together, to the right. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: "auto" }}>
            {c.permalink !== null && c.permalink !== "" ? (
              <a
                className="ib-nav"
                href={c.permalink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("Open on platform")}
                title={t("Open on platform")}
                style={{ flexShrink: 0 }}
              >
                <Icon name="external" size={13} />
              </a>
            ) : null}
            {at >= 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="ib-nav"
                  disabled={prevId === null}
                  aria-label={t("Previous comment")}
                  title={t("Previous comment")}
                  onClick={() => prevId !== null && onSelect(prevId)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />
                  </svg>
                </button>
                <span className="cap" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {count(at + 1, locale)} / {count(order.length, locale)}
                </span>
                <button
                  type="button"
                  className="ib-nav"
                  disabled={nextId === null}
                  aria-label={t("Next comment")}
                  title={t("Next comment")}
                  onClick={() => nextId !== null && onSelect(nextId)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
                  </svg>
                </button>
              </div>
            ) : null}
            </div>
          </div>

          <div className="ib-sec" style={{ padding: "16px 18px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar url={c.authorAvatarUrl} label={name} size={36} />
              <div style={{ minWidth: 0 }}>
                <div className="el" style={{ fontSize: 14, fontWeight: 600 }}>
                  {name}
                </div>
                {caption.length === 0 ? null : <div className="cap" suppressHydrationWarning>{caption.join(" · ")}</div>}
              </div>
              {badge === null ? null : (
                <span className={`bd ${badge.cls}`} title={badge.title} style={{ marginLeft: "auto", flexShrink: 0 }}>
                  {badge.text}
                </span>
              )}
            </div>

            <div
              style={{
                marginTop: 14,
                fontSize: 16,
                lineHeight: 1.65,
                color: "#171717",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                textWrap: "pretty",
              }}
            >
              {c.body}
            </div>
            {c.translation === null || c.translation === "" ? null : (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 11px",
                  borderRadius: 8,
                  background: "#f8f8f8",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "#525252",
                }}
              >
                {c.translation}
                <span className="cap"> · {t("machine translation")}</span>
              </div>
            )}
            {c.likeCount > 0 ? (
              <div className="cap" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 10 }}>
                <Icon name="heart" size={12} />
                {zh ? `${count(c.likeCount, locale)} 赞` : `${count(c.likeCount, locale)} likes`}
              </div>
            ) : null}
          </div>

          <div className="ib-sec" style={{ padding: "14px 18px 16px" }}>
            {!isOpen ? (
              // Nothing to approve: the comment has already been acted on, and
              // the approve controls would be an offer the screen cannot keep.
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="bd gray">{stateLabel(c.state)}</span>
                <span className="cap">{t("This comment is out of the inbox. Nothing is waiting on it.")}</span>
              </div>
            ) : draft === null ? (
              // No draft yet. An empty draft box would read as a reply nobody
              // wrote, so the space says how one gets made instead.
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span className="ib-ai" aria-hidden>
                    <Icon name="spark" size={12} />
                  </span>
                  {/* nowrap: in a narrow card the long hint beside it
                      squeezed this to one character a line ("回 / 复"). */}
                  <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{t("Reply")}</span>
                  <span className="cap">{t("The AI drafts, you approve. Pick a tone or say what to cover.")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn p"
                    style={{ height: 32 }}
                    disabled={busy}
                    onClick={() => onRegenerate(c.id)}
                  >
                    <Icon name="spark" size={13} />
                    {busy ? `${t("Working")}…` : t("Draft a reply")}
                  </button>
                  {toneChips}
                </div>
                {steerLine}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>{approvalNote}</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("AI-suggested reply")}</span>
                  <span className="bd amb">{t("Draft")}</span>
                  {draft.model === null ? null : (
                    <span className="cap" style={{ marginLeft: "auto" }}>
                      {draft.model.replace(/^[^/]+\//, "")}
                    </span>
                  )}
                </div>

                {/* What the platform said the last time this was tried. It was
                    stored on the row and shown nowhere, so three overnight
                    failures left three drafts that looked untouched. */}
                {draft.error ? (
                  <p
                    style={{
                      margin: "0 0 8px",
                      padding: "8px 10px",
                      borderRadius: 9,
                      background: "#fff7f7",
                      border: "1px solid #ffd6d6",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      color: "#8a2b2b",
                    }}
                  >
                    {t("The last attempt was refused")}: {draft.error}
                  </p>
                ) : null}
                <textarea
                  ref={draftRef}
                  className="dr"
                  rows={3}
                  value={draftBody}
                  onChange={(e) => setEdit({ draftId: draft.id, body: e.target.value })}
                  aria-label={t("AI-suggested reply")}
                  style={{
                    display: "block",
                    width: "100%",
                    minHeight: 84,
                    border: "1px solid #e2e2e2",
                    borderRadius: 10,
                    padding: "11px 13px",
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#171717",
                    background: "#fff",
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  <span className="cap" style={{ marginRight: 2 }}>{t("Regenerate")}:</span>
                  {toneChips}
                </div>
                {steerLine}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn p"
                    style={{ height: 32 }}
                    disabled={busy || draftBody.trim() === ""}
                    onClick={() => onApprove(draft.id, draftBody)}
                  >
                    <Icon name="check" size={13} />
                    {busy ? `${t("Working")}…` : t("Approve & send")}
                  </button>
                  {/* One button for both halves of editing: it saves once there
                      is something to save, and puts the cursor in the box when
                      there is not. */}
                  <button
                    type="button"
                    className="btn s"
                    style={{ height: 32 }}
                    disabled={busy}
                    onClick={() => {
                      if (dirty) onSaveEdit(draft.id, draftBody);
                      else draftRef.current?.focus();
                    }}
                  >
                    <Icon name="pen" size={13} />
                    {dirty ? t("Save") : t("Edit")}
                  </button>
                  <button
                    type="button"
                    className="btn s"
                    style={{ height: 32 }}
                    disabled={busy}
                    onClick={() => onRegenerate(c.id)}
                  >
                    <Icon name="spark" size={13} />
                    {t("Regenerate")}
                  </button>
                  <div style={{ flexGrow: 1 }} />
                  {approvalNote}
                </div>
              </>
            )}
          </div>

          {isOpen ? (
            // Acting on the comment you are reading, without a trip back up to
            // tick it for the bulk controls. Quiet, because none of these is
            // what a person usually came here to do.
            <div
              className="ib-sec"
              style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 10px", background: "#fcfcfc" }}
            >
              <button type="button" className="btn ib-q" disabled={busy} onClick={() => onModerate(c.id, "hide")}>
                <Icon name="eye" size={13} />
                {t("Hide")}
              </button>
              <button type="button" className="btn ib-q" disabled={busy} onClick={() => onModerate(c.id, "spam")}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="8" />
                  <path d="m6.4 6.4 11.2 11.2" />
                </svg>
                {t("Mark as spam")}
              </button>
              <button type="button" className="btn ib-q" disabled={busy} onClick={() => onModerate(c.id, "ignore")}>
                <Icon name="pause" size={13} />
                {t("Set aside")}
              </button>
            </div>
          ) : null}
        </article>
        {others.length === 0 ? null : (
          <section className="ib-card" style={{ marginTop: 14 }} aria-label={t("More on this video")}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px" }}>
              <Icon name="comment" size={13} color="#7c7c7c" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("More on this video")}</span>
              <span className="cap">{count(open.group.comments.length - 1, locale)}</span>
            </div>
            {others.map((o) => {
              const oname = displayName(o, zh);
              const ob = badgeFor(o);
              return (
                <button key={o.id} type="button" className="ib-ctx" onClick={() => onSelect(o.id)}>
                  <Avatar url={o.authorAvatarUrl} label={oname} size={24} />
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="el" style={{ fontSize: 12, fontWeight: 500, color: "#171717", minWidth: 0 }}>
                        {oname}
                      </span>
                      <span className="cap" suppressHydrationWarning>{shortAgo(o.postedAt, zh)}</span>
                      {ob === null ? null : (
                        <span className={`bd ${ob.cls}`} style={{ marginLeft: "auto", flexShrink: 0 }}>
                          {ob.text}
                        </span>
                      )}
                    </span>
                    <span className="ib-clamp" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#525252", marginTop: 2 }}>
                      {o.body}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    );
  }

  /* --------------------------------------------------------------- nothing */

  const nothingWaiting = (
    <div style={{ padding: "40px 20px", maxWidth: 460 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t("No comments waiting")}</div>
      <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }} suppressHydrationWarning>
        {syncLine}
      </p>
      <button type="button" className="btn s" style={{ marginTop: 12 }} onClick={onSyncNow}>
        {t("Check now")}
      </button>
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* The rail and the module sidebar are components of their own: see
          Rail and ResearchSidebar. */}
      <div
        data-inbox-screen=""
        style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
      >
        {header}
        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {tabRow}
            {/* The artboard had nowhere to put a failure. A platform refusal
                has to be readable, and in the person's own words, wherever it
                came from — one comment or a whole selection. */}
            {error === null ? null : (
              <div
                role="alert"
                style={{
                  flexShrink: 0,
                  padding: "9px 20px",
                  borderBottom: "1px solid #ededed",
                  background: "#ffe7e7",
                  color: "#e03636",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
            {summaryLine}
            {chartsOpen ? band : null}
            {groups.length === 0 ? (
              nothingWaiting
            ) : (
              <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
                {list}
                {detail}
              </div>
            )}
          </div>

          {/* The artboard's right-hand column, shared with the other Research
              screens. Its note is the one thing this screen can say from its
              own rows: what is waiting, and whether any of it is a lead. */}
          <ResearchAgentPanel
            accent={ACCENT}
            zh={zh}
            scope={
              zh
                ? `${count(summary.open, locale)} 条评论 · ${count(channelCount, locale)} 个渠道`
                : `${count(summary.open, locale)} comments · ${count(channelCount, locale)} channels`
            }
            note={agentNote}
            placeholder={t("Ask about these comments…")}
            model={model}
            footnote={t("Comment data is personal data, HK PDPO applies")}
            onAsk={onAsk}
            thread={thread}
            tools={tools}
          />
        </div>
      </div>
    </>
  );
}
