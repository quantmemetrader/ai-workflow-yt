import React from "react";
import { AbsoluteFill, Easing, Img, spring } from "remotion";
import { V2 } from "./theme";
import { Marked, emWidth, fitPacked, fitSize, fitWrappedOrMark, isCjk, splitLines } from "./text";

/**
 * Director v2's templates: the graphics that make an argument legible with
 * the sound off (PLAN.md §1 "Graphics", §2 W4).
 *
 * Ten kinds, each a move the channel's own finished videos make: the opening
 * claim landing line by line with the words; a number that counts up to the
 * figure she says; two bars growing in turn; a timeline building; the logo
 * of the company just named on a white tile; a small chip when it comes up
 * again; a headline card; a term and its one-line definition; the
 * teacher-to-student diagram; a 0.7 s chapter stinger. And the end card,
 * which now carries the 素材来源 line.
 *
 * Every template is drawn from absolute timing props — `landMs`, `stepsMs[]`
 * — measured from the graphic's own start, so the director can land a line
 * on a word to the frame. The numbers are §1's: 300 ms in on
 * `cubic-bezier(.2,.8,.2,1)`, 180 ms out, sizes in pixels on the 1080×1920
 * frame (`V2` in `theme.ts`, scaled by `px()`), radius 24, one shadow, the
 * accent for the words and figures that matter and #FF453A only for the
 * negative bar. Overshoot only on the chip, and there under 3 %.
 *
 * Nothing here draws a gradient, a glow, a spin or a fake screenshot.
 *
 * Every template reads its extra values from `options` defensively — the
 * rows come from JSON, and a missing `stepsMs` or a string where a number
 * was meant should degrade to a sensible default, never to a blank frame.
 */

export const V2_KINDS = ["hook", "counter", "compare", "list", "entity", "chip", "headline", "term", "diagram", "stinger"] as const;
export type V2Kind = (typeof V2_KINDS)[number];
export const isV2Kind = (kind: string): kind is V2Kind => (V2_KINDS as readonly string[]).includes(kind);

/** The kinds whose picture keeps changing after the entrance; rendered as one clip, never as in/hold/out. */
export const THROUGH_ANIMATED: readonly string[] = ["hook", "counter", "compare", "list", "diagram", "stinger"];

export type Options = Record<string, unknown>;

/* ---------------------------------------------------------------- readers */

const num = (v: unknown, fallback: number): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : v == null ? fallback : String(v));
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const numbers = (v: unknown): number[] => arr<unknown>(v).map((x) => num(x, NaN)).filter((x) => Number.isFinite(x));

/* --------------------------------------------------------------- geometry */

/**
 * The frame's geometry, with §1's pixel values scaled to it.
 *
 * `px` scales a vertical measure (and every size) by the frame's height,
 * `x` a horizontal one by its width, so a 1080×1920 frame gets the plan's
 * numbers exactly and a 16:9 frame gets the same design at its own size.
 */
export type Geo = {
  W: number;
  H: number;
  px: (n: number) => number;
  x: (n: number) => number;
  /** The safe column: x from the left margin to the platform's right-hand controls. */
  safeLeft: number;
  safeRight: number;
  safeW: number;
};

export function geo(W: number, H: number): Geo {
  const px = (n: number) => Math.round((n * H) / V2.frame.height);
  const x = (n: number) => Math.round((n * W) / V2.frame.width);
  const safeLeft = x(V2.side);
  const safeRight = W - x(V2.rightUnsafe);
  return { W, H, px, x, safeLeft, safeRight, safeW: safeRight - safeLeft };
}

/* ----------------------------------------------------------------- timing */

export const bezier = Easing.bezier(V2.bezier[0], V2.bezier[1], V2.bezier[2], V2.bezier[3]);
export const easeOut = Easing.out(Easing.cubic);
export const easeOutQuad = Easing.out(Easing.quad);
export const easeIn = Easing.in(Easing.quad);

/** 0 → 1 over `ms` starting at `fromMs`, clamped, on `curve` (§1's bezier unless said). */
export function progress(tMs: number, fromMs: number, ms: number, curve: (x: number) => number = bezier): number {
  if (ms <= 0) return tMs >= fromMs ? 1 : 0;
  const x = (tMs - fromMs) / ms;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return curve(x);
}

/**
 * The entrance and the exit of one graphic, as two factors.
 *
 * `enter` rises over the first 300 ms, `exit` falls over the last 180 ms
 * (measured to the *end* of the frame, so the last frame is fully out),
 * `on` is their product and `t` the frame's time in ms from the graphic's
 * start. The v1 graphics use `on` for everything; the templates use the two
 * factors separately so an entrance can be a slide and an exit a fade.
 */
export type Envelope = { t: number; enter: number; exit: number; on: number; totalMs: number };

