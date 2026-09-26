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
    else if (longEnough && pause === "firm") cut = true;
    else if (pause === "soft" && chars >= o.softMinChars) cut = true;
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
