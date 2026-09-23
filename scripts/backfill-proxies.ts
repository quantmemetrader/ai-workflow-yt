/**
 * Give the footage that is already here a preview copy.
 *
 * `files.proxy` runs on every video upload from now on (`completeUpload`), so
 * only clips uploaded before that existed are missing one — which is all of
 * the studio's current footage. Re-uploading a 570 MB take from Hong Kong to
 * get a 3 MB preview of it is not a plan; this queues the same job the upload
 * would have.
 *
 * It queues and returns. The worker does the encoding, one job at a time,
 * behind everything else in the queue (`priority: 4`), so a backfill of forty
 * takes cannot delay the render somebody is waiting on. Each job downloads its
 * master and spends a few seconds of FFmpeg on it — 3.4s for 75 seconds of
 * 1080p — so the whole store is minutes of work, mostly spent on the downloads.
 *
 * Safe to run twice: the queue dedupes on `proxy:<fileId>`, and the job itself
 * checks the column again when it gets there. Failures are per-file and land
 * in `jobs`; nothing here can damage a master.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first \
 *        --conditions=react-server --import tsx scripts/backfill-proxies.ts [tenantId] [--dry]
 *
 * With no tenant it does every tenant in the database, which on this box is
 * the one studio. `--dry` lists what it would queue and queues nothing.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const tenantId = args.find((a) => !a.startsWith("--")) ?? null;

  /*
   * First, the ones that need no encoding at all.
   *
   * Every render since yesterday already writes a 480p copy and records it on
   * the export (`video_exports.proxy_file_id`). A rendered master dropped back
   * onto a timeline as footage is a source clip like any other, and it would
   * be re-encoded here for a file that exists. This points the master's own
   * column at the copy the renderer already made.
   */
  if (!dry) {
    const linked = await db.execute(sql`
      update files f
         set proxy_file_id = ve.proxy_file_id
        from video_exports ve
       where ve.file_id = f.id
         and ve.proxy_file_id is not null
         and f.proxy_file_id is null
         and f.deleted_at is null
         ${tenantId ? sql`and f.tenant_id = ${tenantId}` : sql``}
    `);
    if (linked.rowCount) console.log(`linked ${linked.rowCount} rendered master(s) to the copy the renderer already made.`);
  }

  const rows = await db
    .select({
      id: files.id,
      tenantId: files.tenantId,
      name: files.name,
      ownerId: files.ownerId,
      sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(
      and(
        eq(files.kind, "video"),
        isNull(files.deletedAt),
        // Nothing to encode without bytes: a row whose upload never completed.
        sql`${files.storageKey} is not null`,
        isNull(files.proxyFileId),
        /* A proxy is not made of a proxy. The tag is what `makeProxyFile`
           writes on every copy it creates, so this stays true however many
           times the backfill is run; the two `not exists` clauses catch the
           copies made before the tag existed, which carry no tag but are
           named by the row they are a copy of. */
        sql`not (${files.tags} @> array['proxy']::text[])`,
        sql`not exists (select 1 from video_exports ve where ve.proxy_file_id = ${files.id})`,
        sql`not exists (select 1 from files m where m.proxy_file_id = ${files.id})`,
        ...(tenantId ? [eq(files.tenantId, tenantId)] : []),
      ),
    )
    .orderBy(files.createdAt);

  if (!rows.length) {
    console.log("Every video in the store already has a preview copy. Nothing to do.");
    process.exit(0);
  }

  const bytes = rows.reduce((n, r) => n + (r.sizeBytes ?? 0), 0);
  console.log(
    `${rows.length} clip(s) without a preview copy, ${(bytes / 1e9).toFixed(2)} GB of masters between them.`,
  );

  if (dry) {
    for (const row of rows) {
      console.log(`  would queue ${row.id}  ${((row.sizeBytes ?? 0) / 1e6).toFixed(0).padStart(6)} MB  ${row.name}`);
    }
    console.log("\n--dry: nothing queued.");
    process.exit(0);
  }

  let queued = 0;
  for (const row of rows) {
    try {
      await enqueue({
        tenantId: row.tenantId,
        type: "files.proxy",
        module: "files",
        payload: { fileId: row.id },
        objectType: "file",
        objectId: row.id,
        createdBy: row.ownerId,
        dedupeKey: `proxy:${row.id}`,
        // Under an upload's own proxy (5) and well under a poster (6): the
        // clip somebody just dropped in matters more than one from last month.
        priority: 4,
      });
      queued += 1;
    } catch (err) {
      // One unqueueable row must not stop the other thirty-nine.
      console.warn(`  could not queue ${row.id} (${row.name}):`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`queued ${queued} of ${rows.length} clip(s). Watch them land: pm2 logs aura-worker.`);
  process.exit(0);
}

void main();
