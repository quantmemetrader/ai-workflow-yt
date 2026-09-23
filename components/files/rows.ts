import type { FileRow } from "@/components/canvas/FilesScreen";
import type { files, Relation } from "@/lib/db/schema";

type Row = { file: typeof files.$inferSelect; ownerName: string };

/** The one place a database row becomes a table row, so every Files view shows
 * the same columns from the same fields.
 *
 * `access` is the relation this person actually holds on each file, which is
 * what the right-hand badge claims. It used to be one screen-wide flag, so a
 * file shared read-only sat in the list badged "Editor".
 */
export function toRows(
  rows: Row[],
  access?: Map<string, Relation>,
  vis?: Map<
    string,
    { visibility: "private" | "everyone" | "groups" | "people"; groups: string[]; userIds: string[]; people: { name: string; email: string }[] }
  >,
  viewer?: { id: string; isAdmin: boolean },
): FileRow[] {
  return rows.map((r) => ({
    id: r.file.id,
    name: r.file.name,
    kind: r.file.kind,
    sizeBytes: r.file.sizeBytes,
    ownerName: r.ownerName,
    updatedAt: (r.file.deletedAt ?? r.file.updatedAt).toISOString(),
    durationMs: r.file.durationMs,
    version: r.file.version,
    /*
     * Pictures show themselves, and a video shows a frame of itself: the
     * thumbnail route makes the same permission check the download route
     * makes, pulls a poster out of the video once with FFmpeg and keeps it
     * beside the file. Everything else has no picture to show and keeps its
     * kind glyph.
     */
    posterUrl:
      r.file.kind === "image" || r.file.kind === "video"
        ? `/api/files/${r.file.id}/thumb`
        : null,
    access: access?.get(r.file.id) ?? null,
    visibility: vis?.get(r.file.id)?.visibility,
    groups: vis?.get(r.file.id)?.groups,
    userIds: vis?.get(r.file.id)?.userIds,
    people: vis?.get(r.file.id)?.people,
    canSetAccess: viewer ? viewer.isAdmin || r.file.ownerId === viewer.id : false,
  }));
}
