import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { auditLog, type Module } from "@/lib/db/schema";
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
