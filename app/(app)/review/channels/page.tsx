import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { PerfView } from "@/components/research/PerfView";
import {
  DEFAULT_WINDOW,
  connectionState,
  performance,
  performanceTotals,
  viewsSeries,
  type Window,
} from "@/lib/social/service";

export const metadata = { title: "已连接渠道" };

/**
 * Connected channels' performance (spec §4.3), moved out of trend research
 * into 作品复盘 (28 Sep: the review comes after publishing, not inside research).
 *
 * The studio's own videos, with views, engagement and comment counts, from the
 * accounts it connected to Zernio. Defaults to the last 28 days because the
 * brief says so, and every chart states its range and its source.
 */
function isWindow(v: unknown): v is Window {
  return v === "7d" || v === "28d" || v === "90d";
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireModule("research");
  const params = await searchParams;

  const raw = params.window;
  const window: Window = isWindow(raw) ? raw : DEFAULT_WINDOW;
  const platform = typeof params.platform === "string" && params.platform ? params.platform : null;
  const opts = { window, platform: platform ?? undefined };

  const [rows, totals, series, state] = await Promise.all([
    performance(viewer, opts),
    performanceTotals(viewer, opts),
    viewsSeries(viewer, opts),
    connectionState(viewer),
  ]);

  return (
    <>
      <PerfView
        locale={viewer.locale ?? "zh-CN"}
        rows={rows}
        totals={totals}
        series={series}
        window={window}
        platform={platform}
        channels={state.channels}
        syncedAt={state.syncedAt}
        model={answeringModel()}
      />
    </>
  );
}
