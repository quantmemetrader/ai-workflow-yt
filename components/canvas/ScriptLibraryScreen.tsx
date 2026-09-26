"use client";

import * as React from "react";
import { ProposalsStrip } from "@/components/agents/ProposalsStrip";
import type { Proposals } from "@/lib/agents/proposals";
import { ResearchAgentPanel } from "./ResearchAgentPanel";
import type { ScriptListItem } from "@/lib/script/service";
import { useResizable } from "@/components/ui/Resizer";
import { StatusStrip } from "@/components/ui/kit";
import { PersonAvatar } from "@/components/ui/PersonAvatar";

/**
 * ScriptLibraryScreen — a transcription of design/canvas/Script-Library.dc.html.
 *
 * Everything after the artboard's 52px rail: the Script module sidebar (the
 * library scopes, the folder list, the House style footer), the toolbar, the
 * status filter row, and the two views the artboard draws of the same list —
 * the Finder-style icon grid (.ic / .icn / .icl) and the seven-column table.
 * Markup, nesting, class names, SVG paths, pixel values and colours are the
 * artboard's; only the content is lifted into props. The artboard is the source
 * of truth — when it changes, change this file with it, and do not "improve"
 * anything here that the artboard does not do.
 *
 * What the artboard draws and this file does not, and why:
 *
 *   — The right-hand 320px Agent panel. It is a scripted conversation (a
 *     question nobody asked, a "0.9 s" tool run, a "Remind Michelle" button
 *     wired to nothing) and this screen is given no thread, model or onAsk, so
 *     every word of it would be invented.
 *   — The "Length" and "House style" columns. ScriptListItem carries neither a
 *     duration nor a conformance score, and a column of em-dashes is worse than
 *     no column. The remaining five columns keep the artboard's own widths.
 *   — "Style guide v7", "Prompt template plus 41 approved past scripts" and the
 *     "scored against guide v7" tail on the footer line. The guide's version and
 *     contents are not known to this screen.
 *   — The artboard's red "Changes requested" badge. `script_status` has no such
 *     value, so that treatment stays undrawn rather than being pinned onto a
 *     status that does not mean it.
 *   — `.ic.sel`, the selected tile. There is no selection in this screen's
 *     contract; opening a script is the whole interaction.
 *
 * What this file draws and the artboard does not: a delete control per row and
 * per tile, revealed on hover or keyboard focus, wearing the artboard's own
 * .ptog icon-button treatment; and the two empty states, in the artboard's
 * heading / .mut / .btn.s vocabulary.
 */

export type ScriptLibraryScreenProps = {
  locale: string;
  scripts: ScriptListItem[];
  /** What 编剧 suggests writing next. */
  proposals?: Proposals;
  folders: { id: string; name: string; count: number }[];
  counts: { all: number; brief: number; drafting: number; awaiting: number; locked: number };
  /** null = "All scripts" (no folder selected) */
  folderId: string | null;
  /** null = the "All" chip */
  status: ScriptListItem["status"] | null;
  sort: "updated" | "title" | "status";
  /** "list" | "grid" — the artboard draws both; default "list" */
  view: "list" | "grid";
  /** the library filter in the sidebar; "topics" is the 选题 queue */
  scope: "all" | "mine" | "awaiting" | "shared" | "topics";
  /** The 选题 queue, drawn in place of the list when `scope` is "topics". */
  topicsView?: React.ReactNode;
  /** How many topics are waiting, for the sidebar's badge. */
  topicCount?: number | null;
  query: string;
  pending: boolean;
  error: string | null;

  onOpen: (scriptId: string) => void;
  onFolder: (folderId: string | null) => void;
  onStatus: (status: ScriptListItem["status"] | null) => void;
  onScope: (scope: ScriptLibraryScreenProps["scope"]) => void;
  onSort: (sort: ScriptLibraryScreenProps["sort"]) => void;
  onView: (view: "list" | "grid") => void;
  onQuery: (q: string) => void;
  onNewScript: () => void;
  onNewFolder: () => void;
  onDelete: (scriptId: string) => void;
  /** The model the right-hand panel names under its composer. */
  model: string;
  /** Hands a question to the agent on /chat, where it can cite the files and
   * scripts the asker is allowed to read. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, rendered in the agent panel. */
  thread?: React.ReactNode;
  /** Controls above the composer: history, a new thread. */
  tools?: React.ReactNode;
};

type Status = ScriptListItem["status"];

/** The artboard's `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/** Whole days since a date. `Date.now()` is read here rather than in a render
 * body, which the repo's `react-hooks/purity` rule rejects. */
function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/* --------------------------------------------------------------------- css */

/**
 * The artboard's own <style>, minus the rail rules (.r — the rail is not ours),
 * the html/body rules (the artboard is a 1440x900 frame, the product fills the
 * viewport) and the rules for the other Script screens that share this
 * stylesheet (the editor, the page previews, the diff view). Every selector is
 * scoped to [data-script-library-screen] (the two roots below) so these
 * one-letter class names cannot collide with — or be overridden by — the rest
 * of the app, which defines its own .n / .lbl / .btn. Source order is the
 * artboard's, so the cascade inside is unchanged.
 */
