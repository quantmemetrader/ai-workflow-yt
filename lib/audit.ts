import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, users, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { newId } from "@/lib/ids";

/**
 * The audit log (spec §4.11). An admin reading a file they were never granted
 * is recorded here exactly like anyone else's read — that visibility is the
 * point, so this must never be conditional on who the actor is.
 */
export async function audit(
  actor: Pick<Viewer, "id" | "tenantId"> | null,
  action: string,
  opts: {
    objectType?: string;
    objectId?: string;
    module?: Module;
    meta?: Record<string, unknown>;
    tenantId?: string;
  } = {},
) {
  let ip: string | undefined;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  } catch {
    // Outside a request (cron, worker) there are no headers; that is fine.
  }

  await db
    .insert(auditLog)
    .values({
      id: newId("aud"),
      tenantId: actor?.tenantId ?? opts.tenantId ?? "unknown",
      actorId: actor?.id,
      action,
      objectType: opts.objectType,
      objectId: opts.objectId,
      module: opts.module,
      meta: opts.meta ?? {},
      ip,
    })
    .catch((err) => {
      // A failed audit write must not take the user's action down with it, but
      // it must be loud in the logs.
      console.error("[audit] write failed", action, err);
    });
}

export async function recentAudit(
  tenantId: string,
  filter: { actorId?: string; action?: string; objectId?: string; since?: Date; limit?: number } = {},
) {
  const conds = [eq(auditLog.tenantId, tenantId)];
  if (filter.actorId) conds.push(eq(auditLog.actorId, filter.actorId));
  // The filter is a prefix, not a pattern: `%` and `_` arriving from an admin's
  // filter box would otherwise widen the match rather than narrow it.
  if (filter.action) {
    const prefix = filter.action.replace(/([\\%_])/g, "\\$1");
    conds.push(sql`${auditLog.action} like ${prefix + "%"} escape '\\'`);
  }
  if (filter.objectId) conds.push(eq(auditLog.objectId, filter.objectId));
  if (filter.since) conds.push(gte(auditLog.at, filter.since));

  return db
    .select({ entry: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(and(...conds))
    .orderBy(desc(auditLog.at))
    .limit(filter.limit ?? 100);
}
