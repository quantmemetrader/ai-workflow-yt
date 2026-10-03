import { getViewer } from "@/lib/auth/dal";
import { beginUpload } from "@/lib/files/service";
import { beginVersion } from "@/lib/files/versions";
import { presignUpload } from "@/lib/storage/r2";
import { readUploadInput } from "../upload-input";

/**
 * Hands the browser a short-lived URL to PUT one object straight into R2.
 *
 * The bytes never pass through a server function, so a 4 GB master is not
 * bounded by a request-body limit and costs no compute. The row is created
 * first, which is what owns the key and the permissions; the object that lands
 * at that key is confirmed afterwards.
 *
 * This is the path for small files only. One PUT has no retry and no resume,
 * and the signature expires while a slow link is still sending — which is what
 * killed a 590 MB upload from Hong Kong. Anything big goes through
 * `/api/files/multipart/*` instead; the client picks.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("files")) return new Response("Forbidden", { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const read = readUploadInput(body);
  if ("refusal" in read) return read.refusal;

  /* 上传新版本: the same checks and the same signed PUT, at a fresh key of
     the existing file rather than a new row (`lib/files/versions.ts`). */
  const versionOf = typeof body.versionOf === "string" && body.versionOf.length <= 64 ? body.versionOf : null;

  try {
    if (versionOf) {
      const { file, storageKey } = await beginVersion(viewer, versionOf, read.input);
      const upload = await presignUpload(storageKey, read.input.mime);
      return Response.json({ fileId: file.id, upload, versionKey: storageKey });
    }
    const { file, storageKey } = await beginUpload(viewer, read.input);
    const upload = await presignUpload(storageKey, read.input.mime);
    return Response.json({ fileId: file.id, upload });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Upload failed", { status: 400 });
  }
}
