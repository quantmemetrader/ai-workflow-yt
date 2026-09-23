/**
 * Put a file that is already on this box through the app's own upload path.
 *
 * The browser normally does presign -> PUT -> complete. The bytes for these
 * takes are already here (pulled from the studio's Drive), and sending 1.5GB
 * down to a laptop only to send it back costs a long wait for nothing. This
 * runs the same three steps server-side, as a real user, so the row, the
 * permissions and the follow-up jobs are identical to a real upload.
 *
 *   node --env-file=.env.local --import tsx scripts/upload-local.ts <userId> <path> [name]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { beginUpload, completeUpload } from "@/lib/files/service";
import { presignUpload } from "@/lib/storage/r2";

async function main() {
  const [userId, filePath, nameArg] = process.argv.slice(2);
  if (!userId || !filePath) throw new Error("usage: upload-local.ts <userId> <path> [name]");

  const viewer = await viewerById(userId);
  if (!viewer) throw new Error(`no such user: ${userId}`);

  const name = nameArg || path.basename(filePath);
  const bytes = await readFile(filePath);
  const mime = name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";

  const { file, storageKey } = await beginUpload(viewer, { name, mime, sizeBytes: bytes.byteLength });
  const { url, headers } = await presignUpload(storageKey, mime);

  const put = await fetch(url, { method: "PUT", headers, body: bytes });
  if (!put.ok) throw new Error(`R2 refused the PUT: ${put.status} ${await put.text()}`);

  await completeUpload(viewer, file.id, createHash("sha256").update(bytes).digest("hex"));
  console.log(`  uploaded ${name}  ${(bytes.byteLength / 1048576).toFixed(0)}MB  fileId=${file.id}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("  FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
