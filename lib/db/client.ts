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

/*
 * Whether pm2 is keeping this process alive: the web server (cluster mode),
 * the worker (fork mode), and the scheduled scripts while they run.
 *
 * pm2 gives every child a `pm_id` — in fork mode through the spawn
 * environment, in cluster mode by copying its `pm2_env` blob into process.env
 * before the script loads (pm2/lib/ProcessContainer.js). It is "0" for the
 * first process, so this tests presence, not truth. `next build`, `next dev`,
 * a script run by hand from a shell and a serverless function all come up
 * without it.
 *
 * Two things below depend on it: the heartbeat, and whether an idle
 * connection may hold the process open.
 */
const underPm2 = process.env.pm_id !== undefined;

const pool =
  global.__pgPool ??
  new Pool({
    connectionString: env.databaseUrl,
    /*
     * Sixteen, not eight.
     *
     * A page renders its queries in parallel — Finance opens with six, and the
     * layout, the rail and the agent panel add their own — and every one of
     * them takes 236ms against Singapore. Eight connections per process meant
     * the seventh query queued behind a round trip, and on a box running at
     * three times its core count the queue outlived the ten-second connect
     * timeout: `/finance` answered 500 with "timeout exceeded when trying to
     * connect" while the health check, which needs one connection, stayed
     * green.
     *
     * Neon's pooler is pgbouncer and fans thousands of client connections onto
     * a handful of Postgres ones, so this costs it nothing.
     */
    max: 16,
    /*
     * Five minutes, not thirty seconds.
     *
     * Measured on the box: a warm connection answers `select 1` in 244ms and a
     * cold one in 1,900ms, because a cold one pays TCP plus a TLS handshake to
     * Singapore first. At a thirty-second idle timeout a quiet worker closed
     * every connection between jobs and paid that handshake again on the next
     * one — the box's own health check took 1,667ms for a query that costs
     * two. The heartbeat below keeps one alive past even this.
     */
    idleTimeoutMillis: 5 * 60_000,
    /*
     * Twenty seconds. Long, deliberately: the alternative to waiting is a 500,
     * and against a database on another continent from a machine that is
     * routinely oversubscribed, a connection that takes twelve seconds is slow
     * rather than broken.
     */
    connectionTimeoutMillis: 20_000,
    // Neon terminates idle TLS sessions; keepalive stops us from handing a
    // dead socket to the first request after a quiet period.
    keepAlive: true,
    /*
     * Every connection starts with a known search path, set before the pool
     * lets anyone use it.
     *
     * This is a bug we have already had, not belt and braces. `DATABASE_URL`
     * points at Neon's pooler, which is pgbouncer, and pgbouncer hands the
     * same server connection to one client after another, so session state
     * leaks: one `pg_dump` through the pooler (it opens with
     * `set_config('search_path', '', false)`) left a pooled connection with an
     * empty search path, and sign-in failed with `relation "users" does not
     * exist` while the health check, which only runs `select 1`, stayed
     * green. The backup now uses the direct endpoint; this makes the app
     * immune to the class rather than to the instance.
     *
     * `onConnect`, not the pool's "connect" event. pg-pool emits that event as
     * it hands the new client to the request that was waiting for it, so a SET
     * issued from the handler ran alongside that request's first statement —
     * pg warned about it on every cron run ("Calling client.query() when the
     * client is already executing a query is deprecated"), and pg 9 will
     * refuse the second query outright. This hook is awaited before the client
     * is released to anyone, and if the SET fails the connection is closed and
     * the request fails, rather than running on whatever path the pooler left
     * behind.
     */
    onConnect: async (client) => {
      await client.query("set search_path to public");
    },
    /*
     * Outside pm2, let the process exit when the pool is all that is left.
     *
     * An idle connection is an open socket with a five-minute timer on it, and
     * both hold the event loop open: a script that did not call `pool.end()`
     * sat for five minutes after its last query — or for ever, while the
     * heartbeat still ran everywhere. Under pm2 nothing changes; the web
     * server and the worker have their own reasons to stay up.
     */
    allowExitOnIdle: !underPm2,
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

  /*
   * And keep one alive — in the processes pm2 runs, and only there.
   *
   * The box is in Amsterdam and pays 1.9 seconds for a connection it let go,
   * so the web server and the worker ping every twenty seconds. Nothing else
   * should. A serverless function is frozen between requests, and its
   * handshake is local anyway. A build, `next dev` and a one-off script have
   * nothing to keep warm — and the timer, though unref'd, put a connection to
   * work every twenty seconds, and a connection at work is a socket that
   * holds the event loop open: sixteen lab scripts from September were found
   * still running in October for exactly this reason. The scheduled pm2
   * scripts get the heartbeat too, and end themselves as they always have.
   */
  if (underPm2) {
    const beat = setInterval(() => {
      void pool.query("select 1").catch(() => {
        // A failed heartbeat is not news: the retry wrapper and the next real
        // query both report properly, and logging here would fill the log
        // every twenty seconds during an outage.
      });
    }, 20_000);
    // Never hold the process open on its own account.
    beat.unref?.();
  }
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
