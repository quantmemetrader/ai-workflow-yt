import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { workProjectDetail } from "@/lib/projects/service";

/**
 * A project's state in one short string, for the page to poll.
 *
 * The project page used to re-render itself every four seconds while an
 * employee worked, which read as the page reloading. It now asks this
 * instead and refreshes only when the answer changes.
 *
 * Everything the page draws live is in the string: the newest message, who
 * is at work and on which step, the counts, the render (which one, its
 * state, its percent) and the director (its state and step, and when it
 * finished — so a cut that ends without a render still turns the 剪辑 step
 * and the 成片 card over the moment it does), and the narration (AI 配音:
 * which track and whether it is ready, so its player appears when it is).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  /* Chat, the gate of the project page that polls this. */
  if (!viewer || !viewer.modules.includes("chat")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await workProjectDetail(viewer, id, true, 3);
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const last = p.messages[p.messages.length - 1];
  const stamp = [
    last?.id ?? "",
    p.pending.map((r) => `${r.id}:${r.step}`).join(","),
    p.beats.length,
    p.clipList.length,
    p.video?.items ?? 0,
    p.video?.graphics ?? 0,
    p.render?.id ?? "",
    p.render?.state ?? "",
    p.render?.progress ?? 0,
    p.status,
    p.script?.status ?? "",
    p.director?.state ?? "",
    p.director?.step ?? "",
    p.director?.finishedAt ?? "",
    p.narration?.trackId ?? "",
    p.narration?.state ?? "",
    /* An armed auto-cut (or its cancel), so the countdown on the clips
       card follows what the server holds. */
    p.autoCut.dueAt ?? "",
  ].join("|");
  return Response.json({ stamp }, { headers: { "Cache-Control": "no-store" } });
}
