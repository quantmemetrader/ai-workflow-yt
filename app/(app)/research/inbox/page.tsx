import { requireModule } from "@/lib/auth/dal";
import { modelFor } from "@/lib/ai/models";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { InboxView } from "@/components/research/InboxView";
import { connectedSources, decisionCount } from "@/lib/research/service";
import { connectionState, inbox, inboxSummary, priorComments, type InboxFilters } from "@/lib/social/service";

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
    sentiment: one("sentiment"),
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

  // "14 prior comments" on the artboard. Counted per distinct commenter rather
  // than per comment, so a post with forty comments from four people is four
  // queries, not forty.
  const priorCounts: Record<string, number> = {};
  const flat = groups.flatMap((g) => g.comments);
  const byAuthor = new Map<string, string[]>();
  for (const c of flat) {
    if (!c.authorHandle) continue;
    byAuthor.set(c.authorHandle, [...(byAuthor.get(c.authorHandle) ?? []), c.id]);
  }
  await Promise.all(
    [...byAuthor.entries()].map(async ([, ids]) => {
      const detail = flat.find((c) => c.id === ids[0]);
      if (!detail) return;
      const n = await priorComments(viewer, detail.authorHandle, detail.id);
      for (const id of ids) priorCounts[id] = n;
    }),
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
        model={modelFor.assistant()}
      />
    </>
  );
}
