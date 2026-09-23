import { visibilityForFiles } from "@/lib/files/access";
import { requireModule } from "@/lib/auth/dal";
import { listFolder } from "@/lib/files/service";
import { answeringModel } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";
import { relationsForFiles } from "@/lib/authz/rebac";

export const metadata = { title: "文件 · Files" };

export default async function FilesPage() {
  const viewer = await requireModule("files");
  const { files, folders } = await listFolder(viewer, null);
  /* One query for the whole page: the badge on each row is a permission, so
     it is read per file rather than from one screen-wide flag. */
  const access = await relationsForFiles(viewer, files.map((r) => r.file));

  return (
    <FilesView
      folderId={null}
      breadcrumbs={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      canEdit={viewer.role !== "guest"}
      sidebarFolders={folders.map((f) => ({ id: f.id, name: f.name }))}
      folders={folders.map((f) => ({ id: f.id, name: f.name }))}
      /* `toRows` is the one place a database row becomes a table row, which is
         why it exists. Both of the main Files pages had their own copy of the
         mapping, and both copies predated `posterUrl` — so thumbnails worked
         in recent, shared and trash and nowhere anybody actually looks. */
      files={toRows(files, access, await visibilityForFiles(files.map((r) => r.file.id)), viewer)}
    />
  );
}
