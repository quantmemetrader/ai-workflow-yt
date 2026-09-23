"use client";

import { useEffect, useRef } from "react";
import type { ClipRow, GraphicRow } from "@/lib/video/service";
import { ICONS } from "@/lib/video/icons";

/**
 * What the render will look like, drawn over the preview.
 *
 * The editor used to promise a composite and show a talking head: the timeline
 * said "cutaway", "big number", "end card", and the picture underneath was the
 * raw interview with a grey card reading 空镜 where the footage should be. The
 * studio's words, and they are the whole reason this module exists: *"in the
 * editor it shows pink blocks of graphics but still I don't see no graphics on
 * the video part"*. A producer cannot judge a cut against a legend.
 *
 * So everything here is a second reading of `remotion/src/Graphics.tsx` and of
 * `brollFilter` in `lib/video/graphics.ts` — the two places that decide what
 * the exported file actually looks like — in HTML, at the size the preview
 * happens to be. Every number below is a share of the frame's **height**, the
 * same rule the composition uses (`ratio(height, share)`), so a 9:16 cut and a
 * 16:9 cut agree and so does the preview at whatever size the window gives it.
 *
 * It is an approximation and it is meant to be. Type sets in the browser's
 * faces rather than the box's Noto, the arrival springs are not simulated
 * (a graphic is simply on or off), and a cutaway plays its own file rather
 * than the encoded one. What it does get right is *what*, *where* and *when* —
 * which is what a cut is judged on. The exported file is still the truth.
 *
 * Two things deliberately live in `Editor.tsx` and not here: the punch-in,
 * which is a transform on the `<video>` itself because it zooms the picture
 * and nothing over it, and the captions, which were already right.
 */

/* The faces. The composition asks for Inter and Noto Sans CJK SC, which is
   what the box has; a browser in Hong Kong has PingFang or YaHei instead, so
   the app's own stack follows the render's names rather than replacing them.
   Naming a CJK face is not optional — see CLIENT-BACKLOG: a bare `Inter,
   system-ui` picked a Japanese fallback and drew the wrong glyph forms. */
const FAMILY =
  '"Inter", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif';
const CJK =
  '"Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "Inter", system-ui, sans-serif';

/** The composition's own values (`remotion/src/theme.ts`). */
const INK = "#ffffff";
const QUIET = "rgba(255,255,255,0.68)";

/** Whether a line is mostly Chinese, which picks the face — as `Graphics.tsx`. */
const isCjk = (text: string) => (text.match(/[\u3400-\u9fff]/g) ?? []).length > text.length / 3;

/** The picture's rendered size, in CSS pixels. */
export type Frame = { w: number; h: number };

export type LivePreviewOverlayProps = {
  /** The cutaway live at the playhead, if any. Drawn under everything else. */
  cutaway: GraphicRow | null;
  /** Everything else live at the playhead: punch-ins and cutaways removed. */
  graphics: GraphicRow[];
  /** The bin, for resolving a cutaway's clip to a file to play. */
  clips: ClipRow[];
  /** The playhead, on the timeline's clock. */
  atMs: number;
  /** Whether the main picture is running, so the cutaway runs with it. */
  playing: boolean;
  accent: string;
  zh: boolean;
  frame: Frame;
};

/**
 * Where a cutaway's footage comes from.
 *
 * A `broll` row carries `options.clipId` (a row in the bin, not a file) and
 * `options.sourceInMs`, which is what `render.ts` reads. Exported because the
 * `<video>` in the editor has to know whether the pip will really draw before
 * it moves the speaker into the circle for it.
 */
export function cutawaySource(
  graphic: GraphicRow,
  clips: ClipRow[],
): { fileId: string; sourceInMs: number } | null {
  const clipId = String((graphic.options as Record<string, unknown> | undefined)?.clipId ?? "");
  if (!clipId) return null;
  const clip = clips.find((c) => c.id === clipId);
  if (!clip?.fileId) return null;
  /* The 480p proxy when the clip has one, the master otherwise — the same
     choice the main picture makes in `seek`. A cutaway is three seconds of
     footage behind a sentence; there is no reason to pull a 570MB master
     across a continent to judge whether it belongs there. Read through a cast
     rather than off `ClipRow` directly: proxies for bin clips arrived with
     this change and a preview that stops compiling if they are rolled back is
     a preview nobody can look at. */
  const proxyFileId = (clip as ClipRow & { proxyFileId?: string | null }).proxyFileId ?? null;
  return {
    fileId: proxyFileId ?? clip.fileId,
    sourceInMs: Math.max(0, Number((graphic.options as Record<string, unknown> | undefined)?.sourceInMs ?? 0) || 0),
  };
}

