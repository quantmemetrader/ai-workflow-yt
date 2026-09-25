/**
 * Permission smoke test — the acceptance checks the spec names in §9, run
 * against the real database.
 *
 *   npm run smoke
 *
 * These are the checks that must never regress: they are the difference
 * between a work platform and a leak.
 *
 * It builds its own people and documents in a scratch tenant, asserts the
 * rules against them, and deletes them again. It used to read the seeded demo
 * studio instead, which meant the one check standing between a leak and a
 * deploy could only run on a database that had demo data in it — and
 * `scripts/deploy.sh` runs this before it builds. Nothing here touches, reads
 * or counts the studio's own content.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import {
  entitlements,
  files,
  folders,
  relationTuples,
  tenants,
  users,
  type Module,
} from "../lib/db/schema";
import type { Viewer } from "../lib/auth/dal";
import { canReadFiles, relationOn, share, shareCeiling } from "../lib/authz/rebac";
import { searchFiles } from "../lib/ai/retrieval";
import { subjectsFor } from "../lib/authz/subjects";
import { newId, ulid } from "../lib/ids";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * A token per fixture document: each appears in exactly one of them and
 * nowhere in the studio's own files, so a search can assert an exact number of
 * matches.
 *
 * Independent tokens, not variations on one stem — retrieval scores names by
 * trigram similarity as well as by substring, and tokens sharing a prefix
 * would match each other's documents, which would make the filtering test
 * measure nothing.
 */
const run = ulid().slice(-10);
const TENANT = `tnt_smoke_${run}`;
const token = () => randomBytes(8).toString("hex");
const STYLE = token();
const ZH = token();
const BOARD = token();

const MODULES: Module[] = ["chat", "files"];

function viewer(
  user: { id: string; role: Viewer["role"]; email: string; name: string },
): Viewer {
  return {
    id: user.id,
    tenantId: TENANT,
    email: user.email,
    name: user.name,
    nameLocal: null,
    avatarUrl: null,
    title: null,
    workRole: null,
    role: user.role,
    locale: "en",
    modules: MODULES,
    teamIds: [],
    subjects: subjectsFor({ id: user.id, tenantId: TENANT, role: user.role }, []),
    isAdmin: user.role === "owner" || user.role === "admin",
    staleSeen: false,
  };
}

/**
 * A studio in miniature: a folder the whole tenant may edit, a folder only one
 * person holds, and a guest who is inside the tenant but is not the studio.
 */
async function build() {
  const producer = { id: newId("usr"), role: "member" as const, email: `producer.${run}@smoke.invalid`, name: "Smoke Producer" };
  const head = { id: newId("usr"), role: "admin" as const, email: `head.${run}@smoke.invalid`, name: "Smoke Head" };
  const guest = { id: newId("usr"), role: "guest" as const, email: `guest.${run}@smoke.invalid`, name: "Smoke Guest" };
  const people = [producer, head, guest];

  const studioFolder = newId("fld");
  const boardFolder = newId("fld");
  const styleFile = newId("fil");
  const zhFile = newId("fil");
  const boardFile = newId("fil");

  await db.insert(tenants).values({ id: TENANT, name: `Smoke ${run}` });
  await db.insert(users).values(
    people.map((p) => ({
      id: p.id,
      tenantId: TENANT,
      email: p.email,
      name: p.name,
      role: p.role,
      status: "active" as const,
    })),
  );
  await db
    .insert(entitlements)
    .values(people.flatMap((p) => MODULES.map((module) => ({ userId: p.id, module }))));

  await db.insert(folders).values([
    { id: studioFolder, tenantId: TENANT, name: "Studio", path: [studioFolder], ownerId: head.id },
    // A sibling of Studio, not a child: anything under Studio inherits the
    // studio-wide grant, so a folder only the board may read has to sit outside
    // it. "You are seeing a filtered subset" must be true for someone.
    { id: boardFolder, tenantId: TENANT, name: "Board", path: [boardFolder], ownerId: head.id },
  ]);

  await db.insert(files).values([
    {
      id: styleFile,
      tenantId: TENANT,
      folderId: studioFolder,
      folderPath: [studioFolder],
      name: `House style ${STYLE}.md`,
      kind: "doc" as const,
      text: "Direct. One idea per sentence. We explain, we do not sell.",
      ownerId: head.id,
    },
    {
      id: zhFile,
      tenantId: TENANT,
      folderId: studioFolder,
      folderPath: [studioFolder],
      name: `Script ${ZH}.md`,
      kind: "doc" as const,
      text: "一片指甲咁大嘅晶片，决定咗你部手机下一年跑得几快。",
      ownerId: head.id,
    },
    {
      id: boardFile,
      tenantId: TENANT,
      folderId: boardFolder,
      folderPath: [boardFolder],
      name: `Board pack ${BOARD}.md`,
      kind: "doc" as const,
      text: `Gross margin 41.2% against a 38% plan. ${BOARD}. Not for circulation outside the board.`,
      ownerId: head.id,
    },
  ]);

  await db.insert(relationTuples).values([
    // The studio-wide grant. A guest is not the studio, so this reaches
    // everyone but them (lib/authz/subjects.ts).
    {
      id: newId("tup"),
      objectType: "folder",
      objectId: studioFolder,
      relation: "editor" as const,
      subjectType: "tenant",
      subjectId: TENANT,
      grantedBy: head.id,
    },
    {
      id: newId("tup"),
      objectType: "folder",
      objectId: boardFolder,
      relation: "owner" as const,
      subjectType: "user",
      subjectId: head.id,
    },
  ]);

  return {
    producer: viewer(producer),
    head: viewer(head),
    guest: viewer(guest),
    userIds: people.map((p) => p.id),
    folderIds: [studioFolder, boardFolder],
    fileIds: [styleFile, zhFile, boardFile],
    styleFile,
    zhFile,
    boardFile,
  };
}

