import { getViewer } from "@/lib/auth/dal";
import { parseChoice } from "@/lib/files/access";
import { beginUpload } from "@/lib/files/service";
import { presignUpload } from "@/lib/storage/r2";

/**
 * Hands the browser a short-lived URL to PUT one object straight into R2.
 *
 * The bytes never pass through a server function, so a 4 GB master is not
 * bounded by a request-body limit and costs no compute. The row is created
 * first, which is what owns the key and the permissions; the object that lands
 * at that key is confirmed afterwards.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("files")) return new Response("Forbidden", { status: 403 });

  let body: { name?: string; mime?: string; size?: number; folderId?: string | null; access?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return new Response("A file needs a name", { status: 400 });
  if (name.length > 255) return new Response("That name is too long", { status: 400 });

  // The content type is signed into the upload URL and stored on the row, so it
  // must be a plausible media type and nothing that could carry a header.
  const mime = String(body.mime || "application/octet-stream");
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime) || mime.length > 128) {
    return new Response("That is not a content type", { status: 400 });
  }

  // `Number(undefined)` is NaN, and NaN fails every `>` test — the old check
  // let an absent or negative size through to the row untouched.
  const size = Number(body.size ?? 0);
  const LIMIT = 8 * 1024 * 1024 * 1024; // 8 GB — a feature-length master.
  if (!Number.isFinite(size) || size < 0) return new Response("Bad request", { status: 400 });
  if (size > LIMIT) return new Response("That file is larger than 8 GB", { status: 413 });

  const folderId = body.folderId == null ? null : String(body.folderId);
  if (folderId && folderId.length > 64) return new Response("Bad request", { status: 400 });

  try {
    const { file, storageKey } = await beginUpload(viewer, {
      name,
      mime,
      sizeBytes: size,
      folderId,
      access: parseChoice(body.access),
    });

    const upload = await presignUpload(storageKey, mime);
    return Response.json({ fileId: file.id, upload });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Upload failed", { status: 400 });
  }
}
