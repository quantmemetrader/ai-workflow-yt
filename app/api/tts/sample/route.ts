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
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    console.error("[tts sample]", err);
    return new Response("The sample could not be made", { status: 503 });
  }
}
