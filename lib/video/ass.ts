import "server-only";
import { captionPreset, type CaptionPreset } from "./presets";

/**
 * Captions as an ASS subtitle file, which FFmpeg draws natively.
 *
 * The first version of this rendered the whole timeline through Chrome with
 * Remotion and composited the result. It produced exactly the right picture
 * and it took **thirteen seconds a frame** on this box — six hours for a
 * one-minute video — because the machine shares its 32 cores with a ClickHouse
 * server and a BSC node. Correct and unusable is unusable.
 *
 * libass does everything the four presets need, during the encode that was
 * happening anyway: a font at a size, a fill, exactly one of a box or an
 * outline or a shadow, a position from the bottom, and `\k` tags for the
 * word-by-word preset. It is also frame-accurate by construction, where a
 * composited overlay is accurate to however the two encodes lined up.
 *
 * Remotion is still how the *graphics* are drawn — a lower third is layout and
 * craft, and there are six of them in a video rather than nine thousand.
 */
export type AssCue = {
  startMs: number;
  endMs: number;
  text: string;
  /** Word timings, when the transcriber gave them. Only karaoke uses them. */
  words?: { start: number; end: number; text: string }[] | null;
  /** The words worth the accent colour. Only the keyword presets use them. */
  keywords?: string[] | null;
  /** The same line in the second language, for the bilingual preset. */
  second?: string | null;
};

