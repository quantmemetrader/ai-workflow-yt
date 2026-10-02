import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Liveness for uptime checks and deploy verification. It proves the process
 * can reach Postgres — the one dependency without which nothing works — and
 * says nothing else beyond the release id, which the page compares with its
 * own so a tab left open across a deploy refreshes itself (2 Oct: a client
 * saw "An unexpected response was received from the server" on a tab from
 * the previous build).
 */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { ok: true, db: "up", ms: Date.now() - started, release: process.env.NEXT_DEPLOYMENT_ID ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
