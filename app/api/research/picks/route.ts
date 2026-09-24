import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { addOwnPick } from "@/lib/research/own-picks";

/** A person's own topic for today, beside the researcher's. A POST to a route
 *  handler rather than a server action, so it never holds up navigation. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 120) : "";
  if (!text) return Response.json({ error: "Nothing to add" }, { status: 400 });
  await addOwnPick(viewer, text);
  return Response.json({ ok: true });
}
