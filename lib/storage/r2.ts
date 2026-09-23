import "server-only";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

/**
 * Object storage on Cloudflare R2 (S3 API, no egress fees — the right shape
 * for a studio moving finished video around).
 *
 * Big uploads never pass through a server function: the browser PUTs straight
 * to a presigned URL, so a 4 GB master is not bounded by a request body limit
 * and costs us no compute. Reads are presigned too, and short-lived, so a URL
 * that leaks out of a screenshot stops working.
 */
const client = new AwsClient({
  accessKeyId: env.r2.accessKeyId,
  secretAccessKey: env.r2.secretAccessKey,
  service: "s3",
  region: "auto",
});

const base = `${env.r2.endpoint}/${env.r2.bucket}`;

export function objectUrl(key: string): string {
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** A URL the browser can PUT one object to, valid for `expiresIn` seconds. */
export async function presignUpload(key: string, contentType: string, expiresIn = 900) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await client.sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true, allHeaders: false },
  });
  return { url: signed.url, method: "PUT" as const, headers: { "Content-Type": contentType } };
}


/**
 * Multipart uploads — how a big file gets here from far away.
 *
 * One PUT of 590 MB from Hong Kong is a single request that has to survive the
 * whole transfer: no retry, no resume, and a presigned URL that expires while
 * the bytes are still moving. That is exactly the upload the studio reported as
 * "took an eternity and failed".
 *
 * S3-style multipart fixes all three. The upload is created once, each part is
 * PUT on its own — so a part that fails is a part that can be sent again, and
 * several can be in flight at once — and each part is signed only when it is
 * about to be sent, so a slow link never outlives a signature. The object does
 * not exist at the key until it is completed, so a half-finished upload is not
 * a half-finished file.
 *
 * The one thing that must not be forgotten is `abortMultipartUpload`: parts
 * that were uploaded and never completed sit in the bucket, invisible to a
 * listing, and are billed. A cancelled upload has to say so.
 */

/** R2 follows S3 here: at most 10,000 parts, and every part but the last must
 * be the same size, and no smaller than 5 MiB. The part size is decided
 * server-side and handed to the client so the two cannot disagree. */
export const MAX_PARTS = 10_000;

/**
 * The part size to cut a file of `size` bytes into.
 *
 * 16 MiB is the floor: big enough that the per-part overhead (one signature
 * request, one TLS round trip) is noise next to the payload, small enough that
 * a part lost to a dropped connection costs seconds rather than minutes. It is
 * only raised when 10,000 parts of it would not cover the file — at the 8 GB
 * cap that never happens, but the arithmetic is what keeps the promise true if
 * the cap ever moves.
 */
export function partSizeFor(size: number): number {
  const floor = 16 * 1024 * 1024;
  const needed = Math.ceil(size / MAX_PARTS);
  // Round up to a whole MiB so the number in the logs is readable.
  return Math.max(floor, Math.ceil(needed / (1024 * 1024)) * 1024 * 1024);
}

/** Opens a multipart upload at `key` and returns the id every later call needs.
 * Nothing is visible at the key until the upload is completed. */
export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await client.fetch(`${objectUrl(key)}?uploads=`, {
    method: "POST",
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`R2 multipart start ${key} failed: ${res.status} ${await res.text()}`);

  const uploadId = /<UploadId>([\s\S]*?)<\/UploadId>/.exec(await res.text())?.[1];
  if (!uploadId) throw new Error(`R2 multipart start ${key} returned no upload id`);
  return uploadId;
}

/**
 * A URL the browser can PUT one part to.
 *
 * Short-lived on purpose. The whole point of multipart here is that a signature
 * only has to outlive *one part*, not the whole file, so fifteen minutes is
 * generous for 16 MiB even on a bad link — and if a part is retried it is
 * signed again rather than reusing a URL that may since have expired.
 */
export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 900,
): Promise<string> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  // No content type is signed in: a part is a range of bytes, not a document,
  // and the browser sends a `Blob` slice with no type — one fewer thing that
  // can disagree with the signature, and it keeps the PUT a simple request.
  const signed = await client.sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true, allHeaders: false },
  });
  return signed.url;
}

