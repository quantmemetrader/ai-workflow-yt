import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { listAccounts, listDocuments, listEntries, listHiddenAccounts, listPeriodStatuses, periodCloseView, periodSummary } from "@/lib/accounting/service";
import { ACCOUNTING_CURRENCY, hkMonth, isPeriod } from "@/lib/accounting/close";
import { AccountingScreen } from "@/components/accounting/AccountingScreen";
import { libraryFiles, LIBRARIES } from "@/lib/files/module-library";
import { ModuleLibrary } from "@/components/library/ModuleLibrary";
import { mayTrain } from "@/lib/agents/training";

export const metadata = { title: "账务" };

/** Accounting (spec §4.7). Manual: nothing is read off a document, and nothing
 * posts without a confirmation. */
export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const viewer = await requireModule("accounting");
  /* (4 Oct) 账目 shows any month (?month=YYYY-MM), by default this month on
     Hong Kong's clock — not UTC's, which is still last month until 08:00 HKT
     on the 1st. 月结 opens on this month either way. */
  const thisMonth = hkMonth();
  const asked = (await searchParams)?.month;
  const period = typeof asked === "string" && isPeriod(asked) ? asked : thisMonth;

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lib = await libraryFiles(viewer, "accounting");
  const [accounts, hiddenAccounts, documents, entries, summary, months, close] = await Promise.all([
    listAccounts(viewer),
    listHiddenAccounts(viewer),
    listDocuments(viewer),
    listEntries(viewer, period),
    periodSummary(viewer, period),
    listPeriodStatuses(viewer),
    periodCloseView(viewer, thisMonth),
  ]);

  return (
    <AccountingScreen
      period={period}
      thisMonth={thisMonth}
      currency={ACCOUNTING_CURRENCY}
      accounts={accounts}
      hiddenAccounts={hiddenAccounts}
      documents={documents}
      entries={entries}
      summary={summary}
      months={months}
      close={close}
      canClose={viewer.isAdmin}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      library={<ModuleLibrary module="accounting" title={zh ? LIBRARIES.accounting.zh : LIBRARIES.accounting.en} agentName={zh ? "账务" : "the accounting assistant"} zh={zh} folderId={lib.folderId} files={lib.files} canTrain={mayTrain(viewer)} />}
    />
  );
}
