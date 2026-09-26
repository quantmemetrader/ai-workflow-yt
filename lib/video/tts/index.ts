import "server-only";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { voices as elevenLabsVoices } from "@/lib/video/elevenlabs";
import { levelToMp3, probeDurationMs } from "./audio";
import { elevenLabsProvider } from "./elevenlabs";
import { localProvider } from "./local";
import { splitNarration } from "./split";
import type { SpeakSentence, TimedSentence, TtsProvider, UiVoice } from "./types";

export type { UiVoice } from "./types";
import { CANNOT_READ_CHINESE, LOCAL_VOICES, SAMPLE_LINE, baseVoiceId, parseVoiceId, voiceCanRead, type CatalogVoice } from "./voices";

/**
 * Text to speech for the studio: one entry point, whichever engine speaks.
 *
 *   narrate()  text + a voice id -> a levelled MP3 and when every sentence
 *              (and every character, where the engine knows) is said.
 *
 * The provider is named by the voice id (`kokoro:` is the local engine,
 * `elevenlabs:` the vendor), so a track re-spoken next year is spoken by the
 * engine that made it. The local engine is the default for everything new:
 * ElevenLabs refuses this server's IP and its key is a free tier. A third
 * provider (a paid API, say) is one more `TtsProvider` and one more prefix.
 */

const PROVIDERS: Record<"local" | "elevenlabs", TtsProvider> = {
  local: localProvider,
  elevenlabs: elevenLabsProvider,
};

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsError";
  }
}

/** The provider a voice id belongs to, and whether it can speak right now. */
export async function providerFor(voiceId: string): Promise<{ provider: TtsProvider; ok: true } | { ok: false; reason: string }> {
  const parsed = parseVoiceId(voiceId);
  if (!parsed) return { ok: false, reason: `Not a voice this studio knows: ${voiceId}` };
  const provider = PROVIDERS[parsed.provider];
  const state = await provider.available();
  return state.ok ? { provider, ok: true } : { ok: false, reason: state.reason };
}

export type Narration = {
  mp3: Buffer;
  durationMs: number;
  sentences: TimedSentence[];
  engine: string;
  /** The loudness the engine produced before levelling, for the log. */
  inputLufs: number | null;
  /** Wall clock of the synthesis alone, for the log. */
  tookMs: number;
};

/**
 * Speak a narration.
 *
 * Split into sentences (`splitNarration`: a blank line is a paragraph, which
 * is how a script's beats arrive), spoken by the voice's engine, joined with
 * our own pauses, levelled to -16 LUFS and encoded as MP3. The timings are in
 * the finished file's clock: levelling is one gain change, so it moves nothing.
 */
export async function narrate(input: { text?: string; sentences?: SpeakSentence[]; voiceId: string }): Promise<Narration> {
  const parsed = parseVoiceId(input.voiceId);
  if (!parsed) throw new TtsError(`Not a voice this studio knows: ${input.voiceId}`);
  const sentences = input.sentences ?? splitNarration(input.text ?? "");
  if (!sentences.length) throw new TtsError("There is nothing to say");
  if (!voiceCanRead(input.voiceId, sentences.map((s) => s.text).join(""))) throw new TtsError(CANNOT_READ_CHINESE);

  const found = await providerFor(input.voiceId);
  if (!found.ok) throw new TtsError(found.reason);

  const speed = (parsed.voice?.speed ?? 1) * parsed.pace;
  const dir = await mkdtemp(path.join(tmpdir(), "aura-tts-"));
  try {
    const started = Date.now();
    const spoken = await found.provider.synthesize({ sentences, voice: parsed.engineVoice, speed, dir });
    const tookMs = Date.now() - started;
    const mp3Path = path.join(dir, "narration.mp3");
    const { inputLufs } = await levelToMp3(spoken.wavPath, mp3Path);
    const mp3 = await readFile(mp3Path);
    // The container's length, not the engine's arithmetic: it is what the
    // render and the player will believe.
    const durationMs = await probeDurationMs(mp3Path).catch(() => spoken.durationMs);
    return { mp3, durationMs, sentences: spoken.sentences, engine: spoken.engine, inputLufs, tookMs };
  } finally {
    // This box is also the web server: temp audio does not get to accumulate.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

let elCache: { at: number; rows: UiVoice[] } | null = null;

/**
 * The voices a person can pick, for the editor and the project page.
 *
 * The local catalogue whenever the engine is installed; ElevenLabs' library
 * only when it actually answers (cached for an hour — it changes when somebody
 * adds a voice, which is never). Local first: it is the one that works.
 */
export async function voicesForUi(): Promise<UiVoice[]> {
  const out: UiVoice[] = [];
  if ((await localProvider.available()).ok) out.push(...LOCAL_VOICES.map(toUi));
  if ((await elevenLabsProvider.available()).ok) {
    if (!elCache || Date.now() - elCache.at > 3_600_000) {
      const rows = await elevenLabsVoices().catch(() => []);
      elCache = {
        at: Date.now(),
        rows: rows.map((v) => ({
          id: `elevenlabs:${v.id}`,
          provider: "elevenlabs" as const,
          lang: null,
          gender: null,
          style: null,
          name: { zh: `${v.name} · ElevenLabs`, en: `${v.name} · ElevenLabs` },
          blurb: v.description ? { zh: v.description, en: v.description } : null,
          sample: false,
        })),
      };
    }
    out.push(...elCache.rows);
  }
  return out;
}

function toUi(v: CatalogVoice): UiVoice {
  return { id: v.id, provider: v.provider, lang: v.lang, gender: v.gender, style: v.style, name: v.name, blurb: v.blurb, sample: true };
}

/* ---------------------------------------------------------------- samples */

const CACHE_DIR = process.env.TTS_CACHE_DIR || "/opt/tts/cache";
const making = new Map<string, Promise<string>>();

/**
 * A short sample of a catalogue voice, made once and kept on disk.
 *
 * Every voice reads the same line (`SAMPLE_LINE`), so pressing 试听 on two of
 * them compares voices, not sentences. The first press makes it (~8 s: a
 * model load and two sentences); every press after is a file read. Two
 * presses at once share one synthesis.
 */
export async function samplePath(voiceId: string): Promise<string> {
  const base = baseVoiceId(voiceId);
  const voice = LOCAL_VOICES.find((v) => v.id === base);
  if (!voice) throw new TtsError("Samples exist for the studio's own voices only");
  const file = path.join(CACHE_DIR, "samples", `${voice.engineVoice}-v1.mp3`);
  const have = await stat(file).then((s) => s.size > 1000, () => false);
  if (have) return file;

  const pending = making.get(file);
  if (pending) return pending;
  const job = (async () => {
    const n = await narrate({ text: SAMPLE_LINE[voice.lang], voiceId: voice.id });
    await mkdir(path.dirname(file), { recursive: true });
    // Written beside and renamed into place, so a reader never sees half a file.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, n.mp3);
    await rename(tmp, file);
    return file;
  })().finally(() => making.delete(file));
  making.set(file, job);
  return job;
}
