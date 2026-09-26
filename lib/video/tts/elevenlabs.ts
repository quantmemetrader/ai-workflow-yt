import "server-only";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { ElevenLabsError, quota, speak } from "@/lib/video/elevenlabs";
import { joinWithPauses, probeDurationMs } from "./audio";
import type { Synthesis, TimedSentence, TtsProvider } from "./types";

/**
 * ElevenLabs as a speech provider: optional, and only when it can answer.
 *
 * It refuses this server's IP (it redirects API calls to a help page), and the
 * key is a free tier of 10,000 characters a month, so it is never the default.
 * It stays for the day the studio routes it through an egress it accepts, or
 * buys a plan: then a voice from its library works exactly as a local one
 * does, joined and levelled the same way. Whether it can answer is asked once
 * every ten minutes, not before every sentence.
 */

let reach: { at: number; ok: boolean; reason?: string } | null = null;

export const elevenLabsProvider: TtsProvider = {
  id: "elevenlabs",

  async available() {
    if (!env.elevenlabs.configured) return { ok: false as const, reason: "No ELEVENLABS_API_KEY is set on this deployment." };
    if (!reach || Date.now() - reach.at > 10 * 60_000) {
      try {
        // Four seconds, not the fifteen minutes a real request may take: this
        // is asked while a page renders, and "no answer" is an answer.
        await Promise.race([
          quota(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("ElevenLabs did not answer within 4s.")), 4000)),
        ]);
        reach = { at: Date.now(), ok: true };
      } catch (err) {
        reach = {
          at: Date.now(),
          ok: false,
          reason: err instanceof ElevenLabsError || err instanceof Error ? err.message : "ElevenLabs could not be reached from this server.",
        };
      }
    }
    return reach.ok ? { ok: true as const } : { ok: false as const, reason: reach.reason ?? "ElevenLabs is unavailable." };
  },

  async synthesize({ sentences, voice, dir }): Promise<Synthesis> {
    // One request per sentence: that is what gives each its own length, so
    // captions can be timed per sentence even without word timings.
    const files: string[] = [];
    const lengths: number[] = [];
    for (const [i, s] of sentences.entries()) {
      const mp3 = path.join(dir, `el-${i}.mp3`);
      await writeFile(mp3, Buffer.from(await speak(voice, s.text)));
      files.push(mp3);
      lengths.push(await probeDurationMs(mp3));
    }
    const wavPath = path.join(dir, "elevenlabs.wav");
    await joinWithPauses(files, sentences.map((s) => s.pauseMs), wavPath);

    let at = 0;
    const timed: TimedSentence[] = sentences.map((s, i) => {
      const row = { i, paragraph: s.paragraph, text: s.text, startMs: at, endMs: at + lengths[i], words: [] };
      at += lengths[i] + (i < sentences.length - 1 ? s.pauseMs : 0);
      return row;
    });
    return { wavPath, durationMs: await probeDurationMs(wavPath), sentences: timed, engine: "elevenlabs eleven_multilingual_v2" };
  },
};
