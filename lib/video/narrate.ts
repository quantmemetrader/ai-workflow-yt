import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, captions, files, timelineItems, videoClips } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { newId } from "@/lib/ids";
import { presignDownload } from "@/lib/storage/r2";
import { speakTrack } from "@/lib/video/voiceover";
import { hasUsableAudio } from "@/lib/video/tts/audio";
import { hanPerLine, narrationCaptionLines } from "@/lib/video/tts/captions";
import { narrationFromBeats } from "@/lib/video/tts/split";
import type { TimedSentence } from "@/lib/video/tts/types";
import { DEFAULT_VOICE_EN, DEFAULT_VOICE_ZH, parseVoiceId, voiceCanRead, voiceLabel, voiceLanguage } from "@/lib/video/tts/voices";

/**
 * A video whose words are a generated narration, not what was filmed.
 *
 * "If there is no audio in the video and we just have the script, you make
 * the audio too." Stock footage is silent, and so is a phone's b-roll; the
 * director cuts on what is *said*, and with nothing said it used to stop at
 * "no speech to transcribe". Now the script's 旁白 lines are the words:
 *
 *   1. **Voice.** Every beat's voiceover, one paragraph per beat, spoken by
 *      the studio's own speech engine (`lib/video/tts`) into a voice-over
 *      track, with the time of every sentence and character measured as it
 *      is spoken.
 *   2. **Cut to it.** The footage is laid under the narration: each beat
 *      starts a new shot, cuts land in the pauses between sentences, no shot
 *      outlasts the pace, and the clips' own sound is muted so nothing talks
 *      over the voice.
 *   3. **Captions from it.** The measured timings, broken into lines the way
 *      every caption here is — no transcription of our own audio needed.
 *
 * Then the director carries on exactly as it does for filmed speech: design,
 * pictures, render. Run inside the director's job (`lib/video/director.ts`).
 */

export type NarratedCut = {
  trackId: string;
  voiceId: string;
  durationMs: number;
  sentences: number;
  cuts: number;
  captions: number;
  language: string;
};

type Say = (step: "footage" | "voice" | "cut" | "captions", text: string) => Promise<void>;

/** The narration a script's beats add up to, or null when there is none. */
export function narrationOf(beats: { ord: number; voiceover: string; naturalSound?: boolean | null }[]) {
  const n = narrationFromBeats(beats);
  return n.text.trim() ? n : null;
}

/**
 * Whether any of the footage has sound to cut on.
 *
 * A clip whose waveform job already found no audio stream is not asked again;
 * the rest are measured over a signed URL (audio only, the first ninety
 * seconds), at most four of them, because one talking clip is enough to say
 * yes and the question is being asked while somebody waits.
 */
export async function footageHasSound(
  clips: { id: string; fileId: string; peaksError: string | null }[],
): Promise<{ any: boolean; notes: string[] }> {
  const notes: string[] = [];
  for (const c of clips.slice(0, 4)) {
    if (c.peaksError === "this clip has no audio") {
      notes.push(`${c.id}: no audio stream`);
      continue;
    }
    const [f] = await db.select({ key: files.storageKey }).from(files).where(eq(files.id, c.fileId)).limit(1);
    if (!f?.key) continue;
    const url = await presignDownload(f.key, { expiresIn: 1800 });
    const r = await hasUsableAudio(url);
    notes.push(`${c.id}: ${r.why}`);
    if (r.usable) return { any: true, notes };
  }
  return { any: false, notes };
}

/** How long one shot may hold under a narration, by the director's pace. */
const SHOT_MS = { calm: 7000, channel: 5000, hype: 3000 } as const;
/** Air after the last word, so the render does not end on its final syllable. */
const TAIL_MS = 700;
const MIN_SHOT_MS = 1200;

