import { getViewer } from "@/lib/auth/dal";
import { videoCardsFor } from "@/lib/chat/videos";

/**
 * The video cards for a few ids, for the personal chat while a turn is
 * still on screen.
 *
 * A reloaded thread gets its cards from the server with the messages
 * (`threadMessagesOf`). While an answer streams, the browser learns of a
 * render or a video file from the turn's tool events (their receipts and
 * the ids in their results) and of an upload from its own composer, and
 * asks here for the card — the same lookup, the same permission checks, for
 * the same reader — rather than waiting for a reload to draw it.
 *
 *   GET /api/chat/videos?ids=rnd_…,fil_…   →  { videos: VideoCard[] }
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^(rnd|fil)_[0-9a-z]{20,32}$/.test(s)))].slice(0, 20);
  if (!ids.length) return Response.json({ videos: [] }, { headers: { "Cache-Control": "no-store" } });
  const cards = await videoCardsFor(viewer, [
    {
      key: "ask",
      exportIds: ids.filter((id) => id.startsWith("rnd_")),
      fileIds: ids.filter((id) => id.startsWith("fil_")),
      jobIds: [],
    },
  ]);
  const videos = cards.get("ask") ?? [];
  /* Nothing this reader may see among what was asked: the same 404 the
     sibling routes give for an object outside their access, rather than an
     empty 200 that tells a guesser the ids were taken in (QA, 3 Oct). The
     callers treat any non-OK answer as "no card yet". */
  if (!videos.length) return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ videos }, { headers: { "Cache-Control": "no-store" } });
}
