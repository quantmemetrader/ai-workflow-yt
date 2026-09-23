"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CompareScreen, type Series } from "@/components/canvas/CompareScreen";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { writeCollecting } from "@/lib/client/collecting";
import { addSeriesAction, exportComparisonAction } from "@/app/(app)/research/actions";
import { notify } from "@/lib/client/notify";

/** The artboard's series colours, in its own order. */
const COLOURS = ["#007be0", "#383838", "#8d99a6", "#c7c7c7", "#278f5e"];

/**
 * Live wiring for Search & compare.
 *
 * A phrase nobody has looked at before has no data yet: adding it queues a
 * fetch and the chip says "collecting" until the worker has been round the
 * sources. The screen polls for those, and stops as soon as everything has
 * landed — there is nothing to poll for on a screen of cached series.
 */
export function CompareView({
  initialSeries,
  queries,
  window,
  region,
  sourceCount,
  locale,
  model,
  watched,
  trending,
}: {
  initialSeries: Series[];
  queries: string[];
  window: "1m" | "3m" | "6m";
  region: string;
  sourceCount: number;
  locale: string;
  model: string;
  /** Phrases the studio already collects, so nobody retypes one. */
  watched: { phrase: string; label: string; collecting: boolean }[];
  /** What the region is searching for today. */
  trending: { phrase: string; traffic: string | null; headline: string | null }[];
}) {
  const router = useRouter();
  /* The agent answers here. Asking used to push to /chat, which took the
   * screen you were asking about off the screen. */
  const agent = useInlineAgent({ module: "research" });
  const params = useSearchParams();
  const [exporting, startExport] = useTransition();
  const [, startAdd] = useTransition();

  /*
   * The server render is the source of truth; polling only supplies newer
   * copies of it while something is being collected. Adjusting during render
   * (rather than in an effect) is React's own pattern for "throw away derived
   * state when the prop it derives from changes" — it avoids the extra render
   * pass an effect would cost on every navigation.
   */
  const [polled, setPolled] = useState<Series[] | null>(null);
  const [seenInitial, setSeenInitial] = useState(initialSeries);
  if (seenInitial !== initialSeries) {
    setSeenInitial(initialSeries);
    setPolled(null);
  }
  const series = polled ?? initialSeries;

  const setQuery = useCallback(
    (next: { queries?: string[]; window?: string }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.queries) sp.set("q", next.queries.join("|"));
      if (next.window) sp.set("window", next.window);
      router.replace(`/research/compare?${sp.toString()}`);
    },
    [params, router],
  );

  /*
   * Hand what is still being collected to the shell, so it outlives this page.
   *
   * The work was never the thing that stopped when you navigated away: the
   * worker holds the job either way. What stopped was anyone being able to see
   * it, because the "collecting" chip was this component's state and the
   * phrases were only in the URL. The shell's toast picks both up from here and
   * carries on polling wherever you go.
   */
  const pending = series.some((s) => s.pending);
  useEffect(() => {
    if (pending) writeCollecting({ queries, window });
    else writeCollecting(null);
  }, [pending, queries, window]);

  // Poll only while something is still being collected.
  useEffect(() => {
    if (!pending) return;

    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/research/series?q=${encodeURIComponent(queries.join("|"))}&window=${window}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { series: Omit<Series, "colour">[] };
        setPolled(data.series.map((s, i) => ({ ...s, colour: COLOURS[i % COLOURS.length] })));
      } catch {
        // A dropped poll is not worth reporting; the next one runs.
      }
    }, 6000);

    return () => clearInterval(id);
  }, [pending, queries, window]);

  return (
    <CompareScreen
      series={series}
      suggestions={[
        ...watched.map((w) => ({
          phrase: w.phrase,
          kind: "watched" as const,
          hint: w.collecting ? (locale.startsWith("zh") ? "收集中" : "collecting") : undefined,
          // The display name when it differs from the phrase that is searched:
          // a topic called "Nvidia earnings" searched as "nvidia earnings Q3".
          note: w.label !== w.phrase ? w.label : null,
        })),
        ...trending
          .filter((x) => !watched.some((w) => w.phrase.toLowerCase() === x.phrase.toLowerCase()))
          .map((x) => ({
            phrase: x.phrase,
            kind: "trending" as const,
            hint: x.traffic,
            note: x.headline,
          })),
      ]}
      window={window}
      region={region}
      sourceCount={sourceCount}
      exporting={exporting}
      locale={locale}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={locale.startsWith("zh")}
        />
      }
      onAddSeries={(query) => {
        const next = [...queries, query].slice(0, 5);
        startAdd(async () => {
          await addSeriesAction(query, window);
          setQuery({ queries: next });
        });
      }}
      onRemoveSeries={(query) => setQuery({ queries: queries.filter((q) => q !== query) })}
      onWindowChange={(w) => setQuery({ window: w })}
      onExport={() =>
        startExport(async () => {
          const res = await exportComparisonAction(queries, window, region);
          if (res.error) notify(res.error);
          else if (res.fileId) router.push(`/files/${res.fileId}`);
        })
      }
    />
  );
}
