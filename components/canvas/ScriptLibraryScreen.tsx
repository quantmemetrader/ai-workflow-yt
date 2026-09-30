"use client";

import * as React from "react";
import { FolderRail, type RailSection } from "@/components/projects/FolderRail";
import type { Proposals } from "@/lib/agents/proposals";
import { ResearchAgentPanel } from "./ResearchAgentPanel";
import type { ScriptListItem } from "@/lib/script/service";
import { PersonAvatar } from "@/components/ui/PersonAvatar";

/**
 * 脚本 — the script library, drawn like a drive (Ryan, 29 Sep: "more like
 * google drive … more intuitive").
 *
 * One way to browse: the folder column on the left (全部脚本, one folder per
 * project, the studio's own folders, 未归入项目) with a big 「新建」 on top; a
 * breadcrumb 「脚本 › 项目名」 across the top; and ONE row of filters, where
 * the old three layers were (the scope tabs, the status chips, the folders).
 * Grid tiles and list rows open a script on click and give 打开 / 重命名 /
 * 移到文件夹 / 分享 / 删除 on right-click or on their 「⋯」 — each only where
 * the server has that action for that script (a project's script is renamed
 * with its project and stays in the project's folder; a loose one moves
 * between the studio's folders).
 *
 * The pane under the filters is a size container: narrowed by the folder
 * column and the assistant column (at 1024 it is about 330px), the list drops
 * the owner column and the grid drops to fewer tiles, and nothing overflows.
 */

export type ScriptLibraryScreenProps = {
  locale: string;
  scripts: ScriptListItem[];
  /** What 编剧 suggests writing next (kept for the page contract; not drawn). */
  proposals?: Proposals;
  folders: { id: string; name: string; count: number }[];
  /** Counts in the folder that is open, before the filter row is applied. */
  counts: { all: number; brief: number; drafting: number; awaiting: number; locked: number; mine?: number; waitingMe?: number };
  /** null = no own folder open */
  folderId: string | null;
  /** null = no status filter */
  status: ScriptListItem["status"] | null;
  sort: "updated" | "title" | "status";
  view: "list" | "grid";
  /** "topics" is the 选题 queue */
  scope: "all" | "mine" | "awaiting" | "shared" | "topics";
  /** The 选题 queue, drawn in place of the list when `scope` is "topics". */
  topicsView?: React.ReactNode;
  topicCount?: number | null;
  query: string;
  pending: boolean;
  error: string | null;

  onOpen: (scriptId: string) => void;
  /** One folder per project, 未归入项目 and the total; absent draws no folder column. */
  tree?: { projects: { id: string; title: string; count: number; updatedAt: string }[]; unassigned: number; total: number };
  /** The project folder open ("none" for 未归入项目), null for none. */
  projectId?: string | null;
  /** Change what is shown: `project`, `folder`, `status`, `scope`, `q` in one step (null clears). */
  onNav: (patch: Record<string, string | null>) => void;
  onMove?: (scriptId: string, folderId: string | null) => void;
  onRename?: (script: ScriptListItem) => void;
  onShare?: (script: ScriptListItem) => void;
  onSort: (sort: ScriptLibraryScreenProps["sort"]) => void;
  onView: (view: "list" | "grid") => void;
  onNewScript: () => void;
  onNewFolder: () => void;
  onDelete: (scriptId: string) => void;
  /** The model the right-hand panel names under its composer. */
  model: string;
  onAsk: (prompt: string, files?: string[]) => void;
  thread?: React.ReactNode;
  tools?: React.ReactNode;
};

type Status = ScriptListItem["status"];

const ACCENT = "#007be0";

function daysSince(d: Date): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

/* --------------------------------------------------------------------- css */