const CSS = `
[data-script-library-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-script-library-screen] * { box-sizing: border-box; }
[data-script-library-screen] a { color: #007be0; text-decoration: none; }
[data-script-library-screen] img { display: block; }
[data-script-library-screen] p { margin: 0; }

/* sidebar */
[data-script-library-screen] .n { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; transition: background .16s ease; }
[data-script-library-screen] .n.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; font-weight: 500; }
[data-script-library-screen] .n b { margin-left: auto; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-script-library-screen] .n i { margin-left: auto; font-style: normal; display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border-radius: 9px; background: #ffe7e7; color: #e03636; font-size: 11px; font-weight: 500; }
[data-script-library-screen] .lbl { font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-script-library-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-script-library-screen] .h1 { font-size: 15px; font-weight: 500; white-space: nowrap; }
[data-script-library-screen] .mut { font-size: 12.5px; color: #999999; }
/* The primary button is the app's ink black, as on every other screen; the
   artboard's blue made "新建脚本" the one blue button in the product. */
[data-script-library-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; flex-shrink: 0; transition: background .15s ease, border-color .15s ease; }
[data-script-library-screen] .btn.p { background: #171717; color: #fff; font-weight: 500; }
[data-script-library-screen] .btn.p:hover { background: #2e2e2e; }
[data-script-library-screen] .btn.s { border: 1px solid #e2e2e2; color: #383838; }
[data-script-library-screen] .btn.s:hover { background: #f7f7f7; }
[data-script-library-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-script-library-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12.5px; color: #4a5763; white-space: nowrap; }
[data-script-library-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
[data-script-library-screen] .gray { background: #f3f3f3; color: #525252 }
[data-script-library-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-script-library-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-script-library-screen] .amb  { background: #fff7d3; color: #db7706 }
[data-script-library-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-script-library-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }

/* table */
[data-script-library-screen] .t { width: 100%; }
[data-script-library-screen] .t .hd { height: 32px; border-bottom: 1px solid #ededed; display: grid; align-items: center; }
[data-script-library-screen] .t .hd > * { font-size: 11.5px; font-weight: 500; color: #7c7c7c; padding: 0 12px; white-space: nowrap; }
[data-script-library-screen] .t .hd > .num { text-align: right; }
[data-script-library-screen] .tr { height: 46px; border-bottom: 1px solid #f3f3f3; display: grid; align-items: center; }
[data-script-library-screen] .tr > * { font-size: 12.5px; color: #383838; padding: 0 12px; min-width: 0; display: flex; align-items: center; white-space: nowrap; }
[data-script-library-screen] .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
[data-script-library-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }

[data-script-library-screen] .cap { font-size: 11.5px; color: #999999; }
[data-script-library-screen] .seg { width: 30px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
[data-script-library-screen] .seg svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-script-library-screen] .fc { height: 26px; padding: 0 10px; border-radius: 7px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #525252; border: 1px solid #ededed; background: #fff; white-space: nowrap; }
[data-script-library-screen] .fc b { font-weight: 500; color: #999999; font-size: 11.5px; }
[data-script-library-screen] .fc.on { background: #171717; border-color: #171717; color: #fff; }
[data-script-library-screen] .fc.on b { color: #c7c7c7; }
[data-script-library-screen] .dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }
[data-script-library-screen] .ptog { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: #7c7c7c; cursor: pointer; flex-shrink: 0; }
[data-script-library-screen] .ptog:hover { background: #ededed; }
[data-script-library-screen] .ptog svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

/* icon grid (library) */
[data-script-library-screen] .ic { display: flex; flex-direction: column; align-items: center; padding: 8px 4px 6px; border-radius: 10px; min-width: 0; }
[data-script-library-screen] .icn { height: 62px; width: 76px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px; border-radius: 9px; }
[data-script-library-screen] .icl { margin-top: 7px; text-align: center; font-size: 12.5px; line-height: 1.4; color: #171717; max-width: 100%; }
[data-script-library-screen] .icl span { padding: 1px 5px; border-radius: 5px; -webkit-box-decoration-break: clone; box-decoration-break: clone; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
[data-script-library-screen] .icm { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 11.5px; color: #999999; white-space: nowrap; }
[data-script-library-screen] .icm .dot { width: 6px; height: 6px; }

/* the product needs a pointer on what it made clickable; the artboard is static */
[data-script-library-screen] .btn, [data-script-library-screen] .fc, [data-script-library-screen] .n, [data-script-library-screen] .ic { cursor: pointer; }
[data-script-library-screen] .btn, [data-script-library-screen] .fc { border: 0; font-family: inherit; letter-spacing: inherit; }
[data-script-library-screen] .btn.s, [data-script-library-screen] .fc { border: 1px solid #e2e2e2; }
[data-script-library-screen] .fc.on { border-color: #171717; }
[data-script-library-screen] .n { border: 0; background: transparent; font-family: inherit; letter-spacing: inherit; width: 100%; text-align: left; }
[data-script-library-screen] .n.on { background: #ffffff; }
[data-script-library-screen] .tr { transition: background .12s ease; }
[data-script-library-screen] .tr:hover { background: #f8f8f8; }
[data-script-library-screen] .fc:not(.on):hover { background: #f7f7f7; }

/* the delete affordance the artboard has no room for: present to the keyboard,
   invisible until the row or tile it belongs to is hovered or focused */
[data-script-library-screen] .act { opacity: 0; border: 0; background: transparent; padding: 0; transition: opacity .12s ease; }
[data-script-library-screen] .tr:hover .act,
[data-script-library-screen] .tr:focus-within .act,
[data-script-library-screen] .ic:hover .act,
[data-script-library-screen] .ic:focus-within .act { opacity: 1; }
[data-script-library-screen] .act:focus-visible { opacity: 1; }
`;

