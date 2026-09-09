import { ModuleStub } from "@/components/ModuleStub";

export default function AccountingPage() {
  return (
    <ModuleStub
      title="Accounting"
      spec="Build-Spec §4.7"
      summary="A bookkeeping assistant, not a ledger of record. OCR and field extraction produce drafts; nothing posts anywhere without human confirmation."
      screens={["Document inbox", "Draft entries", "Period summary", "Export"]}
    />
  );
}
