"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioRow, CaptionRow, ClipRow, GraphicRow, ItemRow } from "@/lib/video/service";
import { ICONS } from "@/lib/video/icons";
import { Poster } from "@/components/files/Poster";
import { primaryLanguage as primaryLanguageOf } from "@/lib/video/languages";

/**
 * The editor.
 *
 * Everything in this module used to be a form: a list of cuts with two
 * timecode boxes each, captions in a table, graphics in another table. Every
 * individual control worked and the whole thing was unusable, because editing
 * is not data entry — it is looking at a picture, looking at where the sound
 * is, and deciding where the cut goes. You cannot do that across four tabs.
 *
 * So this is the shape every editor has had since the nineties, and has
 * because it is right:
 *
 *   — **The bin, left.** What you have to work with.
 *   — **The viewer, centre.** What you are making, playing as it will play.
 *   — **The inspector, right.** Everything about whatever is selected, and
 *     nothing about anything else.
 *   — **The timeline, across the bottom.** Every track against one clock, with
 *     one playhead through all of them.
 *
 * Dark, like every editor, and not for fashion: the picture is the only thing
 * in the window that should be bright, and grey chrome around a video is the
 * fastest way to misjudge its exposure.
 *
 * **What the preview is and is not.** It plays the source files and seeks
 * between cuts, so it is honest about the edit and approximate about the
 * joins — a cut between two different files shows a hitch a render will not
 * have. Captions and graphics are drawn live over it from the same numbers
 * the renderer uses. The exported file is the truth; this is for deciding.
 */
export type EditorProps = {
  items: ItemRow[];
  clips: ClipRow[];
  captions: CaptionRow[];
  graphics: GraphicRow[];
  audio: AudioRow[];
  accent: string;
  /** The language the cut was made in, when known: the track the preview leads with. */
  preferredLanguage?: string | null;
  zh: boolean;
  busy: boolean;
  onTrim: (itemId: string, input: { inMs: number; outMs: number }) => void;
  onMove: (itemId: string, direction: "up" | "down") => void;
  onRemove: (itemId: string) => void;
  onAddClip: (clipId: string) => void;
  onSplit: (itemId: string, atMs: number) => void;
  /** The right-hand panel's contents for whatever is selected. */
  inspector: (selected: Selection) => React.ReactNode;
  /** The assistant, under the inspector. It does most of the editing. */
  assistant?: React.ReactNode;
  /** A caption dragged along the timeline, or its edges pulled. */
  onRetimeCaption?: (id: string, input: { startMs: number; endMs: number }) => void;
  /** A graphic dragged along the timeline, or its edges pulled. */
  onRetimeGraphic?: (id: string, input: { startMs: number; endMs: number }) => void;
  /** A music or voice-over track dragged to a new start. */
  onMoveTrack?: (id: string, startMs: number) => void;
  /** Footage dropped on the timeline, or picked in the bin. */
  onDropClip?: (clipId: string, atMs: number) => void;
  /** Files dropped on the media panel. */
  onUpload?: (files: FileList) => void;
  /** The + on the Captions track: a new line at the playhead. */
  onAddCaption?: (atMs: number) => void;
  /** The + on the Graphics track: a new graphic at the playhead. */
  onAddGraphic?: (atMs: number) => void;
  /** Take back the last change — including a whole turn from the assistant.
   * Absent when there is nothing to take back. */
  onUndo?: (() => void) | null;
  onRedo?: (() => void) | null;
};

export type Selection =
  | { kind: "item"; id: string }
  | { kind: "caption"; id: string }
  | { kind: "graphic"; id: string }
  | null;

/*
 * The studio's own palette, not an editor's.
 *
 * This was dark, on the argument that the picture should be the brightest
 * thing in the window. That argument is real and it lost to a better one: the
 * rest of the product is white, and a person moving from Files to the editor
 * should not feel they have changed application. Consistency beats a
 * colour-grading convention in a tool nobody is colour grading in.
 *
 * The stage behind the picture stays a neutral grey — light, but not white —
 * so a video with white in it still has an edge.
 */
const INK = "#171717";
const MUTED = "#999999";
const PANEL = "#fcfcfc";
const CHROME = "#ffffff";
const LINE = "#ededed";
const TRACK = "#f8f8f8";
const STAGE = "#f3f3f3";

