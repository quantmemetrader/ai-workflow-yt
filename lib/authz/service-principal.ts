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

const EMAIL = "service@aurafarmers.internal";

let cached: string | null = null;

/** The service principal's user id, created on first use. */
export async function servicePrincipalId(tenantId: string): Promise<string> {
  if (cached) return cached;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, EMAIL)))
    .limit(1);

  if (existing) {
    cached = existing.id;
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
    cached = row.id;
    return row.id;
  }

  const { rows } = await db.execute<{ id: string }>(
    sql`select id from users where tenant_id = ${tenantId} and email = ${EMAIL} limit 1`,
  );
  if (!rows[0]?.id) throw new Error("Could not create or find the service principal");
  cached = rows[0].id;
  return cached;
}

/** A `viewer`-shaped stub for the ledger and the audit log. Carries no
 * entitlements on purpose: it is an identity to charge, not one to read with. */
export async function servicePrincipal(tenantId: string) {
  return { id: await servicePrincipalId(tenantId), tenantId };
}
