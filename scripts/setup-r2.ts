/**
 * Allows the browser to PUT straight into the bucket from the origins we
 * actually serve. Without this, direct uploads fail the preflight and every
 * byte would have to be proxied through a function instead.
 *
 *   npm run setup:r2
 */
import { putBucketCors } from "../lib/storage/r2";

/**
 * Every origin the app is served from. Uploads go browser → R2 directly, so an
 * origin missing here is an origin where uploading silently fails: the row is
 * created, the PUT is refused by the browser, and the file is left unconfirmed.
 * Add the TLS hostname here the day one exists.
 */
const ORIGINS = [
  // The Cherry box, where the product actually runs today.
  "http://84.32.176.16:3300",
  "http://127.0.0.1:3300",
  "http://localhost:3300",
  // The Vercel copy, kept as a fallback.
  "https://ai-workspace-video.vercel.app",
  "https://ai-workflow-for-video-creators.vercel.app",
  // The custom domain on the Vercel copy. Missing here on 20 September, so
  // every upload from it was refused by the browser and left a phantom file.
  "https://yt.okbro.xyz",
  // The studio's own domain, which the site is moving to. Listed before the
  // DNS flips rather than after: an origin missing here does not fail loudly,
  // it fails as an upload that never starts — and a multipart upload loses
  // every one of its part PUTs the same way.
  "https://tengya.media",
  "https://www.tengya.media",
  // Local development.
  "http://localhost:3000",
  "http://localhost:3101",
];

async function main() {
  await putBucketCors(ORIGINS);
  console.log("R2 CORS set for:\n  " + ORIGINS.join("\n  "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
