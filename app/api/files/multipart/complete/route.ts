import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { completeUpload } from "@/lib/files/service";
import { abortMultipartUpload, completeMultipartUpload, headObject, MAX_PARTS } from "@/lib/storage/r2";
import { openSession, readJson } from "../session";

/**
 * Assembles the parts and confirms the file — the same ending the single PUT
 * has, so a multipart upload produces the same row, the same version 1 and the
 * same follow-up jobs (poster, probe) as any other.
 *
 * The size is read back from the object rather than believed from the browser,
 * exactly as `/api/files/[id]/complete` does: a row that claims bytes nobody
 * can find is worse than no row.
 */
export async function POST(request: Request) {
  const parsed = await readJson(request);
  if ("refusal" in parsed) return parsed.refusal;

  const opened = await openSession(parsed.body);
  if ("refusal" in opened) return opened.refusal;
  const { viewer, fileId, storageKey, uploadId } = opened.session;

  const parts = readParts(parsed.body.parts);
  if (!parts) return new Response("Bad request", { status: 400 });

  try {
    await completeMultipartUpload(storageKey, uploadId, parts);
  } catch (err) {
    /* Assembly failed for good — a part is missing, or one that is not the
       last is under the minimum. The upload will never complete now, so the
       parts already sent are pure cost; throw them away rather than leave them
       to be billed for ever. */
    await abortMultipartUpload(storageKey, uploadId).catch(() => {});
    return new Response(err instanceof Error ? err.message : "The upload could not be assembled", { status: 409 });
  }

  const head = await headObject(storageKey);
  if (!head) return new Response("The upload did not arrive", { status: 409 });

  await db.update(files).set({ sizeBytes: head.size }).where(eq(files.id, fileId));
  /* The client's own hash if it computed one, otherwise the object's etag —
     the same mark of a confirmed upload the single PUT records. For a
     multipart object that etag is a digest of the part digests with the part
     count after it, not the MD5 of the bytes; it is never compared against a
     hash taken elsewhere, only used to say "the bytes arrived". */
  const given = typeof parsed.body.checksum === "string" ? parsed.body.checksum.slice(0, 128) : undefined;
  await completeUpload(viewer, fileId, given || head.etag || undefined);

  return Response.json({ ok: true, size: head.size });
}

/** Ascending, unique, in range, and every etag a plausible one. R2 refuses the
 * whole upload on a list out of order, and it is cheaper to say so here than
 * to find out after the assembly request. */
function readParts(raw: unknown): { partNumber: number; etag: string }[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PARTS) return null;

  const parts: { partNumber: number; etag: string }[] = [];
  let previous = 0;
  for (const item of raw) {
    const entry = item as { partNumber?: unknown; etag?: unknown };
    const partNumber = Number(entry.partNumber);
    const etag = String(entry.etag ?? "").trim();
    if (!Number.isInteger(partNumber) || partNumber <= previous || partNumber > MAX_PARTS) return null;
    if (!etag || etag.length > 256) return null;
    previous = partNumber;
    parts.push({ partNumber, etag });
  }
  return parts;
}
