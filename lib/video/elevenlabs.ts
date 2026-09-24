import "server-only";
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
export function toCaptionLines(
  transcript: Transcript,
  options: { maxChars?: number; maxMs?: number; pauseMs?: number } = {},
): { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[] }[] {
  const words = transcript.words.filter((w) => w.type === "word" && w.text.trim());
  if (!words.length) return [];

  const cjk = /[　-鿿豈-﫿]/.test(transcript.text);
  const maxChars = options.maxChars ?? (cjk ? 18 : 42);
  const maxMs = options.maxMs ?? 6000;
  const pauseMs = options.pauseMs ?? 700;

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

    if (current.length >= maxChars || lengthMs >= maxMs || endsSentence || i === words.length - 1) {
      flush();
    }
  }

  flush();
  return lines.filter((l) => l.text && l.endMs > l.startMs);
}
