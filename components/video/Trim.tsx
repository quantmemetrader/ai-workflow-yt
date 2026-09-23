"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Trimming a cut by looking at it.
 *
 * This is the difference between the module and an editor. Until now a cut was
 * trimmed by typing `00:14.2` into a box, pressing play somewhere else, and
 * typing a different number — which means the person doing it is holding the
 * edit in their head instead of seeing it.
 *
 * Three things, together, are what make this feel like CapCut rather than a
 * form:
 *
 *   1. **The waveform.** A cut belongs at the end of a sentence or on a
 *      breath, and both are visible in the audio and invisible in a number.
 *      Measured once by the worker (`lib/video/peaks.ts`) and drawn from ~600
 *      stored points, so opening this costs nothing.
 *   2. **Handles you drag.** In and out, with the picture following the one
 *      you are holding, so you see the frame you are cutting on as you choose
 *      it.
 *   3. **Play just this cut.** Not the whole file — the trimmed range, looped,
 *      which is the only way to know whether an edit works.
 *
 * The video element streams from R2 over a signed URL with range requests, so
 * scrubbing a four-gigabyte master does not download a four-gigabyte master.
 * It streams the clip's 480p preview copy when there is one, which is the
 * difference between a scrub that lands and a scrub that buffers: the same
 * film at about a fortieth of the bytes, with a keyframe every two seconds so
 * a dropped handle has something near it to resume from.
 */
