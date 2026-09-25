import { requireModule } from "@/lib/auth/dal";
import { connectedSources, decisionCount, rankedTopics } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { TrendsView } from "@/components/research/TrendsView";
import { listCompetitors, ourMedianViews } from "@/lib/social/service";
import { env } from "@/lib/env";
import { answeringModel } from "@/lib/ai/models";
import { storedHot } from "@/lib/research/platforms";
import { onFocus } from "@/lib/research/platform-catalog";
import { latestDigest } from "@/lib/home/pulse";
import { ownPicksToday } from "@/lib/research/own-picks";
import { evidenceNumbers, type Evidence } from "@/lib/research/signals";
import { proposalsFor } from "@/lib/agents/proposals";
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

  /* The stored Google and YouTube lists (see below), read alongside the rest
     rather than after it: two database reads, never a live one. */
  const storedLists = Promise.all([storedHot("google").catch(() => null), storedHot("youtube").catch(() => null)]);
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
   * What Hong Kong is searching for and watching, for the topic picker to
   * suggest and the live strip's first tab.
   *
   * From storage, the lists the hourly collector read and marked business /
   * tech / other — not Google's feed and YouTube's chart read live on every
   * render, which were the noisiest lists on the page and, being unmarked,
   * could not be filtered. Storage only, never a live read: a render does
   * not wait on a platform or a model. Never allowed to fail the page.
   *
   * The suggestions are the searches on the beat; a list nobody has marked
   * yet (before the first collection with the classifier) is passed whole.
   * The strip's own "show everything" switch reads the full list from
   * `/api/research/hot`, so nothing is lost by filtering here.
   */
  const zhPage = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [google, youtube] = await storedLists;
  const googleRel = google?.relevance ?? null;
  const trending = (google?.rows ?? [])
    .filter((r) => !googleRel || onFocus(googleRel[r.phrase]))
    .slice(0, 14)
    .map((r) => {
      // The collector writes "TW · headline" for a row topped up from elsewhere.
      const from = /^([A-Z]{2}) · ([\s\S]*)$/.exec(r.extra ?? "");
      return { phrase: r.phrase, traffic: r.heatLabel, headline: (from ? from[2] : r.extra) || null, region: from ? from[1] : "HK" };
    });
  const youtubeRel = youtube?.relevance ?? null;
  const watched = {
    videos: (youtube?.rows ?? []).map((r) => ({
      id: /[?&]v=([\w-]+)/.exec(r.url ?? "")?.[1] ?? r.phrase,
      title: r.phrase,
      channelTitle: r.extra ?? "",
      thumbnail: r.thumbnail,
      views: r.heat ?? 0,
      rel: youtubeRel?.[r.phrase] ?? null,
    })),
    note: youtube?.rows.length
      ? null
      : (youtube?.note ?? (zhPage ? "YouTube 的榜单还没收集到，整点收集后会出现在这里。" : "YouTube's chart has not been collected yet; it appears after the next hourly collection.")),
  };

  const backlogCount = topics.filter((t) => t.status === "adopted").length;
  /* 研究员's pick this morning, so the page opens on a conclusion rather
     than a chart. */
  const [digest, proposals] = await Promise.all([latestDigest(viewer.tenantId), proposalsFor(viewer, "script")]);
  /* The morning's pick first, then what 策划 put on today's plan, three at
     most, no repeats. */
  const picks: { text: string; why: string | null; source: "digest" | "plan" | "backlog" | "audience" | "mine"; thumbnail: string | null; url?: string | null; evidence?: string[]; strength?: number; sources?: { label: string; title: string; url: string | null; numbers: string }[] }[] = [];
  /* Since the daily signal: the one or two signals, each with its evidence
     rows' own numbers and the cover of the video that proves it. Nothing
     else is added, because one strong topic is the point. */
  if (digest?.signals.length) {
    for (const s of digest.signals.slice(0, 2)) {
      const lead = s.evidence.find((e) => e.thumbnail) ?? null;
      picks.push({
        text: s.title,
        why: s.whyNow.replace(/（证据\d+）|\[[A-Z]\d{1,2}\]/g, "").trim() || null,
        source: "digest",
        thumbnail: lead?.thumbnail ?? null,
        url: lead?.url ?? s.evidence[0]?.url ?? null,
        evidence: s.evidence.slice(0, 3).map((e) => `${e.source.replace(/（.*?）/, "")} · ${evidenceNumbers(e as unknown as Evidence)}`),
        sources: s.evidence.slice(0, 5).map((e) => ({
          label: e.source.replace(/（.*?）/, ""),
          title: e.phrase.slice(0, 50),
          url: e.url,
          numbers: evidenceNumbers(e as unknown as Evidence).split(" · ").slice(0, 2).join(" · "),
        })),
        strength: s.strength,
      });
    }
  } else if (digest?.topic) picks.push({ text: digest.topic, why: digest.why, source: "digest", thumbnail: null });
  for (const p of digest?.signals.length ? [] : proposals.items) {
    if (picks.length >= 3) break;
    if (picks.some((x) => x.text === p.text || (digest?.topic && p.text.includes(digest.topic)))) continue;
    picks.push({ text: p.text, why: p.why, source: p.source, thumbnail: null });
  }
  /* And what people added themselves today, after the researcher's. */
  for (const o of await ownPicksToday(viewer.tenantId)) {
    if (picks.some((x) => x.text === o.text)) continue;
    picks.push({ text: o.text, why: null, source: "mine", thumbnail: null, url: null, by: o.by } as (typeof picks)[number]);
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
      trending={trending}
      watching={watched.videos}
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
