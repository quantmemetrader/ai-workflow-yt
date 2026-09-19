import { requireModule } from "@/lib/auth/dal";
import { listSharedWithMe } from "@/lib/files/service";
import { modelFor } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";

/** Files someone chose to share with this person — not their own, and not the
 * studio-wide grant everyone holds. */
export default async function SharedPage() {
  const viewer = await requireModule("files");
  const rows = await listSharedWithMe(viewer);

  return (
    <FilesView
      view="shared"
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