export function Trim({
  fileId,
  proxyFileId,
  durationMs,
  inMs,
  outMs,
  peaks,
  peaksError,
  zh,
  onChange,
}: {
  fileId: string;
  /** The small copy to play instead, when the clip has one. Absent for
   * footage uploaded before proxies existed: that still plays the master. */
  proxyFileId?: string | null;
  /** The clip's full length. Everything here is a fraction of it. */
  durationMs: number;
  inMs: number;
  outMs: number;
  peaks: number[] | null;
  peaksError: string | null;
  zh: boolean;
  /** Committed on release, not on every pixel of a drag. */
  onChange: (input: { inMs: number; outMs: number }) => void;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const video = useRef<HTMLVideoElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);

  // Local while dragging, so the handle follows the pointer at 60fps without a
  // server round trip between frames.
  const [live, setLive] = useState({ inMs, outMs });
  /* The latest values where a pointer-up handler can read them: a side
     effect inside a state updater runs twice under StrictMode and saved the
     trim twice. */
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const [dragging, setDragging] = useState<"in" | "out" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [atMs, setAtMs] = useState(inMs);

  // The row's own values win whenever they change underneath — another person
  // editing, or the first cut rewriting the timeline.
  const [seen, setSeen] = useState({ inMs, outMs });
  if (seen.inMs !== inMs || seen.outMs !== outMs) {
    setSeen({ inMs, outMs });
    if (!dragging) setLive({ inMs, outMs });
  }

  const total = Math.max(1, durationMs);
  const pct = (ms: number) => Math.min(100, Math.max(0, (ms / total) * 100));

  /* Playing the range rather than the file: loop back to the in point when the
     out point is reached, which is how you judge whether a cut works. */
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const tick = () => {
      const ms = el.currentTime * 1000;
      setAtMs(ms);
      if (playing && ms >= live.outMs) {
        el.currentTime = live.inMs / 1000;
      }
    };
    el.addEventListener("timeupdate", tick);
    return () => el.removeEventListener("timeupdate", tick);
  }, [playing, live.inMs, live.outMs]);

  const msAt = (clientX: number): number => {
    const box = strip.current?.getBoundingClientRect();
    if (!box) return 0;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(share * total);
  };

  const startDrag = (which: "in" | "out") => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setDragging(which);

    const move = (ev: PointerEvent) => {
      const ms = msAt(ev.clientX);
      setLive((cur) => {
        // Half a second minimum, so a handle cannot be dragged past the other
        // one and leave a cut with no length.
        const next =
          which === "in"
            ? { inMs: Math.min(ms, cur.outMs - 500), outMs: cur.outMs }
            : { inMs: cur.inMs, outMs: Math.max(ms, cur.inMs + 500) };
        // The picture follows the handle being held: you are choosing a frame,
        // so you should be looking at it.
        const el = video.current;
        if (el) el.currentTime = (which === "in" ? next.inMs : next.outMs) / 1000;
        return next;
      });
    };

    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setDragging(null);
      // Committed once, on release. Saving on every pointer move would be a
      // write per pixel.
      onChange(liveRef.current);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const nudge = (which: "in" | "out", by: number) => {
    const cur = liveRef.current;
    const next =
      which === "in"
        ? { inMs: Math.max(0, Math.min(cur.inMs + by, cur.outMs - 500)), outMs: cur.outMs }
        : { inMs: cur.inMs, outMs: Math.min(total, Math.max(cur.outMs + by, cur.inMs + 500)) };
    setLive(next);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <video
        ref={video}
        src={`/api/files/${proxyFileId ?? fileId}/download`}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        style={{
          width: "100%",
          maxHeight: 280,
          borderRadius: 10,
          background: "#000",
          display: "block",
        }}
      />

      {/* ------------------------------------------------------ the strip */}
      <div
        ref={strip}
        onPointerDown={(e) => {
          // A click on the strip scrubs. Handles stop this themselves.
          const el = video.current;
          if (el) el.currentTime = msAt(e.clientX) / 1000;
        }}
        style={{
          position: "relative",
          height: 62,
          borderRadius: 8,
          background: "#f6f6f6",
          overflow: "hidden",
          cursor: "text",
          touchAction: "none",
        }}
      >
        <Waveform peaks={peaks} />

        {/* What is being cut away, dimmed rather than hidden: you want to see
            what is just outside the cut when deciding where it goes. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            left: 0,
            width: `${pct(live.inMs)}%`,
            background: "rgba(255,255,255,0.72)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            left: `${pct(live.outMs)}%`,
            background: "rgba(255,255,255,0.72)",
            pointerEvents: "none",
          }}
        />

        {/* The playhead. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${pct(atMs)}%`,
            width: 1.5,
            background: "#171717",
            pointerEvents: "none",
          }}
        />

        {(["in", "out"] as const).map((which) => (
          <div
            key={which}
            role="slider"
            tabIndex={0}
            aria-label={which === "in" ? t("Cut in", "入点") : t("Cut out", "出点")}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={which === "in" ? live.inMs : live.outMs}
            onPointerDown={startDrag(which)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 1000 : 100;
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                nudge(which, -step);
              }
              if (e.key === "ArrowRight") {
                e.preventDefault();
                nudge(which, step);
              }
            }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${pct(which === "in" ? live.inMs : live.outMs)}%`,
              width: 11,
              marginLeft: which === "in" ? -1 : -10,
              cursor: "ew-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: dragging === which ? "#007be0" : "#171717",
              borderRadius: which === "in" ? "4px 0 0 4px" : "0 4px 4px 0",
              touchAction: "none",
            }}
          >
            <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.7)" }} />
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------- the numbers */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            const el = video.current;
            if (!el) return;
            if (el.paused) {
              el.currentTime = live.inMs / 1000;
              void el.play();
            } else {
              el.pause();
            }
          }}
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid #ededed",
            background: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
          }}
        >
          {playing ? t("Pause", "暂停") : t("Play this cut", "播放这段")}
        </button>

        <span style={{ fontSize: 11.5, color: "#525252", fontVariantNumeric: "tabular-nums" }}>
          {stamp(live.inMs)} – {stamp(live.outMs)}
        </span>
        <span style={{ fontSize: 11.5, color: "#999999", fontVariantNumeric: "tabular-nums" }}>
          {((live.outMs - live.inMs) / 1000).toFixed(1)}s
          {durationMs > 0 ? ` ${t("of", "／")} ${(durationMs / 1000).toFixed(1)}s` : ""}
        </span>

        {peaks === null && !peaksError ? (
          <span style={{ fontSize: 11, color: "#999999" }}>
            {t("measuring the audio…", "正在分析音频…")}
          </span>
        ) : null}
        {peaksError ? (
          <span style={{ fontSize: 11, color: "#a35f00" }} title={peaksError}>
            {t("no waveform for this clip", "这个片段没有波形")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The waveform, as one SVG path.
 *
 * Mirrored around the middle, which is how every editor draws audio and is
 * therefore what a person expects to see. One path rather than six hundred
 * rectangles: the browser draws it in one operation and it scales to whatever
 * width the panel has been dragged to.
 */
function Waveform({ peaks }: { peaks: number[] | null }) {
  if (!peaks?.length) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", height: 1, background: "#ededed" }} />
      </div>
    );
  }

  const n = peaks.length;
  const top = peaks.map((v, i) => `${(i / (n - 1)) * 100},${50 - v * 46}`).join(" ");
  const bottom = peaks
    .map((v, i) => `${((n - 1 - i) / (n - 1)) * 100},${50 + v * 46}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    >
      <polygon points={`${top} ${bottom}`} fill="#b9d8f5" />
    </svg>
  );
}

/** 1:04.2 — the precision an edit is actually made at. */
function stamp(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