export function Editor(props: EditorProps) {
  const { items, clips, captions, graphics, audio, accent, zh, busy } = props;
  const t = (en: string, cn: string) => (zh ? cn : en);

  const video = useRef<HTMLVideoElement | null>(null);
  const lane = useRef<HTMLDivElement | null>(null);
  /* The playhead, where the `timeupdate` handler can read it without being
     torn down and rebuilt on every frame — which is what listing it as an
     effect dependency would do. Written in an effect, never during render. */
  const atMsRef = useRef(0);
  /* The file picker behind the + on the Video and Audio tracks. Dropping on
     the bin already worked; a + is what somebody looks for. */
  const filePicker = useRef<HTMLInputElement | null>(null);
  const [accept, setAccept] = useState("video/*");
  const pick = useCallback((kinds: string) => {
    setAccept(kinds);
    // The attribute has to be on the element before the dialog opens.
    requestAnimationFrame(() => filePicker.current?.click());
  }, []);

  const [selected, setSelected] = useState<Selection>(null);
  /* Which half of the right-hand column is open. Selecting something on the
     timeline opens the inspector, because that is what you just asked to look
     at; the assistant opens itself when touched. */
  const [rail, setRail] = useState<"inspector" | "assistant">("assistant");

  /** Select, and show what was selected. Everything on the timeline goes
   * through this rather than `setSelected`, so nothing can select something
   * into a panel that is collapsed. */
  const choose = useCallback((next: Selection) => {
    setSelected(next);
    if (next !== null) setRail("inspector");
  }, []);
  const [atMs, setAtMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Pixels per second. The one control every timeline has. */
  const [zoom, setZoom] = useState(40);
  /** A file is being dragged over the media panel. */
  const [dropping, setDropping] = useState(false);

  const byClip = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);

  /**
   * The edit as one clock.
   *
   * Each cut gets a start on the timeline and keeps its own source range, so a
   * position in the finished video can be turned back into "this file, this
   * many milliseconds in" — which is what the preview needs on every frame and
   * what a click on the timeline has to answer.
   */
  const lanes = useMemo(() => {
    // A running start built by folding rather than by mutating a variable the
    // map closes over: the same arithmetic, and it stays a pure render.
    const rows = items.reduce<
      {
        id: string;
        kind: string;
        label: string;
        atMs: number;
        lengthMs: number;
        inMs: number;
        outMs: number | null;
        fileId: string | null;
        peaks: number[] | null;
        durationMs: number | null;
      }[]
    >((acc, i) => {
      const clip = i.clipId ? byClip.get(i.clipId) : undefined;
      /* A clip not yet measured has no honest length. It is drawn at a
         placeholder five seconds and says so, rather than as a sliver that
         will not play; the page is polling and redraws it to size. */
      const unmeasured = i.kind === "clip" && i.outMs === null && (clip?.durationMs ?? null) === null;
      /* Measured and found to have no readable length (the worker said so):
         still drawn at the placeholder, but not promised as "measuring". */
      const unmeasurable = unmeasured && Boolean(clip?.peaksError);
      const lengthMs = unmeasured ? 5000 : Math.max(1, i.lengthMs);
      const previous = acc[acc.length - 1];
      acc.push({
        id: i.id,
        kind: i.kind,
        label:
          i.kind === "title"
            ? (i.text ?? (zh ? "标题卡" : "Title"))
            : `${i.clipLabel ?? "—"}${unmeasurable ? (zh ? " · 无法读取时长" : " · length unknown") : unmeasured ? (zh ? " · 测量中…" : " · measuring…") : ""}`,
        atMs: previous ? previous.atMs + previous.lengthMs : 0,
        lengthMs,
        inMs: i.inMs,
        outMs: i.outMs,
        fileId: clip?.fileId ?? null,
        peaks: clip?.peaks ?? null,
        durationMs: clip?.durationMs ?? null,
      });
      return acc;
    }, []);

    const last = rows[rows.length - 1];
    return { rows, totalMs: last ? last.atMs + last.lengthMs : 0 };
  }, [items, byClip, zh]);

  const totalMs = Math.max(1000, lanes.totalMs);

  /** Timeline position to source position. Null over a title card, which has
   * no footage behind it. */
  const sourceAt = useCallback(
    (ms: number) => {
      for (const r of lanes.rows) {
        if (ms >= r.atMs && ms < r.atMs + r.lengthMs) {
          if (!r.fileId) return { row: r, fileId: null, sourceMs: 0 };
          return { row: r, fileId: r.fileId, sourceMs: r.inMs + (ms - r.atMs) };
        }
      }
      return null;
    },
    [lanes.rows],
  );

  /* ---------------------------------------------------------- transport */

  /** The file the element currently holds, so it is only reloaded on a change
   * of source rather than on every seek. */
  const loaded = useRef<string | null>(null);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(totalMs, ms));
      setAtMs(clamped);
      const at = sourceAt(clamped);
      const el = video.current;
      if (!el || !at?.fileId) return;
      const src = `/api/files/${at.fileId}/download`;
      if (loaded.current !== at.fileId) {
        /* Loading a new source pauses the element (that is what the media
           load algorithm does), so a cut between two files stopped playback
           dead at the join. If it was playing, it carries on into the next
           file. */
        const wasPlaying = !el.paused;
        loaded.current = at.fileId;
        el.src = src;
        el.currentTime = at.sourceMs / 1000;
        if (wasPlaying) void el.play().catch(() => {});
        return;
      }
      el.currentTime = at.sourceMs / 1000;
    },
    [sourceAt, totalMs],
  );

  /*
   * Playback follows the *timeline*, not the file.
   *
   * The element plays its own source; this watches where it has got to, turns
   * that back into a timeline position, and jumps to the next cut when the
   * current one ends. That is what makes three cuts of one file play as three
   * cuts rather than as the whole file.
   */
  useEffect(() => {
    const el = video.current;
    if (!el) return;

    const tick = () => {
      const at = sourceAt(atMsRef.current);
      if (!at?.fileId) return;
      const sourceMs = el.currentTime * 1000;
      const into = sourceMs - at.row.inMs;

      if (into >= at.row.lengthMs - 30) {
        const next = at.row.atMs + at.row.lengthMs;
        if (next >= totalMs - 30) {
          el.pause();
          setPlaying(false);
          setAtMs(totalMs);
          return;
        }
        seek(next + 1);
        return;
      }
      setAtMs(at.row.atMs + Math.max(0, into));
    };

    el.addEventListener("timeupdate", tick);
    return () => el.removeEventListener("timeupdate", tick);
  }, [sourceAt, seek, totalMs]);

  useEffect(() => {
    atMsRef.current = atMs;
  }, [atMs]);

  /*
   * Show the first frame straight away.
   *
   * A `<video>` with no `src` is a black rectangle, which reads as "broken"
   * rather than as "press play". This puts the playhead at the start once the
   * timeline is known, which loads the source and paints frame one.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current || lanes.rows.length === 0) return;
    started.current = true;
    seek(0);
  }, [lanes.rows.length, seek]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      if (atMs >= totalMs - 30) seek(0);
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  /* Space plays, arrows step, J/K/L because every editor has them. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      if (e.code === "Space" || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(atMsRef.current - (e.shiftKey ? 1000 : 100));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(atMsRef.current + (e.shiftKey ? 1000 : 100));
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "s") {
        e.preventDefault();
        const at = sourceAt(atMsRef.current);
        if (at?.fileId) props.onSplit(at.row.id, at.sourceMs);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ------------------------------------------------------ what is on now */

  /* Two caption tracks (the channel's bilingual look) sit on the same
     seconds. The first language on the cut is the one the timeline shows and
     the one the preview reads; the other is drawn small under it, the way
     the render does. Without this the preview picked whichever line sorted
     first, so it swapped language from one second to the next. */
  const primaryLanguage = primaryLanguageOf(captions, props.preferredLanguage);
  const primaryCaptions = primaryLanguage ? captions.filter((c) => c.language === primaryLanguage) : captions;
  const liveCaption = primaryCaptions.find((c) => atMs >= c.startMs && atMs < c.endMs) ?? null;
  const liveSecond =
    liveCaption && primaryLanguage
      ? (captions.find((c) => c.language !== primaryLanguage && atMs >= c.startMs && atMs < c.endMs) ?? null)
      : null;
  const liveAll = graphics.filter((g) => atMs >= g.startMs && atMs < g.endMs);
  const liveGraphics = liveAll.filter((g) => g.kind !== "punch" && g.kind !== "broll");
  /* A punch-in is shown as the zoom it is, on the element itself; a cutaway
     as a named card where the clip will be. Indications, not the render. */
  const livePunch = liveAll.find((g) => g.kind === "punch") ?? null;
  const liveBroll = liveAll.find((g) => g.kind === "broll") ?? null;
  const punchZoom = livePunch ? Number((livePunch.options as Record<string, unknown> | undefined)?.zoom ?? 1.15) || 1.15 : 1;

  const px = (ms: number) => (ms / 1000) * zoom;
  /** What one pixel of drag is worth, in milliseconds, at this zoom. */
  const msPerPx = 1000 / zoom;
  const msAt = (clientX: number) => {
    const box = lane.current?.getBoundingClientRect();
    if (!box) return 0;
    const x = clientX - box.left + (lane.current?.scrollLeft ?? 0);
    return Math.max(0, Math.round((x / zoom) * 1000));
  };

  return (
    <div
      style={{
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: CHROME,
        color: INK,
      }}
    >
      {/* ================================================== top: three panes */}
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex", gap: 1, background: LINE }}>
        {/* ---- bin ---- */}
        <div
          onDragOver={(e) => {
            if (!props.onUpload) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDropping(false);
          }}
          onDrop={(e) => {
            if (!props.onUpload) return;
            e.preventDefault();
            setDropping(false);
            if (e.dataTransfer.files?.length) props.onUpload(e.dataTransfer.files);
          }}
          style={{
            width: 208,
            flexShrink: 0,
            background: dropping ? "#eef5fd" : PANEL,
            outline: dropping ? `1.5px dashed ${accent}` : "1.5px dashed transparent",
            outlineOffset: -4,
            overflowY: "auto",
            padding: 10,
            transition: "background .12s linear",
          }}
        >
          <Heading>{t("Media", "素材")}</Heading>
          {clips.length === 0 ? (
            <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.55, margin: 0 }}>
              {t("Nothing in the bin yet.", "素材库是空的。")}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {clips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  /* Dragged onto the timeline, or clicked to append. Both,
                     because both are things people try first. */
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-aura-clip", c.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => props.onAddClip(c.id)}
                  title={t("Drag onto the timeline, or click to add it at the end", "拖到时间线，或点击加到末尾")}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${LINE}`,
                    borderRadius: 7,
                    background: "#ffffff",
                    padding: 0,
                    cursor: "pointer",
                    overflow: "hidden",
                    font: "inherit",
                    color: INK,
                  }}
                >
                  {/* A poster is made once by the worker and 404s until it
                      exists, so a plain <img> shows a browser's broken-image
                      icon on every clip somebody has just uploaded. */}
                  <Thumb fileId={c.fileId} />
                  <span style={{ display: "block", padding: "6px 7px", fontSize: 11, lineHeight: 1.35 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.label}
                    </span>
                    <span style={{ color: MUTED }}>
                      {c.durationMs ? clock(c.durationMs) : "—"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---- viewer ---- */}
        <div
          style={{
            flexGrow: 1,
            minWidth: 0,
            background: STAGE,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 14,
              position: "relative",
            }}
          >
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", overflow: "hidden", borderRadius: 4 }}>
              <video
                ref={video}
                preload="metadata"
                playsInline
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                style={{
                  maxWidth: "100%",
                  maxHeight: "56vh",
                  display: "block",
                  background: "#000",
                  borderRadius: 4,
                  transform: punchZoom > 1 ? `scale(${punchZoom})` : undefined,
                  transformOrigin: "center",
                  transition: "transform .25s ease-out",
                }}
              />

              {liveBroll ? (
                <div
                  style={{
                    position: "absolute",
                    inset: liveBroll.placement === "full" || liveBroll.placement === "pip" ? 0 : undefined,
                    right: liveBroll.placement !== "full" && liveBroll.placement !== "pip" ? "5%" : undefined,
                    top: liveBroll.placement === "top-right" ? "6%" : undefined,
                    bottom: liveBroll.placement === "bottom-right" ? "6%" : undefined,
                    width: liveBroll.placement === "full" || liveBroll.placement === "pip" ? undefined : "34%",
                    aspectRatio: liveBroll.placement === "full" || liveBroll.placement === "pip" ? undefined : "16 / 9",
                    /* The pip layout keeps the speaker in a circle at the top
                       right: a round window cut out of the cutaway card, so the
                       video underneath shows through where the circle will be. */
                    ...(liveBroll.placement === "pip"
                      ? {
                          WebkitMaskImage: "radial-gradient(circle at 81% 17%, transparent 13.5%, #000 13.6%)",
                          maskImage: "radial-gradient(circle at 81% 17%, transparent 13.5%, #000 13.6%)",
                        }
                      : {}),
                    background: "rgba(23,23,23,0.82)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 500,
                    pointerEvents: "none",
                    borderRadius: liveBroll.placement === "full" || liveBroll.placement === "pip" ? 0 : 4,
                  }}
                >
                  {t("Cutaway", "空镜")} · {liveBroll.text}
                </div>
              ) : null}

              {/* Graphics and captions over the picture, from the same numbers
                  the renderer uses. Not the render — an indication of it. */}
              {liveGraphics.map((g) => {
                /* Where each kind sits, from the same rules the composition
                   draws with — an indication of the render, not the render. */
                if (g.kind === "icon" || g.kind === "image") {
                  const corner = cornerBox(g.placement, g.scale);
                  const paths = g.kind === "icon" ? (ICONS[g.icon ?? ""]?.d ?? ICONS.check.d) : null;
                  return (
                    <div key={g.id} style={{ ...corner, position: "absolute", pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      {paths ? (
                        <span style={{ width: "100%", aspectRatio: "1", borderRadius: "22%", background: "rgba(0,0,0,0.62)", border: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg viewBox="0 0 24 24" style={{ width: "58%", height: "58%", fill: "none", stroke: accent, strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}>
                            {paths.map((d, i) => (
                              <path key={i} d={d} />
                            ))}
                          </svg>
                        </span>
                      ) : g.fileId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${g.fileId}/download`} alt="" style={{ width: "100%", objectFit: "contain", borderRadius: 3 }} />
                      ) : null}
                      {g.text ? <span style={{ color: "#fff", fontSize: 11, fontWeight: 600, textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>{g.text}</span> : null}
                    </div>
                  );
                }
                const place = graphicPlacement(g.kind);
                return (
                  <div key={g.id} style={{ ...place.box, position: "absolute", pointerEvents: "none" }}>
                    <span style={{ ...place.text, color: g.kind === "card" ? "#171717" : "#fff", textShadow: g.kind === "card" ? "none" : "0 2px 10px rgba(0,0,0,0.7)", ...(g.kind === "statement" || g.kind === "header" ? { borderTopColor: accent } : {}) }}>
                      {g.kind === "bracket" ? <b style={{ color: accent, fontWeight: 300 }}>{"{ "}</b> : null}
                      {g.text
                        .split(/(【[^】]+】)/g)
                        .filter(Boolean)
                        .map((p, i) =>
                          p.startsWith("【") ? (
                            <b key={i} style={{ color: accent, fontWeight: "inherit" }}>{p.slice(1, -1)}</b>
                          ) : (
                            <span key={i}>{p.replace(/\s*\|\s*/g, "\n")}</span>
                          ),
                        )}
                      {g.kind === "bracket" ? <b style={{ color: accent, fontWeight: 300 }}>{" }"}</b> : null}
                      {g.sub ? (
                        <span style={{ display: "block", fontSize: 11, fontWeight: 400, opacity: 0.78, whiteSpace: "pre-line" }}>{g.sub.replace(/\s*\|\s*/g, "\n")}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}

              {liveCaption ? (
                <div
                  style={{
                    position: "absolute",
                    left: "8%",
                    right: "8%",
                    bottom: "7%",
                    textAlign: "center",
                    pointerEvents: "none",
                  }}
                >
                  <span
                    style={{
                      background: "rgba(0,0,0,0.62)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      padding: "4px 9px",
                      borderRadius: 6,
                      display: "inline-block",
                    }}
                  >
                    {liveCaption.text}
                    {liveSecond ? (
                      <span style={{ display: "block", fontSize: 10, fontWeight: 400, opacity: 0.8, marginTop: 2 }}>{liveSecond.text}</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* transport */}
          <div
            style={{
              flexShrink: 0,
              height: 42,
              borderTop: `1px solid ${LINE}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 12px",
            }}
          >
            <Key onClick={() => seek(0)} label={t("Start", "开头")}>
              ⏮
            </Key>
            <Key onClick={() => seek(atMs - 100)} label={t("Back", "后退")}>
              ◀
            </Key>
            <Key onClick={toggle} label={playing ? t("Pause", "暂停") : t("Play", "播放")} wide>
              {playing ? "❚❚" : "▶"}
            </Key>
            <Key onClick={() => seek(atMs + 100)} label={t("Forward", "前进")}>
              ▶
            </Key>

            {/* Cut the clip under the playhead in two. `atMs` is a timeline
                position and the item's own numbers are source positions, so
                the conversion happens here — the only place that knows both. */}
            <Key
              onClick={() => {
                const at = sourceAt(atMs);
                if (at?.fileId) props.onSplit(at.row.id, at.sourceMs);
              }}
              label={t("Split here (S)", "在此切开（S）")}
            >
              ✂
            </Key>

            {/* Undo, where an editor puts it. The browser's Back button is
                navigation and always was; this is the one that takes a change
                back, the assistant's included. */}
            <Key
              onClick={() => props.onUndo?.()}
              label={t("Undo (⌘Z)", "撤销（⌘Z）")}
              disabled={!props.onUndo}
            >
              ↶
            </Key>
            <Key
              onClick={() => props.onRedo?.()}
              label={t("Redo (⇧⌘Z)", "重做（⇧⌘Z）")}
              disabled={!props.onRedo}
            >
              ↷
            </Key>
            <span
              style={{
                fontSize: 11.5,
                color: "#525252",
                fontVariantNumeric: "tabular-nums",
                marginLeft: 6,
              }}
            >
              {stamp(atMs)} / {stamp(totalMs)}
            </span>

            <div style={{ flexGrow: 1 }} />

            <span style={{ fontSize: 10.5, color: MUTED }}>{t("Zoom", "缩放")}</span>
            <input
              type="range"
              min={10}
              max={220}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: 108, accentColor: accent }}
              aria-label={t("Zoom", "缩放")}
            />
          </div>
        </div>

        {/* ---- inspector and assistant, one column, one of them open ----
             They used to share the height: the inspector took up to 44% and
             the assistant got the rest, so selecting a caption squeezed the
             conversation into a slot too small to read. They are an accordion
             now. Selecting something on the timeline opens the inspector;
             touching the assistant opens the assistant; the other collapses to
             its title bar, which is one click from open. */}
        <div
          style={{
            width: 292,
            flexShrink: 0,
            background: PANEL,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <RailPane
            title={
              selected === null
                ? t("Nothing selected", "未选中")
                : selected.kind === "item"
                  ? t("Cut", "片段")
                  : selected.kind === "caption"
                    ? t("Caption", "字幕")
                    : t("Graphic", "图形")
            }
            hint={selected === null ? t("select something", "先选中内容") : undefined}
            open={rail === "inspector"}
            onOpen={() => setRail("inspector")}
          >
            <div style={{ padding: "0 12px 12px" }}>{props.inspector(selected)}</div>
          </RailPane>

          {props.assistant ? (
            <RailPane
              title={t("Assistant", "助理")}
              hint={rail === "assistant" ? undefined : t("ask for a change", "直接说要改什么")}
              open={rail === "assistant"}
              onOpen={() => setRail("assistant")}
              /* Anywhere in the panel counts as "I am using this", so typing
                 in the composer does not need a separate click to open it. */
              onPointerDownCapture={() => setRail("assistant")}
              flush
            >
              {props.assistant}
            </RailPane>
          ) : null}
        </div>
      </div>

      {/* ==================================================== the timeline */}
      <div
        style={{
          flexShrink: 0,
          height: 212,
          borderTop: `1px solid ${LINE}`,
          background: PANEL,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", minHeight: 0, flexGrow: 1 }}>
          {/* Track names, spelled out. They were single letters — V, C, G, A —
              which is what an edit suite does when the gutter is 60px wide.
              This one has room for the words, and a word needs no legend. */}
          <div style={{ width: 112, flexShrink: 0, borderRight: `1px solid ${LINE}`, paddingTop: 20 }}>
            {(
              [
                ["video", t("Video", "画面"), t("Add footage", "添加素材")],
                ["captions", t("Captions", "字幕"), t("Add a caption here", "在此加一条字幕")],
                ["graphics", t("Graphics", "图形"), t("Add a graphic here", "在此加一个图形")],
                ["audio", t("Audio", "音频"), t("Add music or a voice-over", "添加音乐或配音")],
              ] as const
            ).map(([k, name, add]) => (
              <div
                key={k}
                style={{
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 8px 0 10px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#525252",
                  borderBottom: `1px solid ${LINE}`,
                }}
                title={name}
              >
                <span
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {name}
                </span>
                {/* One + per track. Video and Audio open the file picker;
                    Captions and Graphics put one at the playhead, which is
                    where somebody looking at the frame wants it. */}
                <button
                  type="button"
                  title={add}
                  aria-label={add}
                  onClick={() => {
                    if (k === "video") pick("video/*");
                    else if (k === "audio") pick("audio/*");
                    else if (k === "captions") props.onAddCaption?.(atMs);
                    else props.onAddGraphic?.(atMs);
                  }}
                  disabled={
                    (k === "captions" && !props.onAddCaption) ||
                    (k === "graphics" && !props.onAddGraphic) ||
                    ((k === "video" || k === "audio") && !props.onUpload)
                  }
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    padding: 0,
                    borderRadius: 5,
                    border: `1px solid ${LINE}`,
                    background: "#ffffff",
                    color: MUTED,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 0,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2.4, strokeLinecap: "round" }}
                  >
                    <path d="M12 6v12M6 12h12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* the tracks themselves */}
          <div
            ref={lane}
            onPointerDown={(e) => {
              /* The playhead follows the press, wherever it lands — on a
                 block as well as between them. It used to ignore presses on a
                 block, so clicking a caption selected it and left the viewer
                 showing a different moment entirely. Dragging still works:
                 the block captures the pointer after this. */
              seek(msAt(e.clientX));
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/x-aura-clip")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              const clipId = e.dataTransfer.getData("text/x-aura-clip");
              if (!clipId) return;
              e.preventDefault();
              props.onDropClip?.(clipId, msAt(e.clientX));
            }}
            style={{ flexGrow: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden", position: "relative" }}
          >
            <div style={{ minWidth: "100%", width: px(totalMs) + 160, position: "relative" }}>
              <Ruler totalMs={totalMs} zoom={zoom} />

              {lanes.rows.length === 0 ? (
                <div
                  style={{
                    position: "absolute",
                    left: 16,
                    top: 46,
                    fontSize: 11.5,
                    color: "#b0b0b0",
                    pointerEvents: "none",
                    lineHeight: 1.6,
                  }}
                >
                  {t(
                    "Nothing on the timeline yet — drag a clip here from Media, or click one to add it at the end.",
                    "时间线还是空的 —— 从左侧把素材拖进来，或点击素材加到末尾。",
                  )}
                </div>
              ) : null}

              {/* V */}
              <Track
                /* Double click to move the selected cut here. A single click
                   on this track is a seek — it is how you scrub — so the
                   second tap is what says "and put that cut here". The cuts
                   are a sequence, not free positions, so this lands it at the
                   join nearest where you tapped. */
                onPlaceTwice={(e) => {
                  if (selected?.kind !== "item") return;
                  const index = lanes.rows.findIndex((r) => r.id === selected.id);
                  if (index < 0) return;
                  const ms = Math.max(0, msAt(e.clientX));
                  let target = lanes.rows.findIndex((r) => ms < r.atMs + r.lengthMs / 2);
                  if (target < 0) target = lanes.rows.length - 1;
                  const steps = target - index;
                  if (steps === 0) return;
                  for (let n = 0; n < Math.abs(steps); n++) {
                    props.onMove(selected.id, steps > 0 ? "down" : "up");
                  }
                }}
              >
                {lanes.rows.map((r, i) => (
                  <Block
                    key={r.id}
                    left={px(r.atMs)}
                    width={px(r.lengthMs)}
                    colour={r.kind === "title" ? "#e2e2e6" : "#cfe4f6"}
                    edge={accent}
                    on={selected?.kind === "item" && selected.id === r.id}
                    onSelect={() => choose({ kind: "item", id: r.id })}
                    peaks={r.peaks}
                    label={r.label}
                    msPerPx={msPerPx}
                    /* The video track is a sequence with no gaps, so moving a
                       cut means reordering it: dragged past the midpoint of a
                       neighbour, it swaps with that neighbour. */
                    onMove={(deltaMs) => {
                      const steps = Math.round(deltaMs / Math.max(1, r.lengthMs / 2));
                      if (steps === 0) return;
                      const direction = steps > 0 ? "down" : "up";
                      const distance = Math.min(Math.abs(steps), direction === "down" ? lanes.rows.length - 1 - i : i);
                      for (let n = 0; n < distance; n++) props.onMove(r.id, direction);
                    }}
                    onTrim={(which, deltaMs) => {
                      const inMs = which === "in" ? Math.max(0, r.inMs + deltaMs) : r.inMs;
                      const outMs =
                        which === "out"
                          ? Math.max(inMs + 200, (r.outMs ?? r.inMs + r.lengthMs) + deltaMs)
                          : (r.outMs ?? r.inMs + r.lengthMs);
                      if (outMs - inMs < 200) return;
                      props.onTrim(r.id, { inMs, outMs });
                    }}
                    movable={r.kind !== "title"}
                    trimmable={r.kind !== "title"}
                  />
                ))}
              </Track>

              {/* C */}
              <Track
                onPlace={(e) => {
                  if (selected?.kind !== "caption") return;
                  const c = captions.find((x) => x.id === selected.id);
                  if (!c) return;
                  const startMs = Math.max(0, msAt(e.clientX));
                  props.onRetimeCaption?.(c.id, { startMs, endMs: startMs + (c.endMs - c.startMs) });
                }}
              >
                {primaryCaptions.map((c) => (
                  <Block
                    key={c.id}
                    left={px(c.startMs)}
                    width={Math.max(4, px(c.endMs - c.startMs))}
                    colour="#d7ecd9"
                    edge={accent}
                    on={selected?.kind === "caption" && selected.id === c.id}
                    onSelect={() => choose({ kind: "caption", id: c.id })}
                    label={c.text}
                    msPerPx={msPerPx}
                    /* A caption sits at a time, so dragging it is re-timing:
                       both ends move together and the line keeps its length. */
                    onMove={(deltaMs) =>
                      props.onRetimeCaption?.(c.id, {
                        startMs: Math.max(0, c.startMs + deltaMs),
                        endMs: Math.max(0, c.endMs + deltaMs),
                      })
                    }
                    onTrim={(which, deltaMs) =>
                      props.onRetimeCaption?.(c.id, {
                        startMs: which === "in" ? Math.max(0, c.startMs + deltaMs) : c.startMs,
                        endMs: which === "out" ? Math.max(c.startMs + 200, c.endMs + deltaMs) : c.endMs,
                      })
                    }
                  />
                ))}
              </Track>

              {/* G */}
              <Track
                onPlace={(e) => {
                  if (selected?.kind !== "graphic") return;
                  const g = graphics.find((x) => x.id === selected.id);
                  if (!g) return;
                  const startMs = Math.max(0, msAt(e.clientX));
                  props.onRetimeGraphic?.(g.id, { startMs, endMs: startMs + (g.endMs - g.startMs) });
                }}
              >
                {graphics.map((g) => (
                  <Block
                    key={g.id}
                    left={px(g.startMs)}
                    width={Math.max(4, px(g.endMs - g.startMs))}
                    /* Three colours for three different things: type over the
                       picture, a picture over the picture, and the picture
                       itself moving. */
                    colour={g.kind === "punch" ? "#dfe4f7" : g.kind === "broll" || g.kind === "image" ? "#f3d9d9" : "#f6e6cd"}
                    edge={accent}
                    on={selected?.kind === "graphic" && selected.id === g.id}
                    onSelect={() => choose({ kind: "graphic", id: g.id })}
                    label={
                      g.kind === "punch"
                        ? `${t("Punch in", "推近")} ×${(Number((g.options as Record<string, unknown> | undefined)?.zoom ?? 1.15) || 1.15).toFixed(2)}`
                        : g.kind === "broll"
                          ? `${t("Cutaway", "空镜")} · ${g.text}`
                          : g.kind === "icon"
                            ? `${t("Icon", "图标")} · ${g.icon ?? ""}${g.text ? ` · ${g.text}` : ""}`
                            : g.kind === "image"
                              ? `${t("Picture", "图片")}${g.text ? ` · ${g.text}` : ""}`
                              : g.text
                    }
                    msPerPx={msPerPx}
                    onMove={(deltaMs) =>
                      props.onRetimeGraphic?.(g.id, {
                        startMs: Math.max(0, g.startMs + deltaMs),
                        endMs: Math.max(0, g.endMs + deltaMs),
                      })
                    }
                    onTrim={(which, deltaMs) =>
                      props.onRetimeGraphic?.(g.id, {
                        startMs: which === "in" ? Math.max(0, g.startMs + deltaMs) : g.startMs,
                        endMs: which === "out" ? Math.max(g.startMs + 500, g.endMs + deltaMs) : g.endMs,
                      })
                    }
                  />
                ))}
              </Track>

              {/* A */}
              <Track last>
                {audio.map((a) => (
                  <Block
                    key={a.id}
                    left={px(a.startMs)}
                    width={Math.max(6, px(Math.max(2000, totalMs - a.startMs)))}
                    colour="#e6ddf3"
                    edge={accent}
                    on={false}
                    onSelect={() => {}}
                    label={a.label ?? a.kind}
                    msPerPx={msPerPx}
                    onMove={(deltaMs) => props.onMoveTrack?.(a.id, Math.max(0, a.startMs + deltaMs))}
                    trimmable={false}
                  />
                ))}
              </Track>

              {/* the playhead, through every track */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: px(atMs),
                  width: 1,
                  background: "#ff4d4d",
                  pointerEvents: "none",
                  zIndex: 5,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    left: -5,
                    width: 11,
                    height: 11,
                    background: "#ff4d4d",
                    clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The picker behind the + on the Video and Audio tracks. */}
      <input
        ref={filePicker}
        type="file"
        multiple
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) props.onUpload?.(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

/**
 * One half of the right-hand column, open or shut.
 *
 * The inspector and the assistant used to divide the height between them,
 * which meant the one you were not using still took a third of the column and
 * the one you were using was too short to work in. Here, whichever you touched
 * last fills the column and the other keeps its title bar — always visible,
 * always one click from open, so nothing is hidden, only folded.
 */
function RailPane({
  title,
  hint,
  open,
  onOpen,
  onPointerDownCapture,
  flush = false,
  children,
}: {
  title: string;
  /** A few words on what this is for, while it is folded. */
  hint?: string;
  open: boolean;
  onOpen: () => void;
  onPointerDownCapture?: () => void;
  /** The assistant draws its own padding; the inspector does not. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerDownCapture={onPointerDownCapture}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flexGrow: open ? 1 : 0,
        flexShrink: open ? 1 : 0,
        borderTop: `1px solid ${LINE}`,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          height: 30,
          padding: "0 12px",
          border: 0,
          background: "transparent",
          cursor: open ? "default" : "pointer",
          font: "inherit",
          fontSize: 10,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: MUTED,
          textAlign: "left",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          style={{
            width: 10,
            height: 10,
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2.6,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .12s linear",
            flexShrink: 0,
          }}
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
        <span style={{ color: open ? "#525252" : MUTED }}>{title}</span>
        {!open && hint ? (
          <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontSize: 10.5 }}>
            {hint}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            overflowY: flush ? "hidden" : "auto",
            display: flush ? "flex" : "block",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: MUTED,
        marginBottom: 9,
      }}
    >
      {children}
    </div>
  );
}

function Key({
  children,
  onClick,
  label,
  wide,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  wide?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: wide ? 40 : 28,
        height: 26,
        borderRadius: 6,
        border: `1px solid ${LINE}`,
        background: wide ? "#171717" : "transparent",
        color: wide ? "#ffffff" : INK,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "default" : "pointer",
        fontSize: 11,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function Track({
  children,
  last,
  onPlace,
  onPlaceTwice,
}: {
  children: React.ReactNode;
  last?: boolean;
  /**
   * A click on the empty part of this track, with the time it landed on.
   *
   * Used to move whatever is selected on this track to where you tapped —
   * dragging a 4-second block across a minute of timeline is precise and
   * slow, and "put it here" is what people try first.
   */
  onPlace?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** A double click anywhere on this track, block included. The video track
   * uses it: a single click there is a seek, so moving a cut needs the second
   * tap to say "no, I meant put it here". */
  onPlaceTwice?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onClick={(e) => {
        // A click that landed on a block is that block's business.
        if ((e.target as HTMLElement).dataset.block !== undefined) return;
        onPlace?.(e);
      }}
      onDoubleClick={(e) => onPlaceTwice?.(e)}
      style={{
        position: "relative",
        height: 40,
        borderBottom: last ? "none" : `1px solid ${LINE}`,
        background: TRACK,
        cursor: onPlace ? "copy" : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A block on the timeline.
 *
 * The waveform is drawn inside the video blocks rather than on a track of its
 * own: the sound belongs to the clip, and a separate audio lane for footage
 * that has not been detached is a lane of duplicates.
 */
/**
 * A block on the timeline, and everything you can do to it by dragging.
 *
 * This was a coloured rectangle you could click. That is a list with a time
 * axis, not a timeline — the whole reason an editor draws blocks is so you can
 * take hold of them.
 *
 * Three gestures, which are the three every editor has:
 *
 *   — **Drag the body** to move it. On the caption and graphic tracks that
 *     re-times it. On the video track it reorders the cut, because the items
 *     there are a sequence with no gaps: dropping a clip halfway along means
 *     "put it there in the order", not "leave a hole".
 *   — **Drag an edge** to trim. The picture follows the edge you are holding,
 *     so you are choosing a frame while looking at it.
 *   — **Click** to select, which is the old behaviour and still the one that
 *     opens the inspector.
 *
 * Committed on release, never per pixel: a write per pointer move would be a
 * write per pixel.
 */
function Block({
  left,
  width,
  colour,
  edge,
  on,
  onSelect,
  label,
  peaks,
  msPerPx,
  onMove,
  onTrim,
  movable = true,
  trimmable = true,
}: {
  left: number;
  width: number;
  colour: string;
  edge: string;
  on: boolean;
  onSelect: () => void;
  label: string;
  peaks?: number[] | null;
  /** How much time a pixel is worth at the current zoom. */
  msPerPx: number;
  /** Dropped somewhere else. `deltaMs` is how far it travelled. */
  onMove?: (deltaMs: number) => void;
  /** An edge released. `which` says which one, `deltaMs` how far it moved. */
  onTrim?: (which: "in" | "out", deltaMs: number) => void;
  movable?: boolean;
  trimmable?: boolean;
}) {
  /* While a drag is in flight the block follows the pointer locally, so it
     moves at the frame rate rather than at the speed of a round trip. */
  const [drag, setDrag] = useState<{ kind: "move" | "in" | "out"; deltaMs: number } | null>(null);

  const begin =
    (kind: "move" | "in" | "out") => (e: React.PointerEvent<HTMLDivElement>) => {
      if (kind === "move" && !movable) return;
      if (kind !== "move" && !trimmable) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect();

      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      let deltaMs = 0;

      const move = (ev: PointerEvent) => {
        deltaMs = Math.round((ev.clientX - startX) * msPerPx);
        setDrag({ kind, deltaMs });
      };

      const up = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        setDrag(null);
        // Under four pixels is a click somebody's hand wobbled on.
        if (Math.abs(deltaMs) < msPerPx * 4) return;
        if (kind === "move") onMove?.(deltaMs);
        else onTrim?.(kind, deltaMs);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
      document.body.style.cursor = kind === "move" ? "grabbing" : "ew-resize";
      document.body.style.userSelect = "none";
    };

  // What the block looks like mid-drag: moved, or with one edge pulled.
  const offset = drag?.kind === "move" ? drag.deltaMs / msPerPx : 0;
  const inPull = drag?.kind === "in" ? drag.deltaMs / msPerPx : 0;
  const outPull = drag?.kind === "out" ? drag.deltaMs / msPerPx : 0;

  return (
    <div
      data-block=""
      role="button"
      tabIndex={0}
      onPointerDown={begin("move")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      title={label}
      style={{
        position: "absolute",
        left: left + offset + inPull,
        width: Math.max(3, width - inPull + outPull),
        top: 3,
        bottom: 3,
        background: colour,
        border: on ? `1.5px solid ${edge}` : "1px solid rgba(23,23,23,0.10)",
        borderRadius: 4,
        overflow: "hidden",
        cursor: movable ? (drag ? "grabbing" : "grab") : "pointer",
        display: "flex",
        alignItems: "flex-end",
        opacity: drag ? 0.85 : 1,
        boxShadow: drag ? "0 4px 14px rgba(23,23,23,0.22)" : "none",
        zIndex: drag ? 4 : 1,
        touchAction: "none",
      }}
    >
      {peaks?.length ? (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.55 }}
        >
          <polygon
            points={`${peaks.map((v, i) => `${(i / (peaks.length - 1)) * 100},${50 - v * 44}`).join(" ")} ${peaks
              .map((v, i) => `${((peaks.length - 1 - i) / (peaks.length - 1)) * 100},${50 + v * 44}`)
              .join(" ")}`}
            fill="#7fb3dd"
          />
        </svg>
      ) : null}

      <span
        style={{
          position: "relative",
          fontSize: 9.5,
          color: "#383838",
          padding: "0 4px 3px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          textShadow: "none",
          pointerEvents: "none",
        }}
      >
        {label}
      </span>

      {/* The edges. Six pixels is what a hand can hit without hitting the
          body, and they only appear on blocks wide enough to have two. */}
      {trimmable && width > 22
        ? (["in", "out"] as const).map((which) => (
            <div
              key={which}
              onPointerDown={begin(which)}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                [which === "in" ? "left" : "right"]: 0,
                width: 6,
                cursor: "ew-resize",
                background: on ? edge : "transparent",
                opacity: on ? 0.45 : 0,
                touchAction: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = edge;
                e.currentTarget.style.opacity = "0.55";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = on ? "0.45" : "0";
              }}
            />
          ))
        : null}
    </div>
  );
}

/**
 * A clip's poster, or a placeholder until the worker has made one.
 *
 * `/thumb` answers 404 while the poster job is still queued — which is always
 * true for a few seconds after an upload — and a bare `<img>` renders that as
 * a broken-image icon, the one graphic that makes a product look unfinished.
 */
function Thumb({ fileId }: { fileId: string }) {
  return (
    <Poster
      src={`/api/files/${fileId}/thumb`}
      style={{ width: "100%", height: 72, objectFit: "cover", display: "block", background: "#000" }}
      fallback={
        <svg
          viewBox="0 0 24 24"
          style={{ width: 17, height: 17, fill: "none", stroke: "#c7c7c7", strokeWidth: 1.6, strokeLinejoin: "round" }}
        >
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="m10 9.5 5 2.5-5 2.5z" />
        </svg>
      }
    />
  );
}

/** Seconds along the top, at whatever spacing the zoom makes readable. */
function Ruler({ totalMs, zoom }: { totalMs: number; zoom: number }) {
  // A tick every 1, 2, 5, 10, 30 or 60 seconds — whichever first gives about
  // 60 pixels of room, so the numbers never collide.
  const steps = [1, 2, 5, 10, 30, 60, 120, 300];
  const step = steps.find((s) => s * zoom >= 58) ?? 600;
  const count = Math.ceil(totalMs / 1000 / step) + 1;

  return (
    <div style={{ position: "relative", height: 20, borderBottom: `1px solid ${LINE}`, background: "#f3f3f3" }}>
      {Array.from({ length: count }, (_, i) => i * step).map((s) => (
        <span
          key={s}
          style={{
            position: "absolute",
            left: (s / 1) * zoom,
            top: 0,
            bottom: 0,
            paddingLeft: 4,
            fontSize: 9.5,
            color: "#b0b0b0",
            borderLeft: `1px solid ${LINE}`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {clock(s * 1000)}
        </span>
      ))}
    </div>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 0:04.2 — the precision an edit is actually made at. */
function stamp(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  return `${m}:${(total - m * 60).toFixed(1).padStart(4, "0")}`;
}


/** A corner or the middle, at a share of the frame's height, for an icon or a picture. */
function cornerBox(placement: string, scale: number): React.CSSProperties {
  const share = `${Math.max(5, Math.min(90, scale))}%`;
  if (placement === "full") return { inset: 0 };
  const base: React.CSSProperties = { width: share, maxWidth: "60%" };
  switch (placement) {
    case "top-left":
      return { ...base, left: "5%", top: "6%" };
    case "top-right":
      return { ...base, right: "5%", top: "6%" };
    case "bottom-left":
      return { ...base, left: "5%", bottom: "12%" };
    case "bottom-right":
      return { ...base, right: "5%", bottom: "12%" };
    case "bottom-center":
      return { ...base, left: "50%", bottom: "12%", transform: "translateX(-50%)" };
    default:
      return { ...base, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }
}

/**
 * Roughly where each graphic lands, for the viewer's preview.
 *
 * Deliberately approximate: the real thing is drawn by Remotion at full size.
 * What this has to get right is *which corner*, so that moving a lower third
 * and moving a chapter mark do not look like the same edit.
 */
function graphicPlacement(kind: string): { box: React.CSSProperties; text: React.CSSProperties } {
  const centred: React.CSSProperties = {
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "0 8%",
  };

  switch (kind) {
    case "lower-third":
      return {
        box: { left: "6%", bottom: "12%" },
        text: { display: "inline-block", borderLeft: "3px solid currentColor", paddingLeft: 8, fontSize: 15, fontWeight: 650 },
      };
    case "chapter":
      return {
        box: { left: "5%", top: "7%" },
        text: {
          display: "inline-block",
          background: "rgba(0,0,0,0.55)",
          padding: "3px 7px",
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 650,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        },
      };
    case "badge":
      return {
        box: { right: "5%", top: "7%" },
        text: {
          display: "inline-block",
          background: "rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.18)",
          padding: "3px 9px",
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 650,
        },
      };
    case "ticker":
      return {
        box: { left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.72)", padding: "4px 10px" },
        text: { display: "block", fontSize: 11, fontWeight: 500 },
      };
    case "quote":
      return {
        box: { inset: 0, display: "flex", alignItems: "center", padding: "0 10%", background: "rgba(0,0,0,0.35)" },
        text: { display: "inline-block", fontSize: 16, fontWeight: 500, textAlign: "left", lineHeight: 1.35 },
      };
    case "stat":
      return { box: centred, text: { display: "inline-block", fontSize: 40, fontWeight: 750, letterSpacing: "-0.03em" } };
    case "bracket":
      return {
        box: { ...centred, background: "rgba(0,0,0,0.8)" },
        text: { display: "inline-block", fontSize: 20, fontWeight: 650, fontStyle: "italic" },
      };
    case "statement":
      return {
        box: { left: "5%", bottom: "44%", maxWidth: "90%" },
        text: { display: "inline-block", borderTop: "3px solid currentColor", paddingTop: 4, fontSize: 17, fontWeight: 700, lineHeight: 1.3, textAlign: "left", whiteSpace: "pre-line" },
      };
    case "header":
      return {
        box: { left: "4%", top: "5%", maxWidth: "88%" },
        text: { display: "inline-block", borderTop: "3px solid currentColor", paddingTop: 3, fontSize: 12, fontWeight: 700, lineHeight: 1.25, textAlign: "left" },
      };
    case "watermark":
      return {
        box: { left: 0, right: 0, bottom: "16%", textAlign: "center" },
        text: { display: "inline-block", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.9 },
      };
    case "footnote":
      return {
        box: { left: 0, right: 0, bottom: "4%", textAlign: "center", padding: "0 6%" },
        text: { display: "inline-block", fontSize: 7, fontWeight: 400, opacity: 0.75 },
      };
    case "card":
      return {
        box: { left: 0, right: 0, bottom: "46%", textAlign: "center" },
        text: { display: "inline-block", background: "rgba(255,255,255,0.96)", color: "#171717", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, textShadow: "none" },
      };
    case "end-card":
      return {
        box: { ...centred, background: "#000" },
        text: { display: "inline-block", fontSize: 22, fontWeight: 650 },
      };
    default:
      return { box: centred, text: { display: "inline-block", fontSize: 15, fontWeight: 650 } };
  }
}
