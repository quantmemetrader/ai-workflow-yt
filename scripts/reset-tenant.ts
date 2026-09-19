/**
 * Empties the studio and leaves one real owner account behind.
 *
 * This deletes **everything**: people, files, chat, agent conversations, the
 * token ledger, the audit log, research topics and their cached series. The
 * schema and the source registry stay, because those are code, not content.
 *
 * It refuses to run without `CONFIRM=wipe`, and it prints what it is about to
 * destroy first. Take a `pg_dump` before running it — `npm run db:backup`.
 *
 *   CONFIRM=wipe OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" npm run db:reset
 *
 * The password is generated and printed once. Nothing else prints it, and it
 * is stored only as a scrypt hash.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { budgets, entitlements, tenants, users, type Module } from "../lib/db/schema";
import { generatePassword, hashPassword } from "../lib/auth/password";
import { newId } from "../lib/ids";
import { syncSourceRegistry } from "../lib/research/ingest";

const ALL_MODULES: Module[] = [
  "chat", "files", "research", "script", "video", "publish",
  "accounting", "finance", "legal", "hr", "admin",
];

/** Everything that holds content. `research_sources` is deliberately absent:
 * it is generated from lib/research/sources.ts, not entered by anyone. */
const CONTENT_TABLES = [
  "topic_events", "comparisons", "series_cache", "topics",
  "job_events", "jobs",
  "knowledge_versions", "knowledge",
  "citations", "tool_calls", "agent_messages", "conversations",
  "ai_usage", "budgets",
  "chat_reactions", "chat_messages", "chat_members", "chat_channels",
  "file_meta", "file_chunks", "file_versions", "relation_tuples", "files", "folders",
  "notifications", "audit_log", "invites", "entitlements", "team_members", "teams",
  "sessions", "settings", "sequences", "users", "tenants",
];

/** Tables that survive on purpose, and why. Everything in the database must be
 * in one list or the other; the check below refuses to run otherwise. */
const KEPT_TABLES = [
  // Generated from lib/research/sources.ts, not entered by anyone.
  "research_sources",
];

async function main() {
  const tenantId = process.env.TENANT_ID ?? "tnt_aurafarmers";
  const tenantName = process.env.TENANT_NAME ?? "Aura Farmers";
  const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const name = process.env.OWNER_NAME ?? "Studio owner";

  if (!email) {
    console.error("Set OWNER_EMAIL — the wipe leaves exactly one account behind, and it needs an address.");
    process.exit(1);
  }

  // "Deletes everything" has to stay true as the schema grows. A table added
  // later and forgotten here would survive the wipe still referencing people
  // who no longer exist — so check the list against the database rather than
  // trusting that someone remembered.
  const { rows: present } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const accounted = new Set([...CONTENT_TABLES, ...KEPT_TABLES]);
  const unaccounted = present.map((r) => r.tablename).filter((t) => !accounted.has(t));
  if (unaccounted.length) {
    console.error(
      `Refusing: ${unaccounted.join(", ")} exists but is in neither CONTENT_TABLES nor KEPT_TABLES.\n` +
        "Add it to one of them in scripts/reset-tenant.ts — a wipe that leaves a table behind is not a wipe.",
    );
    process.exit(1);
  }

  console.log("About to delete, from", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));
  for (const table of ["users", "files", "chat_messages", "conversations", "topics", "audit_log"]) {
    const { rows } = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`));
    console.log(`  ${table.padEnd(16)} ${rows[0]?.n ?? 0}`);
  }

  if (process.env.CONFIRM !== "wipe") {
    console.error("\nRefusing to run. Re-run with CONFIRM=wipe if this is what you want.");
    process.exit(1);
  }

  // One statement, so the studio is never half-deleted.
  await db.execute(sql.raw(`truncate table ${CONTENT_TABLES.join(", ")} restart identity cascade`));
  console.log("\nEmptied.");

  const password = process.env.OWNER_PASSWORD || generatePassword();
  const userId = newId("usr");

  await db.insert(tenants).values({ id: tenantId, name: tenantName, defaultLocale: "zh-CN" });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email,
    name,
    role: "owner",
    status: "active",
    passwordHash: await hashPassword(password),
    locale: "zh-CN",
  });
  await db.insert(entitlements).values(ALL_MODULES.map((module) => ({ userId, module })));
  await db.insert(budgets).values({
    id: newId("bdg"),
    tenantId,
    scope: "user",
    scopeId: userId,
    capMicros: 50 * 1_000_000, // US$50 a period, until an admin sets a real one
  });

  // The source registry is code; put it back.
  await syncSourceRegistry();

  console.log(`\nOwner account: ${email}`);
  console.log(`Password:      ${password}`);
  console.log("\nPrinted once. Change it after signing in, and add the rest of the studio with:");
  console.log('  EMAIL=… NAME="…" MODULES=chat,files,research npm run db:add-user');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