/**
 * The speaker's circle in a picture-in-picture cutaway, as shares of the frame.
 *
 * Measured from `brollFilter`, which is measured from the channel's own cut:
 * the presenter is cropped around the face and set in a ringed circle under
 * the header, top right, while the footage fills the frame behind them.
 */
function pip(portrait: boolean) {
  return portrait
    ? { cx: 0.74, cy: 0.31, d: 0.28, base: "w" as const, crop: 0.56, cropCy: 0.4 }
    : { cx: 0.8, cy: 0.28, d: 0.3, base: "h" as const, crop: 0.62, cropCy: 0.46 };
}

/**
 * How the main `<video>` has to move so the speaker lands in that circle.
 *
 * The render crops a square around the face out of the frame and scales it
 * into the circle. Nothing here can crop a `<video>` — but the cutaway covers
 * the whole frame except a round hole, so moving and shrinking the picture
 * underneath until the face sits behind the hole comes to the same thing, at
 * the cost of no second decode. Percentages, because the element's own box is
 * the only size either side of this needs to agree on.
 */
export function speakerTransform(portrait: boolean): { transform: string; transformOrigin: string } {
  const c = pip(portrait);
  const scale = c.d / c.crop;
  const dx = Math.round((c.cx - 0.5) * 1000) / 10;
  const dy = Math.round((c.cy - c.cropCy) * 1000) / 10;
  return {
    transform: `translate(${dx}%, ${dy}%) scale(${scale.toFixed(3)})`,
    transformOrigin: `50% ${c.cropCy * 100}%`,
  };
}

export function LivePreviewOverlay({
  cutaway,
  graphics,
  clips,
  atMs,
  playing,
  accent,
  zh,
  frame,
}: LivePreviewOverlayProps) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { w, h } = frame;
  const portrait = h > w;

  /** A share of the frame's height, in pixels — the composition's `ratio`. */
  const r = (share: number) => Math.round(h * share);
  /* The same, floored at seven pixels, for type only. A footnote is 1.2% of
     the height: twenty-three pixels in the export and four in a preview a
     third the size, which is a grey smear rather than a footnote. Everything
     else stays proportional; this only rescues the two or three sizes that
     fall under legibility on a small window. */
  const type = (share: number) => Math.max(7, Math.round(h * share));

  const source = cutaway ? cutawaySource(cutaway, clips) : null;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* The cutaway first, so the furniture draws over it — the order the
          render composites in: picture, cutaway, stills, captions. */}
      {cutaway ? (
        source ? (
          <Cutaway
            key={cutaway.id}
            graphic={cutaway}
            source={source}
            atMs={atMs}
            playing={playing}
            frame={frame}
            portrait={portrait}
          />
        ) : (
          /* The clip is not in the bin any more — the render drops a cutaway
             like this rather than failing, so the preview says so rather than
             showing the speaker as if nothing were planned. */
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(23,23,23,0.82)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FAMILY,
              fontSize: 12,
              fontWeight: 500,
              textAlign: "center",
              padding: "0 8%",
            }}
          >
            {t("Cutaway", "空镜")} · {cutaway.text || t("clip missing", "素材已不在库中")}
          </div>
        )
      ) : null}

      {h > 0
        ? graphics.map((g) => (
            <Still key={g.id} graphic={g} accent={accent} r={r} type={type} w={w} />
          ))
        : null}
    </div>
  );
}

/* ----------------------------------------------------------- the cutaway */

/**
 * The stock clip, playing where the render will put it.
 *
 * Muted, because a cutaway is a picture over a sentence and the sentence is
 * the speaker's — `brollFilter` never touches the interview's audio. Kept in
 * step with the playhead rather than started and left alone: the two elements
 * decode independently and a second of drift over a four-second cutaway is
 * enough to make a producer distrust the sync. A quarter of a second is the
 * slack, because correcting inside that costs a visible stutter and buys
 * nothing anybody can see.
 */
