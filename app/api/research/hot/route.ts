import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { HOT_TENANT, isPlatformKey, platformHot, storedAll } from "@/lib/research/platforms";
import { judgeHot } from "@/lib/research/judge";
import { onFocus } from "@/lib/research/platform-catalog";

/**
 * A platform's hot list, and 研究员's reading of it, as plain GETs.
 *
 * These were server actions. A server action can take thirty seconds here
 * (the reading is a model call), and the app router queues every navigation
 * behind an in-flight action — so while 研究员 was reading a list, the rail
 * did nothing and the client said the site was down. A fetch to a route
 * handler holds nothing up.
 *
 * Each list carries `relevance`, the business / tech mark on every row made
 * when it was collected; the screen filters on it. Null means the list was
 * never marked, and the screen shows it whole.
 *
 * The stored `judged` marks cite the collector's studio's own videos,
 * viewers and rivals (`HOT_TENANT`), so they go only to that studio; anyone
 * else gets none here and the `judge=1` read makes theirs from their brief.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return Response.json({ error: "Not allowed" }, { status: 403 });
  /* Every tab at once, from storage: the page asks this once and switching
     platforms is then instant. */
  const own = viewer.tenantId === HOT_TENANT;
  if (request.nextUrl.searchParams.get("platform") === "all") {
    const all = await storedAll();
    if (!own) for (const hot of Object.values(all)) if (hot) hot.judged = null;
    return Response.json({ lists: all }, { headers: { "Cache-Control": "private, max-age=60" } });
  }
  const platform = request.nextUrl.searchParams.get("platform");
  if (!isPlatformKey(platform)) return Response.json({ error: "No such platform" }, { status: 400 });

  const hot = await platformHot(platform);
  if (request.nextUrl.searchParams.get("judge") === "1") {
    /* Only lists stored before marks were kept get here (the collector
       stores them now); judged the way the collector would, on the rows on
       the beat when there are enough of them. */
    const rel = hot.relevance ?? null;
    const focus = rel ? hot.rows.filter((r) => onFocus(rel[r.phrase])) : hot.rows;
    const judged = (own ? hot.judged : null) ?? (hot.rows.length ? await judgeHot(viewer.tenantId, platform, rel && focus.length >= 3 ? focus : hot.rows, hot.fetchedAt) : {});
    return Response.json({ judged }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json(
    { rows: hot.rows, note: hot.note, fetchedAt: hot.fetchedAt, summary: hot.summary ?? null, relevance: hot.relevance ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
