import "server-only";
import "@/lib/keys/boot";
import { env } from "@/lib/env";

/**
 * ElevenLabs: transcription for captions, and voice-over.
 *
 * Two jobs on one account, and they are metered differently: transcription by
 * the length of the audio, speech by the number of characters. The free tier
 * this key is on allows 10,000 characters a month, so `quota()` is read before
 * a voice-over is offered rather than after it fails.
 *
 * Nothing in here is called from a page render. The worker calls it, the same
 * rule every other vendor in this codebase follows, because an hour of
 * interview audio is minutes of upload and a bill per request.
 */

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

export class ElevenLabsUnconfigured extends Error {
  constructor() {
    super("No ELEVENLABS_API_KEY is set, so captions cannot be transcribed.");
    this.name = "ElevenLabsUnconfigured";
  }
}

const TIMEOUT_MS = Number(process.env.ELEVENLABS_TIMEOUT_MS ?? 15 * 60_000);

function key(): string {
  const k = env.elevenlabs.apiKey;
  if (!k) throw new ElevenLabsUnconfigured();
  return k;
}

/**
 * Whether the answer came from the API at all.
 *
 * ElevenLabs does not refuse an address it dislikes with an error. It
 * redirects the request to a help article, so `fetch` follows it and hands
 * back a cheerful 200 of HTML where JSON or audio should be, and the failure
 * surfaces three functions later as a parse error about a `<`. This server is
 * on such an address: it used to reach the API through an SSH tunnel to
 * another machine, and that machine is gone on purpose. Say so here, once,
 * in the words of the thing that actually happened.
 */
function cameFromTheApi(res: Response): boolean {
  try {
    return new URL(res.url).origin === new URL(env.elevenlabs.baseUrl).origin;
  } catch {
    return true;
  }
}

const REFUSED =
  "ElevenLabs redirected this request away from its API, which is how it refuses a server's address. " +
  "Voice-over needs an egress ElevenLabs accepts; everything else in the pipeline is unaffected.";

async function call<T>(
  method: "GET" | "POST",
  path: string,
  init: { body?: BodyInit; json?: unknown } = {},
): Promise<T> {
  const res = await fetch(env.elevenlabs.baseUrl + path, {
    method,
    headers: {
      "xi-api-key": key(),
      ...(init.json ? { "Content-Type": "application/json" } : {}),
    },
    body: init.json ? JSON.stringify(init.json) : init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!cameFromTheApi(res)) throw new ElevenLabsError(REFUSED, 403);

  const text = await res.text();
  if (!res.ok) {
    /*
     * The vendor's own words, kept. A quota refusal and a bad file are
     * different problems and a person needs to be able to tell which they
     * have; "transcription failed" tells them neither.
     */
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { detail?: { message?: string; status?: string } | string };
      if (typeof parsed.detail === "string") detail = parsed.detail;
      else if (parsed.detail?.message) detail = parsed.detail.message;
    } catch {
      // Not JSON. The raw text is what we have and it is what we keep.
    }
    throw new ElevenLabsError(`ElevenLabs said ${res.status}: ${detail}`, res.status);
  }

  return JSON.parse(text) as T;
}

export type Quota = {
  tier: string;
  charactersUsed: number;
  characterLimit: number;
  resetsAt: Date | null;
};

export async function quota(): Promise<Quota> {
  const s = await call<{
    tier?: string;
    character_count?: number;
    character_limit?: number;
    next_character_count_reset_unix?: number;
  }>("GET", "/user/subscription");

  return {
    tier: s.tier ?? "unknown",
    charactersUsed: s.character_count ?? 0,
    characterLimit: s.character_limit ?? 0,
    resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000) : null,
  };
}

export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
  type: string;
  speaker?: string;
};

export type Transcript = {
  text: string;
  languageCode: string;
  languageProbability: number;
  durationSecs: number;
  words: TranscriptWord[];
};

/**
 * Transcribe audio, with a word-level timeline.
 *
 * `scribe_v1` returns a `words` array with a start and an end for each one,
 * which is what makes real caption timings possible rather than a guess spread
 * evenly across the cut. `diarize` marks who is speaking, which an interview
 * needs and a monologue ignores.
 *
 * The language is detected rather than declared: this studio publishes in
 * Cantonese, Mandarin and English, sometimes in the same video, and a
 * hardcoded language would quietly mistranscribe the others.
 */
