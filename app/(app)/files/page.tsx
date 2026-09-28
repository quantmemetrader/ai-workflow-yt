import { visibilityForFiles } from "@/lib/files/access";
import { requireModule } from "@/lib/auth/dal";
import { listFolder, sidebarFolders } from "@/lib/files/service";
import { listByProject, listByType, parseLens } from "@/lib/files/lenses";
import { answeringModel } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";
import { relationsForFiles } from "@/lib/authz/rebac";

export const metadata = { title: "文件 · Files" };

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const viewer = await requireModule("files");
  /* 全部 · 按项目 · 图片 · 视频 · 文档 (`lib/files/lenses.ts`). The lens is in
     the URL, so only what it shows is fetched. */
  const lens = parseLens((await searchParams).view);
  const common = {
    folderId: null,
    breadcrumbs: [],
    locale: viewer.locale ?? "zh-CN",
    model: answeringModel(),
    canEdit: viewer.role !== "guest",
    lens,
  };

  if (lens === "projects") {
    const [{ projects, loose, looseTotal }, sidebar] = await Promise.all([listByProject(viewer), sidebarFolders(viewer)]);
    /* Every row on the page, once, for the one permission read and the one
       visibility read the badges need — a file used by two projects is asked
       about once. */
    const all = new Map([...projects.flatMap((p) => p.files.map((f) => f.row)), ...loose].map((r) => [r.file.id, r]));
    const rows = [...all.values()];
    const [access, vis] = await Promise.all([
      relationsForFiles(viewer, rows.map((r) => r.file)),
      visibilityForFiles(rows.map((r) => r.file.id)),
    ]);
    const asRow = new Map(toRows(rows, access, vis, viewer).map((r) => [r.id, r]));
    return (
      <FilesView
        {...common}
        sidebarFolders={sidebar}
        folders={[]}
        files={[...asRow.values()]}
        projects={projects.map((p) => ({
          id: p.id,
          title: p.title,
          activeAt: p.activeAt,
          hidden: p.hidden,
          script: p.script,
          files: p.files.map((f) => ({ role: f.role, file: asRow.get(f.row.file.id)! })),
        }))}
        loose={loose.map((r) => asRow.get(r.file.id)!)}
        looseTotal={looseTotal}
      />
    );
  }

  if (lens !== "all") {
    const [rows, sidebar] = await Promise.all([listByType(viewer, lens), sidebarFolders(viewer)]);
    const [access, vis] = await Promise.all([
      relationsForFiles(viewer, rows.map((r) => r.file)),
      visibilityForFiles(rows.map((r) => r.file.id)),
    ]);
    return <FilesView {...common} sidebarFolders={sidebar} folders={[]} files={toRows(rows, access, vis, viewer)} />;
  }

  const { files, folders } = await listFolder(viewer, null);
  /* One query for the whole page: the badge on each row is a permission, so
     it is read per file rather than from one screen-wide flag. */
  const access = await relationsForFiles(viewer, files.map((r) => r.file));

  return (
    <FilesView
      {...common}
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
