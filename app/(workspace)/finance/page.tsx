import { ModuleStub } from "@/components/ModuleStub";

export default function FinancePage() {
  return (
    <ModuleStub
      title="Finance"
      spec="Build-Spec §4.8"
      summary="Budgets against client-supplied templates, cash-flow projection, cost dashboard (including AI spend from the token ledger), and spend requests through a configurable approver chain."
      screens={[
        "Budget",
        "Cash-flow projection",
        "Cost dashboard",
        "Spend requests",
        "Report drafts",
      ]}
    />
  );
}
