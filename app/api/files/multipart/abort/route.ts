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
 * The `files` row is deliberately left alone. An upload that never finished
 * has no version and no checksum, which is already how the rest of the product
 * recognises a file whose bytes never came; deleting rows from a cancel button
 * would be a new and sharper behaviour than the single-PUT path has.
 */
export async function POST(request: Request) {
  const parsed = await readJson(request);
  if ("refusal" in parsed) return parsed.refusal;

  const opened = await openSession(parsed.body);
  if ("refusal" in opened) return opened.refusal;

  const { storageKey, uploadId } = opened.session;
  try {
    await abortMultipartUpload(storageKey, uploadId);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "The upload could not be abandoned", { status: 502 });
  }
  return Response.json({ ok: true });
}
