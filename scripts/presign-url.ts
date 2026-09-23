/** Print a short-lived download URL for a stored file: `… presign-url.ts <fileId>`. */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { presignDownload } from "@/lib/storage/r2";
async function main() {
  const [id] = process.argv.slice(2);
  const [f] = await db.select({ key: files.storageKey }).from(files).where(eq(files.id, id)).limit(1);
  if (!f?.key) throw new Error(`no such file ${id}`);
  const dl = await presignDownload(f.key);
  console.log(typeof dl === "string" ? dl : (dl as { url: string }).url);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
