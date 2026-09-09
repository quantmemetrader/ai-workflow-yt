import { ModuleStub } from "@/components/ModuleStub";

export default function FilesPage() {
  return (
    <ModuleStub
      title="Files"
      spec="Build-Spec §3, §10 step 2"
      summary="Shared media and document database with per-file permissions (ReBAC). Folder browser, sharing UI, versioning, audit log."
      screens={["Folder / file browser", "Sharing UI", "Version history", "Audit log"]}
    />
  );
}
