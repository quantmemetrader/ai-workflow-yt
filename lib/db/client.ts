import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * One pool per server instance. Vercel's Fluid Compute reuses instances
 * across concurrent requests, so a small pool per instance against Neon's
 * pgbouncer endpoint is the right shape: connections are reused, and Neon
 * fans thousands of client connections onto a handful of Postgres ones.
 */
declare global {
  // `var` is required here: `let`/`const` in a global declaration do not
  // attach to globalThis, which is the whole point of holding the pool there
  // across hot reloads.
  var __pgPool: Pool | undefined;
  var __pgWarmed: boolean | undefined;
}

const pool =
  global.__pgPool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon terminates idle TLS sessions; keepalive stops us from handing a
    // dead socket to the first request after a quiet period.
    keepAlive: true,
  });

if (!env.isProd) global.__pgPool = pool;

/**
 * Open a couple of connections at boot.
 *
 * The first query on a cold pool pays TCP plus a TLS handshake on top of the
 * round trip, which against a database on another continent is most of a
 * second. A long-lived pm2 process only pays that once — as long as it pays it
 * before a person is waiting.
 */
if (!global.__pgWarmed) {
  global.__pgWarmed = true;
  void Promise.all([pool.query("select 1"), pool.query("select 1")]).catch((err) => {
    console.error("[db] warmup failed", err.message);
  });
}

/**
 * One retry for connection-class failures.
 *
 * The database is in Singapore and the app is in Amsterdam. Even with IPv4
 * resolution forced (Neon publishes AAAA records this box cannot route), a
 * small share of connections still lose the race to `connectionTimeoutMillis`
 * — and one lost connection rendered a 500 page, because a page is one query
 * away from failing. Nothing here is a write that could be applied twice: a
 * connection that never opened ran no statement.
 *
 * Deliberately one retry, not a loop. If the database is genuinely down, the
 * page should say so quickly rather than hold the request open.
 */
const RETRYABLE = new Set(["ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN", "ECONNREFUSED"]);

function isConnectionFailure(err: unknown): boolean {
  const e = err as { code?: string; errors?: { code?: string }[] };
  if (e?.code && RETRYABLE.has(e.code)) return true;
  // Node reports a failed multi-address connect as an AggregateError.
  return Boolean(e?.errors?.some((sub) => sub?.code && RETRYABLE.has(sub.code)));
}

const poolQuery = pool.query.bind(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
pool.query = (async (...args: any[]) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (poolQuery as any)(...args);
  } catch (err) {
    if (!isConnectionFailure(err)) throw err;
    console.warn("[db] connection failed, retrying once:", (err as Error).message);
    await new Promise((r) => setTimeout(r, 200));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (poolQuery as any)(...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { pool };
export type Db = typeof db;

/** Runs `fn` inside a transaction. Use for anything that writes more than
 * one row and must not half-apply (file + version, approval + state flip). */
export function tx<T>(fn: (trx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>) {
  return db.transaction(fn);
}

/**
 * Raw-query value helpers.
 *
 * Drizzle's query builder maps column types for you; `db.execute` does not —
 * rows come back the way node-postgres parsed them, so a timestamp arrives as
 * a string and a Postgres enum array (which pg has no parser for) arrives as
 * the literal `{chat,files}`. Both have already caused a page to crash in
 * production, so every raw query goes through these rather than trusting the
 * shape.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) return new Date(value);
  return null;
}

export function toArray<T extends string = string>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  const inner = value.replace(/^\{|\}$/g, "").trim();
  if (!inner) return [];
  return inner.split(",").map((s) => s.replace(/^"|"$/g, "") as T);
}
