import type { Silence } from "@/lib/video/v2/types";

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

/* ------------------------------------------------------------ director v2 */

/*
 * Everything above works from the word timings and serves the chat tool's
 * `trim_pauses` and the v1 first cut; nothing above changes. Everything
 * below works from *measured* silences (`lib/video/silences.ts`) and serves
 * the v2 cut planner. The difference matters: whisper's word timings on a
 * Mandarin take carry almost no pauses (1,106 of 1,127 gaps are zero on the
 * 蒸馏 take), so a cut placed by them lands somewhere near a pause; a cut
 * placed by silencedetect lands inside one.
 */

export type SpeechFromSilencesOptions = {
  /** A silence shorter than this stays as it is: people breathe mid-sentence. */
  minPause?: number;
  /** What a longer silence is shortened to. */
  trimTo?: number;
  /** What a silence at a sentence end is shortened to: a beat between thoughts reads as intended. */
  endTrimTo?: number;
  /** How much of the silence stays on the outgoing side of the cut, so the tail of the last vowel is never clipped. */
  guard?: number;
  /** Word ends (ms) where a sentence closes; a silence beside one keeps `endTrimTo`. */
  sentenceEnds?: readonly number[];
  /** How near a sentence end must be to a silence's start to count as beside it. */
  sentenceSnapMs?: number;
  /**
   * A silence that begins within this of 0, or ends within this of `totalMs`,
   * is the lead-in or the tail rather than a pause. Containers report a
   * duration a few frames past the last audio sample (the 蒸馏 master says
   * 379.287 s, its audio 379.264 s), and without this the closing silence was
   * treated as a pause to shorten: a cut inside it, then a 163 ms piece of
   * nothing at the end of the timeline.
   */
  edgeMs?: number;
};

const SPEECH_DEFAULTS = { minPause: 300, trimTo: 120, endTrimTo: 200, guard: 60, sentenceSnapMs: 600, edgeMs: 150 } as const;

/**
 * The parts of a take that stay when every long pause is shortened.
 *
 * Each measured silence of at least `minPause` becomes `trimTo` ms of quiet
 * (`endTrimTo` at a sentence end): `guard` ms of it stays after the speech
 * that precedes it and the rest stays before the speech that follows, so
 * the cut sits inside the quiet on both sides. The lead-in before the first
 * word is cut to `guard` ms (the plan wants the first word within 0.3 s);
 * the tail after the last word keeps `endTrimTo` so the end card has a beat.
 *
 * The result is a list of kept source spans, in order, in the same shape as
 * `speechRanges` — the v2 planner intersects it with the sentences it keeps.
 */
export function speechFromSilences(
  silences: readonly Silence[],
  totalMs: number,
  opts: SpeechFromSilencesOptions = {},
): Range[] {
  const o = { ...SPEECH_DEFAULTS, ...opts };
  const ends = [...(o.sentenceEnds ?? [])].sort((a, b) => a - b);
  const atSentenceEnd = (s: Silence): boolean => {
    /* Binary search for the first sentence end at or after the silence start,
       then compare it and the one before with the window. */
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] < s.startMs) lo = mid + 1;
      else hi = mid;
    }
    const near = (e: number | undefined) =>
      e !== undefined && (Math.abs(e - s.startMs) <= o.sentenceSnapMs || (e >= s.startMs && e <= s.endMs));
    return near(ends[lo]) || near(ends[lo - 1]);
  };

  const sorted = [...silences]
    .map((s) => ({ startMs: Math.max(0, s.startMs), endMs: Math.min(totalMs, s.endMs) }))
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const out: Range[] = [];
  let cursor = 0;
  for (const s of sorted) {
    const length = s.endMs - s.startMs;
    if (s.startMs <= o.edgeMs) {
      cursor = Math.max(0, s.endMs - o.guard);
      continue;
    }
    if (s.endMs >= totalMs - o.edgeMs) {
      const endMs = Math.min(totalMs, s.startMs + o.endTrimTo);
      if (endMs > cursor) out.push({ startMs: cursor, endMs });
      cursor = totalMs;
      break;
    }
    if (length < o.minPause) continue;
    const keep = Math.min(length, atSentenceEnd(s) ? o.endTrimTo : o.trimTo);
    const tail = Math.min(o.guard, keep);
    const head = keep - tail;
    const endMs = s.startMs + tail;
    if (endMs > cursor) out.push({ startMs: cursor, endMs });
    cursor = s.endMs - head;
  }
  if (cursor < totalMs) out.push({ startMs: cursor, endMs: totalMs });
  return out.map((r) => ({ startMs: Math.round(r.startMs), endMs: Math.round(r.endMs) }));
}

/** The silence nearest to a moment, if one is within `maxShift` ms; a moment inside a silence returns that silence. */
export function silenceNear(ms: number, silences: readonly Silence[], maxShift = 400): Silence | null {
  let best: Silence | null = null;
  let bestGap = Infinity;
  for (const s of silences) {
    if (ms >= s.startMs && ms <= s.endMs) return s;
    const gap = ms < s.startMs ? s.startMs - ms : ms - s.endMs;
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return bestGap <= maxShift ? best : null;
}

/**
 * The nearest moment inside a silence, or the moment itself when no silence
 * is within `maxShift`. Used to move a cut point the planner chose from
 * word timings (a sentence edge, a take's first word) into measured quiet.
 */
export function snapToSilence(ms: number, silences: readonly Silence[], maxShift = 400): number {
  const s = silenceNear(ms, silences, maxShift);
  if (!s) return ms;
  return Math.min(s.endMs, Math.max(s.startMs, ms));
}

/** `ranges` with every part that falls inside a `drops` span removed. Both lists may be unsorted. */
export function subtract(ranges: readonly Range[], drops: readonly Range[]): Range[] {
  const sortedDrops = [...drops].filter((d) => d.endMs > d.startMs).sort((a, b) => a.startMs - b.startMs);
  const out: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
    let cursor = r.startMs;
    for (const d of sortedDrops) {
      if (d.endMs <= cursor) continue;
      if (d.startMs >= r.endMs) break;
      if (d.startMs > cursor) out.push({ startMs: cursor, endMs: d.startMs });
      cursor = Math.max(cursor, d.endMs);
    }
    if (cursor < r.endMs) out.push({ startMs: cursor, endMs: r.endMs });
  }
  return out;
}

/**
 * The overlap of two range lists, kept exact.
 *
 * `intersect` above merges anything within 400 ms because a chat-tool cut
 * should not stutter; here the whole point is that two spans 180 ms apart
 * are two spans with a shortened pause between them, so nothing is merged
 * unless it touches. Pieces under `minMs` are dropped as slivers.
 */
export function intersectExact(a: readonly Range[], b: readonly Range[], minMs = 150): Range[] {
  const out: Range[] = [];
  const sa = [...a].sort((x, y) => x.startMs - y.startMs);
  const sb = [...b].sort((x, y) => x.startMs - y.startMs);
  let j = 0;
  for (const x of sa) {
    while (j < sb.length && sb[j].endMs <= x.startMs) j++;
    for (let k = j; k < sb.length && sb[k].startMs < x.endMs; k++) {
      const startMs = Math.max(x.startMs, sb[k].startMs);
      const endMs = Math.min(x.endMs, sb[k].endMs);
      if (endMs - startMs >= minMs) out.push({ startMs, endMs });
    }
  }
  return mergeRanges(out, 0);
}
