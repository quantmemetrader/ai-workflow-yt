"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { Icon } from "@/components/ui/Icon";
import { useLiveProject, useLiveSnapshot } from "@/lib/client/live";
import { isRecent, isRunning, liveWords } from "@/lib/projects/live-types";

/**
 * The film this conversation's project is making, drawn in the thread as
 * 剪辑师 at work — "正在渲染 42%" in the same typing style as a reply —
 * instead of a bar at the top of the screen ("when I'm in the chat already,
 * why the loading on top; have it look like typing, just change the text to
 * rendering"). When it lands: 成片已出 with 打开 and 下载, for two minutes.
 * The project is the one the chat belongs to (`/api/chat/project`), asked
 * again whenever the thread settles.
 */
export function ChatLiveWork({ conversationId, settled, zh }: { conversationId: string | null; settled: number; zh: boolean }) {
  const [projectId, setProjectId] = useState<string | null>(null);
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
  if (p.state === "done" && isRecent(p, at)) {
    return (
      <div className="msg">
        <div className="face">
          <AgentIcon agent="video" size={36} radius={10} />
        </div>
        <div style={{ minWidth: 0, flexGrow: 1, paddingTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "#146b43" }}>
          <Icon name="check" size={13} strokeWidth={2.4} /> {zh ? `《${p.title}》成片已出` : `“${p.title}” is ready`}
          <Link href={`/projects/${p.id}`} prefetch={false} className="chip" style={{ height: 24, fontSize: 11.5 }}>
            {zh ? "打开" : "Open"}
          </Link>
          {p.fileId ? (
            <a href={`/api/files/${p.fileId}/download?download=1`} className="chip" style={{ height: 24, fontSize: 11.5, gap: 4 }}>
              <Icon name="download" size={11} /> {zh ? "下载" : "Download"}
            </a>
          ) : null}
        </div>
      </div>
    );
  }
  return null;
}
