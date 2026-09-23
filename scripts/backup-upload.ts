/**
 * Put a dump in R2, and prune what is older than the retention rule.
 *
 * Uses the app's own storage client, so the backup lands in the same bucket
 * with the same credentials the product already has — no second set of keys to
 * rotate, and no separate thing to notice has broken.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx \
 *     scripts/backup-upload.ts <local file> <key>
 */
import { readFile } from "node:fs/promises";
import { deleteObject, listObjects, putObject } from "../lib/storage/r2";

const DAYS = 14;
const YEAR = 365;

async function main() {
  const [file, key] = process.argv.slice(2);
  if (!file || !key) throw new Error("usage: backup-upload <file> <key>");

  const body = await readFile(file);
  await putObject(key, body, "application/octet-stream");
  console.log(`    uploaded ${key} (${(body.byteLength / 1_048_576).toFixed(1)} MB)`);

  /*
   * Retention, stated: everything for a fortnight, then the first dump of each
   * month for a year, then nothing. Applied here rather than by a bucket
   * lifecycle rule so that it is visible in the repository and so that the
   * monthly keeper survives — a lifecycle rule cannot express "keep one".
   */
  const now = Date.now();
  const keep = new Set<string>();
  const all = (await listObjects("backups/")).sort((a, b) => a.key.localeCompare(b.key));

  for (const obj of all) {
    const stamp = /aura-(\d{8})-/.exec(obj.key)?.[1];
    if (!stamp) continue;
    const month = stamp.slice(0, 6);
    if (!keep.has(month)) keep.add(month); // the first of each month, kept
  }

  let removed = 0;
  for (const obj of all) {
    const stamp = /aura-(\d{8})-(\d{6})/.exec(obj.key);
    if (!stamp) continue;
    const when = Date.parse(
      `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}T${stamp[2].slice(0, 2)}:${stamp[2].slice(2, 4)}:${stamp[2].slice(4, 6)}Z`,
    );
    if (!Number.isFinite(when)) continue;
    const age = (now - when) / 86_400_000;
    if (age <= DAYS) continue;

    // Is this the month's keeper? The first key of that month, alphabetically.
    const month = stamp[1].slice(0, 6);
    const firstOfMonth = all.find((o) => o.key.includes(`aura-${month}`))?.key;
    if (obj.key === firstOfMonth && age <= YEAR) continue;

    await deleteObject(obj.key);
    removed++;
  }
  if (removed) console.log(`    pruned ${removed} old backup(s)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
