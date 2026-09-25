import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { setIdeaStatus } from "@/lib/ideas/service";

/**
 * One idea: keep it ("saved", which also puts it in the topic backlog), put
 * it away ("dismissed"), or bring it back ("new"). Starting one is not here:
 * that goes through `startFromTopicAction`, like every other start.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !(viewer.modules.includes("chat") || viewer.modules.includes("research"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  const status = body.status;
  if (status !== "saved" && status !== "dismissed" && status !== "new") return Response.json({ error: "Say saved, dismissed or new" }, { status: 400 });
  const idea = await setIdeaStatus(viewer, String(id).slice(0, 64), status);
  if (!idea) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ idea });
}
