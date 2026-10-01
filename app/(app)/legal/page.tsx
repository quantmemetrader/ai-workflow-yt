import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { libraryFiles, LIBRARIES } from "@/lib/files/module-library";
import { ModuleLibrary } from "@/components/library/ModuleLibrary";
import { mayTrain } from "@/lib/agents/training";
import { listChecklists, listContracts, listRuns, listTemplates } from "@/lib/legal/service";
import { LegalScreen } from "@/components/legal/LegalScreen";

export const metadata = { title: "法务" };

/** Legal (spec §4.10). Drafting and comparison, never a verdict; the
 * non-advice notice (contract 8.4) is on every tab. */
export default async function LegalPage() {
  const viewer = await requireModule("legal");

  const [templates, contracts, checklists, runs] = await Promise.all([
    listTemplates(viewer),
    listContracts(viewer),
    listChecklists(viewer),
    listRuns(viewer),
  ]);

  const lib = await libraryFiles(viewer, "legal");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return (
    <LegalScreen
      library={<ModuleLibrary module="legal" title={zh ? LIBRARIES.legal.zh : LIBRARIES.legal.en} agentName={zh ? "法务" : "the legal assistant"} zh={zh} folderId={lib.folderId} files={lib.files} canTrain={mayTrain(viewer)} />}
      templates={templates}
      contracts={contracts}
      checklists={checklists}
      runs={runs}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
}
