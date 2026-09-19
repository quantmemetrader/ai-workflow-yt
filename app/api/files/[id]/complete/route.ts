import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { completeUpload } from "@/lib/files/service";
import { headObject } from "@/lib/storage/r2";

/** Confirms an upload: checks the object really landed, records its true size
 * and etag, and writes version 1. A row whose object never arrived stays
 * unconfirmed rather than pretending to be a file. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  // Presign checks the module; so must this. Otherwise an entitlement revoked
  // between the two calls still lets the upload be confirmed.
  if (!viewer.modules.includes("files")) return new Response("Not found", { status: 404 });

  const held = await relationOn(viewer, "file", id);
  if (held !== "owner" && held !== "editor") return new Response("Not found", { status: 404 });

  // Tenant-scoped as well as relation-checked: the row is about to be written
  // to, and nothing outside this studio should be reachable by id.
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row?.storageKey) return new Response("Not found", { status: 404 });

  const head = await headObject(row.storageKey);
  if (!head) return new Response("The upload did not arrive", { status: 409 });

  await db.update(files).set({ sizeBytes: head.size }).where(eq(files.id, id));
  await completeUpload(viewer, id, head.etag ?? undefined);

  return Response.json({ ok: true, size: head.size });
}
