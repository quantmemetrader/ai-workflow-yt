"use client";

import * as React from "react";
import { ResearchAgentPanel } from "./ResearchAgentPanel";
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

/** A <select> wearing the artboard's chip text. */
const PICKER: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#171717",
  fontWeight: 500,
  fontFamily: "inherit",
  fontSize: "inherit",
  letterSpacing: "inherit",
  padding: 0,
  maxWidth: 150,
  cursor: "pointer",
};

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
[data-inbox-screen] { font-family: Inter, system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-inbox-screen] * { box-sizing: border-box; }
[data-inbox-screen] a { color: #007be0; text-decoration: none; }
[data-inbox-screen] img { display: block; }
[data-inbox-screen] p { margin: 0; }

[data-inbox-screen] .lbl { font-size: 10.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-inbox-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-inbox-screen] .h1 { font-size: 14px; font-weight: 500; }
[data-inbox-screen] .mut { font-size: 12px; color: #999999; }
[data-inbox-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-inbox-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-inbox-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-inbox-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-inbox-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12px; color: #4a5763; white-space: nowrap; }
[data-inbox-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-inbox-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 500; white-space: nowrap; }
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
[data-inbox-screen] .cap { font-size: 11px; color: #999999; }

/* a list row (the artboard's selected row, and the rest) */
[data-inbox-screen] .cmt { display: flex; gap: 10px; padding: 9px 14px; cursor: pointer; }
[data-inbox-screen] .cmt.on { background: #f5faff; box-shadow: inset 2px 0 0 var(--ac); }

/* the product needs a pointer on what it made clickable; the artboard is static */
[data-inbox-screen] .btn, [data-inbox-screen] .chip { cursor: pointer; }
[data-inbox-screen] .btn { border: 0; font-family: inherit; letter-spacing: inherit; }
[data-inbox-screen] .btn:disabled { opacity: .45; cursor: not-allowed; }
[data-inbox-screen] .chip.pkon { border-color: var(--ac); color: #171717; }

/* bulk selection: out of the way until it is wanted */
[data-inbox-screen] .cbx { opacity: 0; transition: opacity .12s ease; }
[data-inbox-screen] .cmt:hover .cbx,
[data-inbox-screen] .cmt:focus-within .cbx,
[data-inbox-screen] .cmt.anysel .cbx { opacity: 1; }

/* the draft box: the artboard drew its focus ring permanently, because it had
   nothing to focus */
[data-inbox-screen] .dr:focus { box-shadow: 0 0 0 3px #EFF6FF; }
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
  All: "全部",
  Flagged: "已标记",
  "Business leads": "商业线索",
  "Bulk:": "批量：",
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
  "Comment data is personal data, HK PDPO applies": "评论数据属于个人资料，适用香港《个人资料（私隐）条例》",
};

/* ------------------------------------------------------------------ format */

function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
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
  if (at === null) return "";
  const seconds = (at.getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return "";
}

/** "09:15" — when the channels were last checked. */
function clock(at: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(at);
}

/** The platforms write their own names; anything else keeps the stored key. */
const PLATFORM: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  wechat: "WeChat",
  weibo: "Weibo",
  x: "X",
  twitter: "X",
};

function platformLabel(key: string): string {
  return PLATFORM[key.toLowerCase()] ?? key;
}

/** A BCP-47 tag as a person would read it; unknown tags keep the tag. */
function languageLabel(tag: string): string {
  const known: Record<string, string> = {
    yue: "粵語 Cantonese",
    "zh-Hant": "繁體中文",
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
function Thumb({ url }: { url: string | null }): React.JSX.Element {
  const [broken, setBroken] = React.useState(false);
  const common: React.CSSProperties = { width: 34, height: 19, borderRadius: 3, objectFit: "cover", flexShrink: 0 };
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
  } = props;

  const zh = locale.startsWith("zh");
  const t = React.useCallback((key: string): string => (zh ? (ZH[key] ?? key) : key), [zh]);

  /** The artboard's search box, which searched nothing. */
  const [query, setQuery] = React.useState("");
  /** The draft as it stands in the textarea, before it is saved or sent. */
  const [edit, setEdit] = React.useState<{ draftId: string; body: string } | null>(null);
  const draftRef = React.useRef<HTMLTextAreaElement | null>(null);

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
    if (q === "") return groups;
    const hit = (c: InboxComment): boolean =>
      c.body.toLowerCase().includes(q) ||
      (c.translation ?? "").toLowerCase().includes(q) ||
      (c.authorName ?? "").toLowerCase().includes(q) ||
      (c.authorHandle ?? "").toLowerCase().includes(q);
    return groups
      .map((g) => ({ ...g, comments: g.comments.filter(hit) }))
      .filter((g) => g.comments.length > 0);
  }, [groups, q]);

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

  /* ------------------------------------------------------------ the header */

  const header = (
    <div className="bar">
      <span className="h1">{t("Comment inbox")}</span>
      <span className="mut">{t("replies require human approval")}</span>
      <div style={{ flexGrow: 1 }} />
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
    return parts.join(zh ? "" : " ");
  }, [groups, summary.unclassified, zh, locale]);

  if (channelCount === 0) {
    return (
      <>
        <style>{CSS}</style>
        <div
          data-inbox-screen=""
          style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
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

  const filterRow = (
    <div
      style={{
        flexShrink: 0,
        height: 50,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 20px",
        borderBottom: "1px solid #ededed",
      }}
    >
      <div className={`chip${currentSentiment === "" ? "" : " pkon"}`}>
        {t("Sentiment")}:
        <select
          aria-label={t("Sentiment")}
          value={currentSentiment}
          onChange={(e) => onFilter({ ...filters, sentiment: e.target.value === "" ? undefined : e.target.value })}
          style={PICKER}
        >
          <option value="">{t("All")}</option>
          {/* A filter that is on stays selectable even once nothing carries it,
              otherwise the screen cannot be got out of its own filter. */}
          {currentSentiment !== "" && !sentimentKeys.includes(currentSentiment as Sentiment) ? (
            <option value={currentSentiment}>{sentimentLabel(currentSentiment)}</option>
          ) : null}
          {sentimentKeys.map((k) => (
            <option key={k} value={k}>
              {sentimentLabel(k)} ({count(summary.sentiment[k] ?? 0, locale)})
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24">
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </div>
      <div className={`chip${currentLanguage === "" ? "" : " pkon"}`}>
        {t("Language")}:
        <select
          aria-label={t("Language")}
          value={currentLanguage}
          onChange={(e) => onFilter({ ...filters, language: e.target.value === "" ? undefined : e.target.value })}
          style={PICKER}
        >
          <option value="">{t("All")}</option>
          {currentLanguage !== "" && summary.language[currentLanguage] === undefined ? (
            <option value={currentLanguage}>{languageLabel(currentLanguage)}</option>
          ) : null}
          {languages.map(([tag, n]) => (
            <option key={tag} value={tag}>
              {languageLabel(tag)} ({count(n, locale)})
            </option>
          ))}
        </select>
        <svg viewBox="0 0 24 24">
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </div>
      <button
        type="button"
        className={`chip${filters.flagged === true ? " pkon" : ""}`}
        aria-pressed={filters.flagged === true}
        onClick={() => onFilter({ ...filters, flagged: filters.flagged === true ? undefined : true })}
        style={{ background: "transparent", fontFamily: "inherit", fontSize: 12, letterSpacing: "inherit" }}
      >
        {t("Flagged")}
      </button>
      <button
        type="button"
        className={`chip${filters.leads === true ? " pkon" : ""}`}
        aria-pressed={filters.leads === true}
        onClick={() => onFilter({ ...filters, leads: filters.leads === true ? undefined : true })}
        style={{ background: "transparent", fontFamily: "inherit", fontSize: 12, letterSpacing: "inherit" }}
      >
        {t("Business leads")}
      </button>
      <div style={{ flexGrow: 1 }} />
      <span className="cap">{t("Bulk:")}</span>
      {/* Hiding or reporting what someone said is an action with an author and
          a target: with nothing ticked there is no target, and the button says
          so rather than doing nothing when pressed. */}
      <button
        type="button"
        className="btn s"
        disabled={!anySelected}
        title={anySelected ? undefined : t("Tick a comment first")}
        onClick={() => onBulk("hide")}
      >
        {t("Hide")}
        {anySelected ? ` (${count(selected.length, locale)})` : ""}
      </button>
      <button
        type="button"
        className="btn s"
        disabled={!anySelected}
        title={anySelected ? undefined : t("Tick a comment first")}
        onClick={() => onBulk("spam")}
      >
        {t("Mark as spam")}
        {anySelected ? ` (${count(selected.length, locale)})` : ""}
      </button>
    </div>
  );

  /* -------------------------------------------------- the distribution band */

  const band = (
    <div
      style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 250px",
        gap: 18,
        padding: "14px 20px",
        borderBottom: "1px solid #ededed",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t("Sentiment distribution")}</span>
          <span className="cap">
            {zh
              ? `${count(summary.open, locale)} 条新评论 · ${count(channelCount, locale)} 个频道`
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
                <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#525252" }}>
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
            <span key={k} style={{ flex: 1, textAlign: "center", fontSize: 10.5, color: "#999999" }}>
              {sentimentLabel(k)}
            </span>
          ))}
        </div>
      </div>
      <div style={{ borderLeft: "1px solid #ededed", paddingLeft: 18 }}>
        <div className="lbl" style={{ padding: 0, marginBottom: 10 }}>
          {t("Language")}
        </div>
        {languages.length === 0 ? (
          <div className="cap">{zh ? "还没有判读出语言。" : "No language read yet."}</div>
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

  const list = (
    <div
      style={{
        width: 330,
        flexShrink: 0,
        borderRight: "1px solid #ededed",
        overflowY: "auto",
        padding: "6px 0",
      }}
    >
      {shown.map((g) => (
        <div key={g.postId}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px 6px" }}>
            <Thumb url={g.thumbnailUrl} />
            <span
              className="el"
              title={g.title ?? undefined}
              style={{ fontSize: 11.5, fontWeight: 500, color: "#525252", minWidth: 0 }}
            >
              {g.title ?? t("no title")}
            </span>
            <span className="cap" style={{ marginLeft: "auto" }}>
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
                    marginTop: 7,
                    accentColor: ACCENT,
                    flexShrink: 0,
                    cursor: "pointer",
                    ...(ticked ? { opacity: 1 } : {}),
                  }}
                />
                <Avatar url={c.authorAvatarUrl} label={name} size={26} />
                <div style={{ minWidth: 0, flexGrow: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="el" style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, minWidth: 0 }}>
                      {name}
                    </span>
                    <span className="cap" style={{ flexShrink: 0 }}>
                      {shortAgo(c.postedAt, zh)}
                    </span>
                    {badge === null ? null : (
                      <span className={`bd ${badge.cls}`} title={badge.title} style={{ marginLeft: "auto" }}>
                        {badge.text}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "#525252",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {shown.length === 0 ? (
        <div className="cap" style={{ padding: "28px 16px", textAlign: "center" }}>
          {t("Nothing matches these filters")}
        </div>
      ) : null}
    </div>
  );

  /* ------------------------------------------------------- the detail pane */

  let detail: React.JSX.Element;

  if (open === null) {
    detail = (
      <div style={{ flexGrow: 1, minWidth: 0, padding: "16px 20px" }}>
        <div className="cap">{t("Pick a comment on the left to read it here.")}</div>
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

    const caption: string[] = [platformLabel(c.platform)];
    if (open.group.title !== null && open.group.title !== "") {
      caption.push(zh ? `在《${open.group.title}》` : `on ${open.group.title}`);
    }
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

    detail = (
      <div style={{ flexGrow: 1, minWidth: 0, padding: "16px 20px", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar url={c.authorAvatarUrl} label={name} size={36} />
          <div style={{ minWidth: 0 }}>
            <div className="el" style={{ fontSize: 13.5, fontWeight: 600 }}>
              {name}
            </div>
            <div className="cap">{caption.join(" · ")}</div>
          </div>
          {badge === null ? null : (
            <span className={`bd ${badge.cls}`} title={badge.title} style={{ marginLeft: "auto" }}>
              {badge.text}
            </span>
          )}
        </div>

        <div
          style={{
            marginTop: 14,
            padding: "14px 16px",
            borderRadius: 12,
            background: "#f8f8f8",
            fontSize: 15,
            lineHeight: 1.6,
            textWrap: "pretty",
          }}
        >
          {c.body}
        </div>
        {c.translation === null || c.translation === "" ? null : (
          <div className="cap" style={{ marginTop: 7 }}>
            {`“${c.translation}” · ${t("machine translation")}`}
          </div>
        )}

        {!isOpen ? (
          // Nothing to approve: the comment has already been acted on, and the
          // approve controls would be an offer the screen cannot keep.
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="bd gray">{stateLabel(c.state)}</span>
            <span className="cap">{t("This comment is out of the inbox. Nothing is waiting on it.")}</span>
          </div>
        ) : draft === null ? (
          // No draft yet. The artboard never drew this state; an empty draft
          // box would read as a reply nobody wrote.
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
            <button
              type="button"
              className="btn p"
              style={{ height: 32 }}
              disabled={busy}
              onClick={() => onRegenerate(c.id)}
            >
              {busy ? `${t("Working")}…` : t("Draft a reply")}
            </button>
            <div style={{ flexGrow: 1 }} />
            <span className="cap">{t("Nothing sends without approval")}</span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 8px" }}>
              <span className="lbl" style={{ padding: 0 }}>
                {t("AI-suggested reply")}
              </span>
              <span className="bd amb">{t("Draft")}</span>
              {draft.model === null ? null : (
                <span className="cap" style={{ marginLeft: "auto" }}>
                  {draft.model.replace(/^[^/]+\//, "")}
                </span>
              )}
            </div>
            <textarea
              ref={draftRef}
              className="dr"
              rows={2}
              value={draftBody}
              onChange={(e) => setEdit({ draftId: draft.id, body: e.target.value })}
              aria-label={t("AI-suggested reply")}
              style={{
                display: "block",
                width: "100%",
                border: "1px solid #d9d9d9",
                borderRadius: 12,
                padding: "13px 15px",
                fontSize: 14,
                lineHeight: 1.6,
                color: "#2b343d",
                background: "#fff",
                fontFamily: "inherit",
                letterSpacing: "inherit",
                resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn p"
                style={{ height: 32 }}
                disabled={busy || draftBody.trim() === ""}
                onClick={() => onApprove(draft.id, draftBody)}
              >
                {busy ? `${t("Working")}…` : t("Approve & send")}
              </button>
              {/* One button for both halves of editing: it saves once there is
                  something to save, and puts the cursor in the box when there
                  is not. */}
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
                {dirty ? t("Save") : t("Edit")}
              </button>
              <button
                type="button"
                className="btn s"
                style={{ height: 32 }}
                disabled={busy}
                onClick={() => onRegenerate(c.id)}
              >
                {t("Regenerate")}
              </button>
              <div style={{ flexGrow: 1 }} />
              <span className="cap">{t("Nothing sends without approval")}</span>
            </div>
          </>
        )}

        {isOpen ? (
          // The artboard drew moderation only as a bulk control in the filter
          // row, which meant acting on the comment you are reading took a trip
          // back up to tick it first.
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn s"
              style={{ height: 28, fontSize: 12 }}
              disabled={busy}
              onClick={() => onModerate(c.id, "hide")}
            >
              {t("Hide")}
            </button>
            <button
              type="button"
              className="btn s"
              style={{ height: 28, fontSize: 12 }}
              disabled={busy}
              onClick={() => onModerate(c.id, "spam")}
            >
              {t("Mark as spam")}
            </button>
            <button
              type="button"
              className="btn s"
              style={{ height: 28, fontSize: 12 }}
              disabled={busy}
              onClick={() => onModerate(c.id, "ignore")}
            >
              {t("Set aside")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  /* --------------------------------------------------------------- nothing */

  const nothingWaiting = (
    <div style={{ padding: "40px 20px", maxWidth: 460 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t("No comments waiting")}</div>
      <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
        {syncLine}
      </p>
      <button type="button" className="btn s" style={{ marginTop: 12 }} onClick={onSyncNow}>
        {t("Check now")}
      </button>
    </div>
  );

  return (
    <>
      <style>{CSS}</style>

      {/* The rail and the module sidebar are components of their own: see
          Rail and ResearchSidebar. */}
      <div
        data-inbox-screen=""
        style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {header}
        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {filterRow}
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
            {band}
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
          />
        </div>
      </div>
    </>
  );
}
