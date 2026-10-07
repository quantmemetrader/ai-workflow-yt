import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { presignDownload } from "@/lib/storage/r2";
import { fileInVisibleProject } from "@/lib/video/access";
import { versionObject } from "@/lib/files/versions";

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
  if (!viewer.modules.includes("files") && !viewer.modules.includes("video")) {
    return new Response("Not found", { status: 404 });
  }

  // Both reads are issued together, and the row is scoped to the viewer's own
  // tenant. Two reasons. Sequentially, "no such file" answered after one round
  // trip and "exists but you may not read it" after two, and with the database
  // a continent away that gap is ~250ms of clock — a reliable way to learn that
  // a file you cannot read exists (§2.2.4). And the admin override below is a
  // break-glass over *this studio's* files (§2.1); unscoped, an admin of one
  // tenant could pull any object out of another by guessing an id.
  const [rows, held, inProject] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, viewer.tenantId)))
      .limit(1),
    viewer.modules.includes("files") ? relationOn(viewer, "file", id) : Promise.resolve(null),
    // Footage in a project the viewer can see plays for them, whoever uploaded
    // it (lib/video/access.ts).
    fileInVisibleProject(viewer, id),
  ]);

  const file = rows[0];
  const granted = held !== null || inProject;

  if (!file || file.deletedAt) return new Response("Not found", { status: 404 });

  // An admin may break glass; it is recorded as exactly that.
  if (!granted && !viewer.isAdmin) return new Response("Not found", { status: 404 });

  /* `?v=3`: one earlier version, from the 版本 list. Same check as the file
     itself; only a version that kept its own object can be fetched. */
  const params = new URL(request.url).searchParams;
  const wanted = params.get("v");
  const versionNo = wanted && /^\d{1,6}$/.test(wanted) ? Number(wanted) : null;
  if (wanted && versionNo === null) return new Response("Not found", { status: 404 });

  await audit(viewer, granted ? "file.open" : "file.open.admin_override", {
    objectType: "file",
    objectId: id,
    module: "files",
    meta: { name: file.name, relation: held ?? (inProject ? "video_project" : null), ...(versionNo ? { version: versionNo } : {}) },
  });

  if (versionNo !== null) {
    const key = await versionObject(id, versionNo);
    if (!key) return new Response("Not found", { status: 404 });
    const dot = file.name.lastIndexOf(".");
    const keyExt = /\.[^./]{1,10}$/.exec(key)?.[0] ?? (dot > 0 ? file.name.slice(dot) : "");
    const base = dot > 0 ? file.name.slice(0, dot) : file.name;
    const url = await presignDownload(key, { expiresIn: 300, filename: `${base} (v${versionNo})${keyExt}` });
    return Response.redirect(url, 302);
  }

  if (!file.storageKey) {
    // A text document lives in the database, not in object storage — and this
    // response comes from the app's own origin, so its type is not the row's to
    // choose. `text/html` here would be stored XSS running as the reader.
    // Objects in R2 are served from R2's domain and do not have this problem.
    const safeMime =
      file.mime === "text/markdown" || file.mime === "text/plain" || file.mime === "application/json"
        ? file.mime
        : "text/plain";
    /* 下载 means a file on disk (Catherine, 7 Oct: a report from the assistant opened as text in the tab and "the download fails"). */
    const asFile = params.get("download") === "1";
    const fname = file.name || "document.md";
    const ext = /\.[a-z0-9]{1,6}$/i.exec(fname)?.[0] ?? ".md";
    return new Response(file.text ?? "", {
      headers: {
        "Content-Type": `${safeMime}; charset=utf-8`,
        "Content-Disposition": asFile ? `attachment; filename="document${ext}"; filename*=UTF-8''${encodeURIComponent(fname)}` : "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const download = params.get("download") === "1";
  // A <video> keeps asking the same signed URL for byte ranges for as long as
  // the page is open; five minutes was enough for a download and not for a
  // player somebody paused and came back to (the next seek hit an expired
  // link and the player spun). Playback links live for six hours.
  const url = await presignDownload(file.storageKey, {
    expiresIn: download ? 300 : 6 * 3600,
    filename: download ? file.name : undefined,
  });

  return Response.redirect(url, 302);
}
