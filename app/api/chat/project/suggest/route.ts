import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { mayCreate, suggestFromConversation } from "@/lib/chat/conversation-project";

/**
 * A title and a one-paragraph brief for "建成项目", written by the utility
 * model from the conversation (a few seconds; capped at 25). A route, not a
 * server action, so a slow model call never holds up navigation; the
 * popover shows the cleaned first ask meanwhile and keeps it if this fails.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!mayCreate(viewer)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { conversationId?: unknown };
  const conversationId = typeof body.conversationId === "string" && body.conversationId.length <= 64 ? body.conversationId : "";
  const res = await suggestFromConversation(viewer, conversationId);
  if (!res) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
