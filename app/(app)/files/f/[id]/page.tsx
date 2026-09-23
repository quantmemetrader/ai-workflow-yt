import { visibilityForFiles } from "@/lib/files/access";
import { notFound } from "next/navigation";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { canReadFolders, relationOn } from "@/lib/authz/rebac";
import { listFolder } from "@/lib/files/service";
import { answeringModel } from "@/lib/ai/models";
import { FilesView } from "@/components/files/FilesView";
import { toRows } from "@/components/files/rows";
import { relationsForFiles } from "@/lib/authz/rebac";

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("files");

  // No relation means it does not exist as far as this person is concerned.
  const held = await relationOn(viewer, "folder", id);
  if (!held) notFound();

  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder || folder.deletedAt) notFound();

  const [trail, roots, contents] = await Promise.all([
    folder.path.length
      ? db.select({ id: folders.id, name: folders.name }).from(folders).where(inArray(folders.id, folder.path))
      : Promise.resolve([]),
    db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(isNull(folders.parentId), isNull(folders.deletedAt), canReadFolders(viewer)))
      .orderBy(folders.name),
    listFolder(viewer, id),
  ]);

  const access = await relationsForFiles(viewer, contents.files.map((r) => r.file));

  const breadcrumbs = folder.path
    .map((pid) => trail.find((t) => t.id === pid))
    .filter((x): x is { id: string; name: string } => Boolean(x));

  return (
    <FilesView
      folderId={id}
      breadcrumbs={breadcrumbs}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      canEdit={held === "owner" || held === "editor" || viewer.isAdmin}
      sidebarFolders={roots.filter((f) => f.name !== "__home")}
      folders={contents.folders.map((f) => ({ id: f.id, name: f.name }))}
      files={toRows(contents.files, access, await visibilityForFiles(contents.files.map((r) => r.file.id)), viewer)}
    />
  );
}
