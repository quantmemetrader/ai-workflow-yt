import { cookies } from "next/headers";
import { COOKIE_NAME, getSession, type Session } from "@/lib/server/auth";

/*
  Splitting the site from its data.

  The workflow is a single-node application: it holds its state in SQLite and
  reads it synchronously, and the interlocking proves a route by running eleven
  queries in the middle of a decision. That design is fine, but it needs one
  machine with one disk, and a serverless host gives every request a different
  one — the database ends up at /tmp on whichever instance answered, freshly
  seeded, so a task created by one request does not exist for the next.

  So the pages are served from the edge and the API is served from the machine
  that owns the disk. `API_ORIGIN` is what switches that on: next.config.ts
  proxies /api/* there, and the two pages that check a session server-side ask
  it rather than opening a local database that has nothing in it.

  Unset, everything runs locally exactly as before, which is what development
  and the single-box deployment both want.
*/

export function apiOrigin(): string | null {
  const raw = process.env.API_ORIGIN?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Who is signed in, asked of whoever owns the database.
 *
 * The browser's cookie is forwarded verbatim: the remote API is the only thing
 * that can validate it, because it is the only thing holding the secret and the
 * user rows. A failure here is a signed-out answer rather than a thrown page —
 * the site being unable to reach its API should look like a login screen, not
 * a stack trace.
 */
export async function resolveSession(): Promise<Session | null> {
  const origin = apiOrigin();
  if (!origin) return getSession();

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${origin}/api/session`, {
      headers: { cookie: `${COOKIE_NAME}=${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { session: Session | null };
    return data.session ?? null;
  } catch {
    return null;
  }
}
