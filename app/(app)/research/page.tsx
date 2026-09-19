import { requireModule } from "@/lib/auth/dal";
import { connectedSources, decisionCount, rankedTopics } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { TrendsView } from "@/components/research/TrendsView";

/** The studio's tech beats, as the design names them. */
const CATEGORIES = [
  { key: "ai", label: "AI" },
  { key: "chain", label: "Blockchain & crypto" },
  { key: "semi", label: "Semiconductors" },
  { key: "devices", label: "Consumer tech" },
  { key: "fintech", label: "Fintech" },
  { key: "ev", label: "EV & mobility" },
  { key: "startups", label: "Startups & VC" },
];

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const viewer = await requireModule("research");
  const { cat } = await searchParams;
  const active = cat ? cat.split(",").filter(Boolean) : [];

  const [topics, sources, decisions, open] = await Promise.all([
    rankedTopics(viewer, { categories: active.length ? active : undefined }),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
  ]);

  const backlogCount = topics.filter((t) => t.status === "adopted").length;

  return (
    <>
      <ResearchSidebar
        locale={viewer.locale ?? "zh-CN"}
        decisionCount={decisions}
        inboxCount={open}
        backlogCount={backlogCount}
        sources={sources.map((s) => ({
          key: s.key,
          name: s.name,
          kind: s.kind,
          status: s.status,
          note: s.note ?? s.lastError,
        }))}
      />
      <TrendsView
      locale={viewer.locale ?? "zh-CN"}
      region="HK"
      activeCategories={active}
      categories={CATEGORIES}
      sources={sources.map((s) => ({
        key: s.key,
        name: s.name,
        kind: s.kind,
        status: s.status,
        note: s.note ?? s.lastError,
      }))}
      topics={topics.map((t) => ({
        id: t.id,
        name: (viewer.locale ?? "zh-CN").startsWith("zh") && t.nameLocal ? t.nameLocal : t.name,
        category: t.category,
        summary: t.summary,
        angles: t.angles,
        flagged: t.flagged,
        flagReason: t.flagReason,
        heat: t.heat,
        change: t.change14d,
        rising: t.rising,
        status: t.status,
        points: t.points,
        sourceKeys: t.sourceKeys,
        freshness: t.freshness ? t.freshness.toISOString() : null,
        articles: [],
      }))}
      />
    </>
  );
}