const CSS = `
[data-script-library-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-script-library-screen] * { box-sizing: border-box; }
[data-script-library-screen] button { font-family: inherit; letter-spacing: inherit; }
[data-script-library-screen] .folder-rail { width: 220px !important; }
@media (max-width: 1180px) { [data-script-library-screen] .folder-rail { width: 188px !important; } }

[data-script-library-screen] .sl-bar { min-height: 56px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 20px; min-width: 0; }
[data-script-library-screen] .sl-crumb { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 200px; min-height: 34px; }
[data-script-library-screen] .sl-crumb button { border: 0; background: transparent; padding: 4px 6px; margin: 0 -6px; border-radius: 7px; font-size: 16px; color: #6b6b6b; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
[data-script-library-screen] .sl-crumb button:hover { background: #f3f3f1; color: #171717; }
[data-script-library-screen] .sl-crumb .here { font-size: 16px; font-weight: 600; color: #171717; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-script-library-screen] .sl-open { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border: 1px solid #e2e2e2; border-radius: 8px; font-size: 12.5px; color: #383838; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
[data-script-library-screen] .sl-open:hover { background: #f7f7f7; }
[data-script-library-screen] .sl-search { flex: 0 1 220px; min-width: 150px; height: 34px; border: 1px solid #ececea; border-radius: 17px; background: #f5f5f3; display: flex; align-items: center; gap: 7px; padding: 0 12px; }
[data-script-library-screen] .sl-search:focus-within { background: #fff; border-color: #cfcfcc; }
[data-script-library-screen] .sl-search input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; font-size: 13px; font-family: inherit; color: #171717; }
[data-script-library-screen] .seg { width: 32px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 0; padding: 0; }
[data-script-library-screen] .seg svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

[data-script-library-screen] .sl-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; flex-shrink: 0; }
[data-script-library-screen] .fc { height: 30px; padding: 0 11px; border-radius: 15px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #454545; border: 1px solid #e4e4e1; background: #fff; white-space: nowrap; cursor: pointer; }
[data-script-library-screen] .fc b { font-weight: 500; color: #9a9a9a; font-size: 12px; }
[data-script-library-screen] .fc:not(.on):hover { background: #f5f5f3; }
[data-script-library-screen] .fc.on { background: #171717; border-color: #171717; color: #fff; }
[data-script-library-screen] .fc.on b { color: #c7c7c7; }
[data-script-library-screen] .fc .alert { color: #fff; background: #e03636; border-radius: 9px; padding: 0 6px; line-height: 17px; font-size: 11px; }
[data-script-library-screen] .sl-div { width: 1px; height: 18px; background: #e4e4e1; margin: 0 4px; }
[data-script-library-screen] .dot { width: 7px; height: 7px; border-radius: 4px; flex-shrink: 0; }
[data-script-library-screen] .sl-sort { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #8a8a8a; white-space: nowrap; }
[data-script-library-screen] .sl-sort select { height: 30px; border: 1px solid #e4e4e1; border-radius: 8px; background: #fff; color: #171717; font-family: inherit; font-size: 12.5px; padding: 0 6px; cursor: pointer; }

[data-script-library-screen] .sl-pane { container-type: inline-size; container-name: slpane; }
[data-script-library-screen] .sl-lbl { font-size: 12.5px; font-weight: 600; color: #6b6b6b; margin: 2px 2px 10px; }

/* grid */
[data-script-library-screen] .sl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(156px, 1fr)); gap: 12px; }
[data-script-library-screen] .sl-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 8px 10px; border-radius: 12px; border: 1px solid #ecebe7; background: #fff; min-width: 0; cursor: pointer; transition: background .12s ease, border-color .12s ease; outline: none; }
[data-script-library-screen] .sl-tile:hover { background: #f7f9fc; border-color: #d9e2ef; }
[data-script-library-screen] .sl-tile:focus-visible { border-color: #007be0; box-shadow: 0 0 0 2px rgba(0,123,224,.18); }
[data-script-library-screen] .sl-art { height: 62px; display: flex; align-items: flex-end; justify-content: center; }
[data-script-library-screen] .sl-name { width: 100%; text-align: center; font-size: 13px; line-height: 1.4; height: 2.8em; color: #171717; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
[data-script-library-screen] .sl-meta { width: 100%; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 11.5px; color: #8a8a8a; min-width: 0; }
[data-script-library-screen] .sl-meta .dot { width: 6px; height: 6px; }
[data-script-library-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

/* list */
[data-script-library-screen] .sl-hd, [data-script-library-screen] .sl-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 140px 104px 40px; align-items: center; }
[data-script-library-screen] .sl-hd { height: 36px; border-bottom: 1px solid #ededed; }
[data-script-library-screen] .sl-hd > * { font-size: 12px; font-weight: 500; color: #7c7c7c; padding: 0 10px; white-space: nowrap; }
[data-script-library-screen] .sl-row { min-height: 54px; border-bottom: 1px solid #f1f1ef; cursor: pointer; transition: background .12s ease; outline: none; }
[data-script-library-screen] .sl-row:hover { background: #f7f9fc; }
[data-script-library-screen] .sl-row:focus-visible { background: #eef5fd; }
[data-script-library-screen] .sl-row > * { font-size: 13px; color: #383838; padding: 0 10px; min-width: 0; display: flex; align-items: center; }
@container slpane (max-width: 640px) {
  [data-script-library-screen] .sl-div { display: none; }
  [data-script-library-screen] .sl-hd, [data-script-library-screen] .sl-row { grid-template-columns: minmax(0, 1fr) 82px 78px 36px; }
  [data-script-library-screen] .sl-owner { display: none !important; }
  [data-script-library-screen] .sl-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
}
@container slpane (max-width: 380px) {
  [data-script-library-screen] .sl-hd, [data-script-library-screen] .sl-row { grid-template-columns: minmax(0, 1fr) 76px 34px; }
  [data-script-library-screen] .sl-when { display: none !important; }
}
[data-script-library-screen] .bd { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 500; white-space: nowrap; }
[data-script-library-screen] .gray { background: #f3f3f3; color: #525252 }
[data-script-library-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-script-library-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-script-library-screen] .amb  { background: #fff4df; color: #b86200 }
[data-script-library-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-script-library-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }

/* the 「⋯」 on a row or tile: always there for the keyboard, shown on hover */
[data-script-library-screen] .more { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: #6b6b6b; cursor: pointer; opacity: 0; transition: opacity .12s ease, background .12s ease; flex-shrink: 0; }
[data-script-library-screen] .more:hover { background: #ebebe8; color: #171717; }
[data-script-library-screen] .sl-row:hover .more, [data-script-library-screen] .sl-row:focus-within .more,
[data-script-library-screen] .sl-tile:hover .more, [data-script-library-screen] .sl-tile:focus-within .more,
[data-script-library-screen] .more:focus-visible, [data-script-library-screen] .more[aria-expanded="true"] { opacity: 1; }
@media (hover: none) { [data-script-library-screen] .more { opacity: 1; } }

/* 新建 and its menu, and the right-click menu */
[data-script-library-screen] .sl-new { display: inline-flex; align-items: center; gap: 10px; height: 46px; padding: 0 20px 0 16px; border: 0; border-radius: 16px; background: #fff; color: #171717; font-size: 14.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.08); transition: box-shadow .15s ease, background .15s ease; }
[data-script-library-screen] .sl-new:hover { background: #f7f9fc; box-shadow: 0 1px 3px rgba(0,0,0,.16), 0 4px 12px rgba(0,0,0,.1); }
.sl-menu { position: fixed; z-index: 120; min-width: 188px; max-width: 260px; padding: 6px; background: #fff; border: 1px solid #e6e6e3; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.14); font-family: Inter, 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif; }
.sl-menu button { display: flex; align-items: center; gap: 10px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; font-family: inherit; font-size: 13.5px; color: #262626; cursor: pointer; text-align: left; white-space: nowrap; }
.sl-menu button:hover, .sl-menu button:focus-visible { background: #f3f5f8; outline: none; }
.sl-menu button.danger { color: #d12c2c; }
.sl-menu button.danger:hover { background: #fdeeee; }
.sl-menu button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sl-menu svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.sl-menu hr { border: 0; border-top: 1px solid #efefec; margin: 5px 4px; }
.sl-menu .sub { padding-left: 26px; }
`;

