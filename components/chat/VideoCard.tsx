"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { videoBytes, videoClock, type VideoCard } from "@/lib/chat/video-card";

/**
 * A video in a message: the poster with a play button, the film's name,
 * length and size, and the presses that matter — 下载, 打开项目, 在剪辑台
 * 打开. Pressing play swaps the poster for the player, which plays the 480p
 * copy when there is one (a twentieth of the master's bytes; the studio's
 * link to the bucket is the slow part) and drops to the file itself when
 * that copy will not play. Nothing autoplays before a press.
 *
 * Drawn the same in the channel, the personal chat, the project page's
 * drawer and Home's project chats, so "the agent says done" looks the same
 * everywhere it is said. The data is the server's (`lib/chat/videos.ts`),
 * already checked for this reader.
 *
 * `here` is the page the card is on: on a project's own page the card does
 * not offer "打开项目" for that same project.
 */
export function VideoCards({ videos, zh, here, compact = false }: { videos: VideoCard[] | undefined | null; zh: boolean; here?: { projectId?: string | null } | null; compact?: boolean }) {
  if (!videos?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {videos.map((v) => (
        <VideoCardView key={`${v.kind}-${v.id}`} video={v} zh={zh} here={here} compact={compact} />
      ))}
    </div>
  );
}

export function VideoCardView({ video: v, zh, here, compact = false }: { video: VideoCard; zh: boolean; here?: { projectId?: string | null } | null; compact?: boolean }) {
  const [playing, setPlaying] = React.useState(false);
  /* The small copy first; the master if it will not play (deleted, or not
     this reader's to open — `/api/files` says 404 to both alike). */
  const [proxyFailed, setProxyFailed] = React.useState(false);
  const [posterFailed, setPosterFailed] = React.useState(false);
  const playId = proxyFailed ? v.fileId : (v.proxyFileId ?? v.fileId);
  const tall = v.aspect === "9:16";
  const square = v.aspect === "1:1";
  /* Wide enough to read a caption on, never the whole column: a vertical
     film is a phone screen, so it is narrower and taller. */
  const width = compact ? (tall ? 150 : 220) : tall ? 230 : square ? 280 : 360;
  const ratio = tall ? "9 / 16" : square ? "1 / 1" : "16 / 9";
  const facts = [v.aspect, v.durationMs ? videoClock(v.durationMs) : null, v.sizeBytes ? videoBytes(v.sizeBytes) : null].filter(Boolean).join(" · ");
  const showProject = v.project && v.project.id !== here?.projectId;

  return (
    <div data-video-card="" style={{ width: "100%", maxWidth: width, border: "1px solid #e6e6e6", borderRadius: 12, background: "#fff", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ position: "relative", aspectRatio: ratio, background: "#111", overflow: "hidden" }}>
        {playing ? (
          <video
            key={playId}
            src={`/api/files/${playId}/download`}
            poster={posterFailed ? undefined : `/api/files/${v.fileId}/thumb`}
            autoPlay
            controls
            playsInline
            preload="metadata"
            onError={() => {
              if (!proxyFailed && v.proxyFileId) setProxyFailed(true);
            }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#000", display: "block" }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={zh ? `播放 ${v.title}` : `Play ${v.title}`}
            title={zh ? "播放" : "Play"}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, padding: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {posterFailed ? (
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b6b6b" }}>
                <Icon name="film" size={compact ? 22 : 30} strokeWidth={1.5} />
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${v.fileId}/thumb`} alt="" loading="lazy" onError={() => setPosterFailed(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            )}
            <span style={{ position: "relative", width: compact ? 36 : 46, height: compact ? 36 : 46, borderRadius: 999, background: "rgba(255,255,255,0.94)", color: "#171717", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>
              <Icon name="play" size={compact ? 16 : 20} fill style={{ marginLeft: 2 }} />
            </span>
            {v.durationMs ? (
              <span style={{ position: "absolute", right: 7, bottom: 7, fontSize: 10.5, color: "#fff", background: "rgba(0,0,0,.62)", borderRadius: 4, padding: "1px 5px", fontVariantNumeric: "tabular-nums" }}>{videoClock(v.durationMs)}</span>
            ) : null}
          </button>
        )}
      </div>
      <div style={{ padding: compact ? "7px 9px 8px" : "9px 11px 10px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ color: v.kind === "render" ? "#0b7a63" : "#525252", display: "flex", flexShrink: 0 }}>
            <Icon name={v.kind === "render" ? "film" : "clapper"} size={13} />
          </span>
          <span title={v.title} style={{ fontSize: compact ? 12 : 12.5, fontWeight: 600, color: "#171717", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v.title}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: "#7c7c7c", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span>{v.kind === "render" ? <Tr zh="成片" en="Render" inZh={zh} /> : <Tr zh="视频" en="Video" inZh={zh} />}</span>
          {facts ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{facts}</span> : null}
          {v.binned ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#0b7a63", background: "#e6f4ee", borderRadius: 999, padding: "0 7px", lineHeight: "18px", fontSize: 11 }}>
              <Icon name="check" size={10} strokeWidth={2.4} />
              <Tr zh="已加入项目素材" en="Added to the project's clips" inZh={zh} />
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {/* The file with its own name, through the same permission-checked
              redirect every read makes; `download=1` asks storage to hand it
              over as a file rather than open it. */}
          <a href={`/api/files/${v.fileId}/download?download=1`} className="vc-btn vc-primary" title={zh ? "下载成片文件" : "Download the file"}>
            <Icon name="download" size={12} />
            <Tr zh="下载" en="Download" inZh={zh} />
          </a>
          {showProject && v.project ? (
            <Link href={`/projects/${v.project.id}`} prefetch={false} className="vc-btn" title={v.project.title}>
              <Icon name="spark" size={12} />
              <Tr zh="打开项目" en="Open the project" inZh={zh} />
            </Link>
          ) : null}
          {v.videoProjectId && !compact ? (
            <Link href={`/video?project=${v.videoProjectId}`} prefetch={false} className="vc-btn">
              <Icon name="scissors" size={12} />
              <Tr zh="在剪辑台打开" en="Open in the editor" inZh={zh} />
            </Link>
          ) : null}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </div>
  );
}

/* Its own small rules, because the card is drawn inside four different
   surfaces with four different CSS scopes. */
const CSS = `
[data-video-card] .vc-btn { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: 8px; border: 1px solid #e2e2e2; background: #fff; color: #171717; font-size: 11.5px; font-weight: 500; text-decoration: none; white-space: nowrap; font-family: inherit; letter-spacing: inherit; transition: border-color .15s ease, background-color .15s ease; }
[data-video-card] .vc-btn:hover { border-color: #c7c7c7; background: #fafafa; color: #171717; }
[data-video-card] .vc-btn.vc-primary { background: #171717; border-color: #171717; color: #fff; }
[data-video-card] .vc-btn.vc-primary:hover { background: #2b2b2b; border-color: #2b2b2b; color: #fff; }
`;
