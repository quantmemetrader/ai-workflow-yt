import type { FileRow } from "@/components/canvas/FilesScreen";
import type { files } from "@/lib/db/schema";

type Row = { file: typeof files.$inferSelect; ownerName: string };

/** The one place a database row becomes a table row, so every Files view shows
 * the same columns from the same fields. */
export function toRows(rows: Row[]): FileRow[] {
  return rows.map((r) => ({
    id: r.file.id,
    name: r.file.name,
    kind: r.file.kind,
    sizeBytes: r.file.sizeBytes,
    ownerName: r.ownerName,
    updatedAt: (r.file.deletedAt ?? r.file.updatedAt).toISOString(),
    durationMs: r.file.durationMs,
    version: r.file.version,
  }));
}
