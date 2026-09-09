import { ModuleStub } from "@/components/ModuleStub";

export default function LegalPage() {
  return (
    <ModuleStub
      title="Legal"
      spec="Build-Spec §4.9"
      summary="Document drafting from client templates, clause review against configured positions (marked-up view plus summary — never a verdict), contract repository, compliance checklists. Carries a standing no-legal-advice disclaimer (Clause 8.4)."
      screens={[
        "Document drafting",
        "Clause review",
        "Contract repository",
        "Compliance checklists",
      ]}
    />
  );
}
