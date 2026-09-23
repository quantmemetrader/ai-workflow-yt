"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useResizable } from "@/components/ui/Resizer";
import { Poster, Waiting } from "@/components/files/Poster";
import { EyeOffGlyph, GlobeGlyph, PeopleGlyph, PersonGlyph, visibilityLabel } from "@/components/files/AccessPicker";
/**
 * FilesScreen — a transcription of design/canvas/FilesDesktop.dc.html.
 *
 * Everything after the artboard's 52px rail: the Files sidebar (folder tree,
 * views, storage), the toolbar, the List view of the folder, and the right-hand
 * agent panel. Markup, nesting, class names, SVG paths, pixel values and
 * colours are the artboard's; only the content is lifted into props. The
 * artboard is the source of truth — when it changes, change this file with it,
 * and do not "improve" anything here that the artboard does not do.
 *
 * The artboard renders one of three views (List / Grid / Gallery) chosen by a
 * component-local `view` prop. There is no view prop here, so this is the
 * artboard's default state: view = "list", coach card shown, nothing selected.
 */

export type FileRow = {
  id: string;
  name: string;
  /** Version number; the artboard shows "v3" in its own column. */
  version?: number;
  kind: "doc" | "sheet" | "pdf" | "image" | "video" | "audio" | "archive" | "other";
  sizeBytes: number;
  ownerName: string;
  updatedAt: string; // ISO
  durationMs?: number | null;
  posterUrl?: string | null; // thumbnail for media, if the artboard shows one
  /** 0–1 while this file's bytes are still on their way up from this
   * browser. The card then shows the progress where the poster will be,
   * rather than a broken picture. */
  uploading?: number | null;
  /** What this person holds on this file. Null when it was not read — the
   * badge then falls back to the screen-wide "can you edit here". */
  access?: "owner" | "editor" | "commenter" | "viewer" | null;
  /** Who the file itself is shared with: private shows a hidden eye. Icon
   * only on the rows; the words are in its tooltip. */
  visibility?: "private" | "everyone" | "groups" | "people";
  groups?: string[];
  userIds?: string[];
  /** Named people, for the hover card. */
  people?: { name: string; email: string }[];
  /** Whether this person may change that (its owner, or an admin). */
  canSetAccess?: boolean;
};

export type FolderRow = { id: string; name: string; count?: number };

/** The artboard's `accent` prop, at its default. */
const ACCENT = "#007be0";

/** zh-CN is the default locale (spec §4.1); English is the toggle. */
const ZH: Record<string, string> = {
  Uploading: "上传中",
  Processing: "处理中",
  Database: "数据库",
  Folders: "文件夹",
  Views: "视图",
  View: "视图",
  List: "列表",
  Grid: "网格",
  Gallery: "画廊",
  Storage: "存储",
  Name: "名称",
  Kind: "类型",
  Size: "大小",
  Version: "版本",
  Owner: "所有者",
  Modified: "修改时间",
  Access: "权限",
  Upload: "上传",
  "New folder": "新建文件夹",
  "Nothing here yet": "这里还没有内容",
  "Nothing you can see here": "这里没有你有权查看的内容",
  Agent: "助理",
  "Answers use only files you can read": "回答只会使用你有权查看的文件",
  Editor: "可编辑",
  Viewer: "可查看",
  Commenter: "可评论",
  items: "个项目",
  folder: "文件夹",
  files: "个文件",
  Files: "文件",
  "Ask about this folder…": "询问这个文件夹…",
  "Drop a file here, or press Upload": "把文件拖到这里，或点击上传",
  "Deleted files stay here for 30 days": "删除的文件会在这里保留 30 天",
  "Filter by name": "筛选名称",
  Send: "发送",
  "No folders yet": "还没有文件夹",
  Rename: "重命名",
  Restore: "恢复",
  Delete: "删除",
  "New folder makes the first one": "点击“新建文件夹”创建第一个",
};

/** The sidebar's selected treatment, the same one the folder rows use. */
function viewStyle(active: boolean): React.CSSProperties {
  return active
    ? { background: "#ffffff", boxShadow: "0px 1px 2px rgba(0,0,0,0.1)", color: "#171717", fontWeight: 500 }
    : {};
}

/**
 * The artboard's <helmet> stylesheet, verbatim except that every selector is
 * scoped to [data-files-screen] (the two roots below) so these one-letter
 * class names cannot collide with — or be overridden by — the rest of the app.
 * The rail's own rules (.r) are left out; the rail is not ours. The first rule
 * carries what the artboard's 1440x900 frame element set on the subtree.
 */

/* ------------------------------------------------------------------ format */

/** "1.8 GB", "944 MB", "14 KB" — the artboard's sizes, decimal units. */
function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value = value / 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return `${n} ${units[unit]}`;
}

/** "2 Sep" — the artboard's Modified column. */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/** "3 days ago" — carried on the Modified cell's title, so the row stays short. */
function formatRelative(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const seconds = (d.getTime() - Date.now()) / 1000;
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

/** No avatar URL on FileRow, so the artboard's 20px .av circle carries initials. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/* ------------------------------------------------------------------- icons */

/**
 * The artboard's three file glyphs, at the size it draws them inside the 68x38
 * list thumbnail: a plain document, a document with rules (its .pdf report) and
 * the audio glyph. Media with a poster never reaches here.
 */
function FileGlyph({ kind }: { kind: FileRow["kind"] }) {
  const s = {
    width: 13,
    height: 13,
    stroke: "#999999",
    fill: "none",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "audio") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path d="M12 5.5v7.8M8.6 9.2 12 5.6l3.4 3.6M5.5 14.5v3a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6v-3" />
      </svg>
    );
  }
  if (kind === "pdf" || kind === "doc" || kind === "sheet") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path d="M7 4.5h7L18 9v10.5H7z" />
        <path d="M13.6 4.5V9H18" />
        <path d="M9.6 13h5.4M9.6 16h5.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={s}>
      <path d="M7 4.5h7L18 9v10.5H7z" />
      <path d="M13.6 4.5V9H18" />
    </svg>
  );
}