export function envelope(frame: number, fps: number, seconds: number, enterMs = V2.enterMs, exitMs = V2.exitMs): Envelope {
  const t = (frame / fps) * 1000;
  const totalMs = seconds * 1000;
  const enter = progress(t, 0, enterMs);
  const exit = 1 - progress(t + 1000 / fps, totalMs - exitMs, exitMs, easeIn);
  return { t, enter, exit, on: enter * exit, totalMs };
}

/* ------------------------------------------------------------------- type */

const heavy = (size: number, color: string): React.CSSProperties => ({
  fontFamily: V2.heavy,
  fontWeight: 900,
  fontSize: size,
  lineHeight: 1.1,
  color,
  letterSpacing: "0.01em",
  textShadow: V2.textShadow,
});

const bold = (size: number, color: string): React.CSSProperties => ({
  fontFamily: V2.heavy,
  fontWeight: 700,
  fontSize: size,
  lineHeight: 1.25,
  color,
  textShadow: V2.textShadow,
});

/** A figure: Inter at 800 with tabular numerals, so a counting number never jitters. */
const figure = (size: number, color: string): React.CSSProperties => ({
  fontFamily: V2.latin,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1,
  color,
  letterSpacing: "-0.02em",
  fontVariantNumeric: "tabular-nums",
  textShadow: V2.textShadow,
});

/* -------------------------------------------------------------- templates */

export type TemplateProps = {
  g: Geo;
  accent: string;
  text: string;
  sub: string | null;
  options: Options;
  env: Envelope;
  frame: number;
  fps: number;
};

/** The block that enters by rising 16 px and leaves by fading: every Zone-T template's outer motion. */
const rise = (g: Geo, env: Envelope): React.CSSProperties => ({
  opacity: env.enter * env.exit,
  transform: `translateY(${Math.round((1 - env.enter) * g.px(16) - (1 - env.exit) * g.px(8))}px)`,
});

/**
 * hook — the opening claim, up to three lines of 120 px Black in Zone T,
 * each landing with its word: scale 0.92→1.0 over 120 ms centred on
 * `stepsMs[i]`. The block shrinks as one so the widest line fits the safe
 * column and the three fit the zone.
 */
const Hook: React.FC<TemplateProps> = ({ g, accent, text, options, env }) => {
  const lines = splitLines(text, 3);
  const steps = numbers(options.stepsMs);
  const lineHeight = 1.1;
  const zoneH = g.px(V2.zones.T.bottom - V2.zones.T.top);
  const size = Math.min(fitSize(lines, g.safeW, g.px(V2.size.hook), g.px(84)), Math.floor(zoneH / (Math.max(1, lines.length) * lineHeight)));
  return (
    <div
      style={{
        position: "absolute",
        left: g.safeLeft,
        top: g.px(V2.zones.T.top),
        width: g.safeW,
        opacity: env.exit,
        transform: `translateY(${Math.round(-(1 - env.exit) * g.px(8))}px)`,
      }}
    >
      {lines.map((line, i) => {
        const land = steps[i] ?? i * 500;
        const p = progress(env.t, land - V2.hookLineMs / 2, V2.hookLineMs, easeOut);
        return (
          <div
            key={i}
            style={{
              ...heavy(size, V2.ink),
              lineHeight,
              whiteSpace: "nowrap",
              opacity: p,
              transform: `scale(${(0.92 + 0.08 * p).toFixed(4)})`,
              transformOrigin: "left center",
            }}
          >
            <Marked text={line} accent={accent} scale={1} />
          </div>
        );
      })}
    </div>
  );
};

