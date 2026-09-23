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
