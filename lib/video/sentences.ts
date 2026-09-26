import type { Sentence, Silence, Word } from "@/lib/video/v2/types";

/**
 * Words into sentences, with ids that stay put.
 *
 * Everything in director v2 talks about the take by sentence: the outline
 * call returns beats per sentence id, the cut planner drops sentence ids
 * with a reason, the gold labels name the sentence a retake kept. So the
 * split has to be deterministic — the same words always give the same
 * `s000, s001, …` — and it has to happen once, here, before anything else
 * looks at the transcript. Pure: no I/O, no model, nothing random.
 *
 * Where a sentence ends, in order of trust:
 *
 *   1. Sentence punctuation on the word (。！？ and their ASCII forms).
 *      Whisper punctuates when its initial prompt does (see
 *      /opt/whisper/transcribe.py), but on this studio's takes it mostly
 *      punctuates the first minute and then stops, so this cannot be the
 *      only rule.
 *   2. A measured silence between two words (`silences`, from ffmpeg's
 *      silencedetect — W1's `detectSilences`). The word timings alone carry
 *      almost no pauses: on the 蒸馏 take 1,106 of 1,127 gaps are exactly
 *      zero, and where whisper does leave a gap it hangs the pause on the
 *      *next* word's start. So a silence is matched by its midpoint, with a
 *      tolerance that reaches into the next word.
 *   3. A gap in the word timings themselves, when there is one.
 *   4. A comma, once the sentence is long enough to stand alone.
 *   5. A caption boundary, only once the sentence is past `maxChars` — the
 *      v1 caption lines were hard-broken at sixteen characters, so they are
 *      a last resort, not a signal.
 *   6. `hardMaxChars`: a ceiling, so a two-minute unpunctuated stretch with
 *      no silences given still becomes several sentences the model can
 *      point at.
 *
 * W1 owns this file after Stage 0 and may tune the numbers; the shape of
 * `Sentence` is frozen in `v2/types.ts`.
 */

/** A word as the transcriber gives it (seconds) or as v2 keeps it (ms). */
export type WordInput = { text: string; start: number; end: number } | Word;

/** A caption line, in the same clock as the words. Only the times are read. */
export type CaptionInput = { startMs: number; endMs: number };

export type SentenceOptions = {
  /** The clip these words were said in. One take, one id; `src` by default. */
  clipId?: string;
  /** Measured pauses in the same clock as the words. */
  silences?: Silence[];
  /** A measured silence at least this long may end a sentence (the detector's own floor is 250 ms). */
  minSilenceMs?: number;
  /** A silence at least this long ends a sentence of `minChars`; a shorter one needs `softMinChars`. */
  firmSilenceMs?: number;
  /** A silence at least this long ends a sentence whatever its length: nobody pauses a second mid-thought. */
  hardSilenceMs?: number;
  /** A silence further than this from the nearest word boundary is not between two words at all. */
  silenceSnapMs?: number;
  /** A gap in the word timings at least this long ends a sentence. */
  pauseMs?: number;
  /** A comma ends a sentence once it holds at least this many Han characters. */
  commaMinChars?: number;
  /** Below this many Han characters a pause or a firm silence does not break: a one-word sentence is noise. */
  minChars?: number;
  /** A short silence (a breath, 250–400 ms) breaks only a sentence at least this long. */
  softMinChars?: number;
  /** Past this many Han characters a caption boundary may break. */
  maxChars?: number;
  /** Past this many Han characters the sentence breaks regardless. */
  hardMaxChars?: number;
};

const DEFAULTS: Required<Omit<SentenceOptions, "silences">> = {
  clipId: "src",
  minSilenceMs: 250,
  firmSilenceMs: 400,
  hardSilenceMs: 900,
  silenceSnapMs: 600,
  pauseMs: 600,
  commaMinChars: 10,
  minChars: 6,
  softMinChars: 10,
  maxChars: 40,
  hardMaxChars: 60,
};

