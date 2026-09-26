"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { readRendering, serverRendering, subscribeRendering, writeRendering } from "@/lib/client/rendering";
import { notify } from "@/lib/client/notify";
import { TOPBAR_LIVE_SLOT, useLiveSnapshot } from "@/lib/client/live";
import { isRecent, isRunning, liveWords, type LiveProject } from "@/lib/projects/live-types";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { createPortal } from "react-dom";
import type { DirectorState } from "@/lib/video/director";

/**
 * The film, followed off the page.
 *
 * A small chip at the top of every page while a film is being made —
 * "《蒸馏之战》 · 正在渲染 42%", a press away from its project — and, for
 * two minutes after it lands, "成片已出 · 打开 / 下载"; "渲染没成功 · 重试"
 * when it did not. Read from the studio-wide live store
 * (`lib/client/live.ts`), so a cut 剪辑师 started from the chat, or a
 * colleague started from their screen, is followed here too — it used to
 * follow only the render this browser had started itself.
 *
 * That older way is kept underneath for a render started on the Video
 * screen for a cut that belongs to no project (the store lists projects):
 * the id remembered in this browser (`lib/client/rendering.ts`) is asked
 * after until it is done. On the Video screen itself the chip draws
 * nothing; the strip there says it in full.
 */
type Answer = {
  id: string;
  title: string;
  director: DirectorState;
  export: { id: string; state: string; progress: number; fileId: string | null; error: string | null } | null;
};

const STEP: Record<string, [string, string]> = {
  footage: ["Footage", "素材"],
  voice: ["Voicing", "配音中"],
  transcribe: ["Transcribing", "转写中"],
  captions: ["Captions", "加字幕中"],
  cut: ["Cutting", "剪辑中"],
  design: ["Designing", "设计中"],
  pictures: ["Finding pictures", "找图中"],
  write: ["Writing", "写入中"],
  render: ["Rendering", "渲染中"],
};

export function RenderWatch({ locale }: { locale: string }) {
  const zh = locale.startsWith("zh");
  const pathname = usePathname();
  const onVideo = pathname === "/video";
  const { at: polledAt, projects: live } = useLiveSnapshot();
  /* Ticks while there is a countdown or a window to count down; the poll's
     own clock otherwise, so nothing here reads the time during a render. */
  const ticking = useNow(1000, live.some((p) => p.state === "armed" || isRecent(p, polledAt)));
  const now = ticking ?? polledAt;

  /* The one to show: something running first, then an armed countdown,
     then the newest film that landed or failed inside its window. */
  const pick =
    live.find((p) => isRunning(p)) ??
    live.find((p) => p.state === "armed") ??
    [...live].filter((p) => isRecent(p, now)).sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0] ??
    null;

  if (onVideo) return <Legacy locale={locale} covered={new Set(live.map((p) => p.videoProjectId))} draw={false} />;
  if (pick) return <Chip p={pick} zh={zh} now={now} />;
  return <Legacy locale={locale} covered={new Set(live.map((p) => p.videoProjectId))} draw />;
}

