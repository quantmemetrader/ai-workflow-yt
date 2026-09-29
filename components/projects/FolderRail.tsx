"use client";

import * as React from "react";

export type RailFolder = {
  key: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** A script dropped on this folder (drag from the list). */
  onDrop?: (scriptId: string) => void;
  /** 全部 draws a stack, 未归入 an open tray, a project or own folder a folder. */
  kind?: "all" | "project" | "own" | "loose";
};

export type RailSection = { title?: string; folders: RailFolder[]; action?: { label: string; onClick: () => void } };

/**
 * The folder column down the left of 所有脚本 and 所有视频, like a drive's:
 * 全部, one folder per project (made with the project, nothing to do), the
 * studio's own folders, and what belongs to no project.
 */
export function FolderRail({ sections, footer = null, header = null }: { sections: RailSection[]; footer?: React.ReactNode; /** Above the folders (the drive's 「新建」). */ header?: React.ReactNode }) {
  const [over, setOver] = React.useState<string | null>(null);
  return (
    <nav aria-label="文件夹" className="folder-rail" style={{ width: 236, flexShrink: 0, borderRight: "1px solid #ededed", overflowY: "auto", padding: "14px 10px 24px", boxSizing: "border-box", background: "#fbfbfa" }}>
      {header}
      {sections.map((sec, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          {sec.title || sec.action ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px 6px" }}>
              <span style={{ flexGrow: 1, fontSize: 11.5, fontWeight: 600, color: "#9a9a9a", letterSpacing: ".02em" }}>{sec.title}</span>
              {sec.action ? (
                <button type="button" onClick={sec.action.onClick} style={{ height: 24, padding: "0 8px", border: "1px solid #e3e2de", borderRadius: 7, background: "#fff", fontFamily: "inherit", fontSize: 11.5, color: "#525252", cursor: "pointer" }}>
                  {sec.action.label}
                </button>
              ) : null}
            </div>
          ) : null}
          {sec.folders.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={f.onClick}
              aria-current={f.active ? "true" : undefined}
              onMouseEnter={(e) => {
                /* The whole name on hover only where the column cut it off:
                   a tooltip over a name that is already fully shown covered
                   the tabs above it. */
                const s = e.currentTarget.querySelector<HTMLElement>("[data-label]");
                e.currentTarget.title = s && s.scrollWidth > s.clientWidth + 1 ? f.label : "";
              }}
              onDragOver={
                f.onDrop
                  ? (e) => {
                      if (!Array.from(e.dataTransfer.types).includes("text/x-script-id")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOver(f.key);
                    }
                  : undefined
              }
              onDragLeave={f.onDrop ? () => setOver((k) => (k === f.key ? null : k)) : undefined}
              onDrop={
                f.onDrop
                  ? (e) => {
                      const id = e.dataTransfer.getData("text/x-script-id");
                      setOver(null);
                      if (id) {
                        e.preventDefault();
                        f.onDrop!(id);
                      }
                    }
                  : undefined
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                height: 36,
                padding: "0 10px",
                border: over === f.key ? "1.5px dashed #1f6feb" : "1.5px solid transparent",
                borderRadius: 9,
                background: f.active ? "#e9f0fd" : over === f.key ? "#f2f6fe" : "transparent",
                color: f.active ? "#0b3d91" : "#333",
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: f.active ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Glyph kind={f.kind ?? "project"} />
              <span data-label="" style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</span>
              {typeof f.count === "number" ? <span style={{ fontSize: 11.5, color: "#9a9a9a" }}>{f.count}</span> : null}
            </button>
          ))}
        </div>
      ))}
      {footer}
    </nav>
  );
}

function Glyph({ kind }: { kind: NonNullable<RailFolder["kind"]> }) {
  if (kind === "all")
    return (
      <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="#6b6b6b" strokeWidth={1.8} strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M4 10h16M10 10v10" />
      </svg>
    );
  if (kind === "loose")
    return (
      <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="#8a8a8a" strokeWidth={1.8} strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <path d="M3.5 13.5 6 6h12l2.5 7.5v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
        <path d="M3.5 13.5H9l1 2h4l1-2h5.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width={17} height={17} aria-hidden style={{ flexShrink: 0 }}>
      <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z" fill={kind === "own" ? "#9db8e6" : "#f2c94c"} />
    </svg>
  );
}
