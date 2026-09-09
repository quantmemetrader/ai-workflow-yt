import { ModuleStub } from "@/components/ModuleStub";

export default function AdminPage() {
  return (
    <ModuleStub
      title="Admin"
      spec="Build-Spec Section 4.11"
      summary="Gated. Accounts, entitlements, token spend, channel credentials, audit log, and the knowledge-and-skills area the client uses to tune agent behaviour without us."
      screens={[
        "People",
        "Entitlements matrix",
        "Token dashboard",
        "Budgets",
        "Channels and credentials",
        "Audit log",
        "Knowledge and skills area",
      ]}
    />
  );
}
