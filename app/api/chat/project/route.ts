import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { bridgeState, createFromConversation } from "@/lib/chat/conversation-project";

/**
 * The chat bar's project: GET what a conversation already belongs to (and
 * whether this person may start one), POST to turn it into a project.
 *
 * The GET is the one cheap read the bar makes after each reply: the
 * conversation's owner, its link row, its tool rows and one project query.
 * The screen's own ids (`projectId` a work project, `videoProjectId`,
 * `scriptId`) are hints, each checked against the person on the server.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const param = (u: URL, k: string) => {
  const v = u.searchParams.get(k);
  return v && v.length <= 64 ? v : null;
};

export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(req.url);
  const conversationId = param(url, "conversationId");
  if (!conversationId) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const state = await bridgeState(viewer, conversationId, {
      projectId: param(url, "projectId"),
      videoProjectId: param(url, "videoProjectId"),
      scriptId: param(url, "scriptId"),
    });
    if (!state) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return Response.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("[chat-project] state", err);
    return Response.json({ error: "Could not read the conversation" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { conversationId?: unknown; title?: unknown; brief?: unknown; access?: unknown };
  const conversationId = typeof body.conversationId === "string" && body.conversationId.length <= 64 ? body.conversationId : "";
  const res = await createFromConversation(viewer, conversationId, { title: body.title, brief: body.brief, access: body.access });
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status, headers: NO_STORE });
  return Response.json({ id: res.id, title: res.title, existed: res.existed }, { headers: NO_STORE });
}