/** "3500" in "3500多个账号": the digits, what comes before them and what follows. */
export function parseFigure(value: string): { prefix: string; digits: string; number: number | null; decimals: number; suffix: string } {
  const m = value.match(/^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return { prefix: "", digits: "", number: null, decimals: 0, suffix: value };
  const digits = m[2].replace(/,/g, "");
  return { prefix: m[1], digits, number: Number(digits), decimals: (digits.split(".")[1] ?? "").length, suffix: m[3] };
}

/**
 * counter — the figure at 150 px counting up and landing exactly on
 * `landMs`, the unit at 68 px beside it, the label under. A value with no
 * digits in it (十几倍) is set as it is, without a count.
 *
 * The count starts with the card (a card sitting on "0" for half a second
 * looks broken) and takes `landMs` — between 0.5 and 1.2 s, the plan's
 * 0.7 s being the typical gap between the card's first frame and the
 * number's last syllable — unless `countMs` says otherwise. Two details
 * make the landing exact to the frame: the digits shown are the *floor* of
 * the running value (rounding would show 3500 while the value is 3499.6,
 * three frames early), and the curve is a quadratic ease-out rather than a
 * cubic, whose tail is so flat that the last digit would stop ticking well
 * before the word.
 */
const Counter: React.FC<TemplateProps> = ({ g, accent, text, sub, options, env }) => {
  const value = str(options.value, text);
  const unit = str(options.unit);
  const landMs = Math.max(0, num(options.landMs, V2.countMs));
  const countMs = Math.max(200, Math.min(num(options.countMs, Math.min(1200, Math.max(500, landMs))), landMs || V2.countMs));
  const fig = parseFigure(value);
  const p = fig.number === null ? 1 : progress(env.t, landMs - countMs, countMs, easeOutQuad);
  /* On and after the landing frame the string is the one she said, not a
     float that rounds to it. */
  const scale = 10 ** fig.decimals;
  const running = fig.number === null ? 0 : Math.floor(fig.number * p * scale + 1e-6) / scale;
  const shown = fig.number === null ? value : env.t >= landMs ? fig.digits : running.toFixed(fig.decimals);
  const numSize = g.px(V2.size.stat);
  const unitSize = g.px(V2.size.unit);
  const label = sub ?? str(options.labelZh);
  const tail = fig.number === null ? unit : fig.suffix + unit;
  return (
    <div style={{ position: "absolute", left: g.safeLeft, top: g.px(V2.zones.T.top + 12), width: g.safeW, ...rise(g, env) }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: g.px(10), whiteSpace: "nowrap" }}>
        {fig.number !== null && fig.prefix ? <span style={heavy(unitSize, V2.ink)}>{fig.prefix}</span> : null}
        <span style={{ ...(fig.number === null ? heavy(numSize, accent) : figure(numSize, accent)), minWidth: fig.number === null ? undefined : `${(fig.digits.length * 0.62).toFixed(2)}em` }}>
          {shown}
        </span>
        {tail ? <span style={heavy(unitSize, V2.ink)}>{tail}</span> : null}
      </div>
      {label ? <div style={{ ...bold(g.px(V2.size.meta), V2.meta), marginTop: g.px(14) }}>{label}</div> : null}
    </div>
  );
};

type Bar = { label?: string; value?: number | string; display?: string; negative?: boolean };

/**
 * compare — two or three bars growing in sequence, 0.5 s each from
 * `stepsMs[i]` (or one after another from the entrance), the figure fading
 * in as its bar lands. The longest bar spans the safe column; red only for
 * a bar marked `negative`. Two bars get the heavier setting (40 px labels,
 * 30 px bars); three are set a step smaller so the block still ends near
 * y 500, above the face on a talking-head take.
 */