const SENTENCE_END = /[。！？!?；;…]["”』」）)]*$/;
const COMMA_END = /[，,、]["”』」）)]*$/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
/* Letters only: "1." + "51" is one number, "63." + "5%" is one figure. */
const LATIN_END = /[A-Za-z]$/;
const LATIN_START = /^[A-Za-z]/;

/** How many Han characters a string holds. Latin and digits count for nothing here on purpose. */
export function hanCount(text: string): number {
  return (text.match(HAN) ?? []).length;
}

/** Words in milliseconds, whichever clock they arrived in. */
export function toWords(words: readonly WordInput[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    const text = (w.text ?? "").trim();
    if (!text) continue;
    if ("startMs" in w) {
      out.push({ text, startMs: Math.round(w.startMs), endMs: Math.round(Math.max(w.startMs, w.endMs)) });
    } else {
      const startMs = Math.round(w.start * 1000);
      out.push({ text, startMs, endMs: Math.round(Math.max(w.start, w.end) * 1000) });
    }
  }
  return out;
}

/**
 * Join words the way the language reads them.
 *
 * Chinese has no spaces. Whisper splits Latin names into fragments
 * (An·th·rob·ic, De·ep·Se·ek) and gives them back to back, so a space is
 * put only between two fragments that both look like words *and* have a
 * timing gap between them — a fragment that starts where the last one
 * ended is the same word continuing.
 */
export function joinWords(words: readonly Word[]): string {
  let text = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0) {
      const p = words[i - 1];
      const bothLatin = LATIN_END.test(p.text) && LATIN_START.test(w.text);
      if (bothLatin && w.startMs - p.endMs > 40) text += " ";
    }
    text += w.text;
  }
  return text.trim();
}

/**
 * Split words into sentences.
 *
 * `captions` is the second positional argument because that is how the
 * plan names the call; it is optional and only its times are read.
 */
export function toSentences(
  words: readonly WordInput[],
  captions: readonly CaptionInput[] = [],
  options: SentenceOptions = {},
): Sentence[] {
  const o = { ...DEFAULTS, ...options };
  const all = toWords(words);
  if (!all.length) return [];

  const captionEdges = new Set<number>();
  for (const c of captions) {
    captionEdges.add(c.startMs);
    captionEdges.add(c.endMs);
  }

  /*
   * Which word boundary each measured pause belongs to.
   *
   * Whisper's word times are loose by a few hundred milliseconds around a
   * pause: it hangs the silence on the start of the word that follows, or
   * lets the last word before it run late. Matching a silence to whichever
   * boundary its window happens to overlap first put a break *inside* a
   * word (罕见联|手, because 手 was timed to start before the pause that
   * followed it). So every silence is assigned to the one word boundary
   * nearest its start, and only if that boundary is within `silenceSnapMs`;
   * a pause further from any boundary than that is not between two words.
   *
   * Three grades by length: `hard` (≥ hardSilenceMs) always ends the
   * sentence; `firm` (≥ firmSilenceMs) ends one of `minChars`; `soft`
   * (≥ minSilenceMs, a breath) ends one of `softMinChars` or more.
   */
  type Grade = "hard" | "firm" | "soft";
  const grade = (len: number): Grade | null =>
    len >= o.hardSilenceMs ? "hard" : len >= o.firmSilenceMs ? "firm" : len >= o.minSilenceMs ? "soft" : null;
  const RANK: Record<Grade, number> = { soft: 0, firm: 1, hard: 2 };
  /* Keyed by the index of the word the boundary follows. */
  const pauseAfter = new Map<number, Grade>();
  const ends = all.map((w) => w.endMs);
  for (const s of o.silences ?? []) {
    const g = grade(s.endMs - s.startMs);
    if (!g) continue;
    /* Binary search for the first word ending at or after the silence start,
       then compare it with the one before: the nearer boundary takes it. */
    let lo = 0;
    let hi = ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] < s.startMs) lo = mid + 1;
      else hi = mid;
    }
    let best = lo;
    if (lo > 0 && Math.abs(ends[lo - 1] - s.startMs) <= Math.abs(ends[lo] - s.startMs)) best = lo - 1;
    if (Math.abs(ends[best] - s.startMs) > o.silenceSnapMs) continue;
    const had = pauseAfter.get(best);
    if (!had || RANK[g] > RANK[had]) pauseAfter.set(best, g);
  }

  /*
   * A pause inside a word is not a sentence end. Whisper times syllables,
   * not words, and a 300 ms hesitation between 火 and 力 — real, measured —
   * would otherwise split 火力 across two sentences and put a caption break
   * inside a word. The segmenter says where the words are; a soft or firm
   * silence only breaks on a word edge. A hard silence breaks regardless:
   * a second of quiet mid-word is a fluff the cut will show anyway.
   */
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
  const onWordEdge = (before: string, after: string): boolean => {
    if (!segmenter || !before || !after) return true;
    const text = before + after;
    for (const seg of segmenter.segment(text)) {
      if (seg.index === before.length) return true;
      if (seg.index > before.length) return false;
    }
    return true;
  };

  const sentences: Sentence[] = [];
  let buffer: Word[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const id = `s${String(sentences.length).padStart(3, "0")}`;
    sentences.push({
      id,
      clipId: o.clipId,
      startMs: buffer[0].startMs,
      endMs: buffer[buffer.length - 1].endMs,
      text: joinWords(buffer),
      words: buffer,
    });
    buffer = [];
  };

  for (let i = 0; i < all.length; i++) {
    const w = all[i];
    buffer.push(w);
    const next = all[i + 1];
    if (!next) break;

    const chars = hanCount(joinWords(buffer));
    const longEnough = chars >= o.minChars || buffer.length >= 4;
    const pause = pauseAfter.get(i) ?? null;

    let cut = false;
    if (SENTENCE_END.test(w.text)) cut = true;
    else if (pause === "hard") cut = true;
    else if (longEnough && next.startMs - w.endMs >= o.pauseMs) cut = true;
    else if (longEnough && pause === "firm" && onWordEdge(joinWords(buffer.slice(-6)), next.text)) cut = true;
    else if (pause === "soft" && chars >= o.softMinChars && onWordEdge(joinWords(buffer.slice(-6)), next.text)) cut = true;
    if (cut) {
      flush();
      continue;
    }
    if (COMMA_END.test(w.text) && chars >= o.commaMinChars) cut = true;
    else if (chars >= o.maxChars && (captionEdges.has(w.endMs) || captionEdges.has(next.startMs))) cut = true;
    else if (chars >= o.hardMaxChars) cut = true;

    if (cut) flush();
  }
  flush();
  return sentences;
}