/** `#rrggbb` to ASS's `&HAABBGGRR`, which is backwards and also has alpha. */
function assColour(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? m[1] : "ffffff";
  const [r, g, b] = [rgb.slice(0, 2), rgb.slice(2, 4), rgb.slice(4, 6)];
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function timestamp(ms: number): string {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** ASS treats these as markup, so text a person typed has to be defanged. */
function escape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/**
 * Wrap to the preset's line count without shrinking the type.
 *
 * Type that changes size from one card to the next is the thing viewers notice
 * without being able to say why, so a long line wraps and, past the preset's
 * limit, is left to libass rather than being squeezed.
 */
function wrap(text: string, lines: 1 | 2, maxChars = 0): string {
  const trimmed = text.trim();
  /*
   * Chinese has no spaces to break at, and this box's libass does not break
   * between CJK characters on its own, so a long line ran off both edges of
   * the frame. Past the width, the line is cut at the punctuation nearest
   * its middle, or at the middle when there is none.
   */
  if (lines === 2 && maxChars > 0 && !/\s/.test(trimmed) && trimmed.length > maxChars) {
    const mid = Math.floor(trimmed.length / 2);
    let at = -1;
    for (let d = 0; d <= Math.floor(trimmed.length / 2); d++) {
      for (const i of [mid - d, mid + d]) {
        if (i > 0 && i < trimmed.length - 1 && /[，、。！？：；,]/.test(trimmed[i - 1])) {
          at = i;
          break;
        }
      }
      if (at !== -1) break;
    }
    if (at === -1) at = mid;
    return `${trimmed.slice(0, at)}\\N${trimmed.slice(at)}`;
  }
  const words = trimmed.split(/\s+/);
  if (lines === 1 || words.length < 5) return trimmed;

  // Balance the two lines rather than filling the first: a full line above a
  // two-word orphan reads as a mistake.
  let best = { at: 1, cost: Infinity };
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const cost = Math.abs(a - b);
    if (cost < best.cost) best = { at: i, cost };
  }
  return `${words.slice(0, best.at).join(" ")}\\N${words.slice(best.at).join(" ")}`;
}

export type AssOptions = {
  presetKey: string;
  width: number;
  height: number;
  accent: string;
  /**
   * The speaker's chin, in px from the top of this frame, from the face
   * track. The reel presets keep their line's top edge below it (PLAN.md
   * §1 Zone F); the older presets ignore it.
   */
  chinY?: number | null;
};

export function toAss(cues: AssCue[], opts: AssOptions): string {
  const preset: CaptionPreset = captionPreset(opts.presetKey);
  const st = preset.style;

  /* Director v2's reel captions are a different renderer, not a variation
     of this one: per-word tags, a measured position, a second style. */
  if (st.reel) return reelAss(cues, preset, opts);

  const size = Math.round(opts.height * st.sizeRatio);
  const marginV = Math.round(opts.height * st.marginRatio);
  const marginH = Math.round(opts.width * 0.08);
  /** How many CJK characters fit on a line at this size. */
  const cjkPerLine = Math.max(6, Math.floor((opts.width - 2 * marginH) / (size * 1.02)));

  /*
   * One treatment, never three. `BorderStyle 3` is the box; `1` is an outline
   * and a shadow, and the two are separated by setting whichever is not wanted
   * to zero — which is how you say "an outline, and no shadow" in a format
   * that has no way to say it directly.
   */
  const box = st.treatment === "plate";
  const outline =
    st.treatment === "outline" ? Math.max(2, Math.round(size * 0.055)) : box ? Math.round(size * 0.3) : 0;
  const shadow = st.treatment === "shadow" ? Math.max(2, Math.round(size * 0.06)) : 0;

  /* The second-language line's own style: the Latin face, small, regular. */
  const secondStyle = st.second
    ? [
        "Style: Second",
        st.second.family,
        Math.round(opts.height * st.second.sizeRatio),
        assColour(st.fill),
        assColour(st.fill, 110),
        assColour("#000000", 40),
        assColour("#000000", 120),
        0,
        0,
        0,
        0,
        100,
        100,
        0,
        0,
        1,
        0,
        Math.max(1, Math.round(opts.height * st.second.sizeRatio * 0.08)),
        st.marginRatio > 0.3 ? 5 : 2,
        marginH,
        marginH,
        Math.max(0, marginV - Math.round(opts.height * st.second.sizeRatio * 1.35)),
        1,
      ].join(",")
    : null;

  const style = [
    "Style: Aura",
    st.family,
    size,
    assColour(st.fill),
    // Secondary is the colour a karaoke word is *before* it is said.
    assColour(st.fill, 110),
    // Outline colour doubles as the box colour when BorderStyle is 3.
    box ? assColour("#000000", 60) : assColour("#000000", 20),
    assColour("#000000", 120),
    st.weight >= 600 ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    box ? 3 : 1,
    outline,
    shadow,
    // 2 = bottom centre, 5 = middle centre. A statement sits in the middle of
    // frame; everything else sits along the bottom.
    st.marginRatio > 0.3 ? 5 : 2,
    marginH,
    marginH,
    marginV,
    1,
  ].join(",");

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style,
    ...(secondStyle ? [secondStyle] : []),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const lines = cues
    .filter((c) => c.text.trim() && c.endMs > c.startMs)
    .flatMap((c) => {
      /*
       * A few words at a time, each group popping in as it is said.
       *
       * The short-form style: the viewer reads three words, not a sentence,
       * and the group arriving on the beat of the voice is what carries the
       * energy. Every group is its own event so it can have its own arrival,
       * and the groups never overlap in time, so libass never stacks them.
       */
      if (st.chunk && c.words?.length) {
        return chunks(c.words, st.chunk).map((group) => {
          const startMs = Math.round(group[0].start * 1000);
          const endMs = Math.max(startMs + 120, Math.round(group[group.length - 1].end * 1000));
          const body = `{\\fad(40,30)\\t(0,110,\\fscx112\\fscy112)\\t(110,190,\\fscx100\\fscy100)}${karaoke(
            group,
            startMs,
            opts.accent,
            st.uppercase,
          )}`;
          return `Dialogue: 0,${timestamp(startMs)},${timestamp(endMs)},Aura,,0,0,0,,${body}`;
        });
      }

      // Every line arrives and leaves with a short fade: type that snaps on
      // and off is the one thing on screen that moves without meaning to.
      const body =
        st.karaoke && c.words?.length
          ? `{\\fad(90,60)}${karaoke(c.words, c.startMs, opts.accent, st.uppercase)}`
          : st.keywords && c.keywords?.length
            ? `{\\fad(90,60)}${highlight(wrap(st.uppercase ? c.text.toUpperCase() : c.text, st.lines, cjkPerLine), c.keywords, opts.accent, size)}`
            : `{\\fad(90,60)}${wrap(escape(st.uppercase ? c.text.toUpperCase() : c.text), st.lines, cjkPerLine)}`;
      const lines = [`Dialogue: 0,${timestamp(c.startMs)},${timestamp(c.endMs)},Aura,,0,0,0,,${body}`];
      /* The same line in the other language, under it: its own event on its
         own style, so the two never fight over one line's size or weight. */
      if (st.second && c.second?.trim()) {
        lines.push(`Dialogue: 1,${timestamp(c.startMs)},${timestamp(c.endMs)},Second,,0,0,0,,{\\fad(90,60)}${escape(c.second.trim())}`);
      }
      return lines;
    });

  return [...header, ...lines, ""].join("\n");
}

/**
 * Words into groups of at most `size`, breaking early on a real pause.
 *
 * A pause of more than half a second inside a group would leave the first
 * words on screen, frozen, while the speaker breathed; the group ends there
 * and the next one starts with the next word said.
 */
function chunks(
  words: { start: number; end: number; text: string }[],
  size: number,
): { start: number; end: number; text: string }[][] {
  const out: (typeof words)[] = [];
  let group: typeof words = [];
  for (const w of words) {
    const last = group[group.length - 1];
    if (group.length >= size || (last && w.start - last.end > 0.5) || (last && w.end - group[0].start > 1.6)) {
      out.push(group);
      group = [];
    }
    group.push(w);
  }
  if (group.length) out.push(group);
  return out;
}

/**
 * The line with its keywords in the accent colour, a size up.
 *
 * The channel's own look: "一枚智能戒指" with 智能 in yellow-green. Longest
 * keyword first, so "睡眠心率" is not broken by "心率"; each occurrence is set
 * once and the run after it resets to the style.
 */
function highlight(text: string, keywords: string[], accent: string, size: number): string {
  // A line already broken by `wrap`: each half is lit on its own, and the
  // break survives escaping.
  if (text.includes("\\N")) return text.split("\\N").map((half) => highlight(half, keywords, accent, size)).join("\\N");
  const wanted = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const bigger = Math.round(size * 1.1);
  const parts: string[] = [];
  let rest = text;
  while (rest.length) {
    let at = -1;
    let hit = "";
    for (const k of wanted) {
      const i = rest.indexOf(k);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        hit = k;
      }
    }
    if (at === -1) {
      parts.push(escape(rest));
      break;
    }
    parts.push(escape(rest.slice(0, at)), `{\\c${assColour(accent)}\\fs${bigger}}${escape(hit)}{\\r}`);
    rest = rest.slice(at + hit.length);
  }
  return parts.join("");
}

