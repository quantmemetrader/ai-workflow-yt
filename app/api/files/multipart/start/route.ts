import { getViewer } from "@/lib/auth/dal";
import { beginUpload } from "@/lib/files/service";
import { createMultipartUpload, MAX_PARTS, partSizeFor } from "@/lib/storage/r2";
import { readUploadInput } from "../../upload-input";
import { readJson } from "../session";

/**
 * Opens a multipart upload for a big file.
 *
 * The row is made exactly as `/api/files/presign` makes it — same viewer
 * checks, same 8 GB cap, same folder and access handling, through the same
 * `beginUpload` — so a multipart upload is not a second kind of file. What
 * differs is only how the bytes get to the key: many small PUTs that can each
 * be retried, instead of one that cannot.
 *
 * The part size is decided here rather than by the browser. R2 requires every
 * part but the last to be the same size, so the two ends have to agree, and the
 * one that knows the limits should be the one that says.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("files")) return new Response("Forbidden", { status: 403 });

  const parsed = await readJson(request);
  if ("refusal" in parsed) return parsed.refusal;

  const read = readUploadInput(parsed.body);
  if ("refusal" in read) return read.refusal;

  const partSize = partSizeFor(read.input.sizeBytes);
  // Belt and braces: the cap already makes this impossible, but a file that
  // cannot be cut into 10,000 parts is one R2 would refuse halfway through,
  // and finding that out after 9,999 parts is the expensive way to learn it.
  if (Math.ceil(read.input.sizeBytes / partSize) > MAX_PARTS) {
    return new Response("That file is too large to upload in parts", { status: 413 });
  }

  try {
    const { file, storageKey } = await beginUpload(viewer, read.input);
    const uploadId = await createMultipartUpload(storageKey, read.input.mime);
    return Response.json({ fileId: file.id, uploadId, partSize });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Upload failed", { status: 400 });
  }
}