function Chip({ p, zh, now }: { p: LiveProject; zh: boolean; now: number }) {
  const words = liveWords(p, now);
  const running = isRunning(p) || p.state === "armed";
  const failed = p.state === "failed";
  /* The chip itself; where it sits is the dock's job (`Dock`). */
  const frame: React.CSSProperties = {
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 28,
    padding: "0 3px 0 11px",
    borderRadius: 14,
    background: failed ? "#fdf3f2" : p.state === "done" ? "#eaf7ef" : "#171717",
    color: failed ? "#a3281c" : p.state === "done" ? "#146b43" : "#fff",
    border: failed ? "1px solid #f6d5d1" : p.state === "done" ? "1px solid #cbe9d8" : "1px solid #171717",
    fontSize: 12,
    boxShadow: "0 3px 12px rgba(23,23,23,0.16)",
    minWidth: 0,
  };
  const label = (
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
      《{p.title}》 · <Tr zh={words.zh} en={words.en} inZh={zh} />
    </span>
  );
  const pill = (primary: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 22,
    padding: "0 9px",
    borderRadius: 11,
    fontSize: 11.5,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    background: primary ? (failed ? "#a3281c" : "#146b43") : "rgba(0,0,0,0.06)",
    color: primary ? "#fff" : "inherit",
  });

  if (running) {
    return (
      <Dock>
      <Link href={`/projects/${p.id}`} prefetch={false} style={{ ...frame, paddingRight: 13, textDecoration: "none" }} title={zh ? "打开项目" : "Open the project"}>
        {p.state === "armed" ? (
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: "#7fb0ea", animation: "auraPulse 1.4s ease-in-out infinite", flexShrink: 0 }} />
        ) : (
          <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, animation: "auraSpin 1s linear infinite", flexShrink: 0 }}>
            <circle cx="12" cy="12" r="8.6" stroke="rgba(255,255,255,.3)" strokeWidth="3" fill="none" />
            <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
        )}
        {label}
        {p.percent !== null && (p.state === "rendering" || (p.state === "directing" && p.step === "render")) ? (
          <span aria-hidden style={{ width: 54, height: 4, borderRadius: 2, background: "rgba(255,255,255,.22)", overflow: "hidden", flexShrink: 0 }}>
            <b style={{ display: "block", height: "100%", width: `${Math.max(4, p.percent)}%`, background: "#fff", borderRadius: 2, transition: "width .5s ease" }} />
          </span>
        ) : null}
      </Link>
      </Dock>
    );
  }
  return (
    <Dock>
    <div style={frame} role="status">
      <span style={{ display: "flex", flexShrink: 0 }}>
        <Icon name={failed ? "undo" : "check"} size={13} strokeWidth={2.4} />
      </span>
      {label}
      <Link href={`/projects/${p.id}`} prefetch={false} style={pill(true)}>
        {failed ? <Tr zh="重试" en="Try again" inZh={zh} /> : <Tr zh="打开" en="Open" inZh={zh} />}
      </Link>
      {!failed && p.fileId ? (
        <a href={`/api/files/${p.fileId}/download?download=1`} style={pill(false)}>
          <Icon name="download" size={11} />
          <Tr zh="下载" en="Download" inZh={zh} />
        </a>
      ) : null}
    </div>
    </Dock>
  );
}

/**
 * Where the chip sits: in the top bar's free middle, on every page — between
 * where you are and the team's ticker, laid out with them so it can never
 * cover either (portalled into `TOPBAR_LIVE_SLOT`). Every bottom corner is
 * taken: the toaster (and the done toast) bottom left over the rail's foot,
 * the background-work toast bottom right, the chat's composer across the
 * bottom middle. On a phone the bar has no middle to spare, so the chip
 * floats at the bottom there; and on a page with no top bar it floats at
 * the top. The chip's own entrance animation owns its `transform`, so the
 * floating strip is full width and centres it with flex instead.
 */
const DOCK_CSS = `.rw-dock{display:flex;justify-content:center;min-width:0;max-width:100%}
.rw-dock>*{min-width:0;max-width:min(460px,100%);animation:fadeUp .18s cubic-bezier(.32,.72,0,1) both}
.rw-dock.rw-float{position:fixed;left:0;right:0;top:5px;z-index:60;pointer-events:none;padding:0 16px}
@media (max-width:760px){.rw-dock,.rw-dock.rw-float{position:fixed;left:0;right:0;top:auto;bottom:14px;z-index:60;pointer-events:none;padding:0 16px}}`;

/* The slot is looked up when the chip draws (after the first poll, so the
   bar is there); nothing to subscribe to, the chip redraws on every poll. */
const noSubscribe = () => () => undefined;

function Dock({ children }: { children: React.ReactNode }) {
  const slot = useSyncExternalStore(noSubscribe, () => document.getElementById(TOPBAR_LIVE_SLOT), () => null);
  const body = (
    <div className={slot ? "rw-dock" : "rw-dock rw-float"}>
      <style>{DOCK_CSS}</style>
      {children}
    </div>
  );
  return slot ? createPortal(body, slot) : body;
}