/**
 * Word by word, from measured timings only.
 *
 * `\kf` fills each word over its own duration and `\c` turns the word being
 * said the accent colour. Durations are in centiseconds because ASS is from
 * 2002.
 *
 * There is no fallback that spaces words evenly: a caption that claims to
 * follow the voice and does not is worse than one that never claimed to. The
 * caller checks for timings and picks a different preset when there are none.
 */
function karaoke(
  words: { start: number; end: number; text: string }[],
  startMs: number,
  accent: string,
  uppercase = false,
): string {
  const out: string[] = [];
  let cursor = startMs / 1000;
  // Chinese is not spaced; a run of characters with spaces between them
  // reads as a typing exercise.
  const cjk = words.some((w) => /[\u3400-\u9fff]/.test(w.text));

  for (const w of words) {
    // A gap before the word is its own silent beat, so the fill does not run
    // early through a pause.
    const gap = Math.max(0, Math.round((w.start - cursor) * 100));
    if (gap > 0) out.push(`{\\k${gap}}`);
    const dur = Math.max(1, Math.round((w.end - w.start) * 100));
    out.push(`{\\kf${dur}\\c${assColour(accent)}}${escape(uppercase ? w.text.toUpperCase() : w.text)}{\\c}`, cjk ? "" : " ");
    cursor = w.end;
  }

  return out.join("").trimEnd();
}

/**
 * Whether the word-by-word preset can honestly be used on these cues.
 *
 * Most of them have to carry real timings, not one lucky sentence: a video
 * that syncs for ten seconds and then drifts is the worst of both.
 */
export function canKaraoke(cues: AssCue[]): boolean {
  if (cues.length === 0) return false;
  const withWords = cues.filter((c) => c.words && c.words.length > 0).length;
  return withWords / cues.length >= 0.8;
}


/* ------------------------------------------------------------------ reel */

