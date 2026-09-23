"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PerfScreen } from "@/components/canvas/PerfScreen";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import type { ChannelRow, PerformanceRow, Window } from "@/lib/social/service";
import { syncNowAction } from "@/app/(app)/research/inbox-actions";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";

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
  totals: {
    posts: number;
    views: number;
    viewsInWindow: number;
    likes: number;
    comments: number;
    engagementRate: number | null;
  };
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
  /* The agent answers here. Asking used to push to /chat, which took the
   * screen you were asking about off the screen. */
  const agent = useInlineAgent({ module: "research" }, { key: "research:performance" });
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
      /* "Check now" used to discard the action's `{ error }` entirely, so a
         refused sync looked exactly like a successful one (REVIEW.md #15).
         `InboxView` has always handled the same action correctly. */
      onSyncNow={() =>
        start(async () => {
          const done = beginWork();
          try {
            const res = await syncNowAction();
            if (res && "error" in res && res.error) {
              notify(res.error);
              return;
            }
            notify(
              locale.startsWith("zh") ? "已排入队列，稍后刷新。" : "Queued. The numbers refresh when it lands.",
              "ok",
            );
            router.refresh();
          } finally {
            done();
          }
        })
      }
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      tools={<AgentHistory zh={locale.startsWith("zh")} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={locale.startsWith("zh")}
        />
      }
    />
  );
}
