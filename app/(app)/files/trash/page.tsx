import { requireModule } from "@/lib/auth/dal";
import { listTrash } from "@/lib/files/service";
import { modelFor } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";

/** Deleted files inside the 30-day recovery window. After that the sweeper
 * takes the bytes too, so "deleted" eventually means deleted. */
export default async function TrashPage() {
  const viewer = await requireModule("files");
  const rows = await listTrash(viewer);

  return (
    <FilesView
      view="trash"
      folderId={null}
      breadcrumbs={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={modelFor.assistant()}
      canEdit={false}
      sidebarFolders={[]}
      folders={[]}
      files={toRows(rows)}
    />
  );
}
