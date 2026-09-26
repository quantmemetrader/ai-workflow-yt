import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { oneGo } from "@/lib/projects/one-go";

/**
 * "Make it in one go" for a project (`lib/projects/one-go.ts`).
 *
 * A route, not a server action: importing clips takes a while, and the app
 * router holds every navigation behind an action in flight.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; way?: unknown; narrate?: unknown; voiceId?: unknown };
  const res = await oneGo(viewer, id, body);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json({ ok: true, brought: res.brought, way: res.way, ...(res.seconds ? { seconds: res.seconds } : {}) });
}
