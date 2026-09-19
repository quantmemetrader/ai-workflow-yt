"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CompareScreen, type Series } from "@/components/canvas/CompareScreen";
import { addSeriesAction, exportComparisonAction } from "@/app/(app)/research/actions";

/** The artboard's series colours, in its own order. */
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
}: {
  initialSeries: Series[];
  queries: string[];
  window: "1m" | "3m" | "6m";
  region: string;
  sourceCount: number;
  locale: string;
  model: string;
}) {
  const router = useRouter();
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

  // Poll only while something is still being collected.
  useEffect(() => {
    if (!series.some((s) => s.pending)) return;

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
  }, [series, queries, window]);

  return (
    <CompareScreen
      series={series}
      window={window}
      region={region}
      sourceCount={sourceCount}
      exporting={exporting}
      locale={locale}
      model={model}
      onAsk={(prompt) => router.push(`/chat?q=${encodeURIComponent(prompt)}`)}
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
          if (res.error) window_alert(res.error);
          else if (res.fileId) router.push(`/files/${res.fileId}`);
        })
      }
    />
  );
}

/** Named so it does not shadow the `window` prop above. */
function window_alert(message: string) {
  globalThis.alert(message);
}
