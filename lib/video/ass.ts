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

export function toAss(
  cues: AssCue[],
  opts: { presetKey: string; width: number; height: number; accent: string },
): string {
  const preset: CaptionPreset = captionPreset(opts.presetKey);
  const st = preset.style;

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
