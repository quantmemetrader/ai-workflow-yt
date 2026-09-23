import { parseChoice, type AccessChoice } from "@/lib/files/access";

/**
 * What an upload has to say about itself before a row is made for it.
 *
 * There are two ways into the store now — one PUT for small files, a multipart
 * upload for big ones — and they have to agree on every rule, or the 8 GB cap
 * is whichever route the browser happened to pick. So the checks live here and
 * both routes call them.
 */

export type UploadInput = {
  name: string;
  mime: string;
  sizeBytes: number;
  folderId: string | null;
  access: AccessChoice;
};

/** 8 GB — a feature-length master. */
export const UPLOAD_LIMIT = 8 * 1024 * 1024 * 1024;

/** Either the validated input, or the response to send back instead. */
export function readUploadInput(
  body: { name?: unknown; mime?: unknown; size?: unknown; folderId?: unknown; access?: unknown },
): { input: UploadInput } | { refusal: Response } {
  const refuse = (message: string, status = 400) => ({ refusal: new Response(message, { status }) });

  const name = String(body.name ?? "").trim();
  if (!name) return refuse("A file needs a name");
  if (name.length > 255) return refuse("That name is too long");

  // The content type is signed into the upload URL and stored on the row, so it
  // must be a plausible media type and nothing that could carry a header.
  const mime = String(body.mime || "application/octet-stream");
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime) || mime.length > 128) return refuse("That is not a content type");

  // `Number(undefined)` is NaN, and NaN fails every `>` test — the old check
  // let an absent or negative size through to the row untouched.
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size < 0) return refuse("Bad request");
  if (size > UPLOAD_LIMIT) return refuse("That file is larger than 8 GB", 413);

  const folderId = body.folderId == null ? null : String(body.folderId);
  if (folderId && folderId.length > 64) return refuse("Bad request");

  return { input: { name, mime, sizeBytes: size, folderId, access: parseChoice(body.access) } };
}
