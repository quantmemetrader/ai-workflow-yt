import "server-only";
import { spawn } from "node:child_process";

/**
 * The FFmpeg around speech: measure it, join it, level it.
 *
 * Provider-agnostic on purpose. The local engine hands back one WAV with the
 * pauses already in; ElevenLabs hands back an MP3 per sentence that has to be
 * joined here. Either way the result goes through the same loudness pass, so
 * a narration from one provider and a narration from the other sit at the
 * same level in the same mix.
 */

function ffmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 10 * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-600)}`));
    });
  });
}

/** Length of an audio file in ms, from its container. */
export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.on("error", reject);
    child.on("close", () => {
      const s = Number(out.trim());
      if (Number.isFinite(s) && s > 0) resolve(Math.round(s * 1000));
      else reject(new Error(`could not measure ${file}`));
    });
  });
}

/**
 * Several clips into one mono WAV at 24 kHz, with the given silence after each
 * one (the last pause is dropped: a narration does not end on dead air).
 */
export async function joinWithPauses(files: string[], pausesMs: number[], out: string): Promise<void> {
  if (!files.length) throw new Error("nothing to join");
  const parts: string[] = [];
  const labels: string[] = [];
  files.forEach((_, i) => {
    parts.push(`[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[s${i}]`);
    labels.push(`[s${i}]`);
    const gap = i < files.length - 1 ? Math.max(0, Math.round(pausesMs[i] ?? 0)) : 0;
    if (gap > 0) {
      parts.push(`anullsrc=r=24000:cl=mono,atrim=0:${(gap / 1000).toFixed(3)},aformat=sample_fmts=s16:channel_layouts=mono[g${i}]`);
      labels.push(`[g${i}]`);
    }
  });
  parts.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
  await ffmpeg(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", parts.join(";"), "-map", "[out]", out]);
}

/**
 * Level a narration to -16 LUFS integrated, -1.5 dBTP, and encode MP3.
 *
 * Two passes, not one: single-pass `loudnorm` works as a dynamic compressor
 * and audibly pumps on speech with pauses in it; measured first and then
 * applied with `linear=true`, it is one gain change for the whole read, which
 * is what a voice wants. -16 LUFS is where the render's own loudness pass puts
 * the whole mix, so a narration arrives already at the level it will leave at.
 */
export async function levelToMp3(input: string, out: string): Promise<{ inputLufs: number | null }> {
  const target = "I=-16:TP=-1.5:LRA=11";
  const measure = await ffmpeg(["-i", input, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const json = measure.stderr.slice(measure.stderr.lastIndexOf("{"), measure.stderr.lastIndexOf("}") + 1);
  let m: Record<string, string> | null = null;
  try {
    m = JSON.parse(json) as Record<string, string>;
  } catch {
    m = null;
  }
  const measured =
    m && Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -70
      ? `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
      : "";
  await ffmpeg([
    "-y",
    "-i",
    input,
    "-af",
    `loudnorm=${target}${measured}`,
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    out,
  ]);
  return { inputLufs: m ? Number(m.input_i) : null };
}

/**
 * Whether a clip has sound worth cutting on: an audio stream at all, and one
 * that is not near silence over its first minute and a half.
 *
 * Read over a signed URL (FFmpeg speaks HTTP), audio only, so a big master is
 * never downloaded to answer a yes or no. "Near silence" is a mean under
 * -50 dBFS or a peak under -35: room tone and a camera's own hiss sit there,
 * a person speaking does not.
 */
export async function hasUsableAudio(url: string): Promise<{ usable: boolean; why: string }> {
  const streams = await new Promise<string>((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-rw_timeout", "30000000", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", url]);
    let o = "";
    child.stdout.on("data", (c) => (o += String(c)));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(o));
  });
  if (!streams.includes("audio")) return { usable: false, why: "no audio stream" };
  try {
    const { stderr } = await ffmpeg(
      ["-rw_timeout", "30000000", "-t", "90", "-i", url, "-vn", "-ac", "1", "-ar", "16000", "-af", "volumedetect", "-f", "null", "-"],
      { timeoutMs: 3 * 60_000 },
    );
    const mean = Number(/mean_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1] ?? "-91");
    const max = Number(/max_volume:\s*(-?[\d.]+)/.exec(stderr)?.[1] ?? "-91");
    if (mean < -50 || max < -35) return { usable: false, why: `near silent (mean ${mean} dB, peak ${max} dB)` };
    return { usable: true, why: `mean ${mean} dB, peak ${max} dB` };
  } catch (err) {
    // Unreadable is not the same as silent: say yes and let transcription decide.
    return { usable: true, why: `could not measure (${err instanceof Error ? err.message.slice(0, 80) : "error"})` };
  }
}
