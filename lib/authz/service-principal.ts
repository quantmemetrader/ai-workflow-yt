import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/**
 * The identity scheduled work runs as (spec §2).
 *
 * A background job still spends money and still reads data, and both have to
 * be attributable. Running them as "no one" would mean the token dashboard
 * cannot explain a line on the bill, and running them as the owner would mean
 * the audit log claims a person did something at 4am that they did not.
 *
 * So: a real row, with a name a person will recognise on the Admin screens,
 * and three properties that make it safe to have around —
 *
 *   — `status` is `suspended`, so it can never sign in. There is no password
 *     hash and no way to set one through the product.
 *   — `role` is `guest`, the least privileged role, so if a future code path
 *     ever resolves a viewer from it, it reaches nothing tenant-wide
 *     (`lib/authz/subjects.ts` excludes guests from the `tenant:` subject).
 *   — it holds no entitlements, so it is not a member of any module.
 *
 * It exists to be *charged* and *logged*, not to act on anyone's behalf. Jobs
 * that need to read a person's data still take that person's viewer.
 */

// Renamed with the studio (2026-09-24). The lookup below is by email, so the
// existing row was updated in the same deploy rather than left to be
// re-created under the new address as a duplicate.
const EMAIL = "service@tengya.internal";

/*
 * Keyed by tenant (REVIEW.md #11).
 *
 * A single `cached` string meant the first studio the worker touched supplied
 * the id for every studio after it, so one tenant's scheduled spend could be
 * charged to another tenant's user and written into their audit log. Latent
 * while `ingest.ts` hardcodes "the first tenant", but a cache that is wrong by
 * construction is a bug whether or not something reaches it today.
 */
const cached = new Map<string, string>();

/** The service principal's user id, created on first use. */
export async function servicePrincipalId(tenantId: string): Promise<string> {
  const hit = cached.get(tenantId);
  if (hit) return hit;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, EMAIL)))
    .limit(1);

  if (existing) {
    cached.set(tenantId, existing.id);
    return existing.id;
  }

  const id = newId("usr");
  // Two workers can reach this at the same moment; the loser takes the
  // winner's row rather than failing the job it was in the middle of.
  const [row] = await db
    .insert(users)
    .values({
      id,
      tenantId,
      email: EMAIL,
      name: "Scheduled work",
      nameLocal: "排程工作",
      role: "guest",
      status: "suspended",
      passwordHash: null,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (row) {
    cached.set(tenantId, row.id);
    return row.id;
  }

  const { rows } = await db.execute<{ id: string }>(
    sql`select id from users where tenant_id = ${tenantId} and email = ${EMAIL} limit 1`,
  );
  if (!rows[0]?.id) throw new Error("Could not create or find the service principal");
  cached.set(tenantId, rows[0].id);
  return rows[0].id;
}

/** A `viewer`-shaped stub for the ledger and the audit log. Carries no
 * entitlements on purpose: it is an identity to charge, not one to read with. */
export async function servicePrincipal(tenantId: string) {
  return { id: await servicePrincipalId(tenantId), tenantId };
}
