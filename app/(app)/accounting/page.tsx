import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { listAccounts, listDocuments, listEntries, periodSummary } from "@/lib/accounting/service";
import { AccountingScreen } from "@/components/accounting/AccountingScreen";

export const metadata = { title: "会计 · Accounting" };

/** Accounting (spec §4.7). Manual: nothing is read off a document, and nothing
 * posts without a confirmation. */
export default async function AccountingPage() {
  const viewer = await requireModule("accounting");
  const period = new Date().toISOString().slice(0, 7);

  const [accounts, documents, entries, summary] = await Promise.all([
    listAccounts(viewer),
    listDocuments(viewer),
    listEntries(viewer, period),
    periodSummary(viewer, period),
  ]);

  return (
    <AccountingScreen
      period={period}
      accounts={accounts}
      documents={documents}
      entries={entries}
      summary={summary}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
}
