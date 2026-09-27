"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { Icon } from "@/components/ui/Icon";
import { useLiveProject, useLiveSnapshot } from "@/lib/client/live";
import { isRecent, isRunning, liveWords } from "@/lib/projects/live-types";
import { VideoCards } from "@/components/chat/VideoCard";
import type { VideoCard } from "@/lib/chat/video-card";

/**
 * The film this conversation's project is making, drawn in the thread as
 * 剪辑师 at work — "正在渲染 42%" in the same typing style as a reply —
 * instead of a bar at the top of the screen ("when I'm in the chat already,
 * why the loading on top; have it look like typing, just change the text to
 * rendering"). When it lands: 成片已出 with 打开 and 下载, for two minutes.
 * The project is the one the chat belongs to (`/api/chat/project`), asked
 * again whenever the thread settles.
 */
export function ChatLiveWork({ conversationId, settled, zh, shown = [] }: { conversationId: string | null; settled: number; zh: boolean; /** Renders already drawn as a card in the thread: not drawn twice. */ shown?: string[] }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [card, setCard] = useState<VideoCard[] | null>(null);
  useEffect(() => {
    if (!conversationId) return;
    const ctl = new AbortController();
    fetch(`/api/chat/project?conversationId=${encodeURIComponent(conversationId)}`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ project: { id: string } | null }>) : null))
      .then((s) => setProjectId(s?.project?.id ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, [conversationId, settled]);

  const p = useLiveProject(projectId);
  const { at } = useLiveSnapshot();
  const doneExport = p && p.state === "done" ? p.exportId : null;
  /* The film, once out, as the app's own video card (the poster that plays,
     下载, 打开项目) — not a line of text with two links. */
  useEffect(() => {
    if (!doneExport) return;
    const ctl = new AbortController();
    fetch(`/api/chat/videos?ids=${encodeURIComponent(doneExport)}`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ videos: VideoCard[] }>) : null))
      .then((d) => setCard(d?.videos ?? null))
      .catch(() => {});
    return () => ctl.abort();
  }, [doneExport]);
  if (!p) return null;
  const words = liveWords(p, at);
  if (isRunning(p) || p.state === "armed") {
    return (
      <div className="msg">
        <div className="face">
          <AgentIcon agent="video" size={36} radius={10} />
        </div>
        <div style={{ minWidth: 0, flexGrow: 1, paddingTop: 8 }}>
          <AgentTyping agent="video" zh={zh} face={false} label={words} percent={p.percent} />
        </div>
      </div>
    );
  }
  if (p.state === "done" && isRecent(p, at) && !(p.exportId && shown.includes(p.exportId))) {
    return (
      <div className="msg">
        <div className="face">
          <AgentIcon agent="video" size={36} radius={10} />
        </div>
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div className="head">
            <span className="who">{zh ? "剪辑师" : "Editor"}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#146b43", background: "#eaf7ef", border: "1px solid #cbe9d8", borderRadius: 999, padding: "1px 8px" }}>
              <Icon name="check" size={11} strokeWidth={2.6} /> {zh ? "成片已出" : "Ready"}
            </span>
          </div>
          <div className="txt plain">{zh ? `《${p.title}》做好了，可以直接看、下载。` : `“${p.title}” is ready to watch and download.`}</div>
          {card?.length ? (
            <VideoCards videos={card} zh={zh} />
          ) : (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <Link href={`/projects/${p.id}`} prefetch={false} className="chip" style={{ height: 28, fontSize: 12 }}>
                {zh ? "打开项目" : "Open the project"}
              </Link>
              {p.fileId ? (
                <a href={`/api/files/${p.fileId}/download?download=1`} className="chip" style={{ height: 28, fontSize: 12, gap: 4 }}>
                  <Icon name="download" size={12} /> {zh ? "下载" : "Download"}
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
}
