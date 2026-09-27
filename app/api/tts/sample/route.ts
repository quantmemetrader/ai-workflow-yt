import { readFile } from "node:fs/promises";
import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { samplePath } from "@/lib/video/tts";
import { parseVoiceId } from "@/lib/video/tts/voices";

/**
 * 试听: a short sample of one of the studio's voices.
 *
 * Every voice reads the same two sentences, so pressing play on two of them
 * compares voices rather than lines. Made on the first press (a few seconds on
 * this server's own engine) and served from disk after that; the browser may
 * keep it for a day, because a voice does not change under its id.
 *
 * Signed-in people with the Video module only: it spends this server's CPU.
 */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("video")) return new Response("Not allowed", { status: 403 });
  const voice = req.nextUrl.searchParams.get("voice") ?? "";
  const parsed = parseVoiceId(voice);
  if (!parsed?.voice) return new Response("No sample for that voice", { status: 404 });
  try {
    const file = await samplePath(parsed.voice.id);
    const body = new Uint8Array(await readFile(file));
    /* Byte ranges: Safari will not play audio from a server that ignores
       `Range` (it asks for bytes 0-1 first) — the button said 无法播放 there
       while Chrome played it. */
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    const common = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" };
    if (range) {
      const size = body.byteLength;
      let start = range[1] ? Number(range[1]) : size - Number(range[2] || 0);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, Math.min(start, size - 1));
      end = Math.max(start, Math.min(end, size - 1));
      return new Response(body.slice(start, end + 1), {
        status: 206,
        headers: { ...common, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(body, { headers: { ...common, "Content-Length": String(body.byteLength) } });
  } catch (err) {
    console.error("[tts sample]", err);
    return new Response("The sample could not be made", { status: 503 });
  }
}