export async function transcribe(
  audio: Blob,
  filename: string,
  options: { diarize?: boolean; languageCode?: string | null } = {},
): Promise<Transcript> {
  const form = new FormData();
  form.set("model_id", "scribe_v1");
  form.set("file", audio, filename);
  form.set("timestamps_granularity", "word");
  if (options.diarize) form.set("diarize", "true");
  if (options.languageCode) form.set("language_code", options.languageCode);

  const raw = await call<{
    text?: string;
    language_code?: string;
    language_probability?: number;
    audio_duration_secs?: number;
    words?: { text?: string; start?: number; end?: number; type?: string; speaker_id?: string }[];
  }>("POST", "/speech-to-text", { body: form });

  return {
    text: raw.text ?? "",
    languageCode: raw.language_code ?? "unknown",
    languageProbability: raw.language_probability ?? 0,
    durationSecs: raw.audio_duration_secs ?? 0,
    words: (raw.words ?? [])
      .filter((w) => typeof w.text === "string")
      .map((w) => ({
        text: w.text ?? "",
        start: w.start ?? 0,
        end: w.end ?? 0,
        type: w.type ?? "word",
        speaker: w.speaker_id,
      })),
  };
}

export type VoiceRow = { id: string; name: string; description: string | null };

export async function voices(): Promise<VoiceRow[]> {
  const raw = await call<{ voices?: { voice_id?: string; name?: string; labels?: Record<string, string> }[] }>(
    "GET",
    "/voices",
  );
  return (raw.voices ?? [])
    .filter((v) => v.voice_id)
    .map((v) => ({
      id: v.voice_id!,
      name: v.name ?? v.voice_id!,
      description: v.labels ? Object.values(v.labels).filter(Boolean).join(" · ") : null,
    }));
}

/**
 * Speech, as MP3 bytes.
 *
 * Returns the audio rather than writing it anywhere: the caller decides where
 * it belongs, and in this codebase that is always the file store with a real
 * owner and a real relation on it.
 */