/* ---------------------------------------------------------------- language */

/** zh-CN strings for the artboard's chrome; English is the artboard's own. */
const ZH: Record<string, string> = {
  Script: "脚本",
  Library: "库",
  "All scripts": "全部脚本",
  "Assigned to me": "指派给我的",
  "Waiting on approval": "等待审批",
  "Shared with me": "共享给我的",
  Topics: "选题",
  Project: "项目",
  "From the topic": "选题",
  Folders: "文件夹",
  "No folders yet": "还没有文件夹",
  "House style": "团队风格",
  "Style guide": "风格指南",
  "New script": "新建脚本",
  "New folder": "新建文件夹",
  "Search scripts": "搜索脚本",
  Scripts: "脚本",
  All: "全部",
  Briefs: "简报",
  Brief: "简报",
  Drafting: "撰写中",
  "Awaiting approval": "待审批",
  Locked: "已锁定",
  Archived: "已归档",
  Sort: "排序",
  "Last edited": "最近编辑",
  Title: "标题",
  Status: "状态",
  "Ver.": "版本",
  Owner: "负责人",
  Edited: "编辑时间",
  Pages: "页面",
  List: "列表",
  docs: "个文档",
  scripts: "个脚本",
  Unassigned: "未指派",
  "Delete script": "删除脚本",
  "No scripts yet": "还没有脚本",
  "New script writes the first one.": "点击“新建脚本”创建第一个。",
  "No scripts match this search.": "没有符合条件的脚本。",
  "Clear the search and the filters": "清除搜索与筛选",
  "filtered to scripts you can read": "已按你的权限过滤",
};

/* ------------------------------------------------------------------ format */

function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** "28 Aug" — the artboard's Edited column, once a script is older than a week. */
function shortDate(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/** "2 min ago", "2 h ago", "Yesterday" — the artboard's own recent stamps. */
function relative(d: Date, locale: string): string {
  const seconds = (d.getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === "second") {
      const s = rtf.format(Math.round(seconds / size), unit);
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
  return "";
}

/**
 * The artboard mixes the two: "2 min ago" and "Yesterday" near the top of the
 * list, "28 Aug" further down. A week is the hinge.
 */
function edited(value: Date, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return Math.abs(Date.now() - d.getTime()) < 7 * 86400000 ? relative(d, locale) : shortDate(d, locale);
}

function fullStamp(value: Date, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/* ------------------------------------------------------------------ status */

/** The artboard's dot colour and badge class per status, and its English word. */
const STATUS: Record<Status, { dot: string; badge: string; label: string }> = {
  brief: { dot: "#c7c7c7", badge: "gray", label: "Brief" },
  drafting: { dot: "#007be0", badge: "blue", label: "Drafting" },
  awaiting_approval: { dot: "#db7706", badge: "amb", label: "Awaiting approval" },
  locked: { dot: "#278f5e", badge: "grn", label: "Locked" },
  /* The artboard has no archived row. Archived is finished and quiet, so it
     wears the same neutral badge as a brief and is told apart by its word. */
  archived: { dot: "#c7c7c7", badge: "gray", label: "Archived" },
};

/* ------------------------------------------------------------------- icons */

/** The folder tint the artboard gives the folder you are inside. */
function SidebarFolder({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: on ? "#8fc3f1" : "#c7c7c7", flexShrink: 0 }}>
      <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z" />
    </svg>
  );
}

/**
 * The artboard's Finder folder, 54x42. Its gradient is declared once at the
 * root of the screen (`#sl-mfold`) rather than per tile, which is where the
 * artboard's duplicated id would land in a list of any length.
 */
function FolderTile() {
  return (
    <svg
      viewBox="0 0 60 46"
      width="54"
      height="42"
      style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.14))" }}
    >
      <path d="M2 5a4 4 0 0 1 4-4h14.2a4 4 0 0 1 3.1 1.5L26.4 6H54a4 4 0 0 1 4 4v5H2z" fill="#4e9ce0" />
      <rect x="1" y="10.5" width="58" height="34.5" rx="4.5" fill="url(#sl-mfold)" />
      <rect x="1.5" y="10.5" width="57" height="1.8" rx=".9" fill="#bfe3ff" />
    </svg>
  );
}

/** The corner stamp on a page: a pencil while drafting, a clock while waiting,
 * a padlock once locked. A brief has no version and no stamp. */
