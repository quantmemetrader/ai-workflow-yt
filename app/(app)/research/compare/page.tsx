import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { connectedSources, decisionCount, rankedTopics, seriesFor, type Window } from "@/lib/research/service";
import { trendingSearches } from "@/lib/research/trending";
import { openCommentCount } from "@/lib/social/service";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { CompareView } from "@/components/research/CompareView";

export const metadata = { title: "搜索与比较 · Search & compare" };

const COLOURS = ["#007be0", "#383838", "#8d99a6", "#c7c7c7", "#278f5e"];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; window?: string }>;
}) {
  const viewer = await requireModule("research");
  const { q, window: w } = await searchParams;

  const asked = (q ? q.split("|") : []).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const window = (["1m", "3m", "6m"].includes(w ?? "") ? w : "3m") as Window;

  /*
   * Opening this screen used to land on an empty chart and an empty box.
   *
   * There was a reason — "the studio picks what it compares, inventing three
   * phrases would be demo content" — and it was the wrong conclusion from a
   * right principle. Nothing here is invented: with no `?q`, it opens on the
   * three hottest topics the studio is *already* watching, which is what a
   * person comparing things would have typed anyway. Adding or removing a
   * series still writes the URL, so a deliberate comparison is unaffected and
   * a shared link still shows exactly what the sender saw.
   */
  /* What the studio already watches, hottest first. One read: it supplies
     both the default comparison and the suggestions under the input. The
     screen used to ask people to type a phrase from memory, so a topic
     collected last week got typed again with one word different and collected
     all over again. */
  const watched = await rankedTopics(viewer, { limit: 60 });
  const queries = asked.length ? asked : watched.slice(0, 3).map((t) => t.query);

  const [series, sources, decisions, open] = await Promise.all([
    seriesFor(viewer, queries, window),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
  ]);

  // Suggestions only; a slow feed never fails the page.
  const trending = await trendingSearches("HK").catch(() => []);

  return (
    <>
      <ResearchSidebar
        locale={viewer.locale ?? "zh-CN"}
        decisionCount={decisions}
        inboxCount={open}
        sources={sources.map((s) => ({
          key: s.key,
          name: s.name,
          kind: s.kind,
          status: s.status,
          note: s.note ?? s.lastError,
        }))}
      />
      <CompareView
      watched={watched
        .filter((t) => !queries.includes(t.query))
        .map((t) => ({ phrase: t.query, label: t.name, collecting: t.collecting }))}
      trending={trending.map((x) => ({ phrase: x.phrase, traffic: x.traffic, headline: x.headline }))}
      queries={queries}
      window={window}
      region="HK / TW / SG"
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      sourceCount={sources.filter((s) => s.status === "live").length}
      initialSeries={series.map((s, i) => ({
        query: s.query,
        colour: COLOURS[i % COLOURS.length],
        points: s.points,
        articles: s.articles,
        sourceKey: s.sourceKey,
        fetchedAt: s.fetchedAt ? s.fetchedAt.toISOString() : null,
        pending: s.pending,
        error: s.error,
      }))}
      />
    </>
  );
}