function Cutaway({
  graphic,
  source,
  atMs,
  playing,
  frame,
  portrait,
}: {
  graphic: GraphicRow;
  source: { fileId: string; sourceInMs: number };
  atMs: number;
  playing: boolean;
  frame: Frame;
  portrait: boolean;
}) {
  const el = useRef<HTMLVideoElement | null>(null);
  /** Where in the cutaway's own file the playhead is, in seconds. */
  const wanted = (source.sourceInMs + Math.max(0, atMs - graphic.startMs)) / 1000;

  /* Follow the playhead. `readyState` is checked because a seek on an element
     that has not got its metadata yet is thrown away; `onLoadedMetadata` does
     that first seek instead. */
  useEffect(() => {
    const v = el.current;
    if (!v || v.readyState < 1) return;
    if (Math.abs(v.currentTime - wanted) > 0.25) v.currentTime = wanted;
  }, [wanted]);

  /* Run and stop with the main picture, including the pause the editor does
     at the end of the timeline. A rejected play() is normal — the element can
     still be loading — and there is nothing to tell anybody about. */
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    if (playing && v.paused) void v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [playing]);

  const placement = graphic.placement || "full";
  const isPip = placement === "pip";
  const full = isPip || placement === "full";
  const { w, h } = frame;

  /* The render takes full-frame footage down a step and vignettes it, so the
     caption over it reads; a quarter more under a pip, so the circle does.
     `eq=brightness=-0.05:saturation=0.9` is an offset, not a multiplier, but
     at this size the difference between the two is not something a producer
     is judging the cut on. */
  const filter = isPip ? "brightness(0.88) saturate(0.85)" : full ? "brightness(0.95) saturate(0.9)" : undefined;

  /* A corner cutaway is `scale` of the frame's height, sixteen by nine, with
     a margin of 5% of the height — the numbers in `brollFilter`. */
  const share = Math.min(0.9, Math.max(0.15, graphic.scale / 100));
  const boxH = Math.round(h * share);
  const boxW = Math.round((boxH * 16) / 9);
  const margin = Math.round(h * 0.05);

  const circle = pip(portrait);
  const radius = ((circle.base === "w" ? w : h) * circle.d) / 2;
  const ring = Math.max(1, Math.round(radius * 0.026));

  const box: React.CSSProperties = full
    ? { inset: 0 }
    : {
        width: boxW,
        height: boxH,
        top: placement.startsWith("top") ? margin : undefined,
        bottom: placement.startsWith("top") ? undefined : margin,
        left: placement.endsWith("left") ? margin : undefined,
        right: placement.endsWith("left") ? undefined : margin,
      };

  return (
    <>
      <div
        style={{
          position: "absolute",
          ...box,
          overflow: "hidden",
          borderRadius: full ? 0 : 3,
          /* The hole the speaker shows through. The `<video>` underneath has
             been moved and shrunk to put the face behind it (see
             `speakerTransform`), which is the render's crop by another
             route. */
          ...(isPip && radius > 0
            ? {
                WebkitMaskImage: `radial-gradient(circle ${radius}px at ${circle.cx * 100}% ${circle.cy * 100}%, transparent ${radius - 0.5}px, #000 ${radius}px)`,
                maskImage: `radial-gradient(circle ${radius}px at ${circle.cx * 100}% ${circle.cy * 100}%, transparent ${radius - 0.5}px, #000 ${radius}px)`,
              }
            : {}),
        }}
      >
        <video
          ref={el}
          src={`/api/files/${source.fileId}/download`}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.currentTime = wanted;
            if (playing) void v.play().catch(() => {});
          }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter }}
        />
        {full ? (
          /* `vignette=PI/4` in the filter chain: the corners come down so the
             words over the middle hold. */
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.45) 100%)",
            }}
          />
        ) : null}
      </div>
      {isPip && radius > 0 ? (
        /* The ring around the speaker. White, as measured from the editor's
           own cut — the accent is kept for the type, not the frame. */
        <div
          style={{
            position: "absolute",
            left: `${circle.cx * 100}%`,
            top: `${circle.cy * 100}%`,
            width: radius * 2,
            height: radius * 2,
            marginLeft: -radius,
            marginTop: -radius,
            borderRadius: "50%",
            border: `${ring}px solid #ffffff`,
            boxSizing: "border-box",
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ the stills */

/** A line with its 【keywords】 in the accent colour, as `Marked` in the composition. */
function Marked({ text, accent, scale = 1.08 }: { text: string; accent: string; scale?: number }) {
  return (
    <>
      {text
        .split(/(【[^】]+】)/g)
        .filter(Boolean)
        .map((p, i) =>
          p.startsWith("【") && p.endsWith("】") ? (
            <span key={i} style={{ color: accent, fontSize: `${Math.round(scale * 100)}%` }}>
              {p.slice(1, -1)}
            </span>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
    </>
  );
}

/** The lines a multi-line graphic is written as: `one | two | three`. */
const lines = (text: string, max: number) =>
  text
    .split(/\n|\|/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);

type StillProps = {
  graphic: GraphicRow;
  accent: string;
  r: (share: number) => number;
  type: (share: number) => number;
  /** The frame's width, which only the FFmpeg-placed picture needs. */
  w: number;
};

/**
 * One graphic, laid out the way `remotion/src/Graphics.tsx` lays it out.
 *
 * Each branch is the same box model as its counterpart there, with
 * `ratio(height, share)` read as `r(share)`, so a change on one side is a
 * findable change on the other. What is dropped: the spring on the way in and
 * the fade on the way out. The preview is scrubbed as often as it is played,
 * and a graphic that fades in every time the playhead lands on it is a
 * graphic you cannot look at.
 */
function Still({ graphic: g, accent, r, type, w }: StillProps) {
  /* `AbsoluteFill` is a **column** flexbox, so `justifyContent` is the vertical
     axis and `alignItems` the horizontal one. Matching that here rather than
     converting each branch is the difference between a layout that can be
     diffed against `Graphics.tsx` and one that has to be re-derived. */
  const fill: React.CSSProperties = { position: "absolute", inset: 0, display: "flex", flexDirection: "column" };
  const face = (text: string) => (isCjk(text) ? CJK : FAMILY);

  switch (g.kind) {
    case "lower-third":
      return (
        <div style={{ ...fill, justifyContent: "flex-end", alignItems: "flex-start", padding: r(0.085) }}>
          <div style={{ display: "flex", alignItems: "stretch", gap: r(0.016) }}>
            {/* A rule, not a box: the name is the graphic. */}
            <div style={{ width: r(0.006), background: accent, borderRadius: r(0.003) }} />
            <div>
              <div
                style={{
                  fontFamily: face(g.text),
                  fontWeight: 650,
                  fontSize: type(0.042),
                  color: INK,
                  lineHeight: 1.15,
                  textShadow: "0 2px 14px rgba(0,0,0,0.55)",
                }}
              >
                {g.text}
              </div>
              {g.sub
                ? lines(g.sub, 4).map((l, i) => (
                    <div
                      key={i}
                      style={{
                        fontFamily: face(l),
                        fontWeight: 450,
                        fontSize: type(0.022),
                        color: QUIET,
                        marginTop: i === 0 ? r(0.006) : 0,
                        lineHeight: 1.35,
                        textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                      }}
                    >
                      {l}
                    </div>
                  ))
                : null}
            </div>
          </div>
        </div>
      );

    case "chapter":
      return (
        <div style={{ ...fill, justifyContent: "flex-start", alignItems: "flex-start", padding: r(0.07) }}>
          <div
            style={{
              fontFamily: face(g.text),
              fontWeight: 600,
              fontSize: type(0.026),
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: INK,
              background: "rgba(0,0,0,0.55)",
              padding: `${r(0.012)}px ${r(0.02)}px`,
              borderRadius: r(0.008),
            }}
          >
            {g.text}
          </div>
        </div>
      );

    case "icon": {
      const box = r(Math.min(0.9, Math.max(0.05, (g.scale || 22) / 100)));
      const paths = ICONS[g.icon ?? ""]?.d ?? ICONS.check.d;
      return (
        <div style={{ ...fill, ...corner(g.placement), padding: r(0.05), flexDirection: "column" }}>
          <div
            style={{
              width: box,
              height: box,
              borderRadius: box * 0.24,
              background: "rgba(0,0,0,0.62)",
              border: `${Math.max(1, box * 0.012)}px solid rgba(255,255,255,0.14)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: box * 0.58,
                height: box * 0.58,
                fill: "none",
                stroke: accent,
                strokeWidth: 1.7,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              }}
            >
              {paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
          </div>
          {g.text ? (
            <div
              style={{
                marginTop: r(0.014),
                fontFamily: face(g.text),
                fontWeight: 600,
                fontSize: type(0.026),
                color: INK,
                textShadow: "0 2px 12px rgba(0,0,0,0.65)",
                textAlign: "center",
                maxWidth: box * 2.4,
              }}
            >
              {g.text}
            </div>
          ) : null}
        </div>
      );
    }

    case "image": {
      /* Not a Remotion still at all — `placeImage` in `lib/video/graphics.ts`
         puts the picture on the frame with FFmpeg. Its numbers: a share of the
         height, a box a fifth wider than tall, a 5% margin, and full frame on
         black. */
      if (!g.fileId) return null;
      const share = Math.min(0.95, Math.max(0.05, (g.scale || 40) / 100));
      const full = g.placement === "full";
      const margin = r(0.05);
      const place: React.CSSProperties = full
        ? { inset: 0, background: "#000" }
        : {
            width: Math.round(w * share * 1.2),
            height: r(share),
            top: g.placement === "top-left" || g.placement === "top-right" ? margin : undefined,
            bottom:
              g.placement === "bottom-left" || g.placement === "bottom-right" || g.placement === "bottom-center"
                ? r(0.12)
                : undefined,
            left: g.placement === "top-left" || g.placement === "bottom-left" ? margin : undefined,
            right: g.placement === "top-right" || g.placement === "bottom-right" ? margin : undefined,
            ...(g.placement === "center" || g.placement === "bottom-center"
              ? { left: "50%", transform: "translateX(-50%)" }
              : {}),
            ...(g.placement === "center" ? { top: "50%", transform: "translate(-50%, -50%)" } : {}),
          };
      return (
        <div style={{ position: "absolute", ...place }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${g.fileId}/download`}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
      );
    }

    case "stat":
      /* The number is the graphic: huge on its own, still big with a word
         beside it, and a rule under it in the accent. */
      return (
        <div style={{ ...fill, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              fontFamily: face(g.text),
              fontWeight: 700,
              fontSize: type(g.text.length <= 5 ? 0.17 : g.text.length <= 9 ? 0.11 : 0.08),
              lineHeight: 1.05,
              color: INK,
              letterSpacing: isCjk(g.text) ? "0" : "-0.04em",
              textAlign: "center",
              maxWidth: "88%",
              textShadow: "0 4px 26px rgba(0,0,0,0.65)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {g.text}
          </div>
          <div
            style={{
              width: "100%",
              maxWidth: r(0.42),
              height: Math.max(1, r(0.005)),
              background: accent,
              borderRadius: r(0.003),
              marginTop: r(0.026),
            }}
          />
          {g.sub ? (
            <div
              style={{
                fontFamily: face(g.sub),
                fontWeight: 450,
                fontSize: type(0.028),
                color: QUIET,
                marginTop: r(0.022),
                textAlign: "center",
                textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              }}
            >
              {g.sub}
            </div>
          ) : null}
        </div>
      );

    case "quote":
      return (
        <div
          style={{
            ...fill,
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: `0 ${r(0.12)}px`,
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontFamily: face(g.text),
              fontWeight: 500,
              fontSize: type(0.052),
              lineHeight: 1.3,
              color: INK,
              letterSpacing: "-0.015em",
              maxWidth: "84%",
            }}
          >
            {`“${g.text}”`}
          </div>
          {g.sub ? (
            <div style={{ display: "flex", alignItems: "center", gap: r(0.016), marginTop: r(0.03) }}>
              <div style={{ width: r(0.05), height: Math.max(1, r(0.004)), background: accent, borderRadius: r(0.002) }} />
              <div style={{ fontFamily: face(g.sub), fontWeight: 450, fontSize: type(0.026), color: QUIET }}>{g.sub}</div>
            </div>
          ) : null}
        </div>
      );

    case "bracket":
      return (
        <div
          style={{
            ...fill,
            flexDirection: "row",
            background: "rgba(0,0,0,0.86)",
            justifyContent: "center",
            alignItems: "center",
            gap: r(0.05),
          }}
        >
          <span style={{ fontFamily: FAMILY, fontWeight: 300, fontSize: type(0.2), color: accent, lineHeight: 1 }}>
            {"{"}
          </span>
          <span
            style={{
              fontFamily: face(g.text),
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: type(0.062),
              color: INK,
              letterSpacing: "-0.02em",
              textAlign: "center",
              maxWidth: r(1.1),
            }}
          >
            {g.text}
          </span>
          <span style={{ fontFamily: FAMILY, fontWeight: 300, fontSize: type(0.2), color: accent, lineHeight: 1 }}>
            {"}"}
          </span>
        </div>
      );

    case "ticker":
      return (
        <div style={{ ...fill, justifyContent: "flex-end", alignItems: "stretch" }}>
          <div
            style={{
              background: "rgba(0,0,0,0.72)",
              borderTop: `${Math.max(1, r(0.003))}px solid ${accent}`,
              padding: `${r(0.014)}px ${r(0.04)}px`,
              display: "flex",
              alignItems: "baseline",
              gap: r(0.022),
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                fontFamily: FAMILY,
                fontWeight: 600,
                fontSize: type(0.022),
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: accent,
                whiteSpace: "nowrap",
              }}
            >
              {g.sub ?? "source"}
            </span>
            <span
              style={{
                fontFamily: face(g.text),
                fontWeight: 450,
                fontSize: type(0.026),
                color: INK,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {g.text}
            </span>
          </div>
        </div>
      );

    case "badge":
      return (
        <div style={{ ...fill, justifyContent: "flex-start", alignItems: "flex-end", padding: r(0.06) }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: r(0.014),
              background: "rgba(0,0,0,0.6)",
              border: `${Math.max(1, r(0.002))}px solid rgba(255,255,255,0.16)`,
              borderRadius: r(0.05),
              padding: `${r(0.012)}px ${r(0.024)}px`,
            }}
          >
            <span
              style={{
                width: r(0.018),
                height: r(0.018),
                background: accent,
                borderRadius: r(0.004),
                transform: "rotate(45deg)",
              }}
            />
            <span
              style={{
                fontFamily: face(g.text),
                fontWeight: 600,
                fontSize: type(0.024),
                letterSpacing: "0.04em",
                color: INK,
                whiteSpace: "nowrap",
              }}
            >
              {g.text}
            </span>
          </div>
        </div>
      );

    case "header":
      /* Top left: the accent dash, the title, the subtitle small. It arrives
         after the hook and then simply stays. */
      return (
        <div
          style={{
            ...fill,
            justifyContent: "flex-start",
            alignItems: "flex-start",
            padding: `${r(0.05)}px ${r(0.04)}px`,
          }}
        >
          <div style={{ maxWidth: "88%" }}>
            <div
              style={{
                width: r(0.022),
                height: Math.max(1, r(0.006)),
                background: accent,
                borderRadius: 2,
                marginBottom: r(0.008),
              }}
            />
            <div
              style={{
                fontFamily: face(g.text),
                fontWeight: 700,
                fontSize: type(0.03),
                lineHeight: 1.2,
                color: INK,
                textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              }}
            >
              <Marked text={g.text} accent={accent} scale={1} />
            </div>
            {g.sub ? (
              <div
                style={{
                  fontFamily: face(g.sub),
                  fontWeight: 400,
                  fontSize: type(0.018),
                  color: INK,
                  opacity: 0.92,
                  marginTop: r(0.004),
                  textShadow: "0 2px 10px rgba(0,0,0,0.6)",
                }}
              >
                {g.sub}
              </div>
            ) : null}
          </div>
        </div>
      );

    case "watermark":
      return (
        <div style={{ ...fill, justifyContent: "flex-end", alignItems: "center", paddingBottom: r(0.16) }}>
          <div style={{ opacity: 0.92, textAlign: "center" }}>
            <div
              style={{
                fontFamily: face(g.text),
                fontWeight: 700,
                fontSize: type(0.02),
                color: INK,
                letterSpacing: "0.04em",
                textShadow: "0 1px 8px rgba(0,0,0,0.6)",
              }}
            >
              {g.text}
            </div>
            {g.sub ? (
              <div style={{ fontFamily: FAMILY, fontWeight: 400, fontSize: type(0.011), color: QUIET, marginTop: 2 }}>
                {g.sub}
              </div>
            ) : null}
          </div>
        </div>
      );

    case "footnote":
      return (
        <div style={{ ...fill, justifyContent: "flex-end", alignItems: "center", paddingBottom: r(0.045) }}>
          <div
            style={{
              opacity: 0.8,
              fontFamily: face(g.text),
              fontWeight: 400,
              fontSize: type(0.012),
              color: "rgba(255,255,255,0.72)",
              textShadow: "0 1px 6px rgba(0,0,0,0.7)",
              padding: `0 ${r(0.04)}px`,
              textAlign: "center",
            }}
          >
            {g.text}
          </div>
        </div>
      );

    case "card":
      /* The one graphic that is dark on light, which is what makes it read as
         a note rather than as a title. */
      return (
        <div style={{ ...fill, justifyContent: "flex-end", alignItems: "center", paddingBottom: r(0.46) }}>
          <div
            style={{
              background: "rgba(255,255,255,0.96)",
              color: "#171717",
              borderRadius: r(0.012),
              padding: `${r(0.014)}px ${r(0.024)}px`,
              fontFamily: face(g.text),
              fontWeight: 600,
              fontSize: type(0.026),
              lineHeight: 1.4,
              maxWidth: "80%",
              textAlign: "center",
              boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
            }}
          >
            <Marked text={g.text} accent={accent} scale={1} />
          </div>
        </div>
      );

    case "statement":
      /* The channel's claim block: short lines set left, the accent dash
         above, the marked words a size up. Over the footage, no scrim — the
         speaker stays visible behind their own claim. */
      return (
        <div
          style={{
            ...fill,
            justifyContent: "flex-end",
            alignItems: "flex-start",
            padding: `0 ${r(0.05)}px ${r(0.44)}px`,
          }}
        >
          <div>
            <div
              style={{
                width: r(0.024),
                height: Math.max(1, r(0.006)),
                background: accent,
                borderRadius: 2,
                marginBottom: r(0.01),
              }}
            />
            {lines(g.text, 3).map((l, i) => (
              <div
                key={i}
                style={{
                  fontFamily: face(l),
                  fontWeight: 700,
                  fontSize: type(0.05),
                  lineHeight: 1.32,
                  color: INK,
                  letterSpacing: isCjk(l) ? "0.01em" : "-0.01em",
                  textShadow: "0 3px 16px rgba(0,0,0,0.65)",
                }}
              >
                <Marked text={l} accent={accent} />
              </div>
            ))}
          </div>
        </div>
      );

    case "end-card":
      return (
        <div
          style={{
            ...fill,
            background: "#000",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: face(g.text),
              fontWeight: 700,
              fontSize: type(0.074),
              color: INK,
              letterSpacing: "-0.02em",
              textAlign: "center",
              maxWidth: "76%",
            }}
          >
            {g.text}
          </div>
          {g.sub ? (
            <div
              style={{
                fontFamily: face(g.sub),
                fontWeight: 450,
                fontSize: type(0.026),
                color: QUIET,
                marginTop: r(0.028),
                textAlign: "center",
              }}
            >
              {g.sub}
            </div>
          ) : null}
        </div>
      );

    default:
      /* `title`, and anything a later preset adds: one line, centred, over the
         footage. The composition's own default branch. */
      return (
        <div style={{ ...fill, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              fontFamily: face(g.text),
              fontWeight: 700,
              fontSize: type(0.058),
              color: INK,
              letterSpacing: "-0.02em",
              textAlign: "center",
              maxWidth: "80%",
              textShadow: "0 3px 18px rgba(0,0,0,0.6)",
            }}
          >
            {g.text}
          </div>
          {g.sub ? (
            <div
              style={{
                fontFamily: face(g.sub),
                fontWeight: 450,
                fontSize: type(0.026),
                color: QUIET,
                marginTop: r(0.02),
                textAlign: "center",
              }}
            >
              {g.sub}
            </div>
          ) : null}
        </div>
      );
  }
}

/** Which corner an icon sits in, as flexbox — `corner()` in the composition. */
function corner(placement: string | null | undefined): React.CSSProperties {
  switch (placement) {
    case "top-left":
      return { justifyContent: "flex-start", alignItems: "flex-start" };
    case "top-right":
      return { justifyContent: "flex-start", alignItems: "flex-end" };
    case "bottom-left":
      return { justifyContent: "flex-end", alignItems: "flex-start" };
    case "bottom-right":
      return { justifyContent: "flex-end", alignItems: "flex-end" };
    default:
      return { justifyContent: "center", alignItems: "center" };
  }
}
