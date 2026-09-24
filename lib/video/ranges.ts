/**
 * Where the speech is, and where it is not.
 *
 * Pure arithmetic over word timings, in its own file so it can be reasoned
 * about and tested without a database, a model or a viewer. Everything the
 * auto-editor does to a timeline is built on these three functions, and they
 * are the part that must be exactly right: a cut placed a hundred milliseconds
 * early clips a consonant, and every viewer hears it.
 */

export type Range = { startMs: number; endMs: number };

/**
 * Silence, as measured between words.
 *
 * Nothing here is an opinion: the transcriber says when each word started and
 * ended, and the space between them is space. A pause under `keepMs` is speech
 * — people breathe mid-sentence — and anything longer is the part of a raw
 * take that makes it unwatchable.
 *
 * `padMs` is left on each side so a cut does not clip the start of a consonant
 * or the tail of a vowel, which is the difference between a tight edit and one
 * that sounds chopped.
 */
export function speechRanges(
  words: { start: number; end: number }[],
  opts: { keepMs?: number; padMs?: number } = {},
): Range[] {
  const keepMs = opts.keepMs ?? 600;
  const padMs = opts.padMs ?? 120;
  if (words.length === 0) return [];

  const ranges: Range[] = [];
  let startMs = Math.max(0, words[0].start * 1000 - padMs);
  let endMs = words[0].end * 1000 + padMs;

  for (const w of words.slice(1)) {
    const wordStart = w.start * 1000;
    if (wordStart - (endMs - padMs) > keepMs) {
      ranges.push({ startMs: Math.round(startMs), endMs: Math.round(endMs) });
      startMs = Math.max(0, wordStart - padMs);
    }
    endMs = w.end * 1000 + padMs;
  }
  ranges.push({ startMs: Math.round(startMs), endMs: Math.round(endMs) });
  return ranges;
}

/** Ranges that touch or overlap, merged. A hundred one-second cuts is not an
 * edit, it is a stutter. */
export function mergeRanges(ranges: Range[], gapMs = 400): Range[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const out: Range[] = [];

  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startMs - last.endMs <= gapMs) {
      last.endMs = Math.max(last.endMs, r.endMs);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * The parts of `wanted` that are actually speech.
 *
 * A model asked for ranges returns round numbers — "keep 0 to 30000" — which
 * cut mid-word. Intersecting its plan with the speech that was measured means
 * the edit lands in silence even when the plan is approximate.
 */
export function intersect(wanted: Range[], speech: Range[]): Range[] {
  const out: Range[] = [];
  for (const w of wanted) {
    for (const s of speech) {
      const startMs = Math.max(w.startMs, s.startMs);
      const endMs = Math.min(w.endMs, s.endMs);
      // Under a third of a second is a frame or two of a word, not a cut.
      if (endMs - startMs > 300) out.push({ startMs, endMs });
    }
  }
  return mergeRanges(out);
}

/**
 * Where a source timestamp ends up after the cut, or null if it was removed.
 *
 * This is what keeps captions and graphics in sync with an edit: they were
 * timed against the original, and every timing after the first removal is
 * wrong by the length of everything taken out before it.
 */
/**
 * The same map, for a time that must land somewhere.
 *
 * `mapTime` answers "where is this instant on the cut" and says null when the
 * instant was removed, which is right for a question and wrong for a caption:
 * a line whose first word began a fifth of a second inside a trimmed silence
 * was being thrown away whole, taking the sentence with it. This snaps such a
 * time to the nearest surviving edge instead — the caption starts a moment
 * early rather than never.
 */
export function mapTimeNear(ms: number, cuts: Range[]): number | null {
  if (!cuts.length) return null;
  let elapsed = 0;
  for (const c of cuts) {
    if (ms < c.startMs) return Math.round(elapsed);
    if (ms <= c.endMs) return Math.round(elapsed + (ms - c.startMs));
    elapsed += c.endMs - c.startMs;
  }
  return Math.round(elapsed);
}

export function mapTime(ms: number, cuts: Range[]): number | null {
  let elapsed = 0;
  for (const c of cuts) {
    if (ms < c.startMs) return null;
    if (ms <= c.endMs) return Math.round(elapsed + (ms - c.startMs));
    elapsed += c.endMs - c.startMs;
  }
  return null;
}
