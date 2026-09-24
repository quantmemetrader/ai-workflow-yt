import { getViewer } from "@/lib/auth/dal";
import { studioPulse } from "@/lib/home/pulse";

/** What the employees are doing right now, for the line in the top bar.
 *  Polled every twenty seconds by every open page, so it is two indexed reads
 *  and nothing else. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("chat")) return Response.json({ lines: [] });
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lines = await studioPulse(viewer, zh);
  return Response.json({ lines }, { headers: { "Cache-Control": "private, no-store" } });
}
