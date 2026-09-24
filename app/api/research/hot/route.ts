import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { isPlatformKey, platformHot } from "@/lib/research/platforms";
import { judgeHot } from "@/lib/research/judge";

/**
 * A platform's hot list, and 研究员's reading of it, as plain GETs.
 *
 * These were server actions. A server action can take thirty seconds here
 * (the reading is a model call), and the app router queues every navigation
 * behind an in-flight action — so while 研究员 was reading a list, the rail
 * did nothing and the client said the site was down. A fetch to a route
 * handler holds nothing up.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const platform = request.nextUrl.searchParams.get("platform");
  if (!isPlatformKey(platform)) return Response.json({ error: "No such platform" }, { status: 400 });

  const hot = await platformHot(platform);
  if (request.nextUrl.searchParams.get("judge") === "1") {
    const judged = hot.rows.length ? await judgeHot(viewer.tenantId, platform, hot.rows, hot.fetchedAt) : {};
    return Response.json({ judged }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({ rows: hot.rows, note: hot.note, fetchedAt: hot.fetchedAt }, { headers: { "Cache-Control": "private, no-store" } });
}
