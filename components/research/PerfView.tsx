"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PerfScreen } from "@/components/canvas/PerfScreen";
import type { ChannelRow, PerformanceRow, Window } from "@/lib/social/service";
import { syncNowAction } from "@/app/(app)/research/inbox-actions";

/**
 * Live wiring for Content performance.
 *
 * Window and platform live in the URL — a chart of the last 90 days on YouTube
 * is a thing one person sends another. Sorting stays local, because it is a
 * way of looking rather than a thing to share.
 */
export function PerfView({
  rows,
  totals,
  series,
  window,
  platform,
  channels,
  syncedAt,
  locale,
  model,
}: {
  rows: PerformanceRow[];
  totals: { posts: number; views: number; likes: number; comments: number; engagementRate: number | null };
  series: { d: string; v: number }[];
  window: Window;
  platform: string | null;
  channels: ChannelRow[];
  syncedAt: Date | null;
  locale: string;
  /** The model the right-hand panel names under its composer. */
  model: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, start] = useTransition();
  const [sort, setSort] = useState<{ key: "views" | "likes" | "comments" | "engagementRate" | "publishedAt"; dir: "asc" | "desc" }>({
    key: "views",
    dir: "desc",
  });

  const push = useCallback(
    (next: { window?: Window; platform?: string | null }) => {
      const q = new URLSearchParams(params.toString());
      if (next.window) q.set("window", next.window);
      if (next.platform === null) q.delete("platform");
      else if (next.platform !== undefined) q.set("platform", next.platform);
      const s = q.toString();
      router.push(s ? `/research/performance?${s}` : "/research/performance");
    },
    [params, router],
  );

  /** Sorted here rather than in SQL: the rows are already in memory and
   * capped, and a re-query per column click would be a round trip to
   * Singapore for something the browser can do instantly. */
  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "publishedAt") {
        return ((a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0)) * dir;
      }
      // Nulls sort last whichever way the column is pointing: "not reported"
      // is not the smallest number, it is the absence of one.
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  return (
    <PerfScreen
      locale={locale}
      rows={sorted}
      totals={totals}
      series={series}
      window={window}
      platform={platform}
      channels={channels}
      syncedAt={syncedAt}
      sort={sort}
      pending={isPending}
      onWindow={(w) => push({ window: w })}
      onPlatform={(p) => push({ platform: p })}
      onSort={(key) => setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }))}
      onSyncNow={() => start(async () => { await syncNowAction(); router.refresh(); })}
      model={model}
      onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
    />
  );
}
