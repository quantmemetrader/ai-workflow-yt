/**
 * Who may 永久删除 a folder in the trash. Owning the folder is not enough: a
 * folder shared as 可编辑 holds files other people uploaded, and a purge is
 * forever. A member may purge it only when every file and folder under it is
 * theirs; an admin (or the workspace owner) may purge everything.
 *
 * Pure, so the rule can be checked without a database.
 */
export type PurgeItem = { ownerId: string | null; proxy?: boolean };

export function folderPurgeBlock(
  viewer: { id: string; isAdmin: boolean },
  folder: { ownerId: string | null },
  files: PurgeItem[],
  folders: PurgeItem[],
): { others: number; message: string | null } {
  if (viewer.isAdmin) return { others: 0, message: null };
  if (folder.ownerId !== viewer.id) return { others: 0, message: "只有创建者或管理员可以永久删除" };
  const foreignFiles = files.filter((f) => f.ownerId !== viewer.id);
  const foreignFolders = folders.filter((f) => f.ownerId !== viewer.id);
  if (!foreignFiles.length && !foreignFolders.length) return { others: 0, message: null };
  /* Previews are not something a person uploaded; count the ones they would
     recognise, but never say 0 when something is blocking. */
  const others = Math.max(1, foreignFiles.filter((f) => !f.proxy).length + foreignFolders.length);
  return {
    others,
    message: `文件夹里有 ${others} 项属于其他人，你只能永久删除自己的内容，请联系管理员处理`,
  };
}
