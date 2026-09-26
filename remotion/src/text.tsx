import React from "react";

/**
 * Text helpers shared by the v1 graphics and the v2 templates.
 *
 * Their own file because `Graphics.tsx` dispatches to `v2.tsx` and both need
 * the same three things: the accent marking, the CJK test, and — new with
 * v2 — an estimate of how wide a line will set, so a template can pick the
 * largest size that fits the safe width without asking the DOM (which a
 * frame-by-frame renderer cannot wait on).
 */

/** Whether a line is mostly Chinese, which picks the face and the tracking. */
export const isCjk = (text: string) => (text.match(/[㐀-鿿]/g) ?? []).length > text.length / 3;

/**
 * A line with its keywords set in the accent colour.
 *
 * The channel marks the words that matter in its yellow-green: "一枚智能戒指"
 * with 智能 lit. The director writes them as 【智能】; this draws them.
 */
export const Marked: React.FC<{ text: string; accent: string; scale?: number }> = ({ text, accent, scale = 1.08 }) => {
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

/** The lines a multi-line graphic is written as: `one | two | three`, or with newlines. */
export const splitLines = (text: string, max: number): string[] =>
  text
    .split(/\n|\|/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);

/**
 * How wide a line sets, in ems of its font size.
 *
 * Noto Sans CJK sets every Han character and fullwidth mark on exactly one
 * em; its Latin is proportional and, at the Bold weight, wider than
 * Inter's. The figures below are calibrated on a rendered credits line
 * (素材来源：抖音 @xxx · B站 @xxx · YouTube @Anthropic ·, 742 px at 26 px
 * in the Bold) and err four to five per cent wide, so a line the estimate
 * says fits does fit. The 【】 marks are not drawn and do not count.
 */
export function emWidth(text: string): number {
  let w = 0;
  for (const ch of text.replace(/[【】]/g, "")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x3400 && c <= 0x9fff) w += 1; // Han
    else if (c >= 0xff00 && c <= 0xffef) w += 1; // fullwidth forms and punctuation
    else if (c >= 0x3000 && c <= 0x303f) w += 1; // CJK punctuation 「」、。
    else if (c >= 0x30 && c <= 0x39) w += 0.64; // digits (tabular)
    else if (c >= 0x41 && c <= 0x5a) w += 0.76; // capitals
    else if (c >= 0x61 && c <= 0x7a) w += 0.62; // lowercase
    else if (ch === " ") w += 0.3;
    else if ("%.,:;·-–—".includes(ch)) w += 0.36;
    else if (ch === "@") w += 0.95;
    else w += 0.64;
  }
  return w * 1.03;
}

/**
 * A credits line packed by its entries — `素材来源：抖音 @xxx · B站 @xxx ·
 * YouTube @Anthropic` splits on the " · " between sources — into at most
 * `maxLines` lines of `emsPerLine`, so a break never lands inside a
 * source's own words (Pinterest | @xxx). An entry too long for a line
 * on its own is wrapped by `wrapLines`.
 */
export function packEntries(text: string, emsPerLine: number, maxLines: number): string[] {
  const entries = text.split(/\s*·\s*/).map((e) => e.trim()).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const entry of entries) {
    if (out.length >= maxLines) break;
    const next = line ? `${line} · ${entry}` : entry;
    if (emWidth(next) <= emsPerLine) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = "";
    if (emWidth(entry) <= emsPerLine) line = entry;
    else {
      const parts = wrapLines(entry, emsPerLine, maxLines - out.length);
      out.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? "";
    }
  }
  if (line && out.length < maxLines) out.push(line);
  return out.slice(0, maxLines);
}

/**
 * A credits line at the largest size, at most `max` and never under `min`,
 * at which `packEntries` holds every source in `maxLines` lines of `width`
 * pixels. `complete` is false when even `min` cannot: `packEntries` drops
 * the sources that do not fit, and a credit that vanished without a trace
 * is exactly what the end card must never do (the line is the on-screen
 * half of the asset record), so the template says so on the card instead.
 * Whitespace and the " · " separators are ignored in the comparison, since
 * a wrapped entry loses the space at its break.
 */
export function fitPacked(text: string, width: number, max: number, min: number, maxLines: number): { size: number; lines: string[]; complete: boolean } {
  const strip = (s: string) => s.replace(/[\s·]/g, "");
  const whole = strip(text);
  for (let size = max; size >= min; size -= 2) {
    const lines = packEntries(text, width / size, maxLines);
    if (strip(lines.join("")) === whole) return { size, lines, complete: true };
  }
  return { size: min, lines: packEntries(text, width / min, maxLines), complete: false };
}

/**
 * The largest font size, at most `max`, at which the widest of `lines` sets
 * inside `width` pixels; never under `min`. A hook line of eight Han
 * characters at 120 px is 960 px wide and the safe width is 866, so the
 * hook block shrinks to 108 px rather than running into the platform's
 * right-hand controls.
 */
