"use client";

import * as React from "react";
import Link from "next/link";
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
};

export type FolderRow = { id: string; name: string; count?: number };

/** The artboard's `accent` prop, at its default. */
const ACCENT = "#007be0";

/** zh-CN is the default locale (spec §4.1); English is the toggle. */
const ZH: Record<string, string> = {
  Database: "数据库",
  Folders: "文件夹",
  Views: "视图",
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
  canEdit: boolean; // hide/disable New folder + Upload when false
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
  /** Hands a question to the employee's agent. */
  onAsk: (prompt: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const {
    breadcrumbs,
    folders: allFolders,
    files: allFiles,
    sidebarFolders,
    currentFolderId,
    canEdit,
    uploads,
    locale,
    onOpenFolder,
    onOpenFile,
    onUploadClick,
    onNewFolder,
    model,
    onAsk,
    view = "folder",
    onRestore,
  } = props;

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
          width: 208,
          flexShrink: 0,
          background: "#f8f8f8",
          borderRight: "1px solid #ededed",
          display: "flex",
          flexDirection: "column",
          padding: "10px 8px",
        }}
      >
        <div style={{ padding: "4px 8px 12px", fontSize: 14, fontWeight: 500 }}>{t("Database")}</div>
        <div className="lbl" style={{ marginBottom: 5 }}>
          {t("Folders")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {sidebarFolders.length === 0 ? (
            <p style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.5, padding: "2px 8px 0" }}>
              {t("No folders yet")}
              {canEdit ? ` · ${t("New folder makes the first one")}` : ""}
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
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#999999" }}>{f.count}</span>
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
            <span style={{ fontSize: 11, color: "#999999" }}>{t("Storage")}</span>
            <span style={{ fontSize: 11, color: "#525252" }}>{formatBytes(totalBytes, locale)}</span>
          </div>
          {/* The artboard draws a fill against a quota. Object storage here has
              no quota, so the figure above is the whole truth and a bar would
              be decoration pretending to be data. */}
        </div>
      </div>

      {/* main */}
      <div
        data-files-screen=""
        style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {/* toolbar */}
        <div
          style={{
            height: 48,
            flexShrink: 0,
            borderBottom: "1px solid #ededed",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 8,
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

          {/* Filter: narrows the rows below by name, in both scripts. The
              artboard drew this as a button; a live box is the same affordance
              without a dialog nobody needs. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 30,
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
          {canEdit ? (
            <button
              type="button"
              className="btn"
              onClick={onNewFolder}
              style={{
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
          {canEdit ? (
            <button
              type="button"
              className="btn"
              onClick={onUploadClick}
              style={{
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
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* ============ LIST ============ */}
            <div style={{ flexGrow: 1, minHeight: 0, padding: "16px 20px" }}>
              {/* uploads in flight — the artboard has no progress affordance, so this
                  borrows its card, its 4px track and its accent */}
              {uploads.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {uploads.map((u) => (
                    <div
                      key={u.name}
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
                              fontSize: 11,
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
              ) : (
                <>
                  <div className="vg" style={{ height: 32, borderBottom: "1px solid #ededed" }}>
                    <div className="h" style={{ justifyContent: "center" }}>
                      {/* selection column: no bulk actions yet, so no checkbox */}
                    </div>
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

                  {folders.map((f) => (
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
                      <div className="c" style={{ justifyContent: "center" }}>
                        {/* selection column: no bulk actions yet, so no checkbox */}
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
                      <div className="c"></div>
                    </div>
                  ))}

                  {files.map((f) => (
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
                      <div className="c" style={{ justifyContent: "center" }}>
                        {/* selection column: no bulk actions yet, so no checkbox */}
                      </div>
                      <div className="c" style={{ gap: 11 }}>
                        {f.posterUrl ? (
                          // A poster is a signed R2 URL that expires, so
                          // next/image's optimiser cannot cache it usefully
                          // and would only add a round trip.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={f.posterUrl}
                            alt=""
                            style={{
                              width: 68,
                              height: 38,
                              borderRadius: 6,
                              objectFit: "cover",
                              flexShrink: 0,
                            }}
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
                          <span className="bdg" style={{ background: "#e4faeb", color: "#278f5e" }}>
                            {t("Editor")}
                          </span>
                        ) : (
                          <span className="bdg" style={{ background: "#f3f3f3", color: "#525252" }}>
                            {t("Viewer")}
                          </span>
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
              width: 320,
              flexShrink: 0,
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
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
            {/* thread — the artboard's worked example is demo content and has no
                props, so the region is left empty until a thread is wired in */}
            <div style={{ flexGrow: 1, minHeight: 0, padding: "16px 14px 0", overflow: "hidden" }}></div>

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
                  <span style={{ fontSize: 11, color: "#999999" }}>{model.replace(/^[^/]+\//, "")}</span>
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
              <span style={{ fontSize: 11, color: "#999999", lineHeight: 1.4 }}>
                {t("Answers use only files you can read")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
