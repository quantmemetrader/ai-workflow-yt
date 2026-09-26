/**
 * The shapes every speech provider speaks in.
 *
 * Pure types, no imports: the worker, the page that lists voices and the
 * route that plays a sample all read them, and none of them should pull a
 * vendor client in to do so.
 */

/** One sentence to say, and the silence after it. */
export type SpeakSentence = {
  text: string;
  /** Silence after this sentence, in ms. Longer at the end of a paragraph (a
   * script beat) than inside one, which is most of what makes a read sound
   * like a person reading rather than a list being recited. */
  pauseMs: number;
  /** Which paragraph (script beat) it came from, 0-based. */
  paragraph: number;
};

/**
 * One word (or one Han character) and when it is said, in **seconds** from
 * the start of the finished file — the same unit `TranscriptWord` uses, so
 * `toCaptionLines` can cut captions from a narration exactly as it does from
 * a transcript.
 */
export type TimedWord = { text: string; start: number; end: number };

/** Where one sentence sits in the finished file. */
export type TimedSentence = {
  i: number;
  paragraph: number;
  text: string;
  /** Where the voice starts and stops, in ms (not the slot with its pause). */
  startMs: number;
  endMs: number;
  /** Per character (Mandarin) or per word (English). Empty when the provider
   * gives no timing inside a sentence; captions then show the line whole. */
  words: TimedWord[];
};

/** What a provider hands back: one WAV on disk with the pauses already in. */
export type Synthesis = {
  wavPath: string;
  durationMs: number;
  sentences: TimedSentence[];
  /** "kokoro v1.1-zh", "elevenlabs eleven_multilingual_v2": for the log. */
  engine: string;
};

export type ProviderId = "local" | "elevenlabs";

export interface TtsProvider {
  id: ProviderId;
  /** Whether this provider can speak right now, and if not, why — in words a
   * person can act on. Cheap and cached; called before a job is queued. */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  synthesize(input: { sentences: SpeakSentence[]; voice: string; speed: number; dir: string }): Promise<Synthesis>;
}

/** The timings file written beside a voice-over in storage. */
export type NarrationTimings = {
  version: 1;
  voiceId: string;
  engine: string;
  durationMs: number;
  sentences: TimedSentence[];
};

/** A voice as the pickers draw it (the editor's audio tab, the project page). */
export type UiVoice = {
  id: string;
  provider: ProviderId;
  lang: "zh" | "en" | null;
  gender: "female" | "male" | null;
  style: string | null;
  name: { zh: string; en: string };
  blurb: { zh: string; en: string } | null;
  /** Whether /api/tts/sample can play a sample of it. */
  sample: boolean;
};
