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
