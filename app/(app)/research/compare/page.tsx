import { requireModule } from "@/lib/auth/dal";
import { modelFor } from "@/lib/ai/models";
import { connectedSources, decisionCount, seriesFor, type Window } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { CompareView } from "@/components/research/CompareView";

const COLOURS = ["#007be0", "#383838", "#8d99a6", "#c7c7c7", "#278f5e"];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; window?: string }>;
}) {
  const viewer = await requireModule("research");
  const { q, window: w } = await searchParams;

  // No default series: the studio picks what it compares. Inventing three
  // phrases here would put demo content on a screen that has none.
  const queries = (q ? q.split("|") : []).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const window = (["1m", "3m", "6m"].includes(w ?? "") ? w : "3m") as Window;

  const [series, sources, decisions, open] = await Promise.all([
    seriesFor(viewer, queries, window),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
  ]);

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
      queries={queries}
      window={window}
      region="HK / TW / SG"
      locale={viewer.locale ?? "zh-CN"}
      model={modelFor.assistant()}
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
