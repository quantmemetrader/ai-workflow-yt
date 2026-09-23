import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Transcript } from "@/lib/video/elevenlabs";

/**
 * Speech to text on this machine, instead of ElevenLabs.
 *
 * Two reasons it is worth having, both of them in CLIENT-BACKLOG.md:
 * ElevenLabs refuses this server's IP, so every transcription currently goes
 * out through an SSH tunnel to the old box; and the account is a free tier
 * whose quota transcription — the high-volume path — eats first. This box has
 * 16 cores and sits at load ~0 between renders.
 *
 * The work itself is `/opt/whisper/transcribe.py`: faster-whisper (Whisper
 * large-v3-turbo through CTranslate2, int8 on CPU) in a venv deliberately kept
 * *outside* the repo, because gigabytes of model weights and a Python tree have
 * no business in a public git repository or in a `next build`.
 *
 * It returns the same `Transcript` shape ElevenLabs does, so `toCaptionLines`
 * and every caller downstream cannot tell which one served the job. The only
 * difference is `speaker`, which is always undefined here — see below.
 */

/** Where the venv lives. Overridable so a future move does not need a deploy. */
const PYTHON = process.env.WHISPER_PYTHON || "/opt/whisper/venv/bin/python";
const SCRIPT = process.env.WHISPER_SCRIPT || "/opt/whisper/transcribe.py";

/**
 * int8 large-v3-turbo measures ~5x realtime on this box on six threads, so a
 * six-minute take is a little over a minute. Twenty minutes is far past any
 * honest run and still short enough that a wedged process is noticed the same
 * day rather than holding a worker slot forever.
 */
const TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS || 20 * 60_000);

/**
 * Six of the sixteen cores, and the model id, both settable without a deploy —
 * the CLI has the same defaults, so these only ever need setting to override.
 * A transcription is never what the studio is waiting on; a render is, and one
 * starting beside this still gets ten cores.
 */
const THREADS = process.env.WHISPER_THREADS || "6";
const MODEL = process.env.WHISPER_MODEL || "";

export class WhisperUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhisperUnavailable";
  }
}

/**
 * Transcribe an audio Blob locally.
 *
 * `diarize` is accepted only so the call site reads the same as the ElevenLabs
 * one; it is ignored. faster-whisper does not diarize — that needs a separate
 * speaker-embedding model (pyannote and a PyTorch install, which is the weight
 * this backend exists to avoid). It costs nothing here: `toCaptionLines` uses
 * `speaker` only to break a line when it changes, so leaving it undefined
 * simply never breaks on it, and no other caller reads it.
 */
export async function transcribeLocal(
  audio: Blob,
  filename: string,
  options: { diarize?: boolean; languageCode?: string | null } = {},
): Promise<Transcript> {
  // The CLI takes a path, not a stream: Whisper seeks around the file to
  // detect the language and to window the decode, so it needs it on disk.
  const dir = await mkdtemp(path.join(tmpdir(), "aura-whisper-"));
  const audioPath = path.join(dir, path.basename(filename) || "audio.mp3");

  try {
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    const args = [SCRIPT, audioPath];
    // Omitted means auto-detect, which is the normal case here: this studio
    // publishes in Mandarin, Cantonese and English, sometimes in one video.
    if (options.languageCode) args.push("--language", options.languageCode);
    if (MODEL) args.push("--model", MODEL);
    args.push("--threads", THREADS);

    // spawn with an argv array, never a shell string: `filename` comes from a
    // caller and a temp path could otherwise be read as shell syntax.
    const raw = await runPython(args);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WhisperUnavailable(
        `the local transcriber printed something that is not JSON: ${raw.trim().slice(0, 300)}`,
      );
    }

    return normalise(parsed);
  } finally {
    // The audio is a copy of a cut that already exists on disk upstream, and
    // this box is also the web server. It does not get to accumulate.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** True if the venv and the script are where we think they are. */
export async function localTranscriberInstalled(): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await Promise.all([access(PYTHON), access(SCRIPT)]);
    return true;
  } catch {
    return false;
  }
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        /* Belt and braces: the script sets these itself before importing
           CTranslate2, which is the only moment the OpenMP thread ceiling can
           still be changed. Passing them in the environment too means the cap
           holds even if the script is ever run a different way. */
        OMP_NUM_THREADS: THREADS,
        MKL_NUM_THREADS: THREADS,
        WHISPER_THREADS: THREADS,
        /* The weights live beside the venv, not in the home directory of
           whichever user the worker happens to run as. */
        HF_HOME: process.env.WHISPER_CACHE || "/opt/whisper/models",
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => {
      if (stderr.length < 4000) stderr += String(c);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WhisperUnavailable(`the local transcriber did not finish within ${Math.round(TIMEOUT_MS / 1000)}s`));
    }, TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      // The usual cause is the venv not being installed on this host at all,
      // which is a fall-back-to-ElevenLabs situation, not a crash.
      reject(new WhisperUnavailable(`${PYTHON} could not start: ${e.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new WhisperUnavailable(`the local transcriber exited ${code}: ${stderr.trim().slice(0, 900)}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new WhisperUnavailable(`the local transcriber printed nothing: ${stderr.trim().slice(0, 900)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Trust nothing about the subprocess's JSON.
 *
 * A half-written or differently-shaped object must fail here, loudly, so the
 * caller falls back to ElevenLabs — rather than becoming a transcript of
 * zero words that the pipeline would happily save as the studio's captions.
 */
function normalise(parsed: unknown): Transcript {
  if (!parsed || typeof parsed !== "object") {
    throw new WhisperUnavailable("the local transcriber returned no object");
  }
  const raw = parsed as {
    text?: unknown;
    languageCode?: unknown;
    languageProbability?: unknown;
    durationSecs?: unknown;
    words?: unknown;
  };
  if (!Array.isArray(raw.words)) {
    throw new WhisperUnavailable("the local transcriber returned no word timings");
  }

  const words = raw.words
    .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === "object")
    .filter((w) => typeof w.text === "string" && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({
      text: String(w.text),
      start: Number(w.start),
      end: Number(w.end),
      type: typeof w.type === "string" ? w.type : "word",
      /* The CLI sends `null` because that is the honest JSON for "not
         diarized"; `TranscriptWord.speaker` is an optional string, and
         undefined is how that same absence is spelled in TypeScript. */
      speaker: typeof w.speaker === "string" ? w.speaker : undefined,
    }));

  if (!words.length) {
    throw new WhisperUnavailable("the local transcriber made out no words");
  }

  return {
    text: typeof raw.text === "string" ? raw.text : "",
    languageCode: typeof raw.languageCode === "string" ? raw.languageCode : "unknown",
    languageProbability: typeof raw.languageProbability === "number" ? raw.languageProbability : 0,
    durationSecs: typeof raw.durationSecs === "number" ? raw.durationSecs : 0,
    words,
  };
}