/**
 * Director v2's reel captions (PLAN.md §1 "Captions", W2).
 *
 * What the tags do, per word, because every word carries its own block:
 *
 *   {\fscx0\fscy0\t(0,112,\fscx108\fscy108)\t(112,160,\fscx100\fscy100)}
 *       the pop, 0 → 108 → 100 % in 160 ms. libass applies `\t` to the
 *       running state in tag order with the event's clock, so restating
 *       it in every word's block is what keeps the whole line popping
 *       together; a bare `\fscx100` in a later block would cancel it.
 *   {\c<rest>\t(a,a+1,\c<accent>\fscx110\fscy110)\t(b,b+1,\c<rest>\fscx100\fscy100)}
 *       the spoken word: accent and 110 % from its start `a` to its end
 *       `b`, back to its resting colour after. A number, or the line's
 *       one keyword, rests in the accent already. `a` never precedes the
 *       end of the pop, or the first word would snap to 110 % while the
 *       line is still growing.
 *   {\blur1.5}  on the 5 px #0E0E10 outline, from the style.
 *   {\fad(0,60)} the exit; the pop is the entrance.
 *
 * The English line is its own event on its own style, 36 px Bold at 75 %,
 * starting 80 ms after the zh line with a fade of the same length.
 *
 * Where the line sits is measured, not guessed. Under libass the visual
 * centre of a Han line in Noto Sans CJK SC Black is 0.43 em above the
 * bottom of its line box and its ink top 0.79 em above it; the Latin
 * en line's centre is 0.39 em above (calibration renders on the box, 72
 * and 36 px, Stage 0 fonts). `MarginV` is derived from those so the zh
 * centre lands on the preset's `centreY` (1360) — or lower, when a face
 * track says the chin is close, down to `maxCentreY` and never past it.
 */
const INK = { han: { centre: 0.43, top: 0.79 }, latin: { centre: 0.39 } } as const;

/** How long a line takes to leave. The pop is its entrance. */
const REEL_EXIT_MS = 60;

export type ReelLayout = {
  size: number;
  outline: number;
  marginH: number;
  marginV: number;
  /** Where the zh line's visual centre and ink top land, px from the top. */
  centreY: number;
  topY: number;
  /** False when the chin forced the line past `maxCentreY`; it is clamped there and the caller may want to know. */
  chinClear: boolean;
  second?: { size: number; outline: number; marginV: number; centreY: number };
};

/** The geometry a reel preset produces on this frame. Null for a preset without a reel style. */
export function reelLayout(
  preset: CaptionPreset,
  opts: { width: number; height: number; chinY?: number | null },
): ReelLayout | null {
  const st = preset.style;
  const r = st.reel;
  if (!r) return null;
  const k = opts.height / 1920;
  const size = Math.round(opts.height * st.sizeRatio);
  const outline = Math.max(1, Math.round(r.outlinePx * k));
  const wanted = r.centreY * k;
  let centre = wanted;
  if (typeof opts.chinY === "number" && Number.isFinite(opts.chinY)) {
    /* Top edge of the ink, outline included, at least `chinGap` below the chin. */
    const minCentre = opts.chinY + r.chinGap * k + (INK.han.top - INK.han.centre) * size + outline;
    centre = Math.max(centre, minCentre);
  }
  const ceiling = r.maxCentreY * k;
  const chinClear = centre <= ceiling + 0.5;
  centre = Math.min(centre, ceiling);
  const marginV = Math.round(opts.height - (centre + INK.han.centre * size));
  const topY = Math.round(centre - (INK.han.top - INK.han.centre) * size - outline);
  const marginH = Math.round(64 * (opts.width / 1080));
  let second: ReelLayout["second"];
  if (r.second) {
    const size2 = Math.round(r.second.sizePx * k);
    const centre2 = r.second.centreY * k + (centre - wanted);
    second = {
      size: size2,
      outline: Math.max(1, Math.round(r.second.outlinePx * k)),
      centreY: Math.round(centre2),
      marginV: Math.round(opts.height - (centre2 + INK.latin.centre * size2)),
    };
  }
  return { size, outline, marginH, marginV, centreY: Math.round(centre), topY, chinClear, second };
}

/** `#rrggbb` as an inline `\c` colour: `&HBBGGRR&`, no alpha. */
function tagColour(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? m[1] : "ffffff";
  return `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`.toUpperCase();
}

/** A word of a reel line: text, its time inside the event (ms), and whether a space goes before it. */
type ReelUnit = { text: string; start: number | null; end: number | null; spaceBefore: boolean };

