import { MAX_PARTS, presignUploadPart } from "@/lib/storage/r2";
import { openSession, readJson } from "../session";

/**
 * Signs one part, now.
 *
 * This is the whole reason a 590 MB upload from Hong Kong can survive: a
 * signature only has to outlive the part it is for, not the file. A part that
 * fails is signed again before it is retried, so a link slow enough to spend an
 * hour on one upload never once meets an expired URL.
 */
export async function POST(request: Request) {
  const parsed = await readJson(request);
  if ("refusal" in parsed) return parsed.refusal;

  const opened = await openSession(parsed.body);
  if ("refusal" in opened) return opened.refusal;

  const partNumber = Number(parsed.body.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    return new Response("Bad request", { status: 400 });
  }

  const { storageKey, uploadId } = opened.session;
  return Response.json({ url: await presignUploadPart(storageKey, uploadId, partNumber) });
}
