import { requireModule } from "@/lib/auth/dal";
import { connectedSources, decisionCount, rankedTopics } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { TrendsView } from "@/components/research/TrendsView";
import { listCompetitors, ourMedianViews } from "@/lib/social/service";
import { env } from "@/lib/env";
import { answeringModel } from "@/lib/ai/models";
import { trendingNearby } from "@/lib/research/trending";
import { latestDigest } from "@/lib/home/pulse";
import { proposalsFor } from "@/lib/agents/proposals";
import { trendingVideos } from "@/lib/research/youtube";
import { creatorMemoryState } from "@/lib/creator/service";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const metadata = { title: "选题研究 · Trends" };

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

  const [topics, sources, decisions, open, competitors, ourMedian, creator, syncJobs] = await Promise.all([
    /*
     * Every topic, not the filtered ones.
     *
     * The board filtered on the server *and* again in the screen, and the
     * beats panel counted its rows from the already-filtered list — so
     * choosing a beat made every other beat read "0 topics" and, if nothing
     * matched, emptied the board with no explanation. The beats are a filter
     * over what is here; the screen applies them, and the counts are over all
     * of it.
     */
    rankedTopics(viewer),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
    // The channels the studio watches from the outside, and its own median to
    // compare them with. This is what the TikHub key is for.
    listCompetitors(viewer),
    ourMedianViews(viewer),
    // The creator's own channel, as the assistant's memory of it.
    creatorMemoryState(viewer.tenantId),
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.tenantId, viewer.tenantId), eq(jobs.type, "creator.sync"), inArray(jobs.status, ["queued", "running"])))
      .limit(1),
  ]);

  /*
   * What Hong Kong is searching for today, for the topic picker to suggest.
   *
   * Outside the `Promise.all` and never allowed to fail the page: it is a list
   * of suggestions, and a dashboard that will not render because Google was
   * slow is worse than a dashboard with no suggestions. Cached for half an
   * hour inside `trendingSearches`, so this is free on most renders.
   */
  const [trending, watched] = await Promise.all([
    /* Topped up from the markets the studio also posts into when Hong Kong's
       own feed is thin — each row says where it came from. */
    trendingNearby("HK", 14).catch(() => []),
    /*
     * And what Hong Kong is *watching*, from YouTube's own chart. One unit of
     * quota, cached twenty minutes, and never allowed to fail the page: the
     * strip explains itself when the key is missing or the quota is spent.
     */
    trendingVideos("HK", 20).then(
      (videos) => ({ videos, note: null as string | null }),
      (err: unknown) => ({
        videos: [] as Awaited<ReturnType<typeof trendingVideos>>,
        note: err instanceof Error ? err.message : "YouTube could not be reached.",
      }),
    ),
  ]);

  const backlogCount = topics.filter((t) => t.status === "adopted").length;
  /* 研究员's pick this morning, so the page opens on a conclusion rather
     than a chart. */
  const [digest, proposals] = await Promise.all([latestDigest(viewer.tenantId), proposalsFor(viewer, "script")]);
  /* The morning's pick first, then what 策划 put on today's plan, three at
     most, no repeats. */
  const picks: { text: string; why: string | null; source: "digest" | "plan" | "backlog" | "audience"; thumbnail: string | null }[] = [];
  if (digest?.topic) picks.push({ text: digest.topic, why: digest.why, source: "digest", thumbnail: null });
  for (const p of proposals.items) {
    if (picks.length >= 3) break;
    if (picks.some((x) => x.text === p.text || (digest?.topic && p.text.includes(digest.topic)))) continue;
    picks.push({ text: p.text, why: p.why, source: p.source, thumbnail: null });
  }
  /* No pictures on picks. A pick is a topic to shoot, not a clip that
     exists; matching one to an old video's thumbnail put the same face on
     every row and implied the footage was already there. */

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
      digest={digest}
      picks={picks}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      trending={trending.map((x) => ({ phrase: x.phrase, traffic: x.traffic, headline: x.headline, region: x.region }))}
      watching={watched.videos.map((v) => ({
        id: v.id,
        title: v.title,
        channelTitle: v.channelTitle,
        thumbnail: v.thumbnail,
        views: v.views,
      }))}
      watchingNote={watched.note}
      creator={creator}
      creatorSyncing={syncJobs.length > 0}
      canWriteScripts={viewer.modules.includes("script")}
      canAdmin={viewer.modules.includes("admin")}
      region="HK"
      competitors={competitors}
      ourMedian={ourMedian}
      tikhubConfigured={env.tikhub.configured}
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
        // Was hardcoded to an empty list while the fetch was storing forty of
        // them, so the dashboard's articles panel was always blank.
        articles: t.articles,
        collecting: t.collecting,
        error: t.error,
      }))}
      />
    </>
  );
}