const Compare: React.FC<TemplateProps> = ({ g, accent, text, options, env }) => {
  const bars = arr<Bar>(options.bars).slice(0, 3);
  const steps = numbers(options.stepsMs);
  const max = Math.max(1e-9, ...bars.map((b) => Math.abs(num(b.value, 0))));
  const three = bars.length > 2;
  const labelSize = g.px(three ? 34 : V2.size.label);
  const valueSize = g.px(three ? 40 : V2.size.value);
  const barH = g.px(three ? 24 : 30);
  const gap = g.px(three ? 10 : 12);
  return (
    <div style={{ position: "absolute", left: g.safeLeft, top: g.px(V2.zones.T.top + 4), width: g.safeW, ...rise(g, env) }}>
      {text ? <div style={{ ...bold(g.px(V2.size.label), V2.quiet), marginBottom: g.px(14) }}>{text}</div> : null}
      {bars.map((b, i) => {
        const from = steps[i] ?? V2.enterMs + i * V2.barMs;
        const p = progress(env.t, from, V2.barMs, easeOut);
        const share = Math.abs(num(b.value, 0)) / max;
        const colour = b.negative ? V2.negative : accent;
        const display = str(b.display, str(b.value));
        return (
          <div key={i} style={{ marginBottom: gap }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: g.px(6) }}>
              <span style={{ ...bold(labelSize, V2.ink), whiteSpace: "nowrap" }}>{str(b.label)}</span>
              <span style={{ ...(isCjk(display) ? heavy(valueSize, colour) : figure(valueSize, colour)), whiteSpace: "nowrap", opacity: p }}>{display}</span>
            </div>
            <div style={{ height: barH, borderRadius: barH / 2, background: "rgba(14,14,16,0.35)", overflow: "hidden" }}>
              <div style={{ width: `${(share * p * 100).toFixed(2)}%`, height: "100%", borderRadius: barH / 2, background: colour }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

type Item = { head?: string; text?: string };

/**
 * list — three to five items building down a rail as each is said
 * (`stepsMs[i]`): a dot, the head in the accent (a date, a name), the line
 * in white. The rail draws down to the newest item.
 */
const List: React.FC<TemplateProps> = ({ g, accent, options, env }) => {
  const items = arr<Item>(options.items).slice(0, 5);
  const steps = numbers(options.stepsMs);
  const rowH = g.px(items.length > 4 ? 64 : 68);
  const dot = g.px(20);
  const gap = g.px(22);
  /* The head column is as wide as the widest head, the line takes the rest
     of the safe column at the largest size that fits every item. */
  const headSize = g.px(V2.size.listHead);
  const heads = items.map((it) => str(it.head));
  const headW = heads.some(Boolean) ? Math.max(g.px(110), Math.ceil(Math.max(...heads.map(emWidth)) * headSize)) : 0;
  const lineW = g.safeW - dot - gap - (headW ? headW + gap : 0);
  const textSize = fitSize(items.map((it) => str(it.text)), lineW, g.px(V2.size.listText), g.px(28));
  const shown = items.map((_, i) => progress(env.t, steps[i] ?? i * 600, 250));
  const last = shown.reduce((acc, p, i) => (p > 0 ? i : acc), -1);
  const railH = last <= 0 ? 0 : rowH * (last - 1) + rowH * shown[last];
  return (
    <div style={{ position: "absolute", left: g.safeLeft, top: g.px(V2.zones.T.top + 8), width: g.safeW, ...rise(g, env) }}>
      <div style={{ position: "absolute", left: dot / 2 - g.px(2), top: rowH / 2, width: g.px(4), height: railH, background: accent, opacity: 0.55, borderRadius: g.px(2) }} />
      {items.map((it, i) => {
        const p = shown[i];
        return (
          <div
            key={i}
            style={{
              height: rowH,
              display: "flex",
              alignItems: "center",
              gap,
              opacity: p,
              transform: `translateX(${Math.round((1 - p) * -g.px(16))}px)`,
            }}
          >
            <span style={{ width: dot, height: dot, borderRadius: "50%", background: accent, flex: "none", transform: `scale(${(0.6 + 0.4 * p).toFixed(3)})` }} />
            {headW ? <span style={{ ...heavy(headSize, accent), width: headW, flex: "none", whiteSpace: "nowrap" }}>{heads[i]}</span> : null}
            <span style={{ ...bold(textSize, V2.ink), whiteSpace: "nowrap" }}>{str(it.text)}</span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * entity — the logo on a white tile, the name at 68 px and the one-line
 * descriptor, 1.5–2.5 s at first mention. No logo: the first character as a
 * monogram on the tile, which reads as a mark and never as a broken image.
 */
const Entity: React.FC<TemplateProps> = ({ g, text, sub, options, env }) => {
  const logo = str(options.logo);
  /* The monogram is the name's first letter or character, never its
     opening quote or bracket: 《自然》杂志 is 自 on the tile, not 《. */
  const mono = str(options.monogram, text.trim().replace(/^[「『（【《〔〈〖〘〚"'(\[{<“‘]+/, "").charAt(0) || text.trim().charAt(0) || "·");
  const tile = g.px(200);
  const nameW = g.safeW - tile - g.px(40);
  return (
    <div
      style={{
        position: "absolute",
        left: g.safeLeft,
        top: g.px(V2.zones.T.top + 20),
        width: g.safeW,
        display: "flex",
        alignItems: "center",
        gap: g.px(40),
        opacity: env.enter * env.exit,
      }}
    >
      <div
        style={{
          width: tile,
          height: tile,
          flex: "none",
          borderRadius: g.px(V2.radius),
          background: V2.tile,
          boxShadow: V2.shadow,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${(0.96 + 0.04 * env.enter).toFixed(4)})`,
        }}
      >
        {logo ? (
          <Img src={logo} style={{ width: tile * 0.7, height: tile * 0.7, objectFit: "contain" }} />
        ) : (
          <span style={{ fontFamily: isCjk(mono) ? V2.heavy : V2.latin, fontWeight: 900, fontSize: isCjk(mono) ? tile * 0.5 : tile * 0.56, lineHeight: 1, color: V2.void }}>{mono}</span>
        )}
      </div>
      <div style={{ minWidth: 0, transform: `translateX(${Math.round((1 - env.enter) * -g.px(16))}px)` }}>
        <div style={{ ...heavy(fitSize([text], nameW, g.px(V2.size.headline), g.px(44)), V2.ink), whiteSpace: "nowrap" }}>{text}</div>
        {sub ? <div style={{ ...bold(g.px(V2.size.meta), V2.quiet), marginTop: g.px(12) }}>{sub}</div> : null}
      </div>
    </div>
  );
};

/**
 * chip — a name in a pill at the top right, for a thing the entity card has
 * already introduced. The one graphic on the spring (damping 14, stiffness
 * 180, mass 0.9); its overshoot is applied at a fifth, so the pill lands
 * with under 3 % (1.9 % measured) and is still on the way in.
 *
 * The spring is fitted to the `in` segment (`durationInFrames: 12`): the
 * chip is rendered as in + hold + out, the hold being frame 12, and the
 * natural spring is still 2.9 % from rest there — a pill 0.6 % larger in
 * the hold than in the `out` part that follows it, which read as a 1–2 px
 * pop at the seam. Fitted, it is within 0.4 % at frame 12 and at rest by
 * frame 13, settles to the eye by ~270 ms, and keeps its overshoot.
 */
const Chip: React.FC<TemplateProps> = ({ g, accent, text, options, env, frame, fps }) => {
  const s = spring({ frame, fps, config: V2.spring, durationInFrames: V2.inFrames });
  const scale = 0.8 + 0.2 * s;
  const logo = str(options.logo);
  const h = g.px(76);
  return (
    <div
      style={{
        position: "absolute",
        right: g.x(V2.rightUnsafe),
        top: g.px(V2.zones.corner.top),
        height: h,
        display: "inline-flex",
        alignItems: "center",
        gap: g.px(14),
        padding: `0 ${g.px(26)}px 0 ${logo ? g.px(12) : g.px(24)}px`,
        borderRadius: h / 2,
        background: "rgba(14,14,16,0.88)",
        boxShadow: V2.shadow,
        opacity: Math.min(1, s * 1.6) * env.exit,
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: "right center",
      }}
    >
      {logo ? (
        <span style={{ width: g.px(52), height: g.px(52), borderRadius: g.px(12), background: V2.tile, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Img src={logo} style={{ width: g.px(36), height: g.px(36), objectFit: "contain" }} />
        </span>
      ) : (
        <span style={{ width: g.px(14), height: g.px(14), borderRadius: "50%", background: accent, flex: "none" }} />
      )}
      <span style={{ ...bold(g.px(V2.size.chip), V2.ink), textShadow: "none", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
};

/**
 * headline — outlet and date as plain text, the quoted headline at 68 px
 * with a highlight sweeping under it, the article image (when there is one)
 * behind at 30 % with the outlet credited. Slides up 250 ms from blur to
 * sharp. A plate, because it has to read over anything, and never a mock
 * screenshot of a site.
 */
const Headline: React.FC<TemplateProps> = ({ g, accent, text, sub, options, env }) => {
  const outlet = str(options.outlet);
  const date = str(options.date);
  const image = str(options.image);
  const credit = str(options.imageCredit, outlet);
  const p = progress(env.t, 0, V2.headlineMs);
  const sweep = progress(env.t, 120, 270, easeOut);
  const pad = g.px(32);
  const innerW = g.safeW - pad * 2;
  /* The quote wraps between words (never inside 发布 or a number) at the
     largest size that holds it in two lines, 68 px at most and 36 at
     least; a headline too long even for that gets a third line, then an
     ellipsis — never a silent cut. */
  /* Quote marks only around words that are a quote (the layout says so); a paraphrase is set plain. */
  const verbatim = options.verbatim !== false;
  const quote = fitWrappedOrMark(verbatim ? `「${text}」` : text, innerW, g.px(V2.size.headline), g.px(36), 2);
  const metaSize = g.px(28);
  return (
    <div
      style={{
        position: "absolute",
        left: g.safeLeft,
        top: g.px(V2.zones.T.top),
        width: g.safeW,
        boxSizing: "border-box",
        padding: `${g.px(26)}px ${pad}px ${g.px(28)}px`,
        borderRadius: g.px(V2.radius),
        background: V2.plate,
        boxShadow: V2.shadow,
        overflow: "hidden",
        opacity: p * env.exit,
        transform: `translateY(${Math.round((1 - p) * g.px(40))}px)`,
        filter: p < 1 ? `blur(${((1 - p) * 12).toFixed(1)}px)` : undefined,
      }}
    >
      {/* The article picture is texture, never a second text layer: blurred and dimmed hard so its own words cannot bleed through the quote (r01's x.com repost did). */}
      {image ? <Img src={image} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.14, filter: "blur(8px) grayscale(0.4)" }} /> : null}
      <div style={{ position: "relative" }}>
        {/* Outlet and date on the left; the picture's credit on the right of the same line, so it costs no height. */}
        <div style={{ display: "flex", gap: g.px(16), alignItems: "baseline", marginBottom: g.px(14) }}>
          {outlet ? <span style={{ ...bold(metaSize, accent), textShadow: "none", whiteSpace: "nowrap" }}>{outlet}</span> : null}
          {date ? <span style={{ ...bold(metaSize, V2.meta), textShadow: "none", whiteSpace: "nowrap" }}>{date}</span> : null}
          {image ? <span style={{ ...bold(g.px(V2.size.credits), V2.credits), textShadow: "none", marginLeft: "auto", whiteSpace: "nowrap" }}>图：{credit}</span> : null}
        </div>
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
          <div
            style={{
              position: "absolute",
              left: -g.px(6),
              top: "6%",
              height: "88%",
              width: `calc(${(sweep * 100).toFixed(2)}% + ${g.px(12)}px)`,
              background: accent,
              opacity: 0.26,
              borderRadius: g.px(8),
            }}
          />
          {quote.lines.map((l, i) => (
            <div key={i} style={{ ...heavy(quote.size, V2.ink), position: "relative", lineHeight: 1.2, textShadow: "none", whiteSpace: "nowrap" }}>
              {l}
            </div>
          ))}
        </div>
        {sub ? <div style={{ ...bold(g.px(V2.size.credits), V2.quiet), marginTop: g.px(10), textShadow: "none" }}>{sub}</div> : null}
      </div>
    </div>
  );
};

/**
 * term — the word the argument turns on in the accent, its definition
 * after an ＝, for 3 s: 蒸馏＝小模型学大模型的「暗知识」. On one line when
 * the term at 88 px and the definition at 44 px fit the safe column
 * together, the way the brief writes it; a longer definition (技术套利's)
 * goes under the term in up to two lines, wrapped between words. The
 * English name, when given, sits under in the meta size.
 */
const Term: React.FC<TemplateProps> = ({ g, accent, text, sub, options, env }) => {
  const definition = sub ?? str(options.definition);
  const en = str(options.en);
  const termSize = fitSize([text], g.safeW * 0.8, g.px(88), g.px(64));
  const eqSize = g.px(56);
  const defSize = g.px(44);
  const oneLine = definition ? emWidth(text) * termSize + emWidth("＝") * eqSize + emWidth(definition) * defSize <= g.safeW : true;
  /* Under the term, the definition wraps into two lines at 44 px, or at
     the largest smaller size (down to 28) that holds all of it: a
     definition a few characters too long for two lines is set a step
     smaller, never cut short; one longer still gets a third line, and
     past that an ellipsis. */
  const wrapped = definition && !oneLine ? fitWrappedOrMark(definition, g.safeW, defSize, g.px(28), 2) : { size: defSize, lines: [] as string[] };
  const lines = wrapped.lines;
  const p2 = progress(env.t, 80, V2.enterMs);
  return (
    <div style={{ position: "absolute", left: g.safeLeft, top: g.px(V2.zones.T.top + 4), width: g.safeW, opacity: env.exit }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: g.px(12), opacity: env.enter, transform: `translateY(${Math.round((1 - env.enter) * g.px(16))}px)`, whiteSpace: "nowrap" }}>
        <span style={heavy(termSize, accent)}>{text}</span>
        {definition ? <span style={{ ...heavy(eqSize, V2.quiet), opacity: oneLine ? p2 : 1 }}>＝</span> : null}
        {definition && oneLine ? <span style={{ ...bold(defSize, V2.ink), opacity: p2 }}>{definition}</span> : null}
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ ...bold(wrapped.size, V2.ink), lineHeight: 1.25, marginTop: i === 0 ? g.px(8) : 0, opacity: p2, transform: `translateY(${Math.round((1 - p2) * g.px(12))}px)`, whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
      {en ? <div style={{ ...bold(g.px(V2.size.meta), V2.meta), fontFamily: V2.latin, fontWeight: 600, marginTop: g.px(8), opacity: p2 }}>{en}</div> : null}
    </div>
  );
};

type Step = { label?: string; sub?: string };

/**
 * diagram — the mechanism in three synced steps: the teacher model (a big
 * white tile), its outputs flowing along an arrow, the student model (a
 * smaller tile). Each step lands at `stepsMs[i]`; the outputs keep flowing,
 * which is why the diagram is rendered as one clip.
 */
const Diagram: React.FC<TemplateProps> = ({ g, accent, options, env }) => {
  const fallback: Step[] = [
    { label: "老师模型", sub: "大模型" },
    { label: "输出", sub: "思维链 · 答案" },
    { label: "学生模型", sub: "小模型" },
  ];
  const given = arr<Step>(options.steps);
  const steps = [0, 1, 2].map((i) => ({ label: str(given[i]?.label, fallback[i].label), sub: str(given[i]?.sub, fallback[i].sub) }));
  const at = numbers(options.stepsMs);
  const t0 = at[0] ?? 0;
  const t1 = at[1] ?? t0 + 700;
  const t2 = at[2] ?? t1 + 700;
  const pA = progress(env.t, t0, V2.enterMs);
  const pArrow = progress(env.t, t1, V2.enterMs);
  const pB = progress(env.t, t2, V2.enterMs);
  const top = g.px(V2.zones.T.top + 40);
  const aW = g.px(300);
  const aH = g.px(220);
  const bW = g.px(240);
  const bH = g.px(170);
  const gap = g.px(40);
  const arrowW = g.safeW - aW - bW - gap * 2;
  const midY = top + aH / 2;
  const tile = (w: number, h: number, p: number, label: string, sub: string, left: number, y: number) => (
    <div
      style={{
        position: "absolute",
        left,
        top: y,
        width: w,
        height: h,
        borderRadius: g.px(V2.radius),
        background: V2.tile,
        boxShadow: V2.shadow,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: p,
        transform: `scale(${(0.96 + 0.04 * p).toFixed(4)})`,
      }}
    >
      <div style={{ ...heavy(g.px(V2.size.boxLabel), V2.void), textShadow: "none", whiteSpace: "nowrap" }}>{label}</div>
      {sub ? <div style={{ ...bold(g.px(V2.size.boxSub), "rgba(14,14,16,0.62)"), textShadow: "none", marginTop: g.px(6), whiteSpace: "nowrap" }}>{sub}</div> : null}
    </div>
  );
  const flowing = env.t >= t1 + V2.enterMs;
  const period = 900;
  const dots = [0, 1, 2].map((i) => {
    const phase = flowing ? (((env.t - t1 - V2.enterMs + i * (period / 3)) % period) + period) % period : -1;
    const q = phase < 0 ? 0 : phase / period;
    const fade = q < 0 ? 0 : Math.min(1, q * 6, (1 - q) * 6);
    return { x: q * arrowW, opacity: fade };
  });
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: g.W, height: g.H, opacity: env.exit }}>
      {tile(aW, aH, pA, steps[0].label, steps[0].sub, g.safeLeft, top)}
      <div style={{ position: "absolute", left: g.safeLeft + aW + gap, top: midY - g.px(3), width: arrowW, height: g.px(6), background: accent, borderRadius: g.px(3), transform: `scaleX(${pArrow.toFixed(4)})`, transformOrigin: "left center", opacity: pArrow }} />
      <div
        style={{
          position: "absolute",
          left: g.safeLeft + aW + gap + arrowW - g.px(18),
          top: midY - g.px(14),
          width: 0,
          height: 0,
          borderTop: `${g.px(14)}px solid transparent`,
          borderBottom: `${g.px(14)}px solid transparent`,
          borderLeft: `${g.px(22)}px solid ${accent}`,
          opacity: pArrow >= 0.98 ? 1 : 0,
        }}
      />
      {dots.map((d, i) => (
        <span key={i} style={{ position: "absolute", left: g.safeLeft + aW + gap + d.x - g.px(9), top: midY - g.px(9), width: g.px(18), height: g.px(18), borderRadius: "50%", background: V2.ink, boxShadow: V2.shadow, opacity: d.opacity * pArrow }} />
      ))}
      <div style={{ position: "absolute", left: g.safeLeft + aW + gap, width: arrowW, top: midY - g.px(64), textAlign: "center", ...bold(g.px(V2.size.meta), accent), opacity: pArrow }}>{steps[1].label}</div>
      <div style={{ position: "absolute", left: g.safeLeft + aW + gap, width: arrowW, top: midY + g.px(22), textAlign: "center", ...bold(g.px(V2.size.boxSub), V2.quiet), opacity: pArrow }}>{steps[1].sub}</div>
      {tile(bW, bH, pB, steps[2].label, steps[2].sub, g.safeRight - bW, midY - bH / 2)}
    </div>
  );
};

/**
 * stinger — 「02 中方回应」 for 0.7 s at a real turn: the plate wipes in
 * from the left over 150 ms, the number and the title slide in after it,
 * and the whole thing fades out on the common exit (`env.exit`, 180 ms
 * measured to the end of the last frame). It used to fade on its own
 * 150 ms curve measured from the frame's *start*, which left the last
 * frame at 40 % opacity — the plate popped off at the cut instead of
 * leaving; `envelope()` already does the end-of-frame arithmetic.
 */
const Stinger: React.FC<TemplateProps> = ({ g, accent, text, options, env }) => {
  const idx = options.index;
  const label = typeof idx === "number" ? String(idx).padStart(2, "0") : str(idx);
  const pIn = progress(env.t, 0, V2.stingerInMs);
  const pText = progress(env.t, 60, 150);
  const pOut = env.exit;
  const h = g.px(220);
  /* The title takes what the plate leaves after the number: 68 px unless
     a long one (Anthropic为什么急) would run past the plate's edge. */
  const labelW = label ? emWidth(label) * g.px(V2.size.stat) + g.px(32) : 0;
  const titleSize = fitSize([text], g.safeW - g.px(96) - labelW, g.px(V2.size.headline), g.px(40));
  return (
    <div
      style={{
        position: "absolute",
        left: g.safeLeft,
        top: g.px(V2.zones.T.top + 20),
        width: g.safeW,
        height: h,
        boxSizing: "border-box",
        padding: `0 ${g.px(48)}px`,
        borderRadius: g.px(V2.radius),
        background: V2.plate,
        boxShadow: V2.shadow,
        display: "flex",
        alignItems: "baseline",
        gap: g.px(32),
        opacity: pOut,
        transform: `scaleX(${pIn.toFixed(4)})`,
        transformOrigin: "left center",
      }}
    >
      <div style={{ position: "relative", top: g.px(52), display: "flex", alignItems: "baseline", gap: g.px(32), opacity: pText, transform: `translateX(${Math.round((1 - pText) * g.px(24))}px)` }}>
        {label ? <span style={{ ...figure(g.px(V2.size.stat), accent), textShadow: "none" }}>{label}</span> : null}
        <span style={{ ...heavy(titleSize, V2.ink), textShadow: "none", whiteSpace: "nowrap" }}>{text}</span>
      </div>
    </div>
  );
};

/**
 * end-card (v2) — on #0E0E10: the sign-off at 68 px, the closing question
 * under it, and the 素材来源 line at 26 px grey, at most two lines, sitting
 * between the watermark band and the footnote band the furniture draws.
 */
const EndCard: React.FC<TemplateProps> = ({ g, accent, text, sub, options, env }) => {
  const credits = str(options.creditsLine);
  const logo = str(options.logo);
  /* Packed by source (never a break inside "Pinterest @xxx"): two lines at
     26 px when every source fits, else two lines a step smaller (down to
     22), else three lines at 22 — 92 px, which still clears the watermark
     band above y 1613 — and if even that cannot hold every source, the
     last line ends in an ellipsis. `packEntries` drops what does not fit,
     and a credit that vanished from the card with no trace is the one
     failure this line exists to prevent; W3's `placeCredits` is meant to
     keep it to two lines at 26 px, and this is what happens when it does
     not. Each line is held on one line: the estimate errs wide, and a line
     that did run over would spread a few pixels into both margins rather
     than wrap into a fourth line under the footnote band. */
  const creditsFit = (() => {
    if (!credits) return null;
    const two = fitPacked(credits, g.safeW, g.px(V2.size.credits), g.px(22), 2);
    if (two.complete) return two;
    const three = fitPacked(credits, g.safeW, g.px(22), g.px(22), 3);
    if (three.complete) return three;
    const lines = [...three.lines];
    lines[lines.length - 1] = `${lines[lines.length - 1]} …`;
    return { ...three, lines };
  })();
  const creditLines = creditsFit?.lines ?? [];
  const creditSize = creditsFit?.size ?? g.px(V2.size.credits);
  /* The closing question: three lines at 44 px, or smaller (to 32), or a fourth line, rather than cut. */
  const subFit = sub ? fitWrappedOrMark(sub, g.safeW, g.px(V2.size.endSub), g.px(32), 3) : { size: g.px(V2.size.endSub), lines: [] as string[] };
  const subLines = subFit.lines;
  return (
    <AbsoluteFill style={{ background: V2.void, opacity: env.on }}>
      <div style={{ position: "absolute", left: g.safeLeft, width: g.safeW, top: g.px(680), textAlign: "center", transform: `translateY(${Math.round((1 - env.enter) * g.px(20))}px)` }}>
        {logo ? (
          <Img src={logo} style={{ width: g.px(160), height: g.px(160), objectFit: "contain", marginBottom: g.px(32) }} />
        ) : (
          <div style={{ width: g.px(48), height: g.px(8), background: accent, borderRadius: g.px(4), margin: `0 auto ${g.px(32)}px` }} />
        )}
        <div style={{ ...heavy(fitSize([text], g.safeW, g.px(V2.size.headline), g.px(44)), V2.ink), textShadow: "none" }}>{text}</div>
        {subLines.map((l, i) => (
          <div key={i} style={{ ...bold(subFit.size, V2.quiet), lineHeight: 1.35, textShadow: "none", marginTop: i === 0 ? g.px(28) : 0 }}>
            {l}
          </div>
        ))}
      </div>
      {creditLines.length ? (
        <div style={{ position: "absolute", left: g.safeLeft, width: g.safeW, bottom: g.H - g.px(1745), textAlign: "center" }}>
          {creditLines.map((l, i) => (
            <div key={i} style={{ ...bold(creditSize, V2.credits), lineHeight: 1.4, textShadow: "none", whiteSpace: "nowrap" }}>
              {l}
            </div>
          ))}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/* ---------------------------------------------------------------- dispatch */

const TEMPLATES: Record<V2Kind | "end-card", React.FC<TemplateProps>> = {
  hook: Hook,
  counter: Counter,
  compare: Compare,
  list: List,
  entity: Entity,
  chip: Chip,
  headline: Headline,
  term: Term,
  diagram: Diagram,
  stinger: Stinger,
  "end-card": EndCard,
};

/** One v2 template, by kind. `Graphics.tsx` calls this for the ten kinds and for an end card that carries `creditsLine`. */
export const V2Graphic: React.FC<TemplateProps & { kind: V2Kind | "end-card" }> = ({ kind, ...props }) => {
  const Template = TEMPLATES[kind];
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <Template {...props} />
    </AbsoluteFill>
  );
};
