import "server-only";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { SpeakSentence, Synthesis, TimedSentence, TtsProvider } from "./types";

/**
 * Speech on this machine: Kokoro-82M through `/opt/tts/speak.py`.
 *
 * The same shape as the local Whisper (`lib/video/whisper.ts`): a venv and the
 * weights kept outside the repo in `/opt/tts`, because a PyTorch tree and
 * 700 MB of model have no business in a public repository or in `next build`;
 * a CLI that prints one JSON object; and this wrapper, which spawns it with an
 * argv array (never a shell string), feeds it the request on stdin and trusts
 * nothing about what comes back.
 *
 * Measured on this box (Ryzen 7700X, no GPU), 8 threads: 43 s of Mandarin in
 * 4.9 s, a real-time factor of 0.115, plus ~6 s to load the model once per
 * call. A three-minute script is about half a minute of work.
 */

const PYTHON = process.env.TTS_PYTHON || "/opt/tts/venv/bin/python";
const SCRIPT = process.env.TTS_SCRIPT || "/opt/tts/speak.py";
/** Six of sixteen cores, the same deal transcription has: a render beside it keeps ten. */
const THREADS = process.env.TTS_THREADS || "6";
/** Far past any honest run (5,000 characters is ~2.5 minutes of work) and short
 * enough that a wedged process is noticed the same day. */
const TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS || 15 * 60_000);

export class LocalTtsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalTtsUnavailable";
  }
}

let installed: { at: number; ok: boolean } | null = null;

export const localProvider: TtsProvider = {
  id: "local",

  async available() {
    if (!installed || Date.now() - installed.at > 60_000) {
      const ok = await Promise.all([access(PYTHON), access(SCRIPT)]).then(
        () => true,
        () => false,
      );
      installed = { at: Date.now(), ok };
    }
    return installed.ok
      ? { ok: true as const }
      : { ok: false as const, reason: `The local speech engine is not installed on this server (${path.dirname(SCRIPT)}).` };
  },

  async synthesize({ sentences, voice, speed, dir }): Promise<Synthesis> {
    const out = path.join(dir, "local.wav");
    const request = JSON.stringify({
      voice,
      speed,
      sentences: sentences.map((s) => ({ text: s.text, pauseMs: s.pauseMs })),
    });
    const raw = await run([SCRIPT, "--json", "--out", out, "--threads", THREADS], request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new LocalTtsUnavailable(`the local speech engine printed something that is not JSON: ${raw.trim().slice(0, 300)}`);
    }
    return normalise(parsed, sentences, out);
  },
};

function run(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    /* turbopackIgnore: this module is reached from pages and routes, and a
       spawn of a path Turbopack cannot resolve made `next build` trace the
       whole repository into .next/standalone (232 MB of source, PDFs and
       logs beside server.js). The interpreter lives in /opt/tts, outside
       the build, so there is nothing here for it to trace. */
    const child = spawn(/*turbopackIgnore: true*/ PYTHON, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        /* The script sets these itself before torch is imported, which is the
           only moment the OpenMP ceiling can still move; passing them here as
           well keeps the cap if it is ever run another way. */
        OMP_NUM_THREADS: THREADS,
        MKL_NUM_THREADS: THREADS,
        TTS_THREADS: THREADS,
        HF_HOME: process.env.TTS_CACHE || "/opt/tts/models",
        HF_HUB_OFFLINE: "1",
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
      reject(new LocalTtsUnavailable(`the local speech engine did not finish within ${Math.round(TIMEOUT_MS / 1000)}s`));
    }, TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new LocalTtsUnavailable(`${PYTHON} could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new LocalTtsUnavailable(`the local speech engine exited ${code}: ${stderr.trim().slice(-900)}`));
      if (!stdout.trim()) return reject(new LocalTtsUnavailable(`the local speech engine printed nothing: ${stderr.trim().slice(-900)}`));
      resolve(stdout);
    });
    child.stdin.end(stdin);
  });
}

/**
 * The CLI's answer, checked. A half-written object has to fail here, loudly,
 * rather than become a voice-over whose captions are all at zero.
 */
function normalise(parsed: unknown, asked: SpeakSentence[], wavPath: string): Synthesis {
  const raw = (parsed ?? {}) as { durationMs?: unknown; sentences?: unknown; model?: unknown };
  if (typeof raw.durationMs !== "number" || !Array.isArray(raw.sentences)) {
    throw new LocalTtsUnavailable("the local speech engine returned no timings");
  }
  if (raw.sentences.length !== asked.length) {
    throw new LocalTtsUnavailable(`asked for ${asked.length} sentences and got ${raw.sentences.length} back`);
  }
  const sentences: TimedSentence[] = raw.sentences.map((s: unknown, i: number) => {
    const r = (s ?? {}) as { text?: unknown; startMs?: unknown; endMs?: unknown; words?: unknown };
    const words = Array.isArray(r.words)
      ? r.words
          .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === "object")
          .filter((w) => typeof w.text === "string" && typeof w.start === "number" && typeof w.end === "number")
          .map((w) => ({ text: String(w.text), start: Number(w.start), end: Math.max(Number(w.start), Number(w.end)) }))
      : [];
    return {
      i,
      paragraph: asked[i].paragraph,
      text: asked[i].text,
      startMs: typeof r.startMs === "number" ? Math.round(r.startMs) : 0,
      endMs: typeof r.endMs === "number" ? Math.round(r.endMs) : 0,
      words,
    };
  });
  return {
    wavPath,
    durationMs: Math.round(raw.durationMs),
    sentences,
    engine: `kokoro ${typeof raw.model === "string" ? raw.model : ""}`.trim(),
  };
}