export function fitSize(lines: string[], width: number, max: number, min: number): number {
  const widest = Math.max(0.5, ...lines.map(emWidth));
  return Math.max(min, Math.min(max, Math.floor(width / widest)));
}

/**
 * The units a line may break between.
 *
 * Chrome breaks Chinese between any two characters, which puts 发 on one
 * line and 布 on the next; a reader stumbles on the split word. Where the
 * browser has `Intl.Segmenter` (Chrome has, since 87) the units are its
 * words for Chinese, so 发布 stays whole; otherwise a Han character is a
 * unit. Latin words and numbers are never split in either case. Closing
 * punctuation (」，。) rides with the unit before it and opening
 * punctuation (「) with the one after, so a quote mark never starts or
 * ends a line on its own. A Han unit straight after a number (154页,
 * 6到9成's 成, 30万) rides with the number, so a figure never ends a line
 * with its unit on the next.
 */
type Segmenter = { segment: (s: string) => Iterable<{ segment: string; isWordLike?: boolean }> };
const segmenter: Segmenter | null = (() => {
  try {
    const S = (Intl as unknown as { Segmenter?: new (locale: string, o: { granularity: string }) => Segmenter }).Segmenter;
    return S ? new S("zh", { granularity: "word" }) : null;
  } catch {
    return null;
  }
})();
const CLOSING = /^[」』）】》〕〉,.;:!?，。；：！？、%]+$/;
const OPENING = /^[「『（【《〔〈]+$/;

export function breakUnits(text: string): string[] {
  const raw = segmenter
    ? Array.from(segmenter.segment(text), (s) => s.segment)
    : (text.match(/[㐀-鿿　-〿＀-￯]|[^\s㐀-鿿　-〿＀-￯]+|\s+/g) ?? [text]);
  const units: string[] = [];
  let pendingOpen = "";
  for (const seg of raw) {
    if (OPENING.test(seg)) {
      pendingOpen += seg;
      continue;
    }
    const unit = pendingOpen + seg;
    pendingOpen = "";
    const prev = units.length ? units[units.length - 1] : "";
    const afterNumber = /[\d%.]\s?$/.test(prev) && /^[㐀-鿿]/.test(unit) && !pendingOpen;
    if ((CLOSING.test(seg) || afterNumber) && units.length) units[units.length - 1] += unit;
    else units.push(unit);
  }
  if (pendingOpen) units.push(pendingOpen);
  return units;
}

/**
 * Greedy wrap by estimated width, for a definition or a credits line the
 * template must hold to a few lines. Breaks only between `breakUnits`, so
 * never inside a Chinese word, a Latin word or a number; a unit wider than
 * the line is split by character rather than overflow. Whitespace between
 * Latin words is kept, whitespace at a break is dropped.
 */
export function wrapLines(text: string, emsPerLine: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = "";
  const push = (tok: string) => {
    const next = line + tok;
    if (emWidth(next) > emsPerLine && line.trim()) {
      out.push(line.trim());
      line = tok.trimStart();
    } else {
      line = next;
    }
  };
  for (const tok of breakUnits(text)) {
    if (out.length >= maxLines) break;
    if (/^\s+$/.test(tok)) {
      if (line) line += " ";
      continue;
    }
    if (emWidth(tok) > emsPerLine) for (const ch of tok) push(ch);
    else push(tok);
  }
  if (out.length < maxLines && line.trim()) out.push(line.trim());
  return out.slice(0, maxLines);
}

/**
 * The largest size, at most `max`, at which `text` wraps into `maxLines`
 * lines of `width` pixels without losing anything, with the lines it
 * makes. A headline that is too long for two lines at 68 px is set at the
 * size where it fits rather than cut off.
 */
export function fitWrapped(text: string, width: number, max: number, min: number, maxLines: number): { size: number; lines: string[]; complete: boolean } {
  const whole = text.replace(/\s+/g, "");
  for (let size = max; size >= min; size -= 2) {
    const lines = wrapLines(text, width / size, maxLines);
    if (lines.join("").replace(/\s+/g, "") === whole) return { size, lines, complete: true };
  }
  const lines = wrapLines(text, width / min, maxLines);
  return { size: min, lines, complete: lines.join("").replace(/\s+/g, "") === whole };
}

/**
 * `fitWrapped`, and when even `min` cannot hold the text in `maxLines`
 * lines, one line more at `min`; and when that cannot either, the lines at
 * `min` with the last ending in an ellipsis. `wrapLines` drops what does
 * not fit, so without this a definition or a headline a few characters
 * too long lost its last words with nothing on screen to say so — the cut
 * is now visible, and the director's row is what has to change.
 */
export function fitWrappedOrMark(text: string, width: number, max: number, min: number, maxLines: number): { size: number; lines: string[]; complete: boolean } {
  const fit = fitWrapped(text, width, max, min, maxLines);
  if (fit.complete) return fit;
  const more = fitWrapped(text, width, min, min, maxLines + 1);
  if (more.complete) return more;
  const lines = [...more.lines];
  if (lines.length) lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  return { ...more, lines, complete: false };
}
