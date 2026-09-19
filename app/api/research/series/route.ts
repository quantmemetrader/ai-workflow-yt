import { getViewer } from "@/lib/auth/dal";
import { seriesFor, type Window } from "@/lib/research/service";

/**
 * Series for the Compare screen, read from the cache.
 *
 * The screen polls this while a series is still being collected: sources
 * answer in their own time (GDELT allows one request every five seconds), so
 * the page asks rather than waits. Anything missing or stale is queued as a
 * side effect of asking, which is why a poll is also what causes the fetch.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("research")) return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  // Each uncached phrase queues an outbound fetch, so the same bounds the
  // Compare action applies are applied here: this route is reachable directly
  // and was taking any number of phrases of any length.
  const queries = (params.get("q") ?? "")
    .split("|")
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= 80)
    .slice(0, 5);

  const windowParam = params.get("window") ?? "3m";
  if (windowParam !== "1m" && windowParam !== "3m" && windowParam !== "6m") {
    return new Response("Bad request", { status: 400 });
  }
  const window: Window = windowParam;

  if (!queries.length) return Response.json({ series: [] });

  const series = await seriesFor(viewer, queries, window);

  return Response.json(
    {
      series: series.map((s) => ({
        query: s.query,
        points: s.points,
        articles: s.articles,
        sourceKey: s.sourceKey,
        fetchedAt: s.fetchedAt,
        pending: s.pending,
        error: s.error,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
