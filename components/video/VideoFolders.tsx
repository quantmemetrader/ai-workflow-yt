"use client";

import * as React from "react";
import Link from "next/link";
import { FolderRail, type RailSection } from "@/components/projects/FolderRail";
import { Poster } from "@/components/files/Poster";
import type { VideoFolder, VideoFolderFile } from "@/lib/video/folders";

/**
 * 所有视频 with a folder per project: 全部剪辑 (the library as it was), each
 * project's folder — its cut, its AI renders and the team's final cuts — and
 * 未归入项目 for cuts no project uses.
 */
export function VideoFolders<P extends { id: string }>({
  zh,
  folders,
  projects,
  library,
}: {
  zh: boolean;
  folders: VideoFolder[];
  /** The cuts, for 全部 and 未归入项目. */
  projects: P[];
  /** Draws the cut library for a set of cuts (the existing grid). */
  library: (cuts: P[]) => React.ReactNode;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [pick, setPick] = React.useState<string>(() => {
    try {
      return sessionStorage.getItem("tg:video:folder") ?? "all";
    } catch {
      return "all";
    }
  });
  const choose = (k: string) => {
    setPick(k);
    try {
      sessionStorage.setItem("tg:video:folder", k);
    } catch {}
  };
  const [preview, setPreview] = React.useState<VideoFolderFile | null>(null);

  const inProjects = new Set(folders.map((f) => f.videoProjectId).filter(Boolean) as string[]);
  const loose = projects.filter((p) => !inProjects.has(p.id));
  const folder = folders.find((f) => f.id === pick) ?? null;
  const active = folder ? folder.id : pick === "none" ? "none" : "all";

  const sections: RailSection[] = [
    { folders: [{ key: "all", kind: "all", label: t("全部剪辑", "All cuts"), count: projects.length, active: active === "all", onClick: () => choose("all") }] },
  ];
  if (folders.length)
    sections.push({
      title: t("项目", "Projects"),
      folders: folders.map((f) => ({ key: f.id, kind: "project" as const, label: f.title, count: f.files.length + (f.videoProjectId ? 1 : 0), active: active === f.id, onClick: () => choose(f.id) })),
    });
  sections.push({ folders: [{ key: "none", kind: "loose", label: t("未归入项目", "Not in a project"), count: loose.length, active: active === "none", onClick: () => choose("none") }] });

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
      <FolderRail sections={sections} />
      <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", padding: "18px 22px 40px" }}>
        {active === "all" ? library(projects) : active === "none" ? (loose.length ? library(loose) : <Quiet text={t("所有剪辑都在项目里。", "Every cut belongs to a project.")} />) : folder ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: "#171717", flexGrow: 1, minWidth: 0 }}>{folder.title}</span>
              <Link prefetch={false} href={`/projects/${folder.id}/edit`} style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: 10, background: "#171717", color: "#fff", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                {t("打开剪辑 →", "Open the edit →")}
              </Link>
              <Link prefetch={false} href={`/projects/${folder.id}/files`} style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #d6d5d0", color: "#333", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
                {t("项目全部文件", "All project files")}
              </Link>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              {folder.videoProjectId ? (
                <Link prefetch={false} href={`/projects/${folder.id}/edit`} style={tile}>
                  <div style={{ aspectRatio: "16 / 10", borderRadius: 10, background: "#eef4fe", display: "flex", alignItems: "center", justifyContent: "center", color: "#1f5fbf" }}>
                    <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.4 20 17M8.2 16.6 20 7" /></svg>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#171717" }}>{t("剪辑台", "The cut")}</div>
                  <div style={{ fontSize: 12, color: "#8a8a8a" }}>{t("素材、时间线、字幕", "Footage, timeline, captions")}</div>
                </Link>
              ) : null}
              {folder.files.map((f) => (
                <button key={f.id} type="button" onClick={() => setPreview(f)} style={{ ...tile, border: "1px solid #ecebe7", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ position: "relative", aspectRatio: "16 / 10", borderRadius: 10, overflow: "hidden", background: "#111" }}>
                    <Poster src={`/api/files/${f.id}/thumb`} style={{ width: "100%", height: "100%", objectFit: "cover" }} fallback={<span />} />
                    {f.durationMs ? <span style={{ position: "absolute", right: 6, bottom: 6, fontSize: 11, color: "#fff", background: "rgba(0,0,0,.6)", borderRadius: 5, padding: "1px 6px" }}>{clock(f.durationMs)}</span> : null}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: f.role === "final" ? "#1e7a4f" : "#1f5fbf", background: f.role === "final" ? "#e7f6ee" : "#e9f2fe", borderRadius: 999, padding: "0 7px", lineHeight: "18px", flexShrink: 0 }}>{f.role === "final" ? t("最终版", "Final") : t("AI 成片", "AI render")}</span>
                    <span style={{ fontSize: 13, color: "#171717", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8a8a8a" }}>{size(f.sizeBytes)} · {day(f.createdAt, zh)}</div>
                </button>
              ))}
            </div>
            {!folder.files.length ? <Quiet text={t("还没有成片。剪好渲染后，成片和上传的最终版会出现在这里。", "No films yet. Renders and uploaded final cuts show here.")} /> : null}
          </div>
        ) : null}
      </div>
      {preview ? (
        <div role="dialog" onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 16, maxWidth: "min(960px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
            <video src={`/api/files/${preview.id}/download`} controls autoPlay style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 10, background: "#000" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flexGrow: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview.name}</span>
              <a href={`/api/files/${preview.id}/download?download=1`} style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: 10, background: "#171717", color: "#fff", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>{t("下载", "Download")}</a>
              <button type="button" onClick={() => setPreview(null)} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #d6d5d0", background: "#fff", fontFamily: "inherit", fontSize: 13.5, cursor: "pointer" }}>{t("关闭", "Close")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const tile: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "#fff", border: "1px solid #ecebe7", textDecoration: "none", color: "inherit", minWidth: 0 };

function Quiet({ text }: { text: string }) {
  return <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 13, color: "#8a8a8a", border: "1px dashed #e3e2de", borderRadius: 12 }}>{text}</div>;
}
function clock(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function size(n: number) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}
function day(iso: string, zh: boolean) {
  const d = new Date(iso);
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