export async function narratedCut(
  viewer: Viewer,
  projectId: string,
  input: {
    beats: { ord: number; voiceover: string; naturalSound?: boolean | null }[];
    voiceId?: string | null;
    aspect: string;
    pace: "calm" | "channel" | "hype";
    previousTrackId?: string | null;
    footage: { id: string; durationMs: number | null; label: string }[];
    say: Say;
  },
): Promise<NarratedCut> {
  const narration = narrationOf(input.beats);
  if (!narration) {
    throw new Error("The script has no narration (旁白) to voice yet. Write the beats' voiceover first, or upload footage with speech.");
  }
  if (!input.footage.length) throw new Error("There is no footage in the bin to lay under the narration.");

  const han = /[一-鿿]/.test(narration.text);
  let voiceId = input.voiceId && parseVoiceId(input.voiceId) ? input.voiceId : han ? DEFAULT_VOICE_ZH : DEFAULT_VOICE_EN;
  /* An English voice picked for a Chinese script would say "Chinese letter"
     for every character (`voiceCanRead`). The director is not stopped for
     that: it reads the script in the Mandarin default and says so. */
  if (!voiceCanRead(voiceId, narration.text)) {
    await input.say("voice", `${voiceLabel(voiceId, false)} cannot read Chinese, so the narration is read by ${voiceLabel(DEFAULT_VOICE_ZH, false)}`);
    voiceId = DEFAULT_VOICE_ZH;
  }
  const name = voiceLabel(voiceId, true);

  /* ---- 1. voice --------------------------------------------------- */
  // A narration made by an earlier run is replaced, not stacked under the new one.
  if (input.previousTrackId) await dropNarration(viewer, projectId, input.previousTrackId);
  const trackId = newId("rnd");
  await db.insert(audioTracks).values({
    id: trackId,
    tenantId: viewer.tenantId,
    projectId,
    kind: "voiceover",
    label: `AI 配音 · ${name}`,
    text: narration.text,
    voiceId,
    startMs: 0,
    gain: 1,
    duckUnderSpeech: false,
    state: "pending",
    createdBy: viewer.id,
  });
  await input.say("voice", `Voicing the script's narration in ${name}: ${narration.text.replace(/\s+/g, "").length} characters, ${narration.beatOrds.length} beats`);
  const spoken = await speakTrack(trackId);
  await input.say("voice", `Voiced: ${(spoken.durationMs / 1000).toFixed(1)}s in ${spoken.sentences.length} sentences (${spoken.engine})`);

  /* ---- 2. cut to it ----------------------------------------------- */
  await input.say("cut", "Timing the footage to the narration");
  const totalMs = spoken.durationMs + TAIL_MS;
  const segments = shotsFor(spoken.sentences, totalMs, SHOT_MS[input.pace] ?? SHOT_MS.channel);
  const items = layFootage(segments, input.footage);

  await db.delete(timelineItems).where(eq(timelineItems.projectId, projectId));
  await db.insert(timelineItems).values(
    items.map((it, i) => ({
      id: newId("beat"),
      projectId,
      kind: "clip",
      clipId: it.clipId,
      ord: i * 10,
      inMs: it.inMs,
      outMs: it.outMs,
      /* Muted: under a narration the clip's own sound is room tone at best
         and a second voice at worst. `narration` marks whose cut this is. */
      options: { mute: true, narration: trackId, paragraph: it.paragraph },
    })),
  );
  await input.say("cut", `Laid ${items.length} shots under ${(totalMs / 1000).toFixed(1)}s of narration`);

  /* ---- 3. captions from it ---------------------------------------- */
  await input.say("captions", "Writing the captions from the narration's own timings");
  const language = voiceLanguage(voiceId) === "zh" ? "zh-CN" : "en";
  const lines = narrationCaptionLines(spoken.sentences, { offsetMs: 0, maxChars: hanPerLine(input.aspect) });
  // The narration is now what is said, so every caption track made from
  // anything else (an earlier transcript, a translation) goes with it.
  await db.delete(captions).where(eq(captions.projectId, projectId));
  if (lines.length) {
    await db.insert(captions).values(
      lines.map((l, i) => ({
        id: newId("beat"),
        projectId,
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        words: l.words,
        language,
        ord: i,
      })),
    );
  }
  await input.say("captions", `${lines.length} caption lines, timed to the voice`);

  return { trackId, voiceId, durationMs: spoken.durationMs, sentences: spoken.sentences.length, cuts: items.length, captions: lines.length, language };
}

/**
 * Take a narration the director made off the cut: its track, the muted shots
 * laid under it, and its file into the bin (the way a replaced render's goes:
 * out of the way, recoverable for the thirty days before the sweep).
 *
 * Called before a new narration, and when a project that was narrated is
 * made again from footage that speaks — otherwise the old voice would be
 * mixed over the new speech and the footage would stay muted.
 */
export async function dropNarration(viewer: Viewer, projectId: string, trackId: string): Promise<boolean> {
  const gone = await db
    .delete(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.projectId, projectId), eq(audioTracks.kind, "voiceover")))
    .returning({ fileId: audioTracks.fileId });
  await db.delete(timelineItems).where(and(eq(timelineItems.projectId, projectId), sql`${timelineItems.options}->>'narration' = ${trackId}`));
  const oldFile = gone[0]?.fileId;
  if (oldFile) {
    await db.update(files).set({ deletedAt: new Date(), deletedBy: viewer.id }).where(and(eq(files.id, oldFile), isNull(files.deletedAt)));
  }
  return gone.length > 0;
}

/**
 * Where the shots change: at every paragraph (beat), and inside a long one at
 * the sentence gap that keeps each shot under `maxShot`. A cut in the pause
 * between two sentences is invisible; a cut mid-word is not, so that only
 * happens when a single sentence outlasts a shot.
 */
