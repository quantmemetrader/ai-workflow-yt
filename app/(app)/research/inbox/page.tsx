import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { InboxView } from "@/components/research/InboxView";
import { connectedSources, decisionCount } from "@/lib/research/service";
import { connectionState, inbox, inboxSummary, type InboxFilters } from "@/lib/social/service";
import { isSentiment, priorCommentCounts } from "@/lib/social/service";

export const metadata = { title: "评论收件箱 · Comment inbox" };

/**
 * Comment inbox (spec §4.3).
 *
 * Comments on the studio's own posts, read through the OAuth grants the studio
 * gave Zernio. Replies go back out the same way, and only after a named person
 * has approved one: see `app/(app)/research/inbox-actions.ts`, where that rule
 * is kept in three places rather than one.
 *
 * This screen used to say the studio needed a YouTube comment API key and that
 * TikTok had no comment interface at all. The first was already in hand and
 * the second is not true of the route we take, so both claims are gone.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireModule("research");
  const params = await searchParams;

  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" && v ? v : undefined;
  };

  const filters: InboxFilters = {
    // Validated here as well as in the query: `performance/page.tsx` already
    // does this for `window`, and this is the same class of input.
    sentiment: isSentiment(one("sentiment")) ? one("sentiment") : undefined,
    language: one("language"),
    flagged: one("flagged") === "1" || undefined,
    leads: one("leads") === "1" || undefined,
  };

  const [groups, summary, state, sources, decisions] = await Promise.all([
    inbox(viewer, filters),
    inboxSummary(viewer),
    connectionState(viewer),
    connectedSources(),
    decisionCount(viewer),
  ]);

  /*
   * "14 prior comments" on the artboard, in one query rather than one per
   * commenter (REVIEW.md #13).
   */
  const priorCounts = await priorCommentCounts(
    viewer,
    groups.flatMap((g) => g.comments).map((c) => ({ id: c.id, authorHandle: c.authorHandle })),
  );

  return (
    <>
      <ResearchSidebar
        locale={viewer.locale ?? "zh-CN"}
        decisionCount={decisions}
        inboxCount={summary.open}
        sources={sources.map((s) => ({
          key: s.key,
          name: s.name,
          kind: s.kind,
          status: s.status,
          note: s.note ?? s.lastError,
        }))}
      />
      <InboxView
        locale={viewer.locale ?? "zh-CN"}
        groups={groups}
        summary={summary}
        channelCount={state.channels.length}
        syncedAt={state.syncedAt}
        priorCounts={priorCounts}
        model={answeringModel()}
      />
    </>
  );
}
