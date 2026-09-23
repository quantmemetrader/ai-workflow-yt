import { visibilityForFiles } from "@/lib/files/access";
import { requireModule } from "@/lib/auth/dal";
import { listTrash, listTrashedFolders, sidebarFolders } from "@/lib/files/service";
import { answeringModel } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";

export const metadata = { title: "回收站 · Trash" };

/** Deleted files inside the 30-day recovery window. After that the sweeper
 * takes the bytes too, so "deleted" eventually means deleted. */
export default async function TrashPage() {
  const viewer = await requireModule("files");
  /* Folders are in here too now that a folder can be deleted. A trash that
     showed the files but not the folder they were in made "put it back"
     impossible to find. */
  const [rows, trashedFolders] = await Promise.all([listTrash(viewer), listTrashedFolders(viewer)]);

  return (
    <FilesView
      view="trash"
      folderId={null}
      breadcrumbs={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      canEdit={false}
      canCreate={viewer.role !== "guest"}
      sidebarFolders={await sidebarFolders(viewer)}
      folders={trashedFolders.map((f) => ({ id: f.id, name: f.name }))}
      files={toRows(rows, undefined, await visibilityForFiles(rows.map((r) => r.file.id)), viewer)}
    />
  );
}