export function shotsFor(sentences: TimedSentence[], totalMs: number, maxShot: number): { startMs: number; endMs: number; paragraph: number }[] {
  if (!sentences.length) return [{ startMs: 0, endMs: totalMs, paragraph: 0 }];
  // The midpoints of the pauses: every place a cut could go.
  const gaps: { at: number; paragraphBreak: boolean }[] = [];
  for (let i = 1; i < sentences.length; i++) {
    const a = sentences[i - 1];
    const b = sentences[i];
    gaps.push({ at: Math.round((a.endMs + b.startMs) / 2), paragraphBreak: a.paragraph !== b.paragraph });
  }
  // Paragraph spans, contiguous from 0 to the end.
  const spans: { startMs: number; endMs: number; paragraph: number; inner: number[] }[] = [];
  let start = 0;
  let paragraph = sentences[0].paragraph;
  let inner: number[] = [];
  for (const g of gaps) {
    if (g.paragraphBreak) {
      spans.push({ startMs: start, endMs: g.at, paragraph, inner });
      start = g.at;
      paragraph = sentences.find((s) => s.startMs >= g.at)?.paragraph ?? paragraph + 1;
      inner = [];
    } else {
      inner.push(g.at);
    }
  }
  spans.push({ startMs: start, endMs: totalMs, paragraph, inner });

  const out: { startMs: number; endMs: number; paragraph: number }[] = [];
  for (const span of spans) {
    let at = span.startMs;
    while (span.endMs - at > maxShot * 1.3) {
      const fits = span.inner.filter((c) => c > at + MIN_SHOT_MS && c - at <= maxShot && span.endMs - c >= MIN_SHOT_MS);
      const next = fits.length ? fits[fits.length - 1] : at + maxShot;
      out.push({ startMs: at, endMs: next, paragraph: span.paragraph });
      at = next;
    }
    out.push({ startMs: at, endMs: span.endMs, paragraph: span.paragraph });
  }
  return out.filter((s) => s.endMs - s.startMs >= 1);
}

/**
 * Footage onto the shots. A beat starts on "its" clip when there is one per
 * beat (a stock search per beat brings them in that order); otherwise the
 * clips take turns. A clip used twice carries on from where it stopped rather
 * than repeating its opening, and one too short for its shot hands the rest
 * of the shot to the next clip.
 */
export function layFootage(
  shots: { startMs: number; endMs: number; paragraph: number }[],
  footage: { id: string; durationMs: number | null }[],
): { clipId: string; inMs: number; outMs: number; paragraph: number }[] {
  const used = new Map<string, number>();
  const paragraphs = [...new Set(shots.map((s) => s.paragraph))];
  const perBeat = footage.length >= paragraphs.length;
  let turn = 0;
  let lastParagraph = -1;
  let lastClip = "";
  const out: { clipId: string; inMs: number; outMs: number; paragraph: number }[] = [];
  for (const shot of shots) {
    let remaining = shot.endMs - shot.startMs;
    let pick = perBeat && shot.paragraph !== lastParagraph ? paragraphs.indexOf(shot.paragraph) % footage.length : turn % footage.length;
    // Never the same clip twice in a row when there is another to cut to.
    if (footage.length > 1 && footage[pick].id === lastClip) pick = (pick + 1) % footage.length;
    turn = pick + 1;
    lastParagraph = shot.paragraph;
    while (remaining > 0) {
      const clip = footage[pick % footage.length];
      const length = clip.durationMs && clip.durationMs > 0 ? clip.durationMs : 10_000;
      let inMs = used.get(clip.id) ?? 0;
      if (length - inMs < Math.min(remaining, MIN_SHOT_MS)) inMs = 0;
      const take = Math.min(remaining, length - inMs);
      out.push({ clipId: clip.id, inMs, outMs: inMs + take, paragraph: shot.paragraph });
      used.set(clip.id, inMs + take >= length - 200 ? 0 : inMs + take);
      remaining -= take;
      lastClip = clip.id;
      if (remaining > 0) {
        pick = (pick + 1) % footage.length;
        turn = pick + 1;
      }
    }
  }
  return out;
}

/** The clips a narrated cut is laid from: the bin's video, in the order it arrived. */
export async function narrationFootage(projectId: string) {
  return db
    .select({ id: videoClips.id, fileId: videoClips.fileId, durationMs: videoClips.durationMs, label: videoClips.label, peaksError: videoClips.peaksError, kind: files.kind })
    .from(videoClips)
    .leftJoin(files, eq(files.id, videoClips.fileId))
    .where(eq(videoClips.projectId, projectId))
    .orderBy(videoClips.addedAt);
}