/** Punctuation a reel line never shows: the breaker strips it, and a row from elsewhere is stripped here. */
const TRAILING_PUNCT = /^(.*?)([，。、！？；：,.!?;:…”」』）)》〉]+)$/;
const LEADING_PUNCT = /^[“「『（(《〈…]+/;

/**
 * The words of a cue as units in the event's clock, punctuation off,
 * Latin fragments joined the way `joinWords` joins them: no space unless a
 * real gap separates two Latin words. A cue without timings becomes one
 * unit per character (spaces kept), so it still pops and still lights its
 * numbers; only the spoken-word highlight needs the clock.
 */
function reelUnits(c: AssCue): ReelUnit[] {
  const out: ReelUnit[] = [];
  if (c.words?.length) {
    for (let i = 0; i < c.words.length; i++) {
      const w = c.words[i];
      let text = w.text.trim();
      const nextText = c.words[i + 1]?.text.trim() ?? "";
      const m = TRAILING_PUNCT.exec(text);
      if (m) {
        const decimal = /[0-9]$/.test(m[1]) && /^[.,]$/.test(m[2]) && /^[0-9]/.test(nextText);
        if (!decimal) text = m[1];
      }
      text = text.replace(LEADING_PUNCT, "");
      if (!text) continue;
      const start = Math.max(0, Math.round(w.start * 1000 - c.startMs));
      const end = Math.max(start, Math.round(w.end * 1000 - c.startMs));
      const prev = out[out.length - 1];
      const latin = Boolean(prev && /[A-Za-z]$/.test(prev.text) && /^[A-Za-z]/.test(text));
      if (latin && prev.end !== null && start - prev.end <= 40) {
        prev.text += text;
        prev.end = Math.max(prev.end, end);
        continue;
      }
      out.push({ text, start, end, spaceBefore: latin });
    }
    return out;
  }
  for (const ch of Array.from(c.text.trim())) {
    if (/[，。、！？；：]/.test(ch)) continue;
    out.push({ text: ch, start: null, end: null, spaceBefore: false });
  }
  return out;
}

/** Units and unit chars that count as a figure: digits with their marks and units, and Han numerals of two or more. */
const DIGIT_RUN = /[0-9][0-9.,]*[0-9]|[0-9]/g;
const UNIT_AFTER_DIGITS = "多个页次万亿千百倍成条家年月日号天人元块美金美元%％";
const HAN_NUMERAL = /[零一二三四五六七八九十百千万亿几两]{2,}[多余]?/g;
const NUMBER_PREFIX = /[近约超共达仅逾]/;

/** Character ranges of the figures in a line, by code point. */
export function numberRanges(text: string): [number, number][] {
  const cps = Array.from(text);
  const u16ToCp: number[] = [];
  for (let i = 0, u = 0; i < cps.length; i++) {
    u16ToCp[u] = i;
    u += cps[i].length;
    u16ToCp[u] = i + 1;
  }
  const ranges: [number, number][] = [];
  const push = (aU16: number, bU16: number, extendUnits: boolean) => {
    let a = u16ToCp[aU16] ?? 0;
    let b = u16ToCp[bU16] ?? cps.length;
    if (extendUnits) {
      let n = 0;
      while (b < cps.length && n < 4 && UNIT_AFTER_DIGITS.includes(cps[b])) {
        b++;
        n++;
      }
      if (a > 0 && NUMBER_PREFIX.test(cps[a - 1])) a--;
    }
    ranges.push([a, b]);
  };
  for (const m of text.matchAll(DIGIT_RUN)) push(m.index!, m.index! + m[0].length, true);
  for (const m of text.matchAll(HAN_NUMERAL)) push(m.index!, m.index! + m[0].length, true);
  ranges.sort((x, y) => x[0] - y[0]);
  return ranges;
}

/**
 * Which units rest in the accent: every figure, plus the first of the
 * row's keywords that occurs outside a figure, up to `maxKeywords`.
 */
function accentFlags(units: ReelUnit[], keywords: string[], maxKeywords: number): boolean[] {
  const plain = units.map((u) => u.text).join("");
  const cps = Array.from(plain);
  const unitOf: number[] = [];
  units.forEach((u, i) => {
    for (let k = 0; k < Array.from(u.text).length; k++) unitOf.push(i);
  });
  const lit = new Array<boolean>(units.length).fill(false);
  const mark = (a: number, b: number) => {
    for (let p = a; p < b && p < unitOf.length; p++) lit[unitOf[p]] = true;
  };
  const numbers = numberRanges(plain);
  for (const [a, b] of numbers) mark(a, b);
  const wanted = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  let used = 0;
  for (const kw of wanted) {
    if (used >= maxKeywords) break;
    const kcp = Array.from(kw);
    let at = -1;
    for (let i = 0; i + kcp.length <= cps.length; i++) {
      let ok = true;
      for (let k = 0; k < kcp.length; k++) {
        if (cps[i + k] !== kcp[k]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (numbers.some(([a, b]) => i < b && i + kcp.length > a)) continue;
      at = i;
      break;
    }
    if (at === -1) continue;
    mark(at, at + kcp.length);
    used++;
  }
  return lit;
}

function reelAss(cues: AssCue[], preset: CaptionPreset, opts: AssOptions): string {
  const st = preset.style;
  const r = st.reel!;
  const L = reelLayout(preset, opts)!;
  const k = opts.height / 1920;

  /* The Black OTF's family name is "Noto Sans CJK SC Black" with Bold 0;
     asking for bold on top of it sends libass to DejaVu (Stage 0). A
     family that names its weight is never emboldened. */
  const namesWeight = /\b(black|heavy|bold|medium|light)$/i.test(st.family);
  const styleZh = [
    "Style: Reel",
    st.family,
    L.size,
    assColour(st.fill),
    assColour(st.fill),
    assColour(r.outlineColour),
    assColour("#000000", 0),
    st.weight >= 600 && !namesWeight ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    1,
    L.outline,
    0,
    2,
    L.marginH,
    L.marginH,
    L.marginV,
    1,
  ].join(",");

  const styleEn =
    r.second && st.second && L.second
      ? [
          "Style: ReelEn",
          st.second.family,
          L.second.size,
          assColour(st.fill, Math.round(255 * (1 - r.second.opacity))),
          assColour(st.fill, Math.round(255 * (1 - r.second.opacity))),
          assColour(r.outlineColour, Math.round(255 * (1 - r.second.opacity))),
          assColour("#000000", 0),
          r.second.bold ? -1 : 0,
          0,
          0,
          0,
          100,
          100,
          0,
          0,
          1,
          L.second.outline,
          0,
          2,
          L.marginH,
          L.marginH,
          L.second.marginV,
          1,
        ].join(",")
      : null;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    /* No wrapping: a reel line is one line by construction, and a line the
       breaker got wrong should show as one long line, not as two. */
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleZh,
    ...(styleEn ? [styleEn] : []),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const accent = tagColour(opts.accent);
  const white = tagColour(st.fill);
  const popUp = Math.round(r.popMs * 0.7);
  const blur = Math.round(r.blur * k * 10) / 10;
  const pop = `\\fscx0\\fscy0\\blur${blur}\\t(0,${popUp},\\fscx${r.peak}\\fscy${r.peak})\\t(${popUp},${r.popMs},\\fscx100\\fscy100)`;

  const sorted = cues
    .filter((c) => c.text.trim() && c.endMs > c.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);

  const events: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const next = sorted[i + 1];
    /* Half a second at least, into the gap before the next line only. */
    let endMs = c.endMs;
    if (endMs - c.startMs < r.minMs) endMs = Math.max(endMs, Math.min(c.startMs + r.minMs, next ? next.startMs : c.startMs + r.minMs));

    const units = reelUnits(c);
    if (!units.length) continue;
    const lit = accentFlags(units, c.keywords ?? [], r.maxKeywords);
    const body = units
      .map((u, idx) => {
        const rest = lit[idx] ? accent : white;
        let tags = `${pop}\\c${rest}`;
        if (u.start !== null && u.end !== null) {
          const a = Math.max(r.popMs, u.start);
          const b = Math.max(a + 1, u.end);
          tags += `\\t(${a},${a + 1},\\c${accent}\\fscx${r.spokenScale}\\fscy${r.spokenScale})\\t(${b},${b + 1},\\c${rest}\\fscx100\\fscy100)`;
        }
        return `{${tags}}${u.spaceBefore ? " " : ""}${escape(u.text)}`;
      })
      .join("");
    events.push(`Dialogue: 0,${timestamp(c.startMs)},${timestamp(endMs)},Reel,,0,0,0,,{\\fad(0,${REEL_EXIT_MS})}${body}`);

    if (styleEn && r.second && c.second?.trim()) {
      const startEn = Math.min(c.startMs + r.second.delayMs, Math.max(c.startMs, endMs - 120));
      events.push(
        `Dialogue: 1,${timestamp(startEn)},${timestamp(endMs)},ReelEn,,0,0,0,,{\\fad(${r.second.delayMs},${REEL_EXIT_MS})}${escape(c.second.trim())}`,
      );
    }
  }

  return [...header, ...events, ""].join("\n");
}
