import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { THEME, ratio } from "./theme";

/**
 * Captions, as the four presets the product offers and nothing else.
 *
 * Rendered over transparency and composited by FFmpeg, so the cut itself is
 * never re-encoded to draw type on it.
 *
 * Two rules from the studio's playbook are enforced here rather than left to
 * whoever fills the form:
 *
 *   — **One treatment.** A plate or an outline or a shadow. Never the three
 *     stacked, which is what "make it readable" turns into at 1am.
 *   — **Two lines, seven words a line.** Longer than that and the viewer is
 *     reading instead of watching. Overflow is not shrunk to fit: the text is
 *     wrapped and the card holds, because type that changes size shot to shot
 *     is the thing people notice without knowing why.
 */
export type Cue = {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
  /** Word timings, when the transcriber gave them. Only `spoken` uses them. */
  words?: { start: number; end: number; text: string }[];
};

export type CaptionStyle = {
  family: string;
  weight: number;
  sizeRatio: number;
  fill: string;
  treatment: "plate" | "outline" | "shadow" | "none";
  plate?: string;
  lines: 1 | 2;
  marginRatio: number;
  karaoke: boolean;
  uppercase: boolean;
};

export type CaptionsProps = {
  cues: Cue[];
  style: CaptionStyle;
  /** Highlight colour for `spoken`. */
  accent: string;
};

export const Captions: React.FC<CaptionsProps> = ({ cues, style, accent }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const t = frame / fps;

  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return <AbsoluteFill />;

  const size = ratio(height, style.sizeRatio);
  const text = style.uppercase ? cue.text.toUpperCase() : cue.text;

  // One treatment, chosen, never stacked.
  const treatment: React.CSSProperties =
    style.treatment === "outline"
      ? { WebkitTextStroke: `${Math.max(1.5, size * 0.055)}px rgba(0,0,0,0.9)`, paintOrder: "stroke fill" }
      : style.treatment === "shadow"
        ? { textShadow: `0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.18)}px rgba(0,0,0,0.75)` }
        : {};

  const plate: React.CSSProperties =
    style.treatment === "plate"
      ? {
          background: style.plate ?? "rgba(0,0,0,0.62)",
          padding: `${Math.round(size * 0.32)}px ${Math.round(size * 0.52)}px`,
          borderRadius: Math.round(size * 0.28),
        }
      : {};

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: ratio(height, style.marginRatio),
        // The safe margin, so nothing sits under a platform's own controls.
        paddingLeft: width * 0.08,
        paddingRight: width * 0.08,
      }}
    >
      <div
        style={{
          fontFamily: style.family ? `"${style.family}", ${THEME.family}` : THEME.family,
          fontWeight: style.weight,
          fontSize: size,
          lineHeight: 1.28,
          color: style.fill,
          textAlign: "center",
          maxWidth: "100%",
          textWrap: "balance",
          WebkitBoxOrient: "vertical",
          display: "-webkit-box",
          WebkitLineClamp: style.lines,
          overflow: "hidden",
          ...treatment,
          ...plate,
        }}
      >
        {style.karaoke && cue.words?.length ? (
          <Spoken words={cue.words} t={t} fill={style.fill} accent={accent} />
        ) : (
          text
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Word-by-word, from real timings only.
 *
 * If the transcriber did not give word timings, this is not used at all — the
 * caller falls back to a whole-line preset rather than spacing words evenly
 * and calling it sync. Evenly spaced words drift off the voice within a
 * sentence and every viewer can feel it.
 */
const Spoken: React.FC<{
  words: { start: number; end: number; text: string }[];
  t: number;
  fill: string;
  accent: string;
}> = ({ words, t, fill, accent }) => (
  <>
    {words.map((w, i) => {
      const on = t >= w.start && t < w.end;
      const said = t >= w.end;
      return (
        <span
          key={`${w.start}-${i}`}
          style={{
            color: on ? accent : fill,
            opacity: on || said ? 1 : 0.55,
            transition: "none",
          }}
        >
          {w.text}
          {i < words.length - 1 ? " " : ""}
        </span>
      );
    })}
  </>
);