function FolderGlyph({ size, stroke }: { size: number; stroke: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: size,
        height: size,
        stroke,
        fill: "none",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    >
      <path d="M4 7a2 2 0 0 1 2-2h3.6l1.8 2.2H18a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/* --------------------------------------------------------------- component */

export function FilesScreen(props: {
  breadcrumbs: { id: string; name: string }[]; // current path, root first
  folders: FolderRow[]; // child folders of the current folder
  files: FileRow[];
  sidebarFolders: FolderRow[]; // the left sidebar's folder tree (top level)
  currentFolderId: string | null;
  canEdit: boolean; // rename/delete on rows; also New folder + Upload unless canCreate says otherwise
  /** New folder and Upload. Recent, Shared and Trash are views, not folders,
   * but people still expect to add something from them; it lands in their own
   * Files. Defaults to `canEdit`. */
  canCreate?: boolean;
  uploads: { name: string; pct: number; error?: string }[];
  locale: string;
  onOpenFolder: (id: string | null) => void;
  onOpenFile: (id: string) => void;
  onUploadClick: () => void;
  onNewFolder: () => void;
  /** Which view of the store this is. Folder listings navigate; the three
   * saved views are flat lists. */
  view?: "folder" | "recent" | "shared" | "trash";
  /** Trash only: put a file back inside its recovery window. */
  onRestore?: (id: string) => void;
  /** The model actually answering, for the line under the composer. */
  model: string;
  /** Rename a file or a folder in place. A camera's filename is not a name a
   * colleague can find. Absent when this person cannot edit here. */
  onRename?: (kind: "file" | "folder", id: string, currentName: string) => void;
  /** Move a file, or a whole folder, to the trash. A folder takes what is
   * inside it — which is why the wiring layer asks first, by name. */
  onDelete?: (kind: "file" | "folder", id: string, currentName: string) => void;
  /** Change who sees a file (the eye chip on a row). Owners and admins only. */
  onSetAccess?: (file: FileRow) => void;
  /** Hands a question to the employee's agent. The answer comes back into
   * `thread`, on this screen: asking about a folder used to navigate to Chat
   * and take the folder, the selection and the scroll with it. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, rendered in the panel's thread region. */
  thread?: React.ReactNode;
  /** Which of the artboard's three views of a folder to draw. The artboard
   * chooses with a component-local prop; here the choice is the person's, and
   * their wiring layer remembers it. */
  layout?: "list" | "grid" | "gallery";
  onLayoutChange?: (next: "list" | "grid" | "gallery") => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState("");
  const { width: sideWidth, handle: sideHandle } = useResizable("files-sidebar", {
    min: 160, max: 400, initial: 208, edge: "right",
  });
  // The agent column shares one stored width across every screen that
  // draws it, so narrowing it here does not leave it wide over there.
  const { width: agentWidth, handle: agentHandle } = useResizable("agent-panel", {
    min: 220, max: 620, initial: 280, edge: "left",
  });
  const [filter, setFilter] = React.useState("");
  const {
    breadcrumbs,
    folders: allFolders,
    files: allFiles,
    sidebarFolders,
    currentFolderId,
    canEdit,
    canCreate: canCreateProp,
    uploads,
    locale,
    onOpenFolder,
    onOpenFile,
    onUploadClick,
    onNewFolder,
    model,
    onAsk,
    onRename,
    onDelete,
    onSetAccess,
    thread,
    layout = "grid",
    onLayoutChange,
    view = "folder",
    onRestore,
  } = props;
  const canCreate = canCreateProp ?? canEdit;

  const zh = props.locale.startsWith("zh");
  const t = (key: string) => (zh ? (ZH[key] ?? key) : key);
  const needle = filter.trim().toLowerCase();
  const files = needle
    ? allFiles.filter((f) => f.name.toLowerCase().includes(needle))
    : allFiles;
  const folders = needle
    ? allFolders.filter((f) => f.name.toLowerCase().includes(needle))
    : allFolders;

  const here = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null;
  const folderName = here ? here.name : t("Files");
  const onPath = new Set(breadcrumbs.map((b) => b.id));
  const totalBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  const empty = folders.length === 0 && files.length === 0;

  return (
    <>

      {/* sidebar */}
      <div
        data-files-screen=""
        style={{
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
        <div style={{ padding: "4px 8px 12px", fontSize: 14, fontWeight: 500 }}>{t("Database")}</div>
        {/* The heading carries the +, so making a folder is where folders are
            rather than only in the toolbar at the other end of the screen. */}
        <div className="lbl" style={{ marginBottom: 5, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ flexGrow: 1 }}>{t("Folders")}</span>
          {canCreate && (
            <button
              type="button"
              onClick={onNewFolder}
              aria-label={t("New folder")}
              title={t("New folder")}
              style={plusButton}
            >
              <PlusGlyph />
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {sidebarFolders.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 8px 0" }}>
              {t("No folders yet")}
            </p>
          ) : null}
          {sidebarFolders.flatMap((f) => {
            const current = f.id === currentFolderId;
            const rows = [
              <div
                key={f.id}
                className="n"
                role="button"
                tabIndex={0}
                onClick={() => onOpenFolder(f.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenFolder(f.id);
                  }
                }}
                style={
                  current
                    ? {
                        background: "#ffffff",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                        color: "#171717",
                        cursor: "pointer",
                      }
                    : onPath.has(f.id)
                      ? { color: "#171717", cursor: "pointer" }
                      : { cursor: "pointer" }
                }
              >
                <svg viewBox="0 0 24 24">
                  <path d="M4 7a2 2 0 0 1 2-2h3.6l1.8 2.2H18a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                </svg>
                <span>{f.name}</span>
                {f.count != null ? (
                  <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>{f.count}</span>
                ) : null}
              </div>,
            ];
            /* the artboard's indented children, under the folder we are in */
            if (current) {
              for (const child of folders) {
                rows.push(
                  <div
                    key={`${f.id}/${child.id}`}
                    className="n"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenFolder(child.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenFolder(child.id);
                      }
                    }}
                    style={{ paddingLeft: 24, cursor: "pointer" }}
                  >
                    <span>{child.name}</span>
                  </div>,
                );
              }
            }
            return rows;
          })}
        </div>
        <div className="lbl" style={{ margin: "14px 0 5px" }}>
          {t("Views")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Link className="n" href="/files/recent" style={viewStyle(view === "recent")}>
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l2.5 1.5" />
            </svg>
            <span>{zh ? "最近" : "Recent"}</span>
          </Link>
          <Link className="n" href="/files/shared" style={viewStyle(view === "shared")}>
            <svg viewBox="0 0 24 24">
              <circle cx="17" cy="6.5" r="2.6" />
              <circle cx="7" cy="12" r="2.6" />
              <circle cx="17" cy="17.5" r="2.6" />
              <path d="m9.4 10.7 5.2-2.9M9.4 13.3l5.2 2.9" />
            </svg>
            <span>{zh ? "共享给我的" : "Shared with me"}</span>
          </Link>
          <Link className="n" href="/files/trash" style={viewStyle(view === "trash")}>
            <svg viewBox="0 0 24 24">
              <path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5" />
            </svg>
            <span>{zh ? "回收站" : "Trash"}</span>
          </Link>
        </div>
        <div style={{ marginTop: "auto", padding: "10px 8px 4px", borderTop: "1px solid #ededed" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 11.5, color: "#999999" }}>{t("Storage")}</span>
            <span style={{ fontSize: 11.5, color: "#525252" }}>{formatBytes(totalBytes, locale)}</span>
          </div>
          {/* The artboard draws a fill against a quota. Object storage here has
              no quota, so the figure above is the whole truth and a bar would
              be decoration pretending to be data. */}
        </div>
      </div>

      {/* main */}
      <div
        data-files-screen=""
        style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
      >
        {/* toolbar */}
        <div
          style={{
            minHeight: 48,
            flexShrink: 0,
            borderBottom: "1px solid #ededed",
            display: "flex",
            alignItems: "center",
            padding: "7px 20px",
            gap: 8,
            // Wrap rather than push things off the end. The row holds
            // breadcrumbs, the view switcher, a filter box, New folder and
            // Upload, and on a narrow window with the agent panel open that is
            // wider than the column: the two buttons at the end simply were
            // not there any more.
            flexWrap: "wrap",
          }}
        >
          {breadcrumbs.flatMap((b, i) => {
            const last = i === breadcrumbs.length - 1;
            if (last) {
              return [
                <span key={b.id} style={{ fontSize: 14, fontWeight: 500 }}>
                  {b.name}
                </span>,
              ];
            }
            return [
              <span
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenFolder(b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenFolder(b.id);
                  }
                }}
                style={{ fontSize: 13, color: "#999999", cursor: "pointer" }}
              >
                {b.name}
              </span>,
              <svg
                key={`${b.id}-sep`}
                viewBox="0 0 24 24"
                style={{
                  width: 12,
                  height: 12,
                  stroke: "#c7c7c7",
                  fill: "none",
                  strokeWidth: 2,
                  strokeLinecap: "round",
                }}
              >
                <path d="m9.5 5.5 6 6.5-6 6.5" />
              </svg>,
            ];
          })}
          <div style={{ flexGrow: 1 }}></div>

          {/* List / Grid / Gallery. The artboard draws all three and only List
              was ever built, so the other two were design nobody could reach. */}
          {onLayoutChange ? (
            <div
              role="group"
              aria-label={t("View")}
              style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "#f3f3f3", flexShrink: 0 }}
            >
              {(["list", "grid", "gallery"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onLayoutChange(mode)}
                  aria-pressed={layout === mode}
                  aria-label={t(LAYOUT_LABEL[mode])}
                  title={t(LAYOUT_LABEL[mode])}
                  style={{
                    width: 26,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: 0,
                    borderRadius: 6,
                    cursor: "pointer",
                    padding: 0,
                    background: layout === mode ? "#ffffff" : "transparent",
                    boxShadow: layout === mode ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                    color: layout === mode ? "#171717" : "#999999",
                  }}
                >
                  <LayoutGlyph mode={mode} />
                </button>
              ))}
            </div>
          ) : null}

          {/* Filter: narrows the rows below by name, in both scripts. The
              artboard drew this as a button; a live box is the same affordance
              without a dialog nobody needs. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              minWidth: 0,
              padding: "0 10px",
              border: "1px solid #ededed",
              borderRadius: 8,
              background: "#ffffff",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: 13,
                height: 13,
                flexShrink: 0,
                stroke: "#7c7c7c",
                fill: "none",
                strokeWidth: 1.8,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              }}
            >
              <path d="M4.5 6h15l-6 7v5.5l-3 1.5V13z" />
            </svg>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t("Filter by name")}
              placeholder={t("Filter by name")}
              style={{
                width: 120,
                minWidth: 60,
                border: 0,
                outline: "none",
                background: "transparent",
                fontSize: 12.5,
                fontFamily: "inherit",
                letterSpacing: "inherit",
                color: "#171717",
              }}
            />
          </div>
          {canCreate ? (
            <button
              type="button"
              className="btn"
              onClick={onNewFolder}
              style={{
                flexShrink: 0,
                border: "1px solid #ededed",
                color: "#525252",
                background: "#ffffff",
                fontFamily: "inherit",
                letterSpacing: "inherit",
              }}
            >
              <FolderGlyph size={13} stroke="#7c7c7c" />
              {t("New folder")}
            </button>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              className="btn"
              onClick={onUploadClick}
              style={{
                flexShrink: 0,
                background: ACCENT,
                color: "#ffffff",
                border: 0,
                fontFamily: "inherit",
                letterSpacing: "inherit",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                style={{
                  width: 13,
                  height: 13,
                  stroke: "currentColor",
                  fill: "none",
                  strokeWidth: 2,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                }}
              >
                <path d="M12 17V6.5M7.5 11 12 6.5l4.5 4.5M5 18.5h14" />
              </svg>
              {t("Upload")}
            </button>
          ) : null}
        </div>

        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            {/* ============ LIST ============ */}
            {/* The list scrolls inside its own pane. The app frame clips its
                overflow, so without this a long folder was simply cut off
                at the bottom of the window with no way to reach the rest. */}
            <div style={{ flexGrow: 1, minHeight: 0, padding: "16px 20px", overflowY: "auto" }}>
              {/* uploads in flight — the artboard has no progress affordance, so this
                  borrows its card, its 4px track and its accent */}
              {uploads.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {uploads.map((u, n) => (
                    <div
                      key={`${n}:${u.name}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        minHeight: 36,
                        padding: "7px 11px",
                        border: "1px solid #ededed",
                        borderRadius: 8,
                        background: "#ffffff",
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        style={{
                          width: 13,
                          height: 13,
                          flexShrink: 0,
                          stroke: "#7c7c7c",
                          fill: "none",
                          strokeWidth: 1.8,
                          strokeLinecap: "round",
                          strokeLinejoin: "round",
                        }}
                      >
                        <path d="M12 17V6.5M7.5 11 12 6.5l4.5 4.5M5 18.5h14" />
                      </svg>
                      <span
                        style={{
                          fontSize: 12.5,
                          color: "#383838",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {u.name}
                      </span>
                      {u.error ? (
                        <span
                          className="bdg"
                          style={{ marginLeft: "auto", background: "#ffe7e7", color: "#e03636" }}
                        >
                          {u.error}
                        </span>
                      ) : (
                        <>
                          <div
                            style={{
                              marginLeft: "auto",
                              width: 120,
                              height: 4,
                              borderRadius: 2,
                              background: "#ededed",
                              flexShrink: 0,
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max(0, Math.min(100, u.pct))}%`,
                                height: 4,
                                borderRadius: 2,
                                background: ACCENT,
                              }}
                            ></div>
                          </div>
                          <span
                            style={{
                              fontSize: 11.5,
                              color: "#999999",
                              fontVariantNumeric: "tabular-nums",
                              flexShrink: 0,
                            }}
                          >
                            {Math.round(u.pct)}%
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {empty ? (
                /* the artboard has no empty state; this is its dashed Grid tile */
                <div
                  className="tile"
                  role={canEdit ? "button" : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onClick={canEdit ? onUploadClick : undefined}
                  onKeyDown={
                    canEdit
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onUploadClick();
                          }
                        }
                      : undefined
                  }
                  style={{
                    borderStyle: "dashed",
                    borderColor: "#e2e2e2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 168,
                    cursor: canEdit ? "pointer" : "default",
                  }}
                >
                  <div style={{ textAlign: "center", padding: "0 20px" }}>
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 22,
                        height: 22,
                        stroke: "#c7c7c7",
                        fill: "none",
                        strokeWidth: 1.8,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                        margin: "0 auto",
                      }}
                    >
                      {view === "trash" ? (
                        <path d="M5.5 7.5h13M9.5 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M7 7.5l.8 11.2h8.4L17 7.5" />
                      ) : (
                        <path d="M12 6v12M6 12h12" />
                      )}
                    </svg>
                    <div style={{ fontSize: 12.5, color: "#525252", marginTop: 8 }}>
                      {t("Nothing here yet")}
                    </div>
                    <div style={{ fontSize: 12, color: "#999999", marginTop: 4, lineHeight: 1.5 }}>
                      {view === "trash"
                        ? t("Deleted files stay here for 30 days")
                        : canEdit
                          ? t("Drop a file here, or press Upload")
                          : t("Nothing you can see here")}
                    </div>
                  </div>
                </div>
              ) : layout !== "list" ? (
                <>
                  <Tiles
                    layout={layout}
                    folders={folders}
                    files={files}
                    locale={locale}
                    onOpenFolder={onOpenFolder}
                    onOpenFile={onOpenFile}
                    onRename={onRename}
                    onDelete={onDelete}
                    onRestore={view === "trash" ? onRestore : undefined}
                    onSetAccess={view === "trash" ? undefined : onSetAccess}
                    zh={zh}
                    t={t}
                  />
                  <div style={{ marginTop: 16, fontSize: 12, color: "#999999" }}>
                    {files.length} {zh ? "个文件" : "files"} · {formatBytes(totalBytes, locale)} ·{" "}
                    {view === "trash"
                      ? zh
                        ? "30 天内可恢复"
                        : "restorable for 30 days"
                      : zh
                        ? "已按你的权限过滤"
                        : "filtered to what you can read"}
                  </div>
                </>
              ) : (
                <>
                  <div className="vg" style={{ height: 32, borderBottom: "1px solid #ededed" }}>
                    {/* The artboard's checkbox column. There are no bulk
                        actions to select rows for yet, and an empty 34px
                        column reads as something that failed to render, so it
                        numbers the rows instead. */}
                    <div className="h" style={{ justifyContent: "center" }}>#</div>
                    <div className="h">{t("Name")}</div>
                    <div className="h">{t("Kind")}</div>
                    <div className="h" style={{ justifyContent: "flex-end" }}>
                      {t("Size")}
                    </div>
                    <div className="h" style={{ justifyContent: "flex-end" }}>
                      {t("Version")}
                    </div>
                    <div className="h">{t("Owner")}</div>
                    <div className="h">{t("Modified")}</div>
                    <div className="h">{t("Access")}</div>
                  </div>

                  {folders.map((f, index) => (
                    <div
                      key={f.id}
                      className="vg"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenFolder(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenFolder(f.id);
                        }
                      }}
                      style={{ height: 56, borderBottom: "1px solid #f3f3f3", cursor: "pointer" }}
                    >
                      <div className="c" style={{ justifyContent: "center", color: "#c7c7c7", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                        {index + 1}
                      </div>
                      <div className="c" style={{ gap: 11 }}>
                        <div
                          style={{
                            width: 68,
                            height: 38,
                            borderRadius: 6,
                            background: "#f3f3f3",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <FolderGlyph size={13} stroke="#999999" />
                        </div>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.name}
                        </span>
                      </div>
                      <div className="c">
                        <span className="bdg" style={{ background: "#f3f3f3", color: "#525252" }}>
                          {t("folder")}
                        </span>
                      </div>
                      <div
                        className="c"
                        style={{ justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" }}
                      >
                        {f.count != null ? `${f.count} ${t("items")}` : ""}
                      </div>
                      <div
                        className="c"
                        style={{ justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" }}
                      ></div>
                      <div className="c" style={{ gap: 8 }}></div>
                      <div className="c" style={{ color: "#7c7c7c" }}></div>
                      <div className="c">
                        {/* Folders were the one thing on this screen with no
                            way to rename or remove them: made, then permanent. */}
                        {view === "trash" && onRestore ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore(f.id);
                            }}
                            className="bdg"
                            style={{ background: "#e6f4ff", color: ACCENT, cursor: "pointer" }}
                          >
                            {zh ? "恢复" : "Restore"}
                          </span>
                        ) : (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {onRename && (
                              <button
                                type="button"
                                title={t("Rename")}
                                aria-label={t("Rename")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRename("folder", f.id, f.name);
                                }}
                                style={renameButton}
                              >
                                <PencilGlyph />
                              </button>
                            )}
                            {onDelete && (
                              <button
                                type="button"
                                title={t("Delete")}
                                aria-label={t("Delete")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete("folder", f.id, f.name);
                                }}
                                style={renameButton}
                              >
                                <TrashGlyph />
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {files.map((f, index) => (
                    <div
                      key={f.id}
                      className="vg"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenFile(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenFile(f.id);
                        }
                      }}
                      style={{ height: 56, borderBottom: "1px solid #f3f3f3", cursor: "pointer" }}
                    >
                      <div className="c" style={{ justifyContent: "center", color: "#c7c7c7", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                        {folders.length + index + 1}
                      </div>
                      <div className="c" style={{ gap: 11 }}>
                        {f.uploading != null ? (
                          <div style={{ position: "relative", width: 68, height: 38, borderRadius: 6, background: "#f3f3f3", flexShrink: 0 }}>
                            <Waiting progress={f.uploading} />
                          </div>
                        ) : f.posterUrl ? (
                          <Poster
                            src={f.posterUrl}
                            style={{
                              width: 68,
                              height: 38,
                              borderRadius: 6,
                              objectFit: "cover",
                              flexShrink: 0,
                            }}
                            fallback={<FileGlyph kind={f.kind} />}
                          />
                        ) : (
                          <div
                            style={{
                              width: 68,
                              height: 38,
                              borderRadius: 6,
                              background: "#f3f3f3",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <FileGlyph kind={f.kind} />
                          </div>
                        )}
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.name}
                        </span>
                        <VisibilityChip file={f} zh={zh} onSetAccess={view === "trash" ? undefined : onSetAccess} />
                      </div>
                      <div className="c">
                        <span className="bdg" style={{ background: "#f3f3f3", color: "#525252" }}>
                          {f.kind}
                        </span>
                      </div>
                      <div
                        className="c"
                        style={{ justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatBytes(f.sizeBytes, locale)}
                      </div>
                      <div
                        className="c"
                        style={{ justifyContent: "flex-end", fontVariantNumeric: "tabular-nums", color: "#7c7c7c" }}
                      >
                        {f.version && f.version > 1 ? `v${f.version}` : ""}
                      </div>
                      <div className="c" style={{ gap: 8 }}>
                        <div
                          className="av"
                          title={f.ownerName}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#f3f3f3",
                            color: "#7c7c7c",
                            fontSize: 9.5,
                            fontWeight: 500,
                            letterSpacing: 0,
                          }}
                        >
                          {initials(f.ownerName)}
                        </div>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {f.ownerName}
                        </span>
                      </div>
                      <div
                        className="c"
                        style={{ color: "#7c7c7c" }}
                        title={formatRelative(f.updatedAt, locale)}
                      >
                        {formatDate(f.updatedAt, locale)}
                      </div>
                      <div className="c">
                        {view === "trash" && onRestore ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore(f.id);
                            }}
                            className="bdg"
                            style={{ background: "#e6f4ff", color: ACCENT, cursor: "pointer" }}
                          >
                            {zh ? "恢复" : "Restore"}
                          </span>
                        ) : canEdit ? (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <AccessBadge access={f.access} canEdit={canEdit} t={t} />
                            {onRename && (
                              <button
                                type="button"
                                title={t("Rename")}
                                aria-label={t("Rename")}
                                onClick={(e) => {
                                  // The row itself opens the file.
                                  e.stopPropagation();
                                  onRename("file", f.id, f.name);
                                }}
                                style={renameButton}
                              >
                                <PencilGlyph />
                              </button>
                            )}
                            {onDelete && (
                              <button
                                type="button"
                                title={t("Delete")}
                                aria-label={t("Delete")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete("file", f.id, f.name);
                                }}
                                style={renameButton}
                              >
                                <TrashGlyph />
                              </button>
                            )}
                          </span>
                        ) : (
                          <AccessBadge access={f.access} canEdit={canEdit} t={t} />
                        )}
                      </div>
                    </div>
                  ))}

                  <div style={{ marginTop: 16, fontSize: 12, color: "#999999" }}>
                    {files.length} {zh ? "个文件" : "files"} · {formatBytes(totalBytes, locale)} ·{" "}
                    {view === "trash"
                      ? zh
                        ? "30 天内可恢复"
                        : "restorable for 30 days"
                      : zh
                        ? "已按你的权限过滤"
                        : "filtered to what you can read"}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ============ AGENT PANEL ============ */}
          <div
            style={{
              width: agentWidth,
              position: "relative",
              flexShrink: 0,
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {agentHandle}
            <div
              style={{
                height: 44,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: "0 10px",
                borderBottom: "1px solid #ededed",
              }}
            >
              <div
                style={{
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: "#ffffff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 500,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 13,
                    height: 13,
                    stroke: ACCENT,
                    fill: "none",
                    strokeWidth: 1.8,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
                  <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
                </svg>
                {t("Agent")}
              </div>
              {/* The artboard paired this with a "Details" tab and a collapse
                  chevron. Neither had anything behind it — a file's details are
                  on the file's own page — so only the panel's name is drawn. */}
              <div style={{ flexGrow: 1 }}></div>
            </div>

            {/* scope */}
            <div style={{ flexShrink: 0, padding: "12px 14px", borderBottom: "1px solid #f3f3f3" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: "#ffffff",
                  border: "1px solid #ededed",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 12,
                    height: 12,
                    stroke: "#7c7c7c",
                    fill: "none",
                    strokeWidth: 1.7,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <path d="M4 7a2 2 0 0 1 2-2h3.6l1.8 2.2H18a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                </svg>
                <span style={{ fontSize: 12, color: "#525252" }}>{folderName}</span>
                <span style={{ fontSize: 12, color: "#c7c7c7" }}>·</span>
                <span style={{ fontSize: 12, color: "#999999" }}>
                  {files.length} {t("files")}
                </span>
              </div>
            </div>

            {/* The artboard offered three canned prompts here. A shipped
                product should not tell people what to ask; the composer below
                is the way in. */}
            {/* thread — the artboard's worked example was demo content. This is
                the real conversation, answered here rather than on /chat. */}
            {thread ?? (
              <div style={{ flexGrow: 1, minHeight: 0, padding: "16px 14px 0", overflow: "hidden" }}></div>
            )}

            {/* composer */}
            <div style={{ flexShrink: 0, padding: "12px 14px 10px" }}>
              <div
                style={{
                  border: "1px solid #e2e2e2",
                  borderRadius: 11,
                  background: "#ffffff",
                  padding: "10px 11px 8px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim()) {
                      e.preventDefault();
                      onAsk(draft);
                      setDraft("");
                    }
                  }}
                  aria-label={t("Ask about this folder…")}
                  placeholder={t("Ask about this folder…")}
                  style={{
                    width: "100%",
                    border: 0,
                    outline: "none",
                    background: "transparent",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    color: "#171717",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 12,
                  }}
                >
                  <ModelPicker current={model} zh={zh} />
                  <button
                    type="button"
                    aria-label={t("Send")}
                    onClick={() => {
                      if (draft.trim()) {
                        onAsk(draft);
                        setDraft("");
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      border: 0,
                      padding: 0,
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      background: ACCENT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 13,
                        height: 13,
                        stroke: "#ffffff",
                        fill: "none",
                        strokeWidth: 2.2,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* footer */}
            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid #f3f3f3",
                padding: "10px 14px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                style={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  stroke: "#999999",
                  fill: "none",
                  strokeWidth: 1.8,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                }}
              >
                <path d="M6.8 10.5h10.4v8H6.8z" />
                <path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5" />
              </svg>
              <span style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.4 }}>
                {t("Answers use only files you can read")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const LAYOUT_LABEL = { list: "List", grid: "Grid", gallery: "Gallery" } as const;

/** The three view icons in the toolbar's segmented control. */
function LayoutGlyph({ mode }: { mode: "list" | "grid" | "gallery" }) {
  const s = {
    width: 13,
    height: 13,
    stroke: "currentColor",
    fill: "none",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (mode === "list") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }
  if (mode === "grid") {
    return (
      <svg viewBox="0 0 24 24" style={s}>
        <rect x="4" y="4" width="7" height="7" rx="1.6" />
        <rect x="13" y="4" width="7" height="7" rx="1.6" />
        <rect x="4" y="13" width="7" height="7" rx="1.6" />
        <rect x="13" y="13" width="7" height="7" rx="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={s}>
      <rect x="3.5" y="5" width="17" height="10.5" rx="1.8" />
      <path d="M7 19h10" />
    </svg>
  );
}

/**
 * Grid and Gallery.
 *
 * Both are in `FilesDesktop.dc.html` and neither was ever built, so the
 * toolbar's three-way control had one working position. They differ in what
 * the tile is for: Grid is a dense board of everything in the folder, Gallery
 * is for looking at footage, so its tile is a 16:9 frame and it leads with the
 * poster.
 *
 * Folders come first in both, because a folder is a place and a file is a
 * thing, and mixing them by date makes a folder hard to find.
 */
function Tiles({
  layout,
  folders,
  files,
  locale,
  onOpenFolder,
  onOpenFile,
  onRename,
  onDelete,
  onRestore,
  onSetAccess,
  zh,
  t,
}: {
  layout: "grid" | "gallery";
  folders: FolderRow[];
  files: FileRow[];
  locale: string;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  /* Rename and delete are on the tiles as well as the rows. The grid is the
     default layout, so putting them only in the list meant most people never
     saw them. */
  onRename?: (kind: "file" | "folder", id: string, currentName: string) => void;
  onDelete?: (kind: "file" | "folder", id: string, currentName: string) => void;
  /* Trash only. Restore lived in the list layout alone, and the default
     layout is the grid — so the trash had no way out of it for most people. */
  onRestore?: (id: string) => void;
  onSetAccess?: (file: FileRow) => void;
  zh: boolean;
  t: (key: string) => string;
}) {
  const gallery = layout === "gallery";
  const min = gallery ? 232 : 152;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: gallery ? 16 : 13,
      }}
    >
      {folders.map((f) => (
        <div
          key={f.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenFolder(f.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenFolder(f.id);
            }
          }}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            padding: 11,
            border: "1px solid #ededed",
            borderRadius: 11,
            background: "#ffffff",
            cursor: "pointer",
            textAlign: "left",
            font: "inherit",
            color: "#171717",
          }}
        >
          <TileActions kind="folder" id={f.id} name={f.name} onRename={onRename} onDelete={onDelete} onRestore={onRestore} t={t} />
          <div
            style={{
              height: gallery ? 118 : 74,
              borderRadius: 8,
              background: "#f8f8f8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* The soft blue folder of the artboard, at tile size. */}
            <svg viewBox="0 0 24 24" style={{ width: 38, height: 38 }}>
              <path
                d="M3.6 7.4a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.55.74l1 1.26h6.7a2 2 0 0 1 2 2v7.9a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"
                fill="#8fc2ef"
              />
              <path
                d="M3.6 9.6a2 2 0 0 1 2-2h12.8a2 2 0 0 1 2 2v7.7a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"
                fill="#b9dcfa"
              />
            </svg>
          </div>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {f.name}
          </span>
        </div>
      ))}

      {files.map((f) => (
        <div
          key={f.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenFile(f.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenFile(f.id);
            }
          }}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            padding: 11,
            border: "1px solid #ededed",
            borderRadius: 11,
            background: "#ffffff",
            cursor: "pointer",
            textAlign: "left",
            font: "inherit",
            color: "#171717",
            minWidth: 0,
          }}
        >
          <TileActions kind="file" id={f.id} name={f.name} onRename={onRename} onDelete={onDelete} onRestore={onRestore} t={t} />
          <div
            style={{
              height: gallery ? 118 : 74,
              borderRadius: 8,
              background: "#f8f8f8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {f.uploading != null ? (
              /* Still coming up from this browser: the ring fills where the
                 poster will be. A broken picture here read as a failed file. */
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <Waiting progress={f.uploading} label={`${t("Uploading")} ${Math.round(f.uploading * 100)}%`} />
              </div>
            ) : f.posterUrl ? (
              <Poster
                src={f.posterUrl}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                pending={t("Processing")}
                fallback={
                  <div style={{ transform: "scale(2.1)" }}>
                    <FileGlyph kind={f.kind} />
                  </div>
                }
              />
            ) : (
              <div style={{ transform: "scale(2.1)" }}>
                <FileGlyph kind={f.kind} />
              </div>
            )}
          </div>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {f.name}
            </span>
            <span style={{ fontSize: 11.5, color: "#999999", display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <span>
                {f.version && f.version > 1 ? `v${f.version} · ` : ""}
                {formatBytes(f.sizeBytes, locale)}
              </span>
              <VisibilityChip file={f} zh={zh} onSetAccess={onSetAccess} />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Rename, delete and (in the trash) restore, in the corner of a tile. */
function TileActions({
  kind,
  id,
  name,
  onRename,
  onDelete,
  onRestore,
  t,
}: {
  kind: "file" | "folder";
  id: string;
  name: string;
  onRename?: (kind: "file" | "folder", id: string, currentName: string) => void;
  onDelete?: (kind: "file" | "folder", id: string, currentName: string) => void;
  /* Trash only. Restore lived in the list layout alone, and the default
     layout is the grid — so the trash had no way out of it for most people. */
  onRestore?: (id: string) => void;
  t: (key: string) => string;
}) {
  if (!onRename && !onDelete && !onRestore) return null;
  return (
    <span style={{ position: "absolute", top: 7, right: 7, display: "flex", gap: 4, zIndex: 1 }}>
      {onRestore && (
        <button
          type="button"
          aria-label={`${t("Restore")} ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRestore(id);
          }}
          className="bdg"
          style={{ background: "#e6f4ff", color: ACCENT, cursor: "pointer", border: 0, font: "inherit" }}
        >
          {t("Restore")}
        </button>
      )}
      {onRename && (
        <button
          type="button"
          title={t("Rename")}
          aria-label={`${t("Rename")} ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRename(kind, id, name);
          }}
          style={renameButton}
        >
          <PencilGlyph />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          title={t("Delete")}
          aria-label={`${t("Delete")} ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(kind, id, name);
          }}
          style={renameButton}
        >
          <TrashGlyph />
        </button>
      )}
    </span>
  );
}


/** The small square + that sits on a section heading. One definition, because
 * the Files sidebar and the chat sidebar draw the same control. */
export const plusButton: React.CSSProperties = {
  width: 18,
  height: 18,
  flexShrink: 0,
  padding: 0,
  borderRadius: 5,
  border: "1px solid #ededed",
  background: "#ffffff",
  color: "#7c7c7c",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 0,
};

export function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2.4, strokeLinecap: "round" }}
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

/** The small pencil that renames a row. */
const renameButton: React.CSSProperties = {
  width: 20,
  height: 20,
  flexShrink: 0,
  padding: 0,
  borderRadius: 5,
  border: "1px solid #ededed",
  background: "#ffffff",
  color: "#7c7c7c",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 0,
};

/**
 * What this person holds on one file.
 *
 * Owner and editor are the same green — both mean "you can change this" — and
 * the two read-only levels are grey, because the difference between them is
 * whether you may leave a comment, not whether you may alter the file.
 */
function AccessBadge({
  access,
  canEdit,
  t,
}: {
  access?: "owner" | "editor" | "commenter" | "viewer" | null;
  canEdit: boolean;
  t: (key: string) => string;
}) {
  const held = access ?? (canEdit ? "editor" : "viewer");
  const writes = held === "owner" || held === "editor";
  const label = held === "owner" ? "Owner" : held === "editor" ? "Editor" : held === "commenter" ? "Commenter" : "Viewer";
  return (
    <span
      className="bdg"
      style={
        writes
          ? { background: "#e4faeb", color: "#278f5e" }
          : { background: "#f3f3f3", color: "#525252" }
      }
    >
      {t(label)}
    </span>
  );
}

/**
 * Who a file is shared with, on its row: a hidden eye for private, a person
 * for specific people, a globe for everyone, people for groups. Icon only on
 * the row; hovering shows the detail (the owner, and who exactly can see it),
 * and its owner or an admin clicks it to change.
 */
function VisibilityChip({
  file,
  zh,
  onSetAccess,
}: {
  file: FileRow;
  zh: boolean;
  onSetAccess?: (file: FileRow) => void;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [at, setAt] = React.useState<{ x: number; y: number; above: boolean } | null>(null);
  if (!file.visibility) return null;
  const label = visibilityLabel(file.visibility, file.groups, zh, file.userIds?.length);
  const glyph =
    file.visibility === "private" ? (
      <EyeOffGlyph size={12} />
    ) : file.visibility === "everyone" ? (
      <GlobeGlyph size={12} />
    ) : file.visibility === "people" ? (
      <PersonGlyph size={12} />
    ) : (
      <PeopleGlyph size={12} />
    );
  const can = Boolean(onSetAccess && file.canSetAccess);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Below the icon, unless that would run off the bottom of the window.
    const above = r.bottom + 190 > window.innerHeight;
    setAt({ x: Math.min(Math.max(8, r.left + r.width / 2 - 130), window.innerWidth - 268), y: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => setAt(null);

  return (
    <>
      <span
        ref={ref}
        role={can ? "button" : undefined}
        tabIndex={0}
        aria-label={zh ? `谁可以看：${label}` : `Who can see: ${label}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={
          can
            ? (e) => {
                e.stopPropagation();
                hide();
                onSetAccess!(file);
              }
            : undefined
        }
        onKeyDown={
          can
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  hide();
                  onSetAccess!(file);
                }
              }
            : undefined
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: 20,
          height: 18,
          color: file.visibility === "private" ? "#7c7c7c" : "#525252",
          cursor: can ? "pointer" : "default",
          borderRadius: 5,
          background: "#f6f6f6",
        }}
      >
        {glyph}
      </span>
      {at && typeof document !== "undefined"
        ? createPortal(<AccessCard file={file} zh={zh} can={can} at={at} glyph={glyph} />, document.body)
        : null}
    </>
  );
}

/** The hover card itself: what the icon means, in full. */
function AccessCard({
  file,
  zh,
  can,
  at,
  glyph,
}: {
  file: FileRow;
  zh: boolean;
  can: boolean;
  at: { x: number; y: number; above: boolean };
  glyph: React.ReactNode;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const GROUP: Record<string, string> = zh
    ? { admin: "管理员（含所有者）", member: "所有成员", guest: "所有访客" }
    : { admin: "Admins (and the owner)", member: "All members", guest: "All guests" };

  const heading =
    file.visibility === "private"
      ? t("Private", "私有")
      : file.visibility === "everyone"
        ? t("Everyone in the studio", "工作室所有人")
        : file.visibility === "people"
          ? t("Specific people", "指定的人")
          : t("Groups", "指定组");

  const lines: { main: string; sub?: string }[] =
    file.visibility === "private"
      ? [{ main: t("Only the owner can see it.", "只有所有者能看到。") }]
      : file.visibility === "everyone"
        ? [{ main: t("All staff can view it.", "所有员工都可以查看。"), sub: t("Guests cannot.", "访客不可见。") }]
        : file.visibility === "people"
          ? (file.people ?? []).map((p) => ({ main: p.name, sub: p.email }))
          : (file.groups ?? []).map((g) => ({ main: GROUP[g] ?? g }));

  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: at.x,
        top: at.y,
        transform: at.above ? "translateY(-100%)" : undefined,
        width: 260,
        zIndex: 300,
        pointerEvents: "none",
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(23,23,23,0.16)",
        padding: "10px 12px",
        fontSize: 12,
        color: "#171717",
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ display: "inline-flex", color: "#525252" }}>{glyph}</span>
        {heading}
      </div>
      <div style={{ fontSize: 11.5, color: "#7c7c7c", marginBottom: 6 }}>
        {t("Owner", "所有者")}: <span style={{ color: "#171717" }}>{file.ownerName}</span>
      </div>
      {file.visibility === "people" || file.visibility === "groups" ? (
        <div style={{ fontSize: 11.5, color: "#999999", marginBottom: 3 }}>{t("Can also see it:", "还可以查看：")}</div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {lines.slice(0, 8).map((l, i) => (
          <div key={i} style={{ minWidth: 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.main}</span>
            {l.sub ? (
              <span style={{ display: "block", fontSize: 11.5, color: "#999999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.sub}
              </span>
            ) : null}
          </div>
        ))}
        {lines.length > 8 ? (
          <div style={{ fontSize: 11.5, color: "#999999" }}>{t(`and ${lines.length - 8} more`, `还有 ${lines.length - 8} 人`)}</div>
        ) : null}
      </div>
      {can ? (
        <div style={{ fontSize: 11.5, color: "#007be0", marginTop: 8 }}>{t("Click to change", "点击更改")}</div>
      ) : null}
    </div>
  );
}

/** The small bin that moves a row to the trash. */
function TrashGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}
    >
      <path d="M4 7h16M10 7V5h4v2M6.5 7l.8 12h9.4l.8-12" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}
    >
      <path d="M12 20h8" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
