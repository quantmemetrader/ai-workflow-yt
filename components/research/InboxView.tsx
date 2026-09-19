"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InboxScreen } from "@/components/canvas/InboxScreen";
import type { InboxGroup } from "@/lib/social/service";
import {
  approveReplyAction,
  bulkModerateAction,
  editDraftAction,
  moderateCommentAction,
  regenerateDraftAction,
  syncNowAction,
} from "@/app/(app)/research/inbox-actions";

/**
 * Live wiring for the Comment inbox.
 *
 * Filters live in the URL rather than in state, so a filtered inbox is a link
 * someone can send to the person who should answer it, and the back button
 * does what it looks like it does.
 *
 * Errors surface in the screen rather than in an `alert()`: half of them are a
 * platform's own words about why a reply was refused, and those are worth
 * reading rather than dismissing.
 */
export function InboxView({
  groups,
  summary,
  channelCount,
  syncedAt,
  priorCounts,
  locale,
  model,
}: {
  groups: InboxGroup[];
  summary: { sentiment: Record<string, number>; language: Record<string, number>; open: number; unclassified: number };
  channelCount: number;
  syncedAt: Date | null;
  /** How many earlier comments each commenter has left, keyed by comment id. */
  priorCounts: Record<string, number>;
  locale: string;
  /** The model the right-hand panel names under its composer. */
  model: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, start] = useTransition();

  const [selectedId, setSelectedId] = useState<string | null>(() => groups[0]?.comments[0]?.id ?? null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  type Filters = { sentiment?: string; language?: string; flagged?: boolean; leads?: boolean };

  const filters = useMemo<Filters>(
    () => ({
      sentiment: params.get("sentiment") ?? undefined,
      language: params.get("language") ?? undefined,
      flagged: params.get("flagged") === "1" || undefined,
      leads: params.get("leads") === "1" || undefined,
    }),
    [params],
  );

  const setFilters = useCallback(
    (next: Filters) => {
      const q = new URLSearchParams();
      if (next.sentiment) q.set("sentiment", next.sentiment);
      if (next.language) q.set("language", next.language);
      if (next.flagged) q.set("flagged", "1");
      if (next.leads) q.set("leads", "1");
      const s = q.toString();
      router.push(s ? `/research/inbox?${s}` : "/research/inbox");
    },
    [router],
  );

  /** Runs one action, keeping the screen honest about what is in flight and
   * what came back. `id` is whatever the screen is showing as busy. */
  const run = useCallback(
    (id: string, work: () => Promise<{ error?: string } | { ok?: unknown }>) => {
      setPending(id);
      setError(null);
      start(async () => {
        try {
          const res = await work();
          if ("error" in res && res.error) setError(res.error);
          else router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setPending(null);
        }
      });
    },
    [router],
  );

  return (
    <InboxScreen
      locale={locale}
      groups={groups}
      summary={summary}
      channelCount={channelCount}
      syncedAt={syncedAt}
      selectedId={selectedId}
      priorCount={selectedId ? (priorCounts[selectedId] ?? 0) : 0}
      filters={filters}
      selected={selected}
      pending={pending}
      error={error}
      onSelect={(id) => {
        setSelectedId(id);
        setError(null);
      }}
      onToggleSelect={(id) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      }
      onFilter={setFilters}
      onApprove={(draftId, body) => run(draftId, () => approveReplyAction(draftId, body))}
      onSaveEdit={(draftId, body) => run(draftId, () => editDraftAction(draftId, body))}
      onRegenerate={(commentId, steer) => run(commentId, () => regenerateDraftAction(commentId, steer))}
      onModerate={(commentId, action) => run(commentId, () => moderateCommentAction(commentId, action))}
      onBulk={(action) =>
        run("bulk", async () => {
          const res = await bulkModerateAction(selected, action);
          setSelected([]);
          // A partial failure is reported as one: the platforms have no bulk
          // endpoint, so some of a selection can succeed while the rest do not.
          if ("failed" in res && res.failed) {
            return { error: `${res.ok} done, ${res.failed} refused. ${res.firstError ?? ""}`.trim() };
          }
          return res;
        })
      }
      onSyncNow={() => run("sync", syncNowAction)}
      model={model}
      onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
    />
  );
}