/**
 * Assembles the parts into the object, and says what landed.
 *
 * The parts must be listed in ascending order or R2 refuses the whole upload.
 * The returned etag is the object's — for a multipart object that is a digest
 * of the part digests with the part count after it (`"…-19"`), not the MD5 of
 * the bytes, which is why it is only ever used as the mark of a confirmed
 * upload and never compared against a hash computed elsewhere.
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<{ key: string; etag: string | null }> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
${[...parts]
  .sort((a, b) => a.partNumber - b.partNumber)
  .map(
    (p) =>
      `  <Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`,
  )
  .join("\n")}
</CompleteMultipartUpload>`;

  const url = new URL(objectUrl(key));
  url.searchParams.set("uploadId", uploadId);
  const res = await client.fetch(url.toString(), {
    method: "POST",
    body,
    headers: { "Content-Type": "application/xml" },
  });

  const xml = await res.text();
  if (!res.ok) throw new Error(`R2 multipart complete ${key} failed: ${res.status} ${xml}`);
  /* S3 and R2 may answer 200 and then report the failure in the body — the
     response is streamed, so the status is sent before assembly is attempted.
     Trusting the status alone marks a file confirmed that has no object. */
  if (/<Error>/.test(xml)) {
    throw new Error(`R2 multipart complete ${key} failed: ${/<Message>([\s\S]*?)<\/Message>/.exec(xml)?.[1] ?? xml}`);
  }

  return { key, etag: /<ETag>([\s\S]*?)<\/ETag>/.exec(xml)?.[1]?.replaceAll('"', "").replaceAll("&quot;", "") ?? null };
}

/** Throws away an unfinished upload and the parts already sent for it.
 * Uploaded parts are billed until this runs, so cancel and fatal failure both
 * have to call it. Already gone is success, not an error. */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const url = new URL(objectUrl(key));
  url.searchParams.set("uploadId", uploadId);
  const res = await client.fetch(url.toString(), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 multipart abort ${key} failed: ${res.status} ${await res.text()}`);
  }
}

/** Etags come back quoted and are put straight into XML we generate. */
function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/** A short-lived read URL. `download` forces a filename in the browser. */
export async function presignDownload(key: string, opts: { expiresIn?: number; filename?: string } = {}) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(opts.expiresIn ?? 300));
  if (opts.filename) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
    );
  }
  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function putObject(key: string, body: BodyInit, contentType: string) {
  const res = await client.fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`R2 put ${key} failed: ${res.status} ${await res.text()}`);
  return key;
}

/**
 * Put, and say what landed.
 *
 * The etag is what a `files` row stores as its checksum: it is the mark of a
 * confirmed upload, and a row without one is treated as a file whose bytes
 * never arrived. The worker's own writes — renders, voice-overs, imported
 * pictures — need the same mark, or the bin refuses the studio's own masters.
 */
export async function putObjectConfirmed(key: string, body: BodyInit, contentType: string): Promise<{ key: string; etag: string | null }> {
  const res = await client.fetch(objectUrl(key), {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`R2 put ${key} failed: ${res.status} ${await res.text()}`);
  return { key, etag: res.headers.get("etag")?.replaceAll('"', "") ?? null };
}

export async function getObject(key: string): Promise<Response> {
  return client.fetch(objectUrl(key));
}

export async function headObject(key: string) {
  const res = await client.fetch(objectUrl(key), { method: "HEAD" });
  if (!res.ok) return null;
  return {
    size: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    etag: res.headers.get("etag")?.replaceAll('"', "") ?? null,
  };
}

/**
 * The keys under a prefix, with their sizes and dates.
 *
 * Paged, because `ListObjectsV2` returns a thousand at a time and a bucket of
 * backups outlives that in three years. Only used by tooling — nothing a
 * person waits on lists a bucket.
 */
export async function listObjects(
  prefix: string,
): Promise<{ key: string; size: number; modified: string | null }[]> {
  const out: { key: string; size: number; modified: string | null }[] = [];
  let token: string | undefined;

  do {
    const url = new URL(`${env.r2.endpoint}/${env.r2.bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (token) url.searchParams.set("continuation-token", token);

    const res = await client.fetch(url.toString());
    if (!res.ok) throw new Error(`R2 list ${prefix} failed: ${res.status}`);
    const xml = await res.text();

    for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const body = block[1];
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1];
      if (!key) continue;
      out.push({
        key,
        size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0),
        modified: /<LastModified>([\s\S]*?)<\/LastModified>/.exec(body)?.[1] ?? null,
      });
    }

    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? undefined)
      : undefined;
  } while (token);

  return out;
}

export async function deleteObject(key: string) {
  const res = await client.fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete ${key} failed: ${res.status}`);
  }
}

/** Keys are namespaced by tenant and date so a listing is browsable by a human
 * and one tenant's prefix can be lifecycled or moved on its own. */
export function storageKey(tenantId: string, fileId: string, filename: string): string {
  const d = new Date();
  const safe = filename.replace(/[^\w.\-一-鿿]+/g, "_").slice(-120);
  return `${tenantId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${fileId}/${safe}`;
}

/** Browser PUTs are cross-origin, so the bucket must allow them. Run from
 * `npm run setup:r2` — idempotent. */
export async function putBucketCors(origins: string[]) {
  const rules = origins
    .map(
      (o) => `<CORSRule>
    <AllowedOrigin>${o}</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>`,
    )
    .join("\n  ");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  ${rules}
</CORSConfiguration>`;

  const res = await client.fetch(`${base}?cors`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/xml" },
  });
  if (!res.ok) throw new Error(`R2 CORS failed: ${res.status} ${await res.text()}`);
}
