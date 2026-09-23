import { abandonUpload } from "@/lib/files/abandon";
import { abortMultipartUpload } from "@/lib/storage/r2";
import { openSession, readJson } from "../session";

/**
 * Throws away an upload nobody is going to finish.
 *
 * Parts that were sent and never completed are invisible — they are not in a
 * listing and there is no object at the key — but R2 stores them and bills for
 * them until the upload is aborted or a lifecycle rule reaps it. A cancelled
 * 590 MB upload that says nothing is half a gigabyte the studio pays for and
 * cannot see, so cancel and fatal failure both call this.
 *
 * The `files` row goes too. It used to be left alone on the theory that "no
 * version" already marks it — but Files lists rows, not versions, so a failed
 * 590 MB upload sat in the folder as a file that opened to nothing. A row is
 * only removed if it was never confirmed (`abandonUpload` checks).
 */
export async function POST(request: Request) {
  const parsed = await readJson(request);
  if ("refusal" in parsed) return parsed.refusal;

  const opened = await openSession(parsed.body);
  if ("refusal" in opened) return opened.refusal;

  const { viewer, fileId, storageKey, uploadId } = opened.session;
  try {
    await abortMultipartUpload(storageKey, uploadId);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "The upload could not be abandoned", { status: 502 });
  }
  const outcome = await abandonUpload(viewer, fileId);
  return Response.json({ ok: true, removed: outcome === "gone" });
}
