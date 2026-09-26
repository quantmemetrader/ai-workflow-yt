import { toCaptionLines, type Transcript } from "@/lib/video/elevenlabs";
import type { TimedSentence } from "./types";

/**
 * Caption lines from a narration's own timings.
 *
 * The same line breaker the transcriber's captions go through
 * (`toCaptionLines`: a real pause, end punctuation, or the frame's width,
 * whichever comes first), fed with the timings the speech engine measured
 * while it spoke, so a narrated video's captions are cut exactly the way a
 * filmed one's are and land on the voice to the character.
 *
 * A provider that gives no timing inside a sentence (ElevenLabs, here) still
 * gets sensible line breaks: its characters are spread across the sentence
 * for the breaker's sake only, and the lines are written *without* word
 * timings, so the word-by-word preset shows them whole rather than pretend
 * to a sync nobody measured.
 */
export function narrationCaptionLines(
  sentences: TimedSentence[],
  opts: { offsetMs?: number; maxChars: number },
): { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[] | null }[] {
  const offset = (opts.offsetMs ?? 0) / 1000;
  const measured = sentences.every((s) => s.words.length > 0);
  const words = sentences.flatMap((s) => (s.words.length ? s.words : spread(s))).map((w) => ({
    text: w.text,
    start: w.start + offset,
    end: w.end + offset,
    type: "word",
  }));
  const transcript: Transcript = {
    text: sentences.map((s) => s.text).join(""),
    languageCode: "",
    languageProbability: 1,
    durationSecs: 0,
    words,
  };
  const cjk = /[　-鿿豈-﫿]/.test(transcript.text);
  return toCaptionLines(transcript, { maxChars: cjk ? opts.maxChars : Math.round(opts.maxChars * 2.5) }).map((l) => ({
    ...l,
    words: measured ? l.words : null,
  }));
}

/** A sentence's characters (CJK) or words (the rest) shared out across its time. */
function spread(s: TimedSentence): { text: string; start: number; end: number }[] {
  const cjk = /[　-鿿豈-﫿]/.test(s.text);
  const units = cjk ? (s.text.match(/[　-鿿豈-﫿][^　-鿿豈-﫿A-Za-z0-9]*|[A-Za-z0-9][^\s　-鿿]*\s*/g) ?? [s.text]) : s.text.split(/(?<=\s)/);
  const start = s.startMs / 1000;
  const span = Math.max(0.2, (s.endMs - s.startMs) / 1000);
  const total = units.reduce((n, u) => n + Math.max(1, u.trim().length), 0) || 1;
  let t = start;
  return units
    .map((u) => {
      const d = (span * Math.max(1, u.trim().length)) / total;
      const w = { text: u.trim(), start: t, end: t + d };
      t += d;
      return w;
    })
    .filter((w) => w.text);
}

/** How many Han characters a caption line holds at an aspect (lib/video/transcribe.ts uses the same). */
export function hanPerLine(aspect: string | null | undefined): number {
  return aspect === "9:16" ? 16 : aspect === "1:1" ? 20 : 24;
}
