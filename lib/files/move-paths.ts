/**
 * The arithmetic of moving things in the folder tree, kept free of the
 * database so it can be checked on its own.
 *
 * A folder's `path` is its ancestors, root first, ending with itself; a file's
 * `folderPath` is a copy of its folder's `path`. Moving folder X under T turns
 * every path that runs through X — X's own, every descendant folder's, every
 * descendant file's — into T's path, then X, then whatever followed X.
 */

/** `path` with everything up to and including `folderId` replaced by `newPrefix` (which ends with `folderId`). */
export function rewritePath(path: readonly string[], folderId: string, newPrefix: readonly string[]): string[] {
  const at = path.indexOf(folderId);
  if (at < 0) return [...path];
  return [...newPrefix, ...path.slice(at + 1)];
}

/** Where folder X ends up: under the target's path, or at the top. */
export function movedFolderPath(folderId: string, target: { path: readonly string[] } | null): string[] {
  return target ? [...target.path, folderId] : [folderId];
}

/** Why a folder cannot go where it was asked to, or null when it can. */
export function folderMoveRefusal(
  folder: { id: string; parentId: string | null },
  target: { id: string; path: readonly string[] } | null,
): "self" | "descendant" | "same" | null {
  if (target && target.id === folder.id) return "self";
  /* The target's own path lists every folder above it; finding the folder
     there means the target is inside it, and the move would make a loop. */
  if (target && target.path.includes(folder.id)) return "descendant";
  if ((target?.id ?? null) === folder.parentId) return "same";
  return null;
}

/** `报价.docx` given a new `报价单.pdf` keeps its name and takes the new extension. */
export function nameWithExtension(current: string, uploaded: string): string {
  const ext = (n: string) => /\.([^./\\]{1,10})$/.exec(n)?.[1] ?? "";
  const next = ext(uploaded);
  if (!next || ext(current).toLowerCase() === next.toLowerCase()) return current;
  const base = current.replace(/\.[^./\\]{1,10}$/, "");
  return `${base}.${next}`;
}

/** The R2 key a version that has not landed yet will be written at, and how to recognise one. */
export function pendingVersionKey(currentStyleKey: string, random: string): string {
  const cut = currentStyleKey.lastIndexOf("/");
  return `${currentStyleKey.slice(0, cut)}/v-${random}${currentStyleKey.slice(cut)}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isVersionKeyFor(key: string, tenantId: string, fileId: string): boolean {
  if (key.length > 512 || key.includes("..")) return false;
  return new RegExp(`^${escapeRe(tenantId)}/\\d{4}/\\d{2}/${escapeRe(fileId)}/v-[a-z0-9]{10}/[^/]+$`).test(key);
}
