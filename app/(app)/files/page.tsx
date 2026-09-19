import { requireModule } from "@/lib/auth/dal";
import { listFolder } from "@/lib/files/service";
import { modelFor } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";

export default async function FilesPage() {
  const viewer = await requireModule("files");
  const { files, folders } = await listFolder(viewer, null);

  return (
    <FilesView
      folderId={null}
      breadcrumbs={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={modelFor.assistant()}
      canEdit={viewer.role !== "guest"}
      sidebarFolders={folders.map((f) => ({ id: f.id, name: f.name }))}
      folders={folders.map((f) => ({ id: f.id, name: f.name }))}
      files={files.map((r) => ({
        id: r.file.id,
        name: r.file.name,
        kind: r.file.kind,
        sizeBytes: r.file.sizeBytes,
        ownerName: r.ownerName,
        updatedAt: r.file.updatedAt.toISOString(),
        durationMs: r.file.durationMs,
        version: r.file.version,
      }))}
    />
  );
}
