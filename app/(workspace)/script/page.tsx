import { ModuleStub } from "@/components/ModuleStub";

export default function ScriptPage() {
  return (
    <ModuleStub
      title="Script"
      spec="Build-Spec §4.4"
      summary="Brief intake, split editor with house-style conformance, version history, and lock-to-authorised-version. Locked scripts are read-only and hand off to Video Edit."
      screens={["Brief intake", "Split editor", "Version history", "Approve and lock"]}
    />
  );
}
