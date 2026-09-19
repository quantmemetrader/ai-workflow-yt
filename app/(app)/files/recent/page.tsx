import { requireModule } from "@/lib/auth/dal";
import { listRecent } from "@/lib/files/service";
import { modelFor } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";

export default async function RecentPage() {
  const viewer = await requireModule("files");
  const rows = await listRecent(viewer);

  return (
    <FilesView
      view="recent"
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
