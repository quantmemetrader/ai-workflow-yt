import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { workProjectDetail } from "@/lib/projects/service";

/**
 * A project's state in one short string, for the page to poll.
 *
 * The project page used to re-render itself every four seconds while an
 * employee worked, which read as the page reloading. It now asks this
 * instead and refreshes only when the answer changes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  /* Chat, the gate of the project page that polls this. */
  if (!viewer || !viewer.modules.includes("chat")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await workProjectDetail(viewer, id, true, 3);
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const last = p.messages[p.messages.length - 1];
  const stamp = [last?.id ?? "", p.pending.map((r) => `${r.id}:${r.step}`).join(","), p.beats.length, p.clipList.length, p.video?.items ?? 0, p.render?.state ?? "", Math.round((p.render?.progress ?? 0) * 100), p.status, p.script?.status ?? "", p.director?.state ?? "", p.director?.step ?? ""].join("|");
  return Response.json({ stamp }, { headers: { "Cache-Control": "no-store" } });
}
