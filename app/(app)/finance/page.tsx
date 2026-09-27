import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import {
  budgetVsActual,
  cashSeries,
  listActuals,
  listCentres,
  listSpend,
  thresholds,
} from "@/lib/finance/service";
import { FinanceScreen } from "@/components/finance/FinanceScreen";
import { listReports } from "@/lib/finance/reports";
import { apiBalances } from "@/lib/finance/providers";

export const metadata = { title: "财务 · Finance" };

/**
 * Finance (spec §4.9).
 *
 * The period is the month we are in. It is not in the URL yet because there is
 * one place to change it and nowhere to link to, and a searchParam that only
 * one control writes is a searchParam to add when something else needs it.
 */
export default async function FinancePage() {
  const viewer = await requireModule("finance");
  const period = new Date().toISOString().slice(0, 7);

  const [centres, budget, actuals, spend, cash, limits, reports, balances] = await Promise.all([
    listCentres(viewer),
    budgetVsActual(viewer, period),
    listActuals(viewer, period),
    listSpend(viewer),
    cashSeries(viewer),
    thresholds(viewer),
    listReports(viewer),
    /* Never holds the page up: a provider that does not answer is a row that says so. */
    apiBalances(viewer).catch(() => null),
  ]);

  return (
    <FinanceScreen
      period={period}
      reports={reports}
      balances={balances}
      centres={centres}
      budget={budget}
      actuals={actuals}
      spend={spend}
      cash={cash}
      thresholds={limits}
      viewerId={viewer.id}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
}
