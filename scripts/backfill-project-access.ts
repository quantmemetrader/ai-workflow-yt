/**
 * Everyone can see the video projects that exist today.
 *
 * Projects became private to whoever made them (lib/video/access.ts). Before
 * that every cut was studio-wide, and the studio agreed the ones already made
 * stay that way: one "everyone can view" tuple per existing project, which the
 * owner can take away from the Access dialog. Skipped where it is already there.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/backfill-project-access.ts
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { relationTuples, videoProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

async function main() {
  const rows = await db
    .select({ id: videoProjects.id, tenantId: videoProjects.tenantId, ownerId: videoProjects.ownerId })
    .from(videoProjects)
    .where(isNull(videoProjects.deletedAt));

  let written = 0;
  for (const row of rows) {
    const [existing] = await db
      .select({ id: relationTuples.id })
      .from(relationTuples)
      .where(
        and(
          eq(relationTuples.objectType, "project"),
          eq(relationTuples.objectId, row.id),
          eq(relationTuples.subjectType, "tenant"),
          eq(relationTuples.subjectId, row.tenantId),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(relationTuples).values({
      id: newId("tup"),
      objectType: "project",
      objectId: row.id,
      relation: "viewer",
      subjectType: "tenant",
      subjectId: row.tenantId,
      grantedBy: row.ownerId,
    });
    written += 1;
  }
  console.log(`${rows.length} projects, ${written} shared with everyone`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
