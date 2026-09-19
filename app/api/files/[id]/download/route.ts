import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { presignDownload } from "@/lib/storage/r2";

/**
 * Opens a file. Permission is checked here, then a short-lived signed URL is
 * issued and the browser is redirected to R2 — so the bytes come straight from
 * storage, but only ever after the check, and the URL expires in minutes.
 *
 * Every open is audited, including an admin's (spec §4.11): that is what makes
 * "an admin read a file they were not granted" visible instead of invisible.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  // The module entitlement is re-checked alongside the relation, the same way
  // /api/files/presign does it: a route handler is a public endpoint and must
  // not assume the rail hid the link (§4.1).
  if (!viewer.modules.includes("files")) return new Response("Not found", { status: 404 });

  // Both reads are issued together, and the row is scoped to the viewer's own
  // tenant. Two reasons. Sequentially, "no such file" answered after one round
  // trip and "exists but you may not read it" after two, and with the database
  // a continent away that gap is ~250ms of clock — a reliable way to learn that
  // a file you cannot read exists (§2.2.4). And the admin override below is a
  // break-glass over *this studio's* files (§2.1); unscoped, an admin of one
  // tenant could pull any object out of another by guessing an id.
  const [rows, held] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, viewer.tenantId)))
      .limit(1),
    relationOn(viewer, "file", id),
  ]);

  const file = rows[0];
  const granted = held !== null;

  if (!file || file.deletedAt) return new Response("Not found", { status: 404 });

  // An admin may break glass; it is recorded as exactly that.
  if (!granted && !viewer.isAdmin) return new Response("Not found", { status: 404 });

  await audit(viewer, granted ? "file.open" : "file.open.admin_override", {
    objectType: "file",
    objectId: id,
    module: "files",
    meta: { name: file.name, relation: held },
  });

  if (!file.storageKey) {
    // A text document lives in the database, not in object storage — and this
    // response comes from the app's own origin, so its type is not the row's to
    // choose. `text/html` here would be stored XSS running as the reader.
    // Objects in R2 are served from R2's domain and do not have this problem.
    const safeMime =
      file.mime === "text/markdown" || file.mime === "text/plain" || file.mime === "application/json"
        ? file.mime
        : "text/plain";
    return new Response(file.text ?? "", {
      headers: {
        "Content-Type": `${safeMime}; charset=utf-8`,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const url = await presignDownload(file.storageKey, {
    expiresIn: 300,
    filename: download ? file.name : undefined,
  });

  return Response.redirect(url, 302);
}