async function tearDown(fixture: Awaited<ReturnType<typeof build>>) {
  const objectIds = [...fixture.fileIds, ...fixture.folderIds];
  await db.delete(relationTuples).where(inArray(relationTuples.objectId, objectIds));
  await db.delete(relationTuples).where(inArray(relationTuples.subjectId, [TENANT, ...fixture.userIds]));
  await db.delete(files).where(eq(files.tenantId, TENANT));
  await db.delete(folders).where(eq(folders.tenantId, TENANT));
  await db.delete(users).where(eq(users.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}

async function run_checks(f: Awaited<ReturnType<typeof build>>) {
  const { producer, head, guest } = f;

  const visibleToProducer = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, TENANT), canReadFiles(producer)));
  const visibleToHead = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, TENANT), canReadFiles(head)));
  const visibleToGuest = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, TENANT), canReadFiles(guest)));

  console.log("\nPermission filtering");
  check(
    "a producer sees the studio's shared documents",
    visibleToProducer.length === 2,
    `${visibleToProducer.length} files`,
  );
  check(
    "a producer does not see the board folder's document",
    !visibleToProducer.some((r) => r.id === f.boardFile),
  );
  check("the head of business does see it", visibleToHead.some((r) => r.id === f.boardFile));
  check(
    "a guest is inside the tenant but is not the studio",
    visibleToGuest.length === 0,
    `${visibleToGuest.length} files`,
  );

  console.log("\nRetrieval (what the agent can reach)");
  const producerBoard = await searchFiles(producer, BOARD);
  check("the agent finds no board content for a producer", producerBoard.hits.length === 0);
  check(
    "but the producer is told the answer may be partial",
    producerBoard.withheld >= 1,
    `${producerBoard.withheld} withheld`,
  );
  const headBoard = await searchFiles(head, BOARD);
  check("the head of business does retrieve it", headBoard.hits.some((h) => h.fileId === f.boardFile));

  const styleSearch = await searchFiles(producer, STYLE);
  check("shared documents are retrievable by title", styleSearch.hits.some((h) => h.fileId === f.styleFile));
  const zhSearch = await searchFiles(producer, "晶片");
  check("Chinese text matches", zhSearch.hits.some((h) => h.fileId === f.zhFile), `${zhSearch.hits.length} hits`);

  console.log("\nSharing is bounded by the sharer (§2.2.7)");
  const ceiling = await shareCeiling(producer, "file", f.styleFile);
  check("a producer holds editor through the tenant grant", ceiling === "editor", String(ceiling));

  const tooHigh = await share(producer, { type: "file", id: f.styleFile }, "owner", { type: "user", id: guest.id });
  check("granting above your own relation is refused", !tooHigh.ok && tooHigh.reason === "above-ceiling");

  const allowed = await share(producer, { type: "file", id: f.styleFile }, "viewer", { type: "user", id: guest.id });
  check("granting at or below your relation succeeds", allowed.ok);
  check("the guest now reads exactly that one file", (await relationOn(guest, "file", f.styleFile)) === "viewer");
  check("and still cannot reach the board document", (await relationOn(guest, "file", f.boardFile)) === null);
}

async function main() {
  console.log(`Fixtures in scratch tenant ${TENANT} (removed when this finishes)`);
  const fixture = await build();
  try {
    await run_checks(fixture);
  } finally {
    await tearDown(fixture);
  }

  // Nothing of the studio's may be left standing in a scratch tenant.
  const [{ leftover = 0 } = { leftover: 0 }] = (
    await db.execute<{ leftover: number }>(
      sql`select count(*)::int as leftover from users where tenant_id = ${TENANT}`,
    )
  ).rows;
  check("\nfixtures cleaned up", Number(leftover) === 0, `${leftover} row(s) left`);

  console.log(failures === 0 ? "\nAll permission checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