/**
 * Word timings reconciled with measured silence.
 *
 * Whisper hangs a pause on the word that follows it: on the 蒸馏 take 核
 * is timed 40.86–41.30 s while the take is silent until 41.24 s, and 阿 is
 * timed 126.40–127.08 s across a pause that runs 126.43–127.01 s. Every
 * consumer downstream is bitten by that — the cut planner counts a word as
 * removed when its middle lies in a trimmed pause, the caption retimer drops
 * a word whose start it cannot map, and a caption pops before its syllable.
 * The silences are the measurement, so the words move to them:
 *
 *   - a silence (≥ `minSilenceMs`) beginning within `toleranceMs` of a
 *     word's start, with the word running on past it: the word starts where
 *     the silence ends (a syllable outlasts the tolerance, so a word whose
 *     first 120 ms are "speech" and then 200 ms of quiet was not spoken
 *     before the pause);
 *   - a silence covering the whole of a word bar a sliver at its start: the
 *     word ends where the silence starts (whisper's 在 timed across a 5.6 s
 *     pause is 50 ms of 在 and 5.5 s of nothing);
 *   - a word timed to run on into the silence after it: it ends where the
 *     silence starts.
 *
 * Words never cross each other: each new start is at least the previous
 * word's new end. Pure, and cheap enough to run on every take.
 */
export function alignWords(
  words: readonly Word[],
  silences: readonly Silence[],
  options: { minSilenceMs?: number; toleranceMs?: number } = {},
): Word[] {
  const minSilence = options.minSilenceMs ?? 200;
  const tol = options.toleranceMs ?? 120;
  const sil = silences.filter((s) => s.endMs - s.startMs >= minSilence).sort((a, b) => a.startMs - b.startMs);
  const out: Word[] = [];
  let floor = 0;
  for (const w0 of words) {
    let startMs = w0.startMs;
    let endMs = w0.endMs;
    /* The silence covering the start, if any: it begins no later than `tol`
       after the word's nominal start and reaches past it. */
    const atStart = sil.find((s) => s.startMs <= startMs + tol && s.endMs > startMs + tol);
    if (atStart) {
      if (atStart.endMs < endMs - 30) {
        startMs = atStart.endMs;
      } else if (atStart.startMs > startMs + 30) {
        endMs = atStart.startMs;
      } else {
        /* Entirely inside the pause: the syllable is after it. */
        const dur = Math.max(40, Math.min(endMs - startMs, 400));
        startMs = atStart.endMs;
        endMs = startMs + dur;
      }
    }
    /* A silence the word runs on into. */
    const atEnd = sil.find((s) => s.startMs > startMs + 30 && s.startMs < endMs - tol && s.endMs >= endMs - tol);
    if (atEnd) endMs = atEnd.startMs;
    startMs = Math.max(startMs, floor);
    endMs = Math.max(endMs, startMs);
    out.push({ text: w0.text, startMs: Math.round(startMs), endMs: Math.round(endMs) });
    floor = Math.round(endMs);
  }
  return out;
}

/** The sentence a moment falls in, or the nearest one when it falls in a gap. */
export function sentenceAt(sentences: readonly Sentence[], ms: number): Sentence | null {
  if (!sentences.length) return null;
  let best: Sentence | null = null;
  let bestGap = Infinity;
  for (const s of sentences) {
    if (ms >= s.startMs && ms <= s.endMs) return s;
    const gap = ms < s.startMs ? s.startMs - ms : ms - s.endMs;
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best;
}
