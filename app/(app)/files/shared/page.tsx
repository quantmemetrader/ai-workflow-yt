import { visibilityForFiles } from "@/lib/files/access";
import { requireModule } from "@/lib/auth/dal";
import { listSharedWithMe, sidebarFolders } from "@/lib/files/service";
import { answeringModel } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";
import { relationsForFiles } from "@/lib/authz/rebac";

export const metadata = { title: "共享文件 · Shared with me" };

/** Files someone chose to share with this person — not their own, and not the
 * studio-wide grant everyone holds. */
export default async function SharedPage() {
  const viewer = await requireModule("files");
  const rows = await listSharedWithMe(viewer);
  const access = await relationsForFiles(viewer, rows.map((r) => r.file));

  return (
    <FilesView
      view="shared"
      folderId={null}
      breadcrumbs={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      canEdit={false}
      canCreate={viewer.role !== "guest"}
      sidebarFolders={await sidebarFolders(viewer)}
      folders={[]}
      files={toRows(rows, access, await visibilityForFiles(rows.map((r) => r.file.id)), viewer)}
    />
  );
}
