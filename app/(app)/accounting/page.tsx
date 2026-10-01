import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { listAccounts, listDocuments, listEntries, periodSummary } from "@/lib/accounting/service";
import { AccountingScreen } from "@/components/accounting/AccountingScreen";
import { libraryFiles, LIBRARIES } from "@/lib/files/module-library";
import { ModuleLibrary } from "@/components/library/ModuleLibrary";
import { mayTrain } from "@/lib/agents/training";

export const metadata = { title: "账务" };

/** Accounting (spec §4.7). Manual: nothing is read off a document, and nothing
 * posts without a confirmation. */
export default async function AccountingPage() {
  const viewer = await requireModule("accounting");
  const period = new Date().toISOString().slice(0, 7);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lib = await libraryFiles(viewer, "accounting");
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
      library={<ModuleLibrary module="accounting" title={zh ? LIBRARIES.accounting.zh : LIBRARIES.accounting.en} agentName={zh ? "账务" : "the accounting assistant"} zh={zh} folderId={lib.folderId} files={lib.files} canTrain={mayTrain(viewer)} />}
    />
  );
}