/**
 * The render this browser started on the Video screen, for a cut with no
 * project around it. Once the studio's store knows the same video project,
 * this stands down — the store's toast is the one that speaks.
 */
function Legacy({ locale, covered, draw }: { locale: string; covered: Set<string>; draw: boolean }) {
  const zh = locale.startsWith("zh");
  const job = useSyncExternalStore(subscribeRendering, readRendering, serverRendering);
  const [state, setState] = useState<Answer | null>(null);
  const told = useRef<string | null>(null);
  const inStore = job ? covered.has(job.projectId) : false;

  useEffect(() => {
    if (!job || inStore) return;
    let live = true;

    async function tick() {
      try {
        const res = await fetch(`/api/video/director?project=${encodeURIComponent(job!.projectId)}`, { cache: "no-store" });
        if (!live) return;
        if (res.status === 404) {
          writeRendering(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as Answer;
        if (!live) return;
        setState(data);

        const d = data.director ?? {};
        const directing = d.state === "queued" || d.state === "running";
        const exp = data.export;
        const rendering = exp ? exp.state === "queued" || exp.state === "rendering" : false;
        const key = `${d.state}:${exp?.id ?? ""}:${exp?.state ?? ""}`;

        if (!directing && !rendering) {
          if (told.current !== key) {
            told.current = key;
            if (d.state === "failed") {
              notify(zh ? `「${data.title}」制作中断：${d.error ?? ""}` : `“${data.title}” stopped: ${d.error ?? ""}`);
            } else if (exp?.state === "failed") {
              notify(zh ? `「${data.title}」渲染失败：${exp.error ?? ""}` : `“${data.title}” failed to render: ${exp.error ?? ""}`);
            } else if (exp?.state === "done" || d.state === "done") {
              notify(zh ? `「${data.title}」已完成，成片已在文件库。` : `“${data.title}” is done. The file is in Files.`, "ok");
            }
          }
          writeRendering(null);
        }
      } catch {
        // A dropped poll is not worth reporting; the next one runs.
      }
    }

    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [job, zh, inStore]);

  /* The store follows it now: forget the mark, so nothing is said twice. */
  useEffect(() => {
    if (job && inStore) writeRendering(null);
  }, [job, inStore]);

  if (!draw || !job || inStore || !state) return null;

  const d = state.director ?? {};
  const exp = state.export;
  const rendering = exp && (exp.state === "queued" || exp.state === "rendering");
  const label =
    d.state === "running" || d.state === "queued"
      ? `${(STEP[d.step ?? ""] ?? [d.step ?? "Working", d.step ?? "处理中"])[zh ? 1 : 0]}${d.step === "render" && exp ? ` ${Math.round(exp.progress)}%` : ""}`
      : rendering
        ? `${zh ? "渲染中" : "Rendering"} ${Math.round(exp!.progress)}%`
        : null;
  if (!label) return null;

  return (
    <Dock>
    <Link
      href={`/video?project=${encodeURIComponent(state.id)}`}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px 0 10px",
        borderRadius: 14,
        background: "#171717",
        color: "#fff",
        fontSize: 12,
        textDecoration: "none",
        boxShadow: "0 3px 12px rgba(23,23,23,0.16)",
      }}
    >
      <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, animation: "auraSpin 1s linear infinite", flexShrink: 0 }}>
        <circle cx="12" cy="12" r="8.6" stroke="rgba(255,255,255,.3)" strokeWidth="3" fill="none" />
        <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label} · {state.title}
      </span>
    </Link>
    </Dock>
  );
}

/** A clock that ticks only while something is on screen to count, and
 *  nothing on the server (the chip is client-only after the first poll). */
function useNow(ms: number, on: boolean): number | null {
  return useSyncExternalStore(
    (onChange) => {
      if (!on) return () => undefined;
      const id = setInterval(onChange, ms);
      return () => clearInterval(id);
    },
    () => (on ? Math.floor(Date.now() / ms) * ms : null),
    () => null,
  );
}
