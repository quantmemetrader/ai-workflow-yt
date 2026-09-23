/**
 * Owner tuples for scripts written before sharing existed.
 *
 * `createScript` now writes an owner tuple, the way Files always has. Scripts
 * written before that have none, so their own authors would see "You cannot
 * share this" on their own script. One row per script, skipped where it is
 * already there.
 *
 *   npx tsx scripts/backfill-script-owners.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { relationTuples, scripts } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

async function main() {
  const rows = await db
    .select({ id: scripts.id, ownerId: scripts.ownerId })
    .from(scripts)
    .where(isNull(scripts.deletedAt));

  let written = 0;
  for (const row of rows) {
    if (!row.ownerId) continue;
    const [existing] = await db
      .select({ id: relationTuples.id })
      .from(relationTuples)
      .where(
        and(
          eq(relationTuples.objectType, "script"),
          eq(relationTuples.objectId, row.id),
          eq(relationTuples.subjectType, "user"),
          eq(relationTuples.subjectId, row.ownerId),
          eq(relationTuples.relation, "owner"),
        ),
      )
      .limit(1);
    if (existing) continue;

    await db.insert(relationTuples).values({
      id: newId("tup"),
      objectType: "script",
      objectId: row.id,
      relation: "owner",
      subjectType: "user",
      subjectId: row.ownerId,
      grantedBy: row.ownerId,
    });
    written++;
  }

  console.log(`${rows.length} scripts, ${written} owner tuples written.`);
  process.exit(0);
}

void main();
