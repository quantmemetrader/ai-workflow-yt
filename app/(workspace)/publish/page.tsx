import { ModuleStub } from "@/components/ModuleStub";

export default function PublishPage() {
  return (
    <ModuleStub
      title="Publish"
      spec="Build-Spec §4.6"
      summary="Per-channel composer with a shared master version and overrides. Every item routes to a named approver before transmission — nothing leaves the platform without an approval record."
      screens={["Channel board", "Composer", "Approval queue", "Publish log"]}
    />
  );
}
