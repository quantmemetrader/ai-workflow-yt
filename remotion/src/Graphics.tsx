import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { THEME, ratio } from "./theme";

/**
 * The graphics the product offers, and deliberately no more.
 *
 * Every one is a move the studio's own reference work found in clips that
 * worked: a word that arrives, a rule that draws, a name that slides in under
 * someone speaking. There is no glow, no particle field, no 3D spin, no
 * "cinematic" bloom — those are the things a model reaches for and a viewer
 * scrolls past.
 *
 * Three shared rules, enforced here so nobody has to remember them:
 *
 *   1. **Nothing moves after it arrives.** Motion carries meaning on the way
 *      in and then stops. A title that keeps drifting is a title being read
 *      twice.
 *   2. **One spring, one direction.** Everything enters from the same side
 *      with the same physics, so a sequence of graphics feels like one hand.
 *   3. **Out is faster than in.** ~0.25s, because leaving is not the idea.
 */
export type GraphicKind =
  | "title"
  | "lower-third"
  | "statement"
  | "end-card"
  | "chapter"
  /** A number that is the point: "1.28M", with "views · last 28 days" under it. */
  | "stat"
  /** Somebody's words, with the attribution under a rule. */
  | "quote"
  /** A headline inside the reference work's `{ }` brackets, on black. */
  | "bracket"
  /** A strip along the bottom: source, disclaimer, "filmed in Hong Kong". */
  | "ticker"
  /** A small corner badge: a mark and a word, for the length of a section. */
  | "badge"
  /** One of the app's own icons, for a thing the speaker just named. */
  | "icon"
  /** The channel's furniture: the video's title top left, the mark bottom
   * centre, the disclaimer along the very bottom. */
  | "header"
  | "watermark"
  | "footnote"
  /** A white card with dark text, for an aside. */
  | "card";

/**
 * The icons, on a 24×24 grid, stroked in the accent colour.
 *
 * The same list as `lib/video/icons.ts` — kept here rather than imported
 * because the Remotion workspace builds on its own, with its own node_modules
 * and no path alias into the app. There is one test that fails loudly if the
 * two ever disagree.
 */
export const ICON_PATHS: Record<string, string[]> = {
  rocket: [
    "M4.5 15.5c-1 2.5-.5 4 .5 4.5s2.5 1 4.5-.5",
    "M14 4c3.5 0 6 2.5 6 6 0 4.5-4.5 8-8 9.5L9 17l-2.5-3C8 12 11.5 4 14 4z",
    "M13.5 9.5h.01",
  ],
  chart: ["M4 19h16", "m6 15 4-4 3 3 5-6"],
  money: ["M4 6.5h16v11H4z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5"],
  clock: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "M12 8v4.5l3 1.8"],
  warning: ["M12 4.5 21 19H3z", "M12 10v4", "M12 16.6h.01"],
  check: ["m4.5 12.5 5 5L20 7"],
  people: [
    "M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M3.5 19.5c0-3 2.2-5 5-5s5 2 5 5",
    "M16 6.2a3 3 0 0 1 0 5.6",
    "M17 14.8c2 .6 3.5 2.4 3.5 4.7",
  ],
  globe: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "M4 12h16", "M12 4c2.5 2.5 2.5 13 0 16M12 4c-2.5 2.5-2.5 13 0 16"],
  camera: ["M3.5 8.5h13v10h-13z", "m16.5 12 4-2.5v7l-4-2.5"],
  mic: [
    "M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4",
    "M6.5 11.5a5.5 5.5 0 0 0 11 0",
    "M12 17v3",
  ],
  bulb: ["M9.5 17h5", "M10 20h4", "M12 4a5.5 5.5 0 0 1 3.2 10c-.5.4-.7 1-.7 1.5h-5c0-.6-.2-1.1-.7-1.5A5.5 5.5 0 0 1 12 4"],
  pin: ["M12 21s6.5-6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21", "M12 8.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"],
  calendar: ["M4.5 6.5h15v13h-15z", "M4.5 10.5h15", "M8.5 4v4M15.5 4v4"],
  fire: ["M12 3.5c3 3 5.5 5 5.5 8.5a5.5 5.5 0 0 1-11 0c0-1.7.8-3 2-4.2.3 1.3 1 2 2 2 0-2.6.7-4.6 1.5-6.3"],
  play: ["M8 5.5 19 12 8 18.5z"],
  lock: ["M6.5 10.5h11v9h-11z", "M9 10.5V8a3 3 0 0 1 6 0v2.5"],
  cart: ["M3.5 5h2l2.2 9.5h9.6l2.2-7H7", "M9.5 19h.01M17 19h.01"],
  plane: ["M3 13.5 21 7l-4 11-4-4-4 3z"],
  chip: ["M8 8h8v8H8z", "M5 10h3M5 14h3M16 10h3M16 14h3", "M10 5v3M14 5v3M10 16v3M14 16v3"],
  building: ["M5 20V6l7-2.5V20", "M12 20h7V9.5l-7-2", "M8 9.5h1M8 13h1M15 12h1M15 15.5h1"],
};

