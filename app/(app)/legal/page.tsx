import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { NON_ADVICE, listChecklists, listContracts, listRuns, listTemplates } from "@/lib/legal/service";
import { LegalScreen } from "@/components/legal/LegalScreen";

export const metadata = { title: "法务 · Legal" };

/** Legal (spec §4.10). Drafting and comparison, never a verdict; the
 * non-advice notice (contract 8.4) is on every tab. */
export default async function LegalPage() {
  const viewer = await requireModule("legal");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  const [templates, contracts, checklists, runs] = await Promise.all([
    listTemplates(viewer),
    listContracts(viewer),
    listChecklists(viewer),
    listRuns(viewer),
  ]);

  return (
    <LegalScreen
      templates={templates}
      contracts={contracts}
      checklists={checklists}
      runs={runs}
      nonAdvice={zh ? NON_ADVICE.zh : NON_ADVICE.en}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
}