export async function speak(
  voiceId: string,
  text: string,
  modelId = "eleven_multilingual_v2",
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${env.elevenlabs.baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!cameFromTheApi(res)) throw new ElevenLabsError(REFUSED, 403);
  if (!res.ok) {
    throw new ElevenLabsError(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  }
  return res.arrayBuffer();
}

/**
 * Words into caption lines.
 *
 * A caption is not a word and not a sentence: it is what fits on screen for
 * long enough to read. So lines break on a real pause, on end punctuation, or
 * when they get too long, whichever comes first, and the timings are the
 * transcript's own rather than anything averaged.
 *
 * CJK counts differently. A line of Chinese at 16 characters is already a
 * comfortable two seconds of reading; the same 16 characters of English is
 * three words. `maxChars` is therefore applied per script, not as one number.
 */
export type CaptionLine = { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[] };

/**
 * Director v2's reel lines (PLAN.md §1 "Captions"): one line of 4–12 Han
 * characters aimed at 8, broken only where the segmenter says a word ends,
 * never inside a figure or a glossary term, punctuation stripped.
 */
export type ReelLineOptions = {
  aimChars?: number;
  maxChars?: number;
  minChars?: number;
  /** Names and terms a break must never fall inside. */
  terms?: readonly string[];
  /** The least a line stays up; a shorter one is stretched into the gap after it. */
  minMs?: number;
  /** A pause this long inside a line is penalised; twice it, the line ends there. */
  pauseMs?: number;
};

export function toCaptionLines(
  transcript: Transcript,
  options: { maxChars?: number; maxMs?: number; pauseMs?: number; reel?: ReelLineOptions | true } = {},
): CaptionLine[] {
  const words = transcript.words.filter((w) => w.type === "word" && w.text.trim());
  if (!words.length) return [];

  const cjk = /[　-鿿豈-﫿]/.test(transcript.text);
  /*
   * How much fits on a line.
   *
   * The client's reading of the first cuts: *"each subtitle line is too
   * short"*. It was 18 Han characters whatever the frame, which is right for a
   * phone and wastes most of a 16:9 one. The caller passes the aspect's budget
   * -- about 16 for 9:16, about 24 for 16:9 -- and this is the fallback for
   * anything that does not.
   *
   * The reel breaker takes a Chinese transcript first (director v2). A Latin
   * transcript asked for reel lines gets this breaker at the reel's width,
   * about two and a half Latin characters per Han one; a word-boundary DP
   * for English is not something this studio's reels have needed yet.
   */
  const reel = options.reel === true ? {} : options.reel;
  if (reel && cjk) return reelLines(words, reel);
  const maxChars = options.maxChars ?? (reel ? Math.round((reel.maxChars ?? REEL_DEFAULTS.maxChars) * 2.5) : cjk ? 20 : 46);
  const maxMs = options.maxMs ?? 6000;
  const pauseMs = options.pauseMs ?? 700;
  /*
   * A full stop does not always end a caption.
   *
   * Breaking on every sentence mark turned two four-character sentences into
   * two four-character lines, which is the other half of "too short". A
   * sentence now only takes the line with it once the line is worth reading on
   * its own; otherwise the next one joins it, up to the same ceiling.
   */
  const minSentenceChars = Math.max(6, Math.round(maxChars * 0.55));
  /*
   * And a comma will do, once the line is nearly full.
   *
   * Counting to the ceiling and cutting there splits numbers and words down
   * the middle -- "160 hundred million US" / "dollars". A comma inside the
   * last fifth of the line is a better place to stop than the exact character
   * the count lands on, and Whisper now punctuates (see the initial_prompt in
   * /opt/whisper/transcribe.py), so there usually is one.
   */
  const softBreakChars = Math.round(maxChars * 0.8);

  const lines: {
    startMs: number;
    endMs: number;
    text: string;
    words: { start: number; end: number; text: string }[];
  }[] = [];
  let buffer: TranscriptWord[] = [];

  const flush = () => {
    if (!buffer.length) return;
    // CJK does not space its words; everything else does.
    const text = cjk ? buffer.map((w) => w.text).join("") : buffer.map((w) => w.text).join(" ");
    lines.push({
      startMs: Math.round(buffer[0].start * 1000),
      endMs: Math.round(buffer[buffer.length - 1].end * 1000),
      text: text.trim(),
      /*
       * The word timings, kept.
       *
       * They were measured, used to decide where the lines break, and then
       * thrown away — so the word-by-word caption preset had nothing to follow
       * and had to space words evenly, which drifts off the voice inside a
       * sentence. These are what make that preset honest.
       */
      words: buffer.map((w) => ({ start: w.start, end: w.end, text: w.text })),
    });
    buffer = [];
  };

  for (const [i, word] of words.entries()) {
    const previous = buffer[buffer.length - 1];
    const gapMs = previous ? (word.start - previous.end) * 1000 : 0;
    const speakerChanged = previous && word.speaker && previous.speaker && word.speaker !== previous.speaker;

    if (previous && (gapMs >= pauseMs || speakerChanged)) flush();

    buffer.push(word);

    const current = cjk ? buffer.map((w) => w.text).join("") : buffer.map((w) => w.text).join(" ");
    const lengthMs = (word.end - buffer[0].start) * 1000;
    const endsSentence = /[.!?。！？]$/.test(word.text);
    const endsClause = /[,、，;；:：]$/.test(word.text);

    if (
      current.length >= maxChars ||
      lengthMs >= maxMs ||
      (endsSentence && current.length >= minSentenceChars) ||
      (endsClause && current.length >= softBreakChars) ||
      i === words.length - 1
    ) {
      flush();
    }
  }

  flush();
  return lines.filter((l) => l.text && l.endMs > l.startMs);
}

/* ------------------------------------------------------------------ reel */

/**
 * Lines for a reel, by dynamic programming over the transcript's words.
 *
 * v1 counted to sixteen and cut, which put breaks inside 罕见联|手, 1.|51亿次
 * and 63.|5%. This breaker allows a break only at a position that is all of:
 * a boundary between two of whisper's words, a word boundary for
 * `Intl.Segmenter('zh')`, and outside every figure (digits with their
 * marks and units, Han numerals of two or more), every Latin token and
 * every glossary term. Among the allowed breaks it picks the set that
 * makes the best lines, judged by: distance from `aimChars` (squared),
 * a sentence or clause mark or a measured pause at the end (good), one
 * inside the line (bad), a particle at either edge (bad: 阿里相关的 |
 * 3500多个账号 reads wrong both ways), fewer than `minChars` (bad), and
 * less than `minMs` on screen (bad). A pause of twice `pauseMs` always
 * ends a line, and a break between two single-character segments costs
 * extra, because that is how ICU splits a word it does not know (账|号).
 *
 * The widths count a Han character as 1 and a Latin letter or digit as
 * 0.5, roughly what they take up in Noto Sans CJK at one size.
 */
const REEL_DEFAULTS = { aimChars: 8, maxChars: 12, minChars: 4, minMs: 500, pauseMs: 700 } as const;
/** The longest glossary term a line keeps whole; longer ones are quoted sentences, not names. */
const REEL_MAX_ATOMIC_TERM = 8;

const HAN_CHAR = /[㐀-䶿一-鿿豈-﫿]/; // zh-ok: a Unicode range, not a word
const R_DIGIT_RUN = /[0-9][0-9.,]*[0-9]|[0-9]/g;
/** Scale words a figure may run through (3500多, 1.51亿, 30万), then at most one measure or unit (个, 次, 条, 美金, %). */
const R_FIGURE_SCALE = "万亿千百十多余";
const R_FIGURE_UNIT = "个页次倍成条家年月日号天人元块%％";
const R_HAN_NUMERAL = /[零一二三四五六七八九十百千万亿几两]{2,}[多余]?/g;
const R_NUMBER_PREFIX = /[近约超共达仅逾]/;
const R_LATIN_RUN = /[A-Za-z][A-Za-z0-9'.-]*/g;
/** A line should not end on the word that opens the next clause (但, 被, 让, 那么…)… */
/** …nor on an adverb that modifies what comes next (不等于, 没能, 很难, 更高, 再也)… */
const WEAK_END = /(但是|那么|所以|因为|因此|然后|只是|就是|而且|[和与在是把被给让将对从到比而就也都又还才或及于向着过但却则不没很更最太再])$/;
/** …a particle at the end is milder (subtitles end on 的 all the time)… */
const PARTICLE_END = /[的了地得]$/;
/** …and it must not start with the particle that belongs to the previous word. */
const WEAK_START = /^[的了地得着过吗呢吧啊呀]/;
/**
 * Single characters that are words on their own. A single-character
 * segment that is not one of these is usually half of a word ICU did not
 * know (调|用量, 账|号), and a break beside it is suspect.
 */
const FUNCTION_CHARS = "的了着过是在和与及或也都就又还才不没要会能可把被让给到从向对比而但并且如因为所以于以之其这那此每各另某几多少有无很更最太再已经将去来说看做用叫";
/**
 * The subset of those that are grammar rather than words: particles,
 * copula, conjunctions, prepositions and demonstratives. A stray single
 * right after one of these and before a longer word (的|大|模型) opens that
 * word, so the boundary after it is inside a word.
 */
const STRUCTURAL_CHARS = "的了着过是在和与及或也都就又还才不没把被让给对而但并且于之其这那此每各另某吗呢吧啊呀";
const R_TRAILING_PUNCT = /^(.*?)([，。、！？；：,.!?;:…”」』）)》〉]+)$/;
const R_LEADING_PUNCT = /^[“「『（(《〈…]+/;

type ReelUnit = { text: string; start: number; end: number; punct: "" | "," | "."; spaceBefore: boolean };

/**
 * The transcript as units a line may be cut between: one per Han
 * character, one per run of Latin letters or digits.
 *
 * Not one per whisper word. Whisper groups characters as it likes
 * (你知道 · 吗 · 美 · 国 · 账号被), and a break that can only fall between
 * its groups misses the phrase boundary the segmenter finds inside one
 * (账号 | 被Anthropic指控). Each character takes its share of its word's
 * time, evenly; the segmenter's words are put back together afterwards
 * for the caption's own word list (`regroup`), which is what the
 * spoken-word highlight follows.
 *
 * Trailing punctuation is lifted off into a boundary strength (a full
 * stop outranks a comma), leading quotes are dropped, a decimal point is
 * kept ("1." + "51"), Latin fragments that abut in time are joined into
 * one token (An·th·rop·ic), and a space is remembered between two Latin
 * words a real gap separates.
 */
function reelUnitsOf(words: TranscriptWord[]): ReelUnit[] {
  const out: ReelUnit[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let text = w.text.trim();
    let punct: ReelUnit["punct"] = "";
    const nextText = words[i + 1]?.text.trim() ?? "";
    const m = R_TRAILING_PUNCT.exec(text);
    if (m) {
      const decimal = /[0-9]$/.test(m[1]) && /^[.,]$/.test(m[2]) && /^[0-9]/.test(nextText);
      if (!decimal) {
        text = m[1];
        punct = /[。！？.!?…]/.test(m[2]) ? "." : ",";
      }
    }
    text = text.replace(R_LEADING_PUNCT, "");
    if (!text) {
      const prev = out[out.length - 1];
      if (prev && punct) prev.punct = punct === "." || prev.punct === "." ? "." : ",";
      continue;
    }
    const cps = Array.from(text);
    const n = cps.length;
    const wordStart = w.start;
    const span = Math.max(0, w.end - w.start);
    let k = 0;
    while (k < n) {
      let j = k + 1;
      if (/[A-Za-z0-9]/.test(cps[k])) while (j < n && /[A-Za-z0-9'.%-]/.test(cps[j])) j++;
      const piece = cps.slice(k, j).join("");
      const start = wordStart + (span * k) / n;
      const end = wordStart + (span * j) / n;
      const prev = out[out.length - 1];
      const latin = Boolean(prev && /[A-Za-z]$/.test(prev.text) && /^[A-Za-z]/.test(piece));
      if (latin && prev.punct === "" && start - prev.end <= 0.04) {
        prev.text += piece;
        prev.end = Math.max(prev.end, end);
      } else {
        out.push({ text: piece, start, end, punct: "", spaceBefore: latin });
      }
      k = j;
    }
    /* The punctuation followed the word, so it follows the word's last piece. */
    out[out.length - 1].punct = punct;
  }
  return out;
}

/** UTF-16 offset → code point offset, for a string's regex matches. */
function cpIndex(text: string): number[] {
  const cps = Array.from(text);
  const map: number[] = [];
  for (let i = 0, u = 0; i < cps.length; i++) {
    map[u] = i;
    u += cps[i].length;
    map[u] = i + 1;
  }
  return map;
}

/**
 * Code point positions a break may never fall on: inside a figure, a Latin
 * token or a term. A term longer than `maxTermChars` (a quoted sentence
 * from the brief) is not kept whole: it could not fit a line anyway.
 */
function forbiddenBreaks(plain: string, terms: readonly string[], maxTermChars: number): Set<number> {
  const cps = Array.from(plain);
  const map = cpIndex(plain);
  const out = new Set<number>();
  const ban = (a: number, b: number) => {
    for (let p = a + 1; p < b; p++) out.add(p);
  };
  const figure = (aU: number, bU: number) => {
    let a = map[aU] ?? 0;
    let b = map[bU] ?? cps.length;
    /* Scale words, then one unit: 3500多个 stops before 账号, 几百条 before
       个人信息 (个 and 人 are units too, but a measure word ends a figure). */
    let n = 0;
    while (b < cps.length && n < 3 && R_FIGURE_SCALE.includes(cps[b])) {
      b++;
      n++;
    }
    if (b < cps.length && R_FIGURE_UNIT.includes(cps[b])) b++;
    else if (b + 1 < cps.length && cps[b] === "美" && "金元".includes(cps[b + 1])) b += 2;
    if (a > 0 && R_NUMBER_PREFIX.test(cps[a - 1])) a--;
    ban(a, b);
  };
  for (const m of plain.matchAll(R_DIGIT_RUN)) figure(m.index!, m.index! + m[0].length);
  for (const m of plain.matchAll(R_HAN_NUMERAL)) figure(m.index!, m.index! + m[0].length);
  for (const m of plain.matchAll(R_LATIN_RUN)) ban(map[m.index!], map[m.index! + m[0].length]);
  for (const raw of terms) {
    const t = Array.from(raw.trim().replace(/^《(.*)》$/, "$1"));
    if (t.length < 2 || t.length > maxTermChars) continue;
    for (let i = 0; i + t.length <= cps.length; i++) {
      let ok = true;
      for (let k = 0; k < t.length; k++) {
        if (cps[i + k] !== t[k]) {
          ok = false;
          break;
        }
      }
      if (ok) ban(i, i + t.length);
    }
  }
  return out;
}

/**
 * Where `Intl.Segmenter` ends a word, as code point positions in the
 * unspaced text, and which of those sit between two single-character Han
 * segments (a word ICU did not know, split into its characters).
 */
function segmentBoundaries(units: ReelUnit[], forbidden: ReadonlySet<number>): { bounds: Set<number>; weak: Map<number, number> } {
  const bounds = new Set<number>();
  /** Boundary → penalty, per the attachment rules below (16 = certainly inside a word, 14 = probably, 3–8 = a little suspect). */
  const weak = new Map<number, number>();
  let spaced = "";
  for (const u of units) spaced += (u.spaceBefore ? " " : "") + u.text;
  if (typeof Intl === "undefined" || typeof (Intl as { Segmenter?: unknown }).Segmenter !== "function") {
    /* No segmenter on this runtime: every unit boundary is a boundary. The
       figure and term guards still hold. */
    let acc = 0;
    bounds.add(0);
    for (const u of units) {
      acc += Array.from(u.text).length;
      bounds.add(acc);
    }
    return { bounds, weak };
  }
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const cps = Array.from(spaced);
  /* Position in the unspaced text for each code point index of the spaced one. */
  const plainPos: number[] = [];
  let p = 0;
  for (const ch of cps) {
    plainPos.push(p);
    if (ch !== " ") p++;
  }
  plainPos.push(p);
  const map = cpIndex(spaced);
  type Seg = { a: number; b: number; single: boolean };
  const segs: Seg[] = [];
  for (const s of seg.segment(spaced)) {
    const a = map[s.index] ?? 0;
    const b = a + Array.from(s.segment).length;
    if (s.segment === " ") continue;
    segs.push({ a, b, single: b - a === 1 && HAN_CHAR.test(s.segment) });
  }
  bounds.add(0);
  /*
   * A single Han character that is not a word on its own is half of a word
   * ICU did not know (账|号, 调|用量), and it belongs to one of its
   * neighbours; which one is not knowable here, so a boundary on either
   * side of it is a little suspect, and one between two such singles is
   * more so. Neither outranks a clause opener left at a line's end.
   *
   * Two shapes are knowable, and the first lab run showed both split
   * across lines (第三轮公开声 | 讨了他, 学习头部的大 | 模型): a stray
   * single before a verb glued to its aspect particle (声|讨了, 藏|着) is
   * that verb's first character, and a stray single right after a grammar
   * character and before a longer word (的|大|模型, 就|防|不住) opens that
   * word. Both get the penalty of a break between two singles. Anything
   * broader than this (treating every single-character verb as half a
   * word) was tried and scattered penalties over the whole transcript,
   * pushing the lines off the clause boundaries the rest of the cost
   * function finds.
   */
  const stray = (s: Seg | undefined) => Boolean(s && s.single && !FUNCTION_CHARS.includes(cps[s.a]));
  const structural = (s: Seg | undefined) => Boolean(s && s.single && STRUCTURAL_CHARS.includes(cps[s.a]));
  /** A two-character segment that is a verb with its aspect particle (讨了, 藏着, 做过). */
  const glue = (s: Seg | undefined) => Boolean(s && s.b - s.a === 2 && HAN_CHAR.test(cps[s.a]) && !FUNCTION_CHARS.includes(cps[s.a]) && "了着过".includes(cps[s.a + 1]));
  const adjacent = (x: Seg | undefined, y: Seg | undefined) => Boolean(x && y && plainPos[x.b] === plainPos[y.a]);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    bounds.add(plainPos[s.a]);
    bounds.add(plainPos[s.b]);
    const n = segs[i + 1];
    if (!adjacent(s, n)) continue;
    const at = plainPos[s.b];
    if (forbidden.has(at)) continue;
    const p = segs[i - 1];
    if (s.single && n!.single) weak.set(at, stray(s) || stray(n) ? 16 : 8);
    else if (stray(s) && (glue(n) || (adjacent(p, s) && structural(p)))) weak.set(at, 16);
    else if (stray(s) || stray(n)) weak.set(at, 5);
  }
  return { bounds, weak };
}

function unitWidth(u: ReelUnit): number {
  let w = 0;
  for (const ch of Array.from(u.text)) w += HAN_CHAR.test(ch) ? 1 : ch === " " ? 0 : 0.5;
  return w;
}

function reelLines(words: TranscriptWord[], o: ReelLineOptions): CaptionLine[] {
  const aim = o.aimChars ?? REEL_DEFAULTS.aimChars;
  const max = o.maxChars ?? REEL_DEFAULTS.maxChars;
  const min = o.minChars ?? REEL_DEFAULTS.minChars;
  const minMs = o.minMs ?? REEL_DEFAULTS.minMs;
  const pauseMs = o.pauseMs ?? REEL_DEFAULTS.pauseMs;

  const units = reelUnitsOf(words);
  const n = units.length;
  if (!n) return [];

  const plain = units.map((u) => u.text).join("");
  const offsets: number[] = [0];
  for (const u of units) offsets.push(offsets[offsets.length - 1] + Array.from(u.text).length);
  /* A name is kept whole; a quoted sentence from the brief (十二字的金句) is
     not a name, and forcing it onto one line left the word before it as a
     one-character caption. Eight characters covers every name and term. */
  const forbidden = forbiddenBreaks(plain, o.terms ?? [], Math.min(max, REEL_MAX_ATOMIC_TERM));
  /* What the highlight lights as one word: figures, Latin tokens and names
     of up to five characters (美国参议院); a longer quoted phrase is kept on
     one line but still lit word by word. */
  const oneWord = forbiddenBreaks(plain, o.terms ?? [], 5);
  const { bounds, weak } = segmentBoundaries(units, forbidden);
  const widths = units.map(unitWidth);

  /*
   * Which unit boundaries may end a line: a segmenter boundary outside
   * every figure, Latin token and term. Then, wherever those leave more
   * than a line's width with no way to break (a name whisper split around
   * a pause, a figure glued to a term), the least bad boundary inside that
   * stretch is allowed as well — the last one outside the figures and
   * terms, or failing that the one at the end of the stretch. Relaxed
   * *there*, never globally: the first version fell back to "any boundary"
   * for the whole transcript when one spot was unreachable, and every
   * other line paid for it (一|份, 核|心).
   */
  const allowed = new Array<boolean>(n + 1).fill(false);
  allowed[0] = true;
  allowed[n] = true;
  for (let i = 1; i < n; i++) allowed[i] = !forbidden.has(offsets[i]) && bounds.has(offsets[i]);
  {
    let last = 0;
    let width = 0;
    let lastFree = -1;
    for (let i = 1; i <= n; i++) {
      width += widths[i - 1];
      if (allowed[i]) {
        last = i;
        width = 0;
        lastFree = -1;
        continue;
      }
      if (!forbidden.has(offsets[i])) lastFree = i;
      if (width > max) {
        const k = lastFree > last ? lastFree : i;
        allowed[k] = true;
        last = k;
        lastFree = -1;
        width = 0;
        for (let m = k; m < i; m++) width += widths[m];
      }
    }
  }

  const lineCost = (j: number, i: number, lineW: number): number => {
    let cost = (lineW - aim) ** 2;
    if (lineW < min) cost += 30;
    if (lineW > max) cost += (lineW - max) * 20;
    const first = units[j];
    const last = units[i - 1];
    const text = units.slice(j, i).map((u) => u.text).join("");
    const durMs = (last.end - first.start) * 1000;
    if (durMs < minMs) cost += 40;
    /* A line up for more than 3.5 s is a line the viewer has read twice. */
    if (durMs > 3500) cost += 20;
    if (i < n && WEAK_END.test(text)) cost += 12;
    else if (i < n && PARTICLE_END.test(text)) cost += 6;
    if (WEAK_START.test(text)) cost += 16;
    /* A break inside a word ICU did not know (口|子) is the worst of these. */
    if (i < n && last.punct === "") cost += weak.get(offsets[i]) ?? 0;
    if (last.punct === ".") cost -= 4;
    else if (last.punct === ",") cost -= 2;
    if (i < n) {
      const gap = (units[i].start - last.end) * 1000;
      if (gap >= 600) cost -= 6;
      else if (gap >= 300) cost -= 3;
    }
    for (let k = j; k < i - 1; k++) {
      /* Reading across a sentence end joins two thoughts on one line (「还是过于理想主义呢欢迎」): worse than a short line. */
      if (units[k].punct === ".") cost += 40;
      else if (units[k].punct === ",") cost += 2;
      const gap = (units[k + 1].start - units[k].end) * 1000;
      /* A pause inside a line leaves the first words frozen while she
         breathes; twice `pauseMs` is a pause nobody should read across. */
      if (gap >= pauseMs) cost += gap >= pauseMs * 2 ? 60 : 25;
    }
    return cost;
  };

  const dp = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    if (!allowed[i]) continue;
    let lineW = 0;
    for (let j = i - 1; j >= 0; j--) {
      lineW += widths[j];
      if (lineW > max && i - j > 1) break;
      if (!allowed[j] || dp[j] === Infinity) continue;
      const cost = dp[j] + lineCost(j, i, lineW);
      if (cost < dp[i]) {
        dp[i] = cost;
        prev[i] = j;
      }
    }
  }
  const cuts: number[] = [];
  for (let i = n; i > 0; i = prev[i]) cuts.push(i);
  cuts.reverse();
  if (!cuts.length || cuts[cuts.length - 1] !== n) cuts.push(n);

  /*
   * The caption's own words: the segmenter's words, put back together
   * from the character units, each spanning its characters' time. A Latin
   * token is a word of its own; a name, a figure or a run of digits whisper
   * split (3|500, 63.|5%) is one word, however the segmenter cut it, so the
   * spoken-word highlight lights 谢亚芳 and 3500多个 whole rather than a
   * character at a time. This is what the reel renderer lights up word by
   * word.
   */
  const regroup = (from: number, to: number): CaptionLine["words"] => {
    const words: CaptionLine["words"] = [];
    for (let k = from; k < to; k++) {
      const u = units[k];
      const prev = words[words.length - 1];
      const latin = /^[A-Za-z0-9]/.test(u.text);
      const prevLatin = Boolean(prev && /[A-Za-z0-9]$/.test(prev.text));
      const digitRun = Boolean(prev && /[0-9.]$/.test(prev.text) && /^[0-9%]/.test(u.text));
      const inside = oneWord.has(offsets[k]) || digitRun;
      const startsWord = k === from || (!inside && (bounds.has(offsets[k]) || latin || prevLatin || u.spaceBefore));
      if (startsWord || !prev) words.push({ start: u.start, end: u.end, text: (u.spaceBefore && prev ? " " : "") + u.text });
      else {
        prev.text += u.text;
        prev.end = Math.max(prev.end, u.end);
      }
    }
    return words.map((w) => ({ ...w, text: w.text.trimStart() }));
  };

  const lines: CaptionLine[] = [];
  let from = 0;
  for (const to of cuts) {
    if (to <= from) continue;
    const us = units.slice(from, to);
    const text = us.map((u, k) => (k > 0 && u.spaceBefore ? " " : "") + u.text).join("");
    lines.push({
      startMs: Math.round(us[0].start * 1000),
      endMs: Math.round(us[us.length - 1].end * 1000),
      text,
      words: regroup(from, to),
    });
    from = to;
  }

  /* Half a second on screen at least, stretched into the gap after the line
     and never over the next one. */
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    if (l.endMs - l.startMs < minMs) l.endMs = Math.max(l.endMs, Math.min(l.startMs + minMs, next ? next.startMs : l.startMs + minMs));
  }
  return lines.filter((l) => l.text && l.endMs > l.startMs);
}
