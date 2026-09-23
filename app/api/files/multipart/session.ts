import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import type { Viewer } from "@/lib/auth/dal";

/**
 * The checks every step of a multipart upload after `start` has to repeat.
 *
 * Three of the four routes are handed a `fileId` and an `uploadId` by the
 * browser, and neither is a secret: a file id is in the chat transcript of
 * anybody the file was shared with. So the storage key is never taken from the
 * request — it is read from the row, after the same relation and tenant checks
 * the single-PUT confirm makes. Otherwise "sign me a part" is a way to write
 * anywhere in the bucket.
 */

export type Session = { viewer: Viewer; fileId: string; storageKey: string; uploadId: string };

export async function openSession(
  body: { fileId?: unknown; uploadId?: unknown },
): Promise<{ session: Session } | { refusal: Response }> {
  const viewer = await getViewer();
  if (!viewer) return { refusal: new Response("Unauthorized", { status: 401 }) };
  // Start checks the module; so must every step after it. Otherwise an
  // entitlement revoked mid-upload still lets the file be finished.
  if (!viewer.modules.includes("files")) return { refusal: new Response("Not found", { status: 404 }) };

  const fileId = String(body.fileId ?? "");
  const uploadId = String(body.uploadId ?? "");
  // R2 upload ids are opaque and long; a bound keeps a silly one out of a URL.
  if (!fileId || fileId.length > 64 || !uploadId || uploadId.length > 1024) {
    return { refusal: new Response("Bad request", { status: 400 }) };
  }

  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") return { refusal: new Response("Not found", { status: 404 }) };

  // Tenant-scoped as well as relation-checked: nothing outside this studio
  // should be reachable by id.
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row?.storageKey) return { refusal: new Response("Not found", { status: 404 }) };

  return { session: { viewer, fileId, storageKey: row.storageKey, uploadId } };
}

/** The body, or the 400 to send instead. */
export async function readJson(request: Request): Promise<{ body: Record<string, unknown> } | { refusal: Response }> {
  try {
    return { body: (await request.json()) as Record<string, unknown> };
  } catch {
    return { refusal: new Response("Bad request", { status: 400 }) };
  }
}