/* ------------------------------------------------------------------ format */

function relative(d: Date, locale: string): string {
  const seconds = (new Date(d).getTime() - Date.now()) / 1000;
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

/** "3小时前" inside a week, "9月28日" after. */
function edited(value: Date, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return Math.abs(Date.now() - d.getTime()) < 7 * 86400000 ? relative(d, locale) : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

function fullStamp(value: Date, locale: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** The same words the script page uses (待写 · 未批准 · 待审批 · 已批准). */
const STATUS: Record<Status, { dot: string; badge: string; zh: string; en: string }> = {
  brief: { dot: "#c7c7c7", badge: "gray", zh: "待写", en: "To write" },
  drafting: { dot: "#007be0", badge: "blue", zh: "未批准", en: "Not approved" },
  awaiting_approval: { dot: "#db7706", badge: "amb", zh: "待审批", en: "In review" },
  locked: { dot: "#278f5e", badge: "grn", zh: "已批准", en: "Approved" },
  archived: { dot: "#c7c7c7", badge: "gray", zh: "已归档", en: "Archived" },
};

/** A native tooltip only where the text is actually cut off. */
function tipIfCut(e: React.MouseEvent<HTMLElement>, text: string) {
  const el = e.currentTarget.querySelector<HTMLElement>("[data-cut]") ?? e.currentTarget;
  const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  e.currentTarget.title = cut ? text : "";
}

/* ------------------------------------------------------------------- icons */

function FolderTile() {
  return (
    <svg viewBox="0 0 60 46" width="54" height="42" style={{ display: "block", flexShrink: 0, filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,.14))" }}>
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

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

const MENU_ICONS: Record<string, React.ReactNode> = {
  open: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
  rename: <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 8.5l3 3" />,
  move: <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1zM10 13h5.5M13 10.5l2.5 2.5-2.5 2.5" />,
  share: <path d="M8.5 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19.5a5 5 0 0 1 10 0M16 8v6M13 11h6" />,
  trash: <path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5" />,
  script: <path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M9.5 12h6M9.5 15.5h4" />,
  folder: <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1zM12 10.5v5M9.5 13h5" />,
};
const MI = ({ k }: { k: string }) => <svg viewBox="0 0 24 24" aria-hidden>{MENU_ICONS[k]}</svg>;

/* ----------------------------------------------------------------- menus */

type MenuItem = { key: string; label: string; icon?: string; danger?: boolean; sub?: boolean; run: () => void } | "hr";

/** A small menu at a point on the screen, kept inside the window. */
function PopMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState({ left: x, top: y });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y, items.length]);
  React.useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const bs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
      }
    };
    const away = () => onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="sl-menu" role="menu" aria-label={label} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === "hr" ? (
          <hr key={`hr${i}`} />
        ) : (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            className={[it.danger ? "danger" : "", it.sub ? "sub" : ""].join(" ").trim() || undefined}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon ? <MI k={it.icon} /> : null}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/* --------------------------------------------------------------- component */

export function ScriptLibraryScreen(props: ScriptLibraryScreenProps): React.JSX.Element {
  const {
    locale,
    scripts,
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
    tree,
    projectId = null,
    onNav,
    onMove,
    onRename,
    onShare,
    onSort,
    onView,
    onNewScript,
    onNewFolder,
    onDelete,
    model,
    onAsk,
    thread,
    tools,
  } = props;

  const zh = locale.startsWith("zh");
  const t = (a: string, b: string) => (zh ? a : b);
  const n = (v: number) => new Intl.NumberFormat(locale).format(v);

  /* The search box types locally and follows the URL after a pause, so a
     keystroke is not a navigation. */
  const [q, setQ] = React.useState(query);
  const [urlQ, setUrlQ] = React.useState(query);
  if (urlQ !== query) {
    /* The URL moved on its own (a folder, 清除筛选): the box follows. */
    setUrlQ(query);
    setQ(query);
  }
  React.useEffect(() => {
    if (q === query) return;
    const id = window.setTimeout(() => onNav({ q: q.trim() || null }), 280);
    return () => window.clearTimeout(id);
  }, [q, query, onNav]);

  const [menu, setMenu] = React.useState<{ x: number; y: number; items: MenuItem[]; label: string } | null>(null);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const closeMenu = React.useCallback(() => {
    setMenu(null);
    setMenuFor(null);
  }, []);

  const agentNote = React.useMemo(() => {
    if (scripts.length === 0) return t("这里还没有脚本。", "There are no scripts here yet.");
    const waiting = scripts.filter((s) => s.status === "awaiting_approval");
    const stale = scripts.filter((s) => s.status === "drafting" && daysSince(s.updatedAt) >= 7);
    const parts: string[] = [];
    if (waiting.length) {
      const longest = waiting.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
      const d = daysSince(longest.updatedAt);
      parts.push(
        zh
          ? `${waiting.length} 个脚本在等审阅，最久的是《${longest.title}》，${d <= 0 ? "今天" : `${d} 天`}。`
          : `${waiting.length} waiting for review. The longest is “${longest.title}”, ${d <= 0 ? "since today" : `${d} days`}.`,
      );
    }
    if (stale.length) parts.push(zh ? `${stale.length} 个草稿超过一周没改。` : `${stale.length} drafts untouched for over a week.`);
    if (!parts.length) parts.push(t("没有卡住的脚本。", "Nothing is stuck."));
    return parts.join(zh ? "" : " ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts, zh]);

  const ownFolder = folders.find((f) => f.id === folderId) ?? null;
  const project = projectId && projectId !== "none" ? (tree?.projects.find((p) => p.id === projectId) ?? null) : null;
  const where = projectId === "none" ? t("未归入项目", "Not in a project") : project ? project.title : ownFolder ? ownFolder.name : null;
  const filtered = query.trim() !== "" || status !== null || scope !== "all";
  const atRoot = where === null;
  const topics = scope === "topics" && Boolean(topicsView);

  /* ---------------------------------------------------- the one filter row */
  type Chip = { key: string; label: string; n?: number | null; dot?: string; alert?: boolean; on: boolean; go: Record<string, string | null>; keep?: boolean };
  const statusChip = (s: Status, v: number): Chip => ({ key: s, label: zh ? STATUS[s].zh : STATUS[s].en, n: v, dot: STATUS[s].dot, on: status === s, go: { status: s, scope: null } });
  const chips: (Chip | "div")[] = [
    { key: "all", label: t("全部", "All"), n: counts.all, on: status === null && scope === "all", go: { status: null, scope: null }, keep: true },
    statusChip("brief", counts.brief),
    statusChip("drafting", counts.drafting),
    statusChip("awaiting_approval", counts.awaiting),
    statusChip("locked", counts.locked),
    "div",
    { key: "mine", label: t("我负责的", "Mine"), n: counts.mine ?? null, on: scope === "mine", go: { scope: "mine", status: null } },
    { key: "awaiting", label: t("等我批准", "Waiting on me"), n: counts.waitingMe ?? null, alert: true, on: scope === "awaiting", go: { scope: "awaiting", status: null } },
    { key: "shared", label: t("共享给我的", "Shared with me"), on: scope === "shared", go: { scope: "shared", status: null }, keep: true },
    ...(topicsView ? [{ key: "topics", label: t("选题", "Topics"), n: topicCount ?? null, on: scope === "topics", go: { scope: "topics", status: null } } as Chip] : []),
  ];
  /* A chip with nothing behind it is noise; it stays while it is the one on. */
  const shownChips = chips.filter((c) => c === "div" || c.keep || c.on || (typeof c.n === "number" ? c.n > 0 : true));

  /* ------------------------------------------------ what a script offers */
  function itemsFor(s: ScriptListItem): MenuItem[] {
    const items: MenuItem[] = [{ key: "open", label: t("打开", "Open"), icon: "open", run: () => onOpen(s.id) }];
    if (s.projectId && onRename) items.push({ key: "rename", label: t("重命名", "Rename"), icon: "rename", run: () => onRename(s) });
    if (!s.projectId && onMove && (folders.length > 0 || s.folderId)) {
      for (const f of folders)
        if (f.id !== s.folderId) items.push({ key: `mv-${f.id}`, label: zh ? `移到「${f.name}」` : `Move to “${f.name}”`, icon: "move", run: () => onMove(s.id, f.id) });
      if (s.folderId) items.push({ key: "mv-out", label: t("移出文件夹", "Take out of the folder"), icon: "move", run: () => onMove(s.id, null) });
    }
    if (s.projectId && onShare) items.push({ key: "share", label: t("分享", "Share"), icon: "share", run: () => onShare(s) });
    items.push("hr", { key: "delete", label: t("删除", "Delete"), icon: "trash", danger: true, run: () => onDelete(s.id) });
    return items;
  }
  function openMenu(s: ScriptListItem, x: number, y: number) {
    setMenuFor(s.id);
    setMenu({ x, y, items: itemsFor(s), label: s.title });
  }
  const onContext = (s: ScriptListItem) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(s, e.clientX, e.clientY);
  };
  const onMore = (s: ScriptListItem) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    if (menuFor === s.id) return closeMenu();
    openMenu(s, r.right - 190, r.bottom + 4);
  };
  const keyOpen = (s: ScriptListItem) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(s.id);
    }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(s, r.left + 24, r.top + 24);
    }
  };
  const drag = (s: ScriptListItem) =>
    !s.projectId && onMove
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/x-script-id", s.id);
            e.dataTransfer.effectAllowed = "move";
          },
        }
      : {};

  const sorted = React.useMemo(() => {
    const out = [...scripts];
    if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title, locale));
    else if (sort === "status") {
      const order: Status[] = ["awaiting_approval", "drafting", "brief", "locked", "archived"];
      out.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    } else out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return out;
  }, [scripts, sort, locale]);

  /* -------------------------------------------------------------- 新建 */
  const [newOpen, setNewOpen] = React.useState<{ x: number; y: number } | null>(null);
  const newButton = (
    <div style={{ padding: "2px 4px 16px" }}>
      <button
        type="button"
        className="sl-new"
        aria-haspopup="menu"
        aria-expanded={newOpen !== null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setNewOpen((v) => (v ? null : { x: r.left, y: r.bottom + 6 }));
        }}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t("新建", "New")}
      </button>
    </div>
  );

  const railSections: RailSection[] = [];
  if (tree) {
    railSections.push({
      folders: [{ key: "all", kind: "all", label: t("全部脚本", "All scripts"), count: tree.total, active: atRoot, onClick: () => onNav({ project: null, folder: null, scope: null, status: null, q: null }) }],
    });
    if (tree.projects.length)
      railSections.push({
        title: t("项目", "Projects"),
        folders: tree.projects.map((p) => ({ key: p.id, kind: "project" as const, label: p.title, count: p.count, active: projectId === p.id, onClick: () => onNav({ project: p.id, folder: null }) })),
      });
    railSections.push({
      title: folders.length ? t("我的文件夹", "My folders") : undefined,
      folders: [
        ...folders.map((f) => ({ key: f.id, kind: "own" as const, label: f.name, count: f.count, active: !projectId && folderId === f.id, onClick: () => onNav({ folder: f.id, project: null }), onDrop: onMove ? (sid: string) => onMove(sid, f.id) : undefined })),
        { key: "none", kind: "loose" as const, label: t("未归入项目", "Not in a project"), count: tree.unassigned, active: projectId === "none", onClick: () => onNav({ project: "none", folder: null }), onDrop: onMove ? (sid: string) => onMove(sid, null) : undefined },
      ],
    });
  }

  /* ------------------------------------------------------------ empties */
  const empty = (
    <div style={{ padding: "36px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{filtered ? t("没有符合的脚本", "No scripts match") : t("这里还没有脚本", "No scripts here yet")}</div>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
        {filtered ? (
          <button type="button" className="fc" onClick={() => { setQ(""); onNav({ q: null, status: null, scope: null }); }}>
            {t("清除筛选", "Clear the filters")}
          </button>
        ) : (
          <button type="button" className="fc on" onClick={onNewScript}>
            {t("新建脚本", "New script")}
          </button>
        )}
      </div>
    </div>
  );

  /* ------------------------------------------------------------- render */
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }} focusable="false">
        <defs>
          <linearGradient id="sl-mfold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fcdf9" />
            <stop offset="1" stopColor="#5eacee" />
          </linearGradient>
        </defs>
      </svg>

      <div data-script-library-screen="" style={{ flexGrow: 1, display: "flex", minWidth: 0, minHeight: 0 }}>
        {tree ? <FolderRail header={newButton} sections={railSections} /> : null}

        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {/* breadcrumb · search · view */}
          <div className="sl-bar">
            <div className="sl-crumb">
              {atRoot ? (
                <span className="here">{t("脚本", "Scripts")}</span>
              ) : (
                <>
                  <button type="button" onClick={() => onNav({ project: null, folder: null })}>
                    {t("脚本", "Scripts")}
                  </button>
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#b5b5b1" strokeWidth={2} strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
                    <path d="m9.5 5.5 6 6.5-6 6.5" />
                  </svg>
                  <span className="here" title={where ?? undefined}>
                    {where}
                  </span>
                </>
              )}
              {project ? (
                <a className="sl-open" href={`/projects/${project.id}`} style={{ marginLeft: 6 }}>
                  {t("打开项目", "Open project")}
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                    <path d="m9.5 5.5 6 6.5-6 6.5" />
                  </svg>
                </a>
              ) : null}
            </div>

            <label className="sl-search">
              <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="#8a8a8a" strokeWidth={1.9} strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="6.4" />
                <path d="m15.8 15.8 4 4" />
              </svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("搜索脚本", "Search scripts")} placeholder={t("搜索脚本", "Search scripts")} />
            </label>

            <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "#f3f3f1", flexShrink: 0 }}>
              {(["list", "grid"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="seg"
                  onClick={() => onView(v)}
                  aria-pressed={view === v}
                  aria-label={v === "list" ? t("列表", "List") : t("网格", "Grid")}
                  style={{ background: view === v ? "#fff" : "transparent", color: view === v ? "#171717" : "#7c7c7c", boxShadow: view === v ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}
                >
                  {v === "list" ? (
                    <svg viewBox="0 0 24 24">
                      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
                      <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <rect x="4.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
                      <rect x="13.2" y="4.2" width="6.6" height="6.6" rx="1.6" />
                      <rect x="4.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
                      <rect x="13.2" y="13.2" width="6.6" height="6.6" rx="1.6" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div
            className="sl-pane"
            aria-busy={pending}
            style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: "14px 20px 0", overflowY: "auto", overflowX: "hidden", opacity: pending ? 0.6 : 1, transition: "opacity .12s ease" }}
          >
            <div className="sl-filters">
              {shownChips.map((c, i) =>
                c === "div" ? (
                  <span key={`d${i}`} className="sl-div" aria-hidden />
                ) : (
                  <button key={c.key} type="button" className={c.on ? "fc on" : "fc"} aria-pressed={c.on} onClick={() => onNav(c.go)}>
                    {c.dot ? <span className="dot" style={{ background: c.dot }} /> : null}
                    {c.label}
                    {typeof c.n === "number" && c.n > 0 ? c.alert && !c.on ? <b className="alert">{n(c.n)}</b> : <b>{n(c.n)}</b> : null}
                  </button>
                ),
              )}
              {topics ? null : (
                <label className="sl-sort">
                  {t("排序", "Sort")}
                  <select value={sort} onChange={(e) => onSort(e.target.value as ScriptLibraryScreenProps["sort"])}>
                    <option value="updated">{t("最近编辑", "Last edited")}</option>
                    <option value="title">{t("名称", "Name")}</option>
                    <option value="status">{t("状态", "Status")}</option>
                  </select>
                </label>
              )}
            </div>

            {error === null ? null : (
              <div className="bd red" style={{ height: "auto", padding: "8px 10px", marginBottom: 12, whiteSpace: "normal", flexShrink: 0 }}>
                {error}
              </div>
            )}

            {topics ? (
              topicsView
            ) : view === "grid" ? (
              <>
                {atRoot && !filtered && folders.length > 0 ? (
                  <>
                    <div className="sl-lbl">{t("文件夹", "Folders")}</div>
                    <div className="sl-grid" style={{ marginBottom: 22 }}>
                      {folders.map((f) => (
                        <button key={f.id} type="button" className="sl-tile" onClick={() => onNav({ folder: f.id, project: null })} onMouseEnter={(e) => tipIfCut(e, f.name)}>
                          <span className="sl-art">
                            <FolderTile />
                          </span>
                          <span className="sl-name" data-cut="">
                            {f.name}
                          </span>
                          <span className="sl-meta">{zh ? `${n(f.count)} 个脚本` : `${n(f.count)} scripts`}</span>
                        </button>
                      ))}
                    </div>
                    <div className="sl-lbl">{t("脚本", "Scripts")}</div>
                  </>
                ) : null}
                {sorted.length === 0 ? (
                  empty
                ) : (
                  <div className="sl-grid">
                    {sorted.map((s) => (
                      <div
                        key={s.id}
                        className="sl-tile"
                        role="button"
                        tabIndex={0}
                        aria-label={s.title}
                        onClick={() => onOpen(s.id)}
                        onKeyDown={keyOpen(s)}
                        onContextMenu={onContext(s)}
                        onMouseEnter={(e) => tipIfCut(e, s.title)}
                        {...drag(s)}
                      >
                        <span className="sl-art">
                          <PageIcon status={s.status} width={42} />
                        </span>
                        <span className="sl-name" data-cut="">
                          {s.title}
                        </span>
                        <span className="sl-meta">
                          <span className="dot" style={{ background: STATUS[s.status].dot }} />
                          <span className="el">
                            {zh ? STATUS[s.status].zh : STATUS[s.status].en} · {edited(s.updatedAt, locale)}
                          </span>
                        </span>
                        <button type="button" className="more" aria-label={t("更多操作", "More")} aria-haspopup="menu" aria-expanded={menuFor === s.id} onClick={onMore(s)} style={{ position: "absolute", top: 4, right: 4 }}>
                          <MoreIcon />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : sorted.length === 0 ? (
              empty
            ) : (
              <div role="table" aria-label={t("脚本", "Scripts")}>
                <div className="sl-hd" role="row">
                  <div role="columnheader">{t("名称", "Name")}</div>
                  <div role="columnheader">{t("状态", "Status")}</div>
                  <div role="columnheader" className="sl-owner">
                    {t("负责人", "Owner")}
                  </div>
                  <div role="columnheader" className="sl-when">
                    {t("最近编辑", "Last edited")}
                  </div>
                  <div />
                </div>
                {sorted.map((s) => {
                  const st = STATUS[s.status];
                  const meta = s.projectTitle && s.projectTitle !== s.title && !project ? s.projectTitle : null;
                  return (
                    <div key={s.id} className="sl-row" role="row" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={keyOpen(s)} onContextMenu={onContext(s)} {...drag(s)}>
                      <div role="cell" style={{ gap: 11 }} onMouseEnter={(e) => tipIfCut(e, s.title)}>
                        <span style={{ width: 24, display: "flex", justifyContent: "center", flexShrink: 0 }}>
                          <PageIcon status={s.status} width={20} />
                        </span>
                        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="el" data-cut="" style={{ color: "#171717", fontWeight: 500, fontSize: 13.5 }}>
                            {s.title}
                          </span>
                          {meta ? (
                            <span className="el" style={{ fontSize: 12, color: "#9a9a9a" }}>
                              {meta}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div role="cell">
                        <span className={`bd ${st.badge}`}>{zh ? st.zh : st.en}</span>
                      </div>
                      <div role="cell" className="sl-owner" style={{ gap: 8 }}>
                        {s.ownerName === null ? (
                          <span style={{ color: "#c7c7c7" }}>–</span>
                        ) : (
                          <>
                            <PersonAvatar className="av" id={s.ownerId} url={s.ownerAvatar} name={s.ownerName} size={20} style={{ fontSize: 9 }} />
                            <span className="el">{s.ownerName}</span>
                          </>
                        )}
                      </div>
                      <div role="cell" className="sl-when" style={{ color: "#7c7c7c", whiteSpace: "nowrap" }} title={fullStamp(s.updatedAt, locale)}>
                        <span className="el">{edited(s.updatedAt, locale)}</span>
                      </div>
                      <div role="cell" style={{ justifyContent: "flex-end", padding: "0 6px" }}>
                        <button type="button" className="more" aria-label={t("更多操作", "More")} aria-haspopup="menu" aria-expanded={menuFor === s.id} onClick={onMore(s)}>
                          <MoreIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!topics && sorted.length > 0 ? (
              <div style={{ margin: "16px 2px 20px", fontSize: 12, color: "#9a9a9a" }}>{zh ? `共 ${n(sorted.length)} 个` : `${n(sorted.length)} scripts`}</div>
            ) : null}
          </div>
        </div>

        <ResearchAgentPanel
          accent={ACCENT}
          zh={zh}
          scope={zh ? `${scripts.length} 个脚本 · ${counts.awaiting} 个在审阅` : `${scripts.length} scripts · ${counts.awaiting} in review`}
          note={agentNote}
          placeholder={t("问问这些脚本…", "Ask about these scripts…")}
          model={model}
          attach
            onAsk={onAsk}
          thread={thread}
          tools={tools}
        />
      </div>

      {menu ? <PopMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={closeMenu} /> : null}
      {newOpen ? (
        <PopMenu
          x={newOpen.x}
          y={newOpen.y}
          label={t("新建", "New")}
          onClose={() => setNewOpen(null)}
          items={[
            { key: "script", label: t("新建脚本", "New script"), icon: "script", run: onNewScript },
            { key: "folder", label: t("新建文件夹", "New folder"), icon: "folder", run: onNewFolder },
          ]}
        />
      ) : null}
    </>
  );
}
