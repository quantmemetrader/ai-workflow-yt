import { getViewer } from "@/lib/auth/dal";
import { conversationDetail } from "@/lib/chat/service";
import { stopTurn } from "@/lib/ai/turns";

/** The Stop button: ends this person's running turn in one of their own conversations. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not allowed", { status: 401 });
  const body = (await request.json().catch(() => null)) as { conversationId?: unknown } | null;
  const id = typeof body?.conversationId === "string" ? body.conversationId : null;
  if (!id || !(await conversationDetail(viewer, id))) return new Response("Not found", { status: 404 });
  return Response.json({ stopped: stopTurn(id) });
}
