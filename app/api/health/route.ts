import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Liveness for uptime checks and deploy verification. It proves the process
 * can reach Postgres — the one dependency without which nothing works — and
 * says nothing else: no versions, no counts, no configuration.
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { ok: true, db: "up", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