function StatusStamp({ status }: { status: Status }) {
  if (status === "drafting") {
    return (
      <g transform="translate(34.5 46.5)">
        <circle r="7.4" fill="#007be0" stroke="#fff" strokeWidth="1.8" />
        <path d="M-2.6 2.6 1.9-1.9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M1.1-2.7l1.6 1.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    );
  }
  if (status === "awaiting_approval") {
    return (
      <g transform="translate(34.5 46.5)">
        <circle r="7.4" fill="#f5a524" stroke="#fff" strokeWidth="1.8" />
        <path
          d="M0-3.2V0l2.1 1.4"
          stroke="#fff"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    );
  }
  if (status === "locked") {
    return (
      <g transform="translate(34.5 46.5)">
        <circle r="7.4" fill="#30a46c" stroke="#fff" strokeWidth="1.8" />
        <rect x="-2.7" y="-.5" width="5.4" height="4" rx="1" fill="#fff" />
        <path d="M-1.6-.5v-1.2a1.6 1.6 0 0 1 3.2 0v1.2" stroke="#fff" strokeWidth="1.3" fill="none" />
      </g>
    );
  }
  return null;
}

/** The artboard's ruled page body, and the block body it gives a brief. */
const LINES: [number, number][] = [
  [13.5, 20],
  [16.7, 27],
  [19.9, 24],
  [23.1, 28],
  [27.9, 18],
  [31.1, 26],
  [34.3, 23],
  [37.5, 27],
  [42.3, 15],
  [45.5, 25],
  [48.7, 22],
];
const BLOCKS: [number, number][] = [
  [13.5, 9],
  [21.9, 13],
  [30.3, 17],
  [38.7, 21],
];

function PageIcon({ status, width }: { status: Status; width: number }) {
  return (
    <svg
      viewBox="0 0 42 54"
      width={width}
      height={Math.round((width * 54) / 42)}
      style={{
        display: "block",
        flexShrink: 0,
        overflow: "visible",
        filter: "drop-shadow(0 .5px 1px rgba(0,0,0,.18)) drop-shadow(0 2px 5px rgba(0,0,0,.06))",
      }}
    >
      <rect x=".5" y=".5" width="41" height="53" rx="3.5" fill="#fff" stroke="rgba(0,0,0,.07)" />
      <rect x="6" y="7" width="15" height="2.4" rx="1.2" fill="#8f8f8f" />
      {status === "brief"
        ? BLOCKS.map(([y, w]) => (
            <React.Fragment key={y}>
              <rect x="6" y={y} width="30" height="6" rx="1.6" fill="#f2f2f2" />
              <rect x="8.2" y={y + 2.3} width={w} height="1.4" rx=".7" fill="#cdcdcd" />
            </React.Fragment>
          ))
        : LINES.map(([y, w]) => (
            <rect key={y} x="6" y={y} width={w} height="1.35" rx=".7" fill="#d6d6d6" />
          ))}
      <StatusStamp status={status} />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5" />
    </svg>
  );
}

/* --------------------------------------------------------------- component */

export function ScriptLibraryScreen(props: ScriptLibraryScreenProps): React.JSX.Element {
  const {
    locale,
    scripts,
    proposals,
    folders,
    counts,
    folderId,
    status,
    sort,
    view,
    scope,
    topicsView,
    topicCount,
    query,
    pending,
    error,
    onOpen,
    onFolder,
    onStatus,
    onScope,
    onSort,
    onView,
    onQuery,
    onNewScript,
    onNewFolder,
    onDelete,
    model,
    onAsk,
    thread,
    tools,
  } = props;

  const zh = locale.startsWith("zh");
  const t = (key: string): string => (zh ? (ZH[key] ?? key) : key);
  const { width: sideWidth, handle: sideHandle } = useResizable("script-sidebar", {
    min: 160, max: 400, initial: 212, edge: "right",
  });

  /**
   * What the panel can say from these rows alone.
   *
   * The artboard asked "What is holding this folder up?" and answered with
   * invented names and durations. This answers the same question from the
   * dates that are actually here: what has been waiting longest, and what has
   * not been touched.
   */
  const agentNote = React.useMemo(() => {
    if (scripts.length === 0) return zh ? "这里还没有脚本。" : "There are no scripts here yet.";

    const waiting = scripts.filter((s) => s.status === "awaiting_approval");
    const stale = scripts.filter((s) => s.status === "drafting" && daysSince(s.updatedAt) >= 7);

    const parts: string[] = [];
    if (waiting.length) {
      const longest = waiting.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
      const d = daysSince(longest.updatedAt);
      parts.push(
        zh
          ? `${waiting.length} 个脚本在等批准，等得最久的是《${longest.title}》，${d <= 0 ? "今天" : `${d} 天`}。`
          : `${waiting.length} waiting on approval. The longest is “${longest.title}”, ${d <= 0 ? "since today" : `${d} days`}.`,
      );
    }
    if (stale.length) {
      parts.push(
        zh
          ? `${stale.length} 个草稿超过一周没有改动。`
          : `${stale.length} drafts have not been touched in over a week.`,
      );
    }
    if (!parts.length) {
      parts.push(zh ? "没有卡住的脚本。" : "Nothing is stuck.");
    }
    return parts.join(zh ? "" : " ");
  }, [scripts, zh]);

  const here = folders.find((f) => f.id === folderId) ?? null;
  const filtered = query.trim() !== "" || status !== null || folderId !== null || scope !== "all";

  /** The artboard's library rows. Only two of the four have a count this screen
   * can know: "all" and the approval queue. The other two are shown bare rather
   * than with a number nobody computed. */
  const scopes: { key: ScriptLibraryScreenProps["scope"]; label: string; badge: number | null; alert: boolean }[] = [
    { key: "all", label: t("All scripts"), badge: counts.all, alert: false },
    { key: "mine", label: t("Assigned to me"), badge: null, alert: false },
    { key: "awaiting", label: t("Waiting on approval"), badge: counts.awaiting, alert: true },
    { key: "shared", label: t("Shared with me"), badge: null, alert: false },
    /* Not on the artboard: the topics chosen elsewhere (Home, Research, the
       backlog, today's plan) that are waiting for a script. The client
       could not find a topic page in Script; this is it. */
    ...(topicsView ? [{ key: "topics" as const, label: t("Topics"), badge: topicCount ?? null, alert: false }] : []),
  ];

  /** The artboard's filter row, in its order, with its dot colours. */
  const chips: { key: Status | null; label: string; n: number; dot: string | null }[] = [
    { key: null, label: t("All"), n: counts.all, dot: null },
    { key: "brief", label: t("Briefs"), n: counts.brief, dot: STATUS.brief.dot },
    { key: "drafting", label: t("Drafting"), n: counts.drafting, dot: STATUS.drafting.dot },
    {
      key: "awaiting_approval",
      label: t("Awaiting approval"),
      n: counts.awaiting,
      dot: STATUS.awaiting_approval.dot,
    },
    { key: "locked", label: t("Locked"), n: counts.locked, dot: STATUS.locked.dot },
  ];

  /** The artboard's list geometry, minus Length and House style (no data).
   * Version and Edited are wide enough for their own header and a Chinese
   * "10小时前" on one line (at 44px and 76px both broke onto two, "版/本");
   * Status and Owner give back what their contents never used, so at 1280
   * the title keeps about 180px rather than eighty. */
  const COLS = "minmax(0, 1fr) 92px 56px 112px 88px 36px";

  const frameStyle = { "--ac": ACCENT } as React.CSSProperties;

  /** "v4" while there is a version; a brief has none, and says so. */
  function versionWord(s: ScriptListItem): string {
    return s.version > 0 ? `v${count(s.version, locale)}` : t("Brief");
  }

  function clearAll() {
    onQuery("");
    onStatus(null);
    onFolder(null);
    onScope("all");
  }

  const footer = zh
    ? `${count(scripts.length, locale)} ${t("scripts")} · ${t("filtered to scripts you can read")}`
    : `${count(scripts.length, locale)} scripts · filtered to scripts you can read`;

  /* ------------------------------------------------------------- empty states */

  const emptyState =
    scripts.length > 0 ? null : (
      <div style={{ maxWidth: 460, padding: "6px 4px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {filtered ? t("No scripts match this search.") : t("No scripts yet")}
        </div>
        <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
          {filtered ? t("Clear the search and the filters") : t("New script writes the first one.")}
        </p>
        {filtered ? (
          <button type="button" className="btn s" onClick={clearAll} style={{ marginTop: 12 }}>
            {t("Clear the search and the filters")}
          </button>
        ) : (
          <button type="button" className="btn p" onClick={onNewScript} style={{ marginTop: 12 }}>
            <svg viewBox="0 0 24 24">
              <path d="M12 6v12M6 12h12" />
            </svg>
            {t("New script")}
          </button>
        )}
      </div>
    );

  /* ------------------------------------------------------------------ render */

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* The gradient the folder tiles share, declared once. */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }} focusable="false">
        <defs>
          <linearGradient id="sl-mfold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fcdf9" />
            <stop offset="1" stopColor="#5eacee" />
          </linearGradient>
        </defs>
      </svg>

      {/* ============ MODULE SIDEBAR ============ */}
      <div
        data-script-library-screen=""
        style={{
          ...frameStyle,
          width: sideWidth,
          position: "relative",
          flexShrink: 0,
          background: "#f8f8f8",
          borderRight: "1px solid #ededed",
          display: "flex",
          flexDirection: "column",
          padding: "10px 8px",
        }}
      >
        {sideHandle}
        <div style={{ display: "flex", alignItems: "center", padding: "4px 9px 12px" }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t("Script")}</span>
          {/* The artboard's "+" beside the module name. The toolbar already
              holds New script, so this is the library's other maker. */}
          <button
            type="button"
            onClick={onNewFolder}
            aria-label={t("New folder")}
            title={t("New folder")}
            style={{
              marginLeft: "auto",
              width: 24,
              height: 24,
              borderRadius: 7,
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,.1)",
              border: 0,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{ width: 13, height: 13, stroke: "#171717", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}
            >
              <path d="M12 6v12M6 12h12" />
            </svg>
          </button>
        </div>

        <div className="lbl" style={{ marginBottom: 5 }}>
          {t("Library")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {scopes.map((s) => {
            const on = scope === s.key && (s.key !== "all" || folderId === null);
            return (
              <button
                key={s.key}
                type="button"
                className={on ? "n on" : "n"}
                aria-pressed={on}
                onClick={() => {
                  onScope(s.key);
                  /* "All scripts" is the whole library, so it also steps out
                     of whichever folder you were in. */
                  if (s.key === "all" && folderId !== null) onFolder(null);
                }}
              >
                <span>{s.label}</span>
                {s.badge === null ? null : s.alert ? (
                  s.badge > 0 ? (
                    <i>{count(s.badge, locale)}</i>
                  ) : (
                    <b>{count(s.badge, locale)}</b>
                  )
                ) : (
                  <b>{count(s.badge, locale)}</b>
                )}
              </button>
            );
          })}
        </div>

        <div className="lbl" style={{ margin: "16px 0 5px" }}>
          {t("Folders")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {folders.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 9px 0" }}>
              {t("No folders yet")}
            </p>
          ) : (
            folders.map((f) => {
              const on = f.id === folderId;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={on ? "n on" : "n"}
                  aria-pressed={on}
                  onClick={() => onFolder(on ? null : f.id)}
                >
                  <SidebarFolder on={on} />
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {f.name}
                  </span>
                  <b>{count(f.count, locale)}</b>
                </button>
              );
            })
          )}
        </div>

        {/* The artboard names a version here ("Style guide v7") and counts the
            approved scripts behind it. Neither is known to this screen, so the
            footer keeps the label and drops the numbers. */}
        <div style={{ marginTop: "auto", padding: "11px 9px 4px", borderTop: "1px solid #ededed" }}>
          <div className="lbl" style={{ padding: 0, marginBottom: 7 }}>
            {t("House style")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#383838" }}>
            <svg
              viewBox="0 0 24 24"
              style={{
                width: 13,
                height: 13,
                stroke: "#7c7c7c",
                fill: "none",
                strokeWidth: 1.7,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                flexShrink: 0,
              }}
            >
              <path d="M6.5 3.5h7.2L18.5 8v12.5h-12z" />
              <path d="M13.5 3.5V8h5" />
            </svg>
            {t("Style guide")}
          </div>
        </div>
      </div>

      {/* ============ MAIN ============ */}
      <div
        data-script-library-screen=""
        style={{ ...frameStyle, flexGrow: 1, display: "flex", minWidth: 0 }}
      >
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {proposals && scope !== "topics" ? (
          <ProposalsStrip owner="script" items={proposals.items} planDate={proposals.planDate} zh={locale.startsWith("zh")} />
        ) : null}
        {/* toolbar */}
        <div className="bar">
          {here === null ? (
            <span className="h1">{t("Scripts")}</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onFolder(null)}
                style={{
                  fontSize: 13,
                  color: "#999999",
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  fontFamily: "inherit",
                  letterSpacing: "inherit",
                  cursor: "pointer",
                }}
              >
                {t("Scripts")}
              </button>
              <svg
                viewBox="0 0 24 24"
                style={{ width: 12, height: 12, stroke: "#c7c7c7", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}
              >
                <path d="m9.5 5.5 6 6.5-6 6.5" />
              </svg>
              <span className="h1">{here.name}</span>
            </>
          )}
          <div style={{ flexGrow: 1 }}></div>

          {/* The artboard drew this as a static box; it is the real search. */}
          <div
            style={{
              width: 200,
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
              style={{
                width: 13,
                height: 13,
                flexShrink: 0,
                stroke: "#999999",
                fill: "none",
                strokeWidth: 1.8,
                strokeLinecap: "round",
              }}
            >
              <circle cx="11" cy="11" r="6.4" />
              <path d="m15.8 15.8 4 4" />
            </svg>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              aria-label={t("Search scripts")}
              placeholder={t("Search scripts")}
              style={{
                width: "100%",
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

          <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "#f3f3f3" }}>
            <button
              type="button"
              className="seg"
              onClick={() => onView("grid")}
              aria-pressed={view === "grid"}
              title={t("Pages")}
              aria-label={t("Pages")}
              style={{
                border: 0,
                padding: 0,
                background: view === "grid" ? "#ffffff" : "transparent",
                color: view === "grid" ? "#171717" : "#7c7c7c",
                boxShadow: view === "grid" ? "0px 1px 2px rgba(0, 0, 0, 0.1)" : "none",
              }}
            >
              <svg viewBox="0 0 24 24">
                <rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
                <rect x="13.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
                <rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
                <rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
              </svg>
            </button>
            <button
              type="button"
              className="seg"
              onClick={() => onView("list")}
              aria-pressed={view === "list"}
              title={t("List")}
              aria-label={t("List")}
              style={{
                border: 0,
                padding: 0,
                background: view === "list" ? "#ffffff" : "transparent",
                color: view === "list" ? "#171717" : "#7c7c7c",
                boxShadow: view === "list" ? "0px 1px 2px rgba(0, 0, 0, 0.1)" : "none",
              }}
            >
              <svg viewBox="0 0 24 24">
                <path d="M9 6.5h11M9 12h11M9 17.5h11" />
                <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" />
              </svg>
            </button>
          </div>

          <button type="button" className="btn p" onClick={onNewScript}>
            <svg viewBox="0 0 24 24" style={{ strokeWidth: 2 }}>
              <path d="M12 6v12M6 12h12" />
            </svg>
            {t("New script")}
          </button>
        </div>

        {/* The same four counts the filter chips carry, read as a state of the
            module rather than as four things to click: what is being written,
            what is waiting on somebody, what is finished. */}
        {/* In the order a script moves (brief, drafting, approval, locked)
            and in the colours the filter chips and the row badges below
            use: a brief is grey, not the amber of "waiting on somebody",
            and 待审批 is the chips' amber rather than a third, red one. */}
        <StatusStrip
          items={[
            { label: t("Briefs"), value: counts.brief, tone: "quiet" },
            { label: t("Drafting"), value: counts.drafting, tone: "running" },
            { label: t("Awaiting approval"), value: counts.awaiting, tone: "waiting" },
            { label: t("Locked"), value: counts.locked, tone: "done" },
          ]}
          right={zh ? `共 ${count(counts.all, locale)} 个脚本` : `${count(counts.all, locale)} scripts in all`}
        />

        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div
            aria-busy={pending}
            style={{
              flexGrow: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              padding: "16px 22px 0",
              overflow: "auto",
              opacity: pending ? 0.6 : 1,
              transition: "opacity .12s ease",
            }}
          >
            {scope === "topics" && topicsView ? topicsView : null}
            {/* filter row */}
            <div style={{ display: scope === "topics" && topicsView ? "none" : "flex", alignItems: "center", gap: 6, marginBottom: 16, flexShrink: 0 }}>
              {chips.map((c) => {
                const on = status === c.key;
                return (
                  <button
                    key={c.key ?? "all"}
                    type="button"
                    className={on ? "fc on" : "fc"}
                    aria-pressed={on}
                    onClick={() => onStatus(c.key)}
                  >
                    {c.dot === null ? null : <span className="dot" style={{ background: c.dot }}></span>}
                    {c.label} <b>{count(c.n, locale)}</b>
                  </button>
                );
              })}
              <div style={{ flexGrow: 1 }}></div>
              <span className="cap">{t("Sort")}</span>
              {/* The artboard drew a chip with a chevron and nothing behind it.
                  The native picker brings its own chevron, so the artboard's is
                  not drawn twice. */}
              <div className="chip" style={{ height: 26, fontSize: 12 }}>
                <select
                  aria-label={t("Sort")}
                  value={sort}
                  onChange={(e) => onSort(e.target.value as ScriptLibraryScreenProps["sort"])}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#171717",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    letterSpacing: "inherit",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <option value="updated">{t("Last edited")}</option>
                  <option value="title">{t("Title")}</option>
                  <option value="status">{t("Status")}</option>
                </select>
              </div>
            </div>

            {error === null ? null : (
              <div className="bd red" style={{ height: "auto", padding: "7px 10px", marginBottom: 12, flexShrink: 0 }}>
                {error}
              </div>
            )}

            {/* ============ GRID ============ */}
            {scope === "topics" && topicsView ? null : view === "grid" ? (
              <>
                {folders.length === 0 ? null : (
                  <>
                    <div className="lbl" style={{ padding: "0 4px", flexShrink: 0 }}>
                      {t("Folders")}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                        gap: "2px 6px",
                        margin: "4px 0 20px",
                        flexShrink: 0,
                      }}
                    >
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="ic"
                          onClick={() => onFolder(f.id)}
                          style={{ border: 0, background: "transparent", fontFamily: "inherit", letterSpacing: "inherit" }}
                        >
                          <span className="icn">
                            <FolderTile />
                          </span>
                          <span className="icl">
                            <span>{f.name}</span>
                          </span>
                          <span className="icm">
                            {zh ? `${count(f.count, locale)} ${t("docs")}` : `${count(f.count, locale)} docs`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="lbl" style={{ padding: "0 4px", flexShrink: 0 }}>
                  {t("Scripts")} · {count(scripts.length, locale)}
                </div>
                {scripts.length === 0 ? (
                  <div style={{ marginTop: 10 }}>{emptyState}</div>
                ) : (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                        gap: "10px 6px",
                        marginTop: 4,
                      }}
                    >
                      {scripts.map((s) => (
                        <div
                          key={s.id}
                          className="ic"
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpen(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onOpen(s.id);
                            }
                          }}
                          style={{ position: "relative", cursor: "pointer" }}
                        >
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(s.id);
                            }}
                            title={s.title}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              minWidth: 0,
                              maxWidth: "100%",
                              width: "100%",
                              border: 0,
                              background: "transparent",
                              padding: 0,
                              fontFamily: "inherit",
                              letterSpacing: "inherit",
                              cursor: "pointer",
                            }}
                          >
                            <span className="icn">
                              <PageIcon status={s.status} width={42} />
                            </span>
                            <span className="icl">
                              <span>{s.title}</span>
                            </span>
                            <span className="icm">
                              <span className="dot" style={{ background: STATUS[s.status].dot }}></span>
                              {versionWord(s)} · {edited(s.updatedAt, locale)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="act ptog"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(s.id);
                            }}
                            aria-label={`${t("Delete script")} ${s.title}`}
                            title={t("Delete script")}
                            style={{ position: "absolute", top: 2, right: 2 }}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="cap" style={{ margin: "22px 0 18px", padding: "0 4px" }}>
                      {footer}
                    </div>
                  </>
                )}
              </>
            ) : (
              /* ============ LIST ============ */
              <>
                {scripts.length === 0 ? (
                  emptyState
                ) : (
                  <>
                    <div className="t">
                      <div className="hd" style={{ gridTemplateColumns: COLS }}>
                        <div>{t("Scripts")}</div>
                        <div>{t("Status")}</div>
                        <div className="num">{t("Ver.")}</div>
                        <div>{t("Owner")}</div>
                        <div>{t("Edited")}</div>
                        <div></div>
                      </div>

                      {scripts.map((s) => {
                        /* Where it came from, when it came from somewhere: the
                           project it is the script of, what that project's
                           topic came from, and the backlog topic. */
                        const meta = [
                          s.projectTitle && s.projectTitle !== s.title ? `${t("Project")} · ${s.projectTitle}` : null,
                          s.sourceLabel,
                          s.topicTitle && s.topicTitle !== s.title ? `${t("From the topic")} · ${s.topicTitle}` : null,
                          s.targetChannel,
                          s.aspect,
                        ]
                          .filter((x): x is string => !!x)
                          .join(" · ");
                        const st = STATUS[s.status];
                        return (
                          <div
                            key={s.id}
                            className="tr"
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpen(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onOpen(s.id);
                              }
                            }}
                            style={{ gridTemplateColumns: COLS, height: 54, cursor: "pointer" }}
                          >
                            <div style={{ gap: 11 }}>
                              <div style={{ width: 26, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                                <PageIcon status={s.status} width={21} />
                              </div>
                              <button
                                type="button"
                                onClick={() => onOpen(s.id)}
                                title={s.title}
                                style={{
                                  minWidth: 0,
                                  flexGrow: 1,
                                  textAlign: "left",
                                  border: 0,
                                  background: "transparent",
                                  padding: 0,
                                  fontFamily: "inherit",
                                  letterSpacing: "inherit",
                                  cursor: "pointer",
                                }}
                              >
                                <span className="el" style={{ color: "#171717", fontWeight: 500, fontSize: 12.5 }}>
                                  {s.title}
                                </span>
                                {meta === "" ? null : (
                                  <span className="el cap" style={{ marginTop: 2 }}>
                                    {meta}
                                  </span>
                                )}
                              </button>
                            </div>
                            <div>
                              <span className={`bd ${st.badge}`} style={{ gap: 4 }}>
                                {s.status === "locked" ? (
                                  <svg
                                    viewBox="0 0 24 24"
                                    style={{
                                      width: 10,
                                      height: 10,
                                      stroke: "currentColor",
                                      fill: "none",
                                      strokeWidth: 2.2,
                                      strokeLinecap: "round",
                                      strokeLinejoin: "round",
                                    }}
                                  >
                                    <path d="M6.8 10.5h10.4v8H6.8z" />
                                    <path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5" />
                                  </svg>
                                ) : null}
                                {t(st.label)}
                              </span>
                            </div>
                            <div className="num">{s.version > 0 ? `v${count(s.version, locale)}` : "–"}</div>
                            <div style={{ gap: 8 }}>
                              {s.ownerName === null ? (
                                <span style={{ color: "#c7c7c7" }}>–</span>
                              ) : (
                                <>
                                  <PersonAvatar
                                    className="av"
                                    id={s.ownerId}
                                    url={s.ownerAvatar}
                                    name={s.ownerName}
                                    title={s.ownerName}
                                    size={18}
                                    style={{ fontSize: 9 }}
                                  />
                                  <span className="el">{s.ownerName}</span>
                                </>
                              )}
                            </div>
                            <div style={{ color: "#7c7c7c" }} title={fullStamp(s.updatedAt, locale)}>
                              {edited(s.updatedAt, locale)}
                            </div>
                            <div style={{ padding: "0 5px", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="act ptog"
                                onClick={() => onDelete(s.id)}
                                aria-label={`${t("Delete script")} ${s.title}`}
                                title={t("Delete script")}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="cap" style={{ margin: "14px 0 18px" }}>
                      {footer}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* The artboard's right-hand column. Its scripted conversation is not
          drawn; what is left is the one thing this screen can say from its
          own rows, which is what is waiting and for how long. */}
      <ResearchAgentPanel
        accent={ACCENT}
        zh={zh}
        scope={
          zh
            ? `${scripts.length} 个脚本 · ${counts.awaiting} 个待批准`
            : `${scripts.length} scripts · ${counts.awaiting} awaiting approval`
        }
        note={agentNote}
        placeholder={zh ? "询问这些脚本…" : "Ask about these scripts…"}
        model={model}
        onAsk={onAsk}
        thread={thread}
        tools={tools}
      />
      </div>
    </>
  );
}