/** Where a corner-placed graphic sits, as flexbox. */
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

export type GraphicProps = {
  kind: GraphicKind;
  /** The line. One sentence; a graphic is not a paragraph. */
  text: string;
  /** Second line, where the preset has one: a role, a source, a handle. */
  sub?: string | null;
  accent?: string;
  /** Seconds the graphic is on screen, used for the exit. */
  seconds: number;
  /** For `icon`: which one. */
  icon?: string | null;
  /** Where it sits in the frame. */
  placement?: string | null;
  /** Share of the frame height, 5–90. */
  scale?: number | null;
};

/** Whether a line is mostly Chinese, which picks the face and the tracking. */
const isCjk = (text: string) => (text.match(/[\u3400-\u9fff]/g) ?? []).length > text.length / 3;

/**
 * A line with its keywords set in the accent colour.
 *
 * The channel marks the words that matter in its yellow-green: "一枚智能戒指"
 * with 智能 lit. The director writes them as 【智能】; this draws them.
 */
const Marked: React.FC<{ text: string; accent: string; scale?: number }> = ({ text, accent, scale = 1.08 }) => {
  const parts = text.split(/(【[^】]+】)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
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
};

export const Graphic: React.FC<GraphicProps> = ({
  kind,
  text,
  sub,
  accent = THEME.accent,
  seconds,
  icon,
  placement,
  scale,
}) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  // One spring for everything, so a run of graphics reads as one hand.
  const arrive = spring({ frame, fps, config: { damping: 200, mass: 0.6 }, durationInFrames: Math.round(fps * 0.45) });
  const leaveAt = Math.max(0, seconds * fps - fps * 0.25);
  const leave = interpolate(frame, [leaveAt, seconds * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const on = arrive * leave;

  if (kind === "lower-third") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: ratio(height, 0.085) }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: ratio(height, 0.016), opacity: on }}>
          {/* A rule, not a box. The name is the graphic; the rule only says
              where it starts. */}
          <div
            style={{
              width: ratio(height, 0.006),
              background: accent,
              borderRadius: ratio(height, 0.003),
              transform: `scaleY(${on})`,
              transformOrigin: "bottom",
            }}
          />
          <div style={{ transform: `translateX(${(1 - on) * -ratio(height, 0.03)}px)` }}>
            <div
              style={{
                fontFamily: THEME.family,
                fontWeight: 650,
                fontSize: ratio(height, 0.042),
                color: THEME.ink,
                lineHeight: 1.15,
                textShadow: "0 2px 14px rgba(0,0,0,0.55)",
              }}
            >
              {text}
            </div>
            {sub
              ? sub
                  .split(/\n|\|/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(0, 4)
                  .map((l, i) => (
                    <div
                      key={i}
                      style={{
                        fontFamily: isCjk(l) ? THEME.cjk : THEME.family,
                        fontWeight: 450,
                        fontSize: ratio(height, 0.022),
                        color: THEME.quiet,
                        marginTop: i === 0 ? ratio(height, 0.006) : 0,
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
      </AbsoluteFill>
    );
  }

  if (kind === "chapter") {
    /* Under the header, not on top of it. Both sit top left and both are on
       screen at once (the header for the whole video, the chapter for the
       section), so at the same padding the section title printed across the
       video's own title and neither could be read. This clears the header
       band that `HEADER_BAND` in the presets measures. */
    return (
      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          alignItems: "flex-start",
          padding: `${ratio(height, 0.155)}px ${ratio(height, 0.07)}px`,
        }}
      >
        <div
          style={{
            opacity: on,
            fontFamily: THEME.family,
            fontWeight: 600,
            fontSize: ratio(height, 0.026),
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: THEME.ink,
            background: "rgba(0,0,0,0.55)",
            padding: `${ratio(height, 0.012)}px ${ratio(height, 0.02)}px`,
            borderRadius: ratio(height, 0.008),
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "icon") {
    /*
     * A thing the speaker just named, drawn rather than fetched.
     *
     * It arrives with the same spring everything else uses and it leaves
     * faster than it came, because arriving is the idea. It is a stroke on a
     * plate — no gradient, no bounce, no spin — so that six of them in a row
     * still read as one hand.
     */
    const paths = ICON_PATHS[icon ?? ""] ?? ICON_PATHS.check;
    const box = ratio(height, Math.min(0.9, Math.max(0.05, (scale ?? 22) / 100)));
    const pad = ratio(height, 0.05);

    return (
      <AbsoluteFill style={{ ...corner(placement), padding: pad, flexDirection: "column" }}>
        <div
          style={{
            opacity: on,
            transform: `translateY(${(1 - on) * ratio(height, 0.02)}px) scale(${0.92 + on * 0.08})`,
            width: box,
            height: box,
            borderRadius: box * 0.24,
            background: "rgba(0,0,0,0.62)",
            border: `${Math.max(1, box * 0.012)}px solid rgba(255,255,255,0.14)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
        {text ? (
          <div
            style={{
              opacity: on,
              marginTop: ratio(height, 0.014),
              fontFamily: THEME.family,
              fontWeight: 600,
              fontSize: ratio(height, 0.026),
              color: THEME.ink,
              textShadow: "0 2px 12px rgba(0,0,0,0.65)",
              textAlign: "center",
              maxWidth: box * 2.4,
            }}
          >
            {text}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  if (kind === "stat") {
    /* The number is the graphic. Hook #12 in the reference catalog draws a
       line under the closing sentence; this is the same idea with the figure
       doing the talking, because a statistic read aloud is forgotten and a
       statistic on screen is not. */
    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            opacity: on,
            transform: `translateY(${(1 - on) * ratio(height, 0.02)}px)`,
            fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
            fontWeight: 700,
            /* A figure, huge; a figure with a word or two beside it, still
               big but on one line rather than three over the face. */
            fontSize: ratio(height, text.length <= 5 ? 0.17 : text.length <= 9 ? 0.11 : 0.08),
            lineHeight: 1.05,
            color: THEME.ink,
            letterSpacing: isCjk(text) ? "0" : "-0.04em",
            textAlign: "center",
            maxWidth: "88%",
            textShadow: "0 4px 26px rgba(0,0,0,0.65)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {text}
        </div>
        <div
          style={{
            width: `${on * 100}%`,
            maxWidth: ratio(height, 0.42),
            height: ratio(height, 0.005),
            background: accent,
            borderRadius: ratio(height, 0.003),
            marginTop: ratio(height, 0.026),
          }}
        />
        {sub ? (
          <div
            style={{
              opacity: on,
              fontFamily: THEME.family,
              fontWeight: 450,
              fontSize: ratio(height, 0.028),
              color: THEME.quiet,
              marginTop: ratio(height, 0.022),
              textAlign: "center",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            }}
          >
            {sub}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  if (kind === "quote") {
    return (
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "flex-start",
          padding: `0 ${ratio(height, 0.12)}px`,
          background: `rgba(0,0,0,${0.45 * on})`,
        }}
      >
        <div
          style={{
            opacity: on,
            transform: `translateX(${(1 - on) * -ratio(height, 0.02)}px)`,
            fontFamily: THEME.family,
            fontWeight: 500,
            fontSize: ratio(height, 0.052),
            lineHeight: 1.3,
            color: THEME.ink,
            letterSpacing: "-0.015em",
            maxWidth: "84%",
            textWrap: "pretty",
          }}
        >
          “{text}”
        </div>
        {sub ? (
          <div style={{ display: "flex", alignItems: "center", gap: ratio(height, 0.016), marginTop: ratio(height, 0.03) }}>
            <div
              style={{
                width: ratio(height, 0.05) * on,
                height: ratio(height, 0.004),
                background: accent,
                borderRadius: ratio(height, 0.002),
              }}
            />
            <div
              style={{
                opacity: on,
                fontFamily: THEME.family,
                fontWeight: 450,
                fontSize: ratio(height, 0.026),
                color: THEME.quiet,
              }}
            >
              {sub}
            </div>
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  if (kind === "bracket") {
    /* Hook #9: `{ }` on black with the line typed inside. Held still rather
       than typed, because a still is what this renderer draws — the motion is
       the brackets arriving. */
    const gap = ratio(height, 0.05);
    return (
      <AbsoluteFill
        style={{
          background: `rgba(0,0,0,${0.86 * on})`,
          justifyContent: "center",
          alignItems: "center",
          gap,
          flexDirection: "row",
        }}
      >
        <span
          style={{
            fontFamily: THEME.family,
            fontWeight: 300,
            fontSize: ratio(height, 0.2),
            color: accent,
            opacity: on,
            transform: `translateX(${(1 - on) * -ratio(height, 0.05)}px)`,
            lineHeight: 1,
          }}
        >
          {"{"}
        </span>
        <span
          style={{
            opacity: on,
            fontFamily: THEME.family,
            fontWeight: 600,
            fontStyle: "italic",
            fontSize: ratio(height, 0.062),
            color: THEME.ink,
            letterSpacing: "-0.02em",
            textAlign: "center",
            maxWidth: ratio(height, 1.1),
            textWrap: "balance",
          }}
        >
          {text}
        </span>
        <span
          style={{
            fontFamily: THEME.family,
            fontWeight: 300,
            fontSize: ratio(height, 0.2),
            color: accent,
            opacity: on,
            transform: `translateX(${(1 - on) * ratio(height, 0.05)}px)`,
            lineHeight: 1,
          }}
        >
          {"}"}
        </span>
      </AbsoluteFill>
    );
  }

  if (kind === "ticker") {
    /* The strip a broadcaster puts a source on. Small, along the bottom, and
       never in the way of a caption — which is why it sits below the caption
       margin rather than on top of it. */
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "stretch" }}>
        <div
          style={{
            transform: `translateY(${(1 - on) * ratio(height, 0.06)}px)`,
            opacity: on,
            background: "rgba(0,0,0,0.72)",
            borderTop: `${ratio(height, 0.003)}px solid ${accent}`,
            padding: `${ratio(height, 0.014)}px ${ratio(height, 0.04)}px`,
            display: "flex",
            alignItems: "baseline",
            gap: ratio(height, 0.022),
          }}
        >
          <span
            style={{
              fontFamily: THEME.family,
              fontWeight: 600,
              fontSize: ratio(height, 0.022),
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: accent,
              whiteSpace: "nowrap",
            }}
          >
            {sub ?? "source"}
          </span>
          <span
            style={{
              fontFamily: THEME.family,
              fontWeight: 450,
              fontSize: ratio(height, 0.026),
              color: THEME.ink,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "badge") {
    /* Hook #11's idea, at the size a badge can hold for a whole section: a
       mark and a word, top right, out of the way of everything else. */
    return (
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: ratio(height, 0.06) }}>
        <div
          style={{
            opacity: on,
            transform: `translateY(${(1 - on) * -ratio(height, 0.02)}px)`,
            display: "flex",
            alignItems: "center",
            gap: ratio(height, 0.014),
            background: "rgba(0,0,0,0.6)",
            border: `${ratio(height, 0.002)}px solid rgba(255,255,255,0.16)`,
            borderRadius: ratio(height, 0.05),
            padding: `${ratio(height, 0.012)}px ${ratio(height, 0.024)}px`,
          }}
        >
          <span
            style={{
              width: ratio(height, 0.018),
              height: ratio(height, 0.018),
              background: accent,
              borderRadius: ratio(height, 0.004),
              transform: "rotate(45deg)",
            }}
          />
          <span
            style={{
              fontFamily: THEME.family,
              fontWeight: 600,
              fontSize: ratio(height, 0.024),
              letterSpacing: "0.04em",
              color: THEME.ink,
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "header") {
    /* Top left: the accent dash, the title in bold, the subtitle small. It
       arrives after the hook and then simply stays, which is why it is
       quiet: nothing about it should compete with the line being said. */
    return (
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: `${ratio(height, 0.05)}px ${ratio(height, 0.04)}px` }}>
        <div style={{ opacity: on, transform: `translateY(${(1 - on) * -ratio(height, 0.012)}px)`, maxWidth: "88%" }}>
          <div style={{ width: ratio(height, 0.022), height: ratio(height, 0.006), background: accent, borderRadius: 2, marginBottom: ratio(height, 0.008) }} />
          <div
            style={{
              fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
              fontWeight: 700,
              fontSize: ratio(height, 0.03),
              lineHeight: 1.2,
              color: THEME.ink,
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
            }}
          >
            <Marked text={text} accent={accent} scale={1} />
          </div>
          {sub ? (
            <div
              style={{
                fontFamily: isCjk(sub) ? THEME.cjk : THEME.family,
                fontWeight: 400,
                fontSize: ratio(height, 0.018),
                color: THEME.ink,
                opacity: 0.92,
                marginTop: ratio(height, 0.004),
                textShadow: "0 2px 10px rgba(0,0,0,0.6)",
              }}
            >
              {sub}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "watermark") {
    /* The channel's mark, bottom centre, above the caption's second line. */
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: ratio(height, 0.16) }}>
        <div style={{ opacity: on * 0.92, textAlign: "center" }}>
          <div
            style={{
              fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
              fontWeight: 700,
              fontSize: ratio(height, 0.02),
              color: THEME.ink,
              letterSpacing: "0.04em",
              textShadow: "0 1px 8px rgba(0,0,0,0.6)",
            }}
          >
            {text}
          </div>
          {sub ? (
            <div style={{ fontFamily: THEME.family, fontWeight: 400, fontSize: ratio(height, 0.011), color: THEME.quiet, marginTop: 2 }}>{sub}</div>
          ) : null}
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "footnote") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: ratio(height, 0.045) }}>
        <div
          style={{
            opacity: on * 0.8,
            fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
            fontWeight: 400,
            fontSize: ratio(height, 0.012),
            color: "rgba(255,255,255,0.72)",
            textShadow: "0 1px 6px rgba(0,0,0,0.7)",
            padding: `0 ${ratio(height, 0.04)}px`,
            textAlign: "center",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "card") {
    /* A white card with dark type, for the aside the speaker did not say out
       loud. The one graphic here that is light on dark rather than the other
       way round, which is what makes it read as a note. */
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: ratio(height, 0.46) }}>
        <div
          style={{
            opacity: on,
            transform: `translateY(${(1 - on) * ratio(height, 0.015)}px)`,
            background: "rgba(255,255,255,0.96)",
            color: "#171717",
            borderRadius: ratio(height, 0.012),
            padding: `${ratio(height, 0.014)}px ${ratio(height, 0.024)}px`,
            fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
            fontWeight: 600,
            fontSize: ratio(height, 0.026),
            lineHeight: 1.4,
            maxWidth: "80%",
            textAlign: "center",
            boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
          }}
        >
          <Marked text={text} accent={accent} scale={1} />
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "statement") {
    /* The channel's claim block: two or three short lines set left, the
       accent dash above, the words that matter in the accent colour and a
       size up. Over the footage with a shadow, not on a scrim: the speaker
       stays visible behind their own claim. */
    const lines = text.split(/\n|\|/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
    return (
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: `0 ${ratio(height, 0.05)}px ${ratio(height, 0.44)}px` }}>
        <div style={{ opacity: on, transform: `translateY(${(1 - on) * ratio(height, 0.016)}px)` }}>
          <div style={{ width: ratio(height, 0.024), height: ratio(height, 0.006), background: accent, borderRadius: 2, marginBottom: ratio(height, 0.01) }} />
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                fontFamily: isCjk(l) ? THEME.cjk : THEME.family,
                fontWeight: 700,
                fontSize: ratio(height, 0.05),
                lineHeight: 1.32,
                color: THEME.ink,
                letterSpacing: isCjk(l) ? "0.01em" : "-0.01em",
                textShadow: "0 3px 16px rgba(0,0,0,0.65)",
              }}
            >
              <Marked text={l} accent={accent} />
            </div>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  if (kind === "end-card") {
    return (
      <AbsoluteFill style={{ background: THEME.void, justifyContent: "center", alignItems: "center", opacity: on }}>
        <div
          style={{
            fontFamily: THEME.family,
            fontWeight: 700,
            fontSize: ratio(height, 0.074),
            color: THEME.ink,
            letterSpacing: "-0.02em",
            textAlign: "center",
            maxWidth: "76%",
            textWrap: "balance",
          }}
        >
          {text}
        </div>
        {sub ? (
          <div
            style={{
              fontFamily: THEME.family,
              fontWeight: 450,
              fontSize: ratio(height, 0.026),
              color: THEME.quiet,
              marginTop: ratio(height, 0.028),
            }}
          >
            {sub}
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  // title: one line, centred, over the footage.
  const scrim = false;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: scrim ? `rgba(0,0,0,${0.55 * on})` : "transparent",
      }}
    >
      <div
        style={{
          opacity: on,
          transform: `translateY(${(1 - on) * ratio(height, 0.018)}px)`,
          fontFamily: isCjk(text) ? THEME.cjk : THEME.family,
          fontWeight: 700,
          fontSize: ratio(height, 0.058),
          color: THEME.ink,
          letterSpacing: "-0.02em",
          textAlign: "center",
          maxWidth: "80%",
          textWrap: "balance",
          textShadow: scrim ? "none" : "0 3px 18px rgba(0,0,0,0.6)",
        }}
      >
        {text}
      </div>
      {sub ? (
        <div
          style={{
            opacity: on,
            fontFamily: THEME.family,
            fontWeight: 450,
            fontSize: ratio(height, 0.026),
            color: THEME.quiet,
            marginTop: ratio(height, 0.02),
            textAlign: "center",
          }}
        >
          {sub}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
