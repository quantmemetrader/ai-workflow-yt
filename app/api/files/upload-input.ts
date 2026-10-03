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

/**
 * The name to store: the last piece of whatever the browser sent, never a
 * path. A name like `../../x.mp4` or `C:\clips\x.mp4` is someone else's
 * folder layout, and `storageKey` builds the R2 key from it. Control
 * characters and the invisible direction overrides that make `gpj.exe`
 * read as `exe.jpg` go too; Chinese, spaces and emoji stay (QA, 3 Oct).
 */
export function cleanUploadName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const hidden = (c: number) =>
    c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
  return [...base]
    .filter((ch) => !hidden(ch.codePointAt(0) ?? 0))
    .join("")
    .trim();
}

/** Either the validated input, or the response to send back instead. */
export function readUploadInput(
  body: { name?: unknown; mime?: unknown; size?: unknown; folderId?: unknown; access?: unknown },
): { input: UploadInput } | { refusal: Response } {
  const refuse = (message: string, status = 400) => ({ refusal: new Response(message, { status }) });

  const name = cleanUploadName(String(body.name ?? ""));
  if (!name || name === "." || name === "..") return refuse("文件需要一个名称");
  if (name.length > 255) return refuse("文件名太长了");

  // The content type is signed into the upload URL and stored on the row, so it
  // must be a plausible media type and nothing that could carry a header.
  const mime = String(body.mime || "application/octet-stream");
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime) || mime.length > 128) return refuse("无法识别这个文件的类型");

  // `Number(undefined)` is NaN, and NaN fails every `>` test — the old check
  // let an absent or negative size through to the row untouched.
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size < 0) return refuse("上传请求有误，请重试");
  /* An empty file has nothing to store and nothing anyone could read; the
     browser refuses it first, and this holds for any other caller. */
  if (size === 0) return refuse("文件是空的，无法上传");
  if (size > UPLOAD_LIMIT) return refuse("文件超过 8 GB，无法上传", 413);

  const folderId = body.folderId == null ? null : String(body.folderId);
  if (folderId && folderId.length > 64) return refuse("上传请求有误，请重试");

  return { input: { name, mime, sizeBytes: size, folderId, access: parseChoice(body.access) } };
}
