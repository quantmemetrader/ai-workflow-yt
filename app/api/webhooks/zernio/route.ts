import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publishLog, publishPosts, publishTargets } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/**
 * What the platform said, after the fact.
 *
 * A publish is not finished when Zernio accepts it. A scheduled post goes out
 * hours later; a video is transcoded before it is live; a platform can reject
 * something that passed every check at submission. Until now the studio only
 * learned any of that on the next channel sync, so the publish log showed
 * "queued" for something that had been live — or rejected — since lunchtime.
 *
 * Two things this deliberately does not do:
 *
 *   — **It does not trust the body to say which studio it belongs to.** The
 *     target is found by the platform's own post id, and that row carries the
 *     tenant. A payload naming a tenant would be a payload that could name
 *     somebody else's.
 *   — **It does not invent an outcome.** Anything it cannot map to one of the
 *     states the product has is recorded verbatim in the log and changes no
 *     state, because a wrong state is worse than a late one.
 *
 * Point Zernio at `<APP_URL>/api/webhooks/zernio`. If `ZERNIO_WEBHOOK_SECRET`
 * is set, the body must carry a matching `X-Zernio-Signature` (hex HMAC-SHA256
 * of the raw body); without the variable set, the route still works and says
 * so in the log, because a studio that has not configured signing is better
 * served by late-but-working than by silence.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response("Too large", { status: 413 });

  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  const signed = verify(raw, request.headers.get("x-zernio-signature"), secret);
  if (secret && !signed) {
    // Deliberately terse: a signature check that explains itself is a
    // signature check that helps somebody get past it.
    return new Response("Bad signature", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  /*
   * Zernio's shape varies by event; the post can arrive at the top level or
   * nested. Both are read, and neither is required to be there.
   */
  const post = (typeof body.post === "object" && body.post !== null ? body.post : body) as Record<
    string,
    unknown
  >;
  const platformPostId = firstString(post._id, post.id, post.postId, body.postId);
  if (!platformPostId) {
    return Response.json({ ok: true, note: "no post id in the payload; nothing to match" });
  }

  /* The tenant comes from the post this target belongs to, never from the
     payload: a body that named a tenant would be a body that could name
     somebody else's. */
  const [target] = await db
    .select({
      id: publishTargets.id,
      state: publishTargets.state,
      attempts: publishTargets.attempts,
      tenantId: publishPosts.tenantId,
    })
    .from(publishTargets)
    .innerJoin(publishPosts, eq(publishPosts.id, publishTargets.postId))
    .where(eq(publishTargets.platformPostId, platformPostId))
    .limit(1);

  if (!target) {
    // Not ours, or ours from before this table existed. Acknowledged so the
    // sender stops retrying, and not recorded, because there is nothing to
    // attach it to.
    return Response.json({ ok: true, note: "no matching target" });
  }

  const status = (firstString(body.event, body.status, post.status) ?? "").toLowerCase();
  const url = firstString(post.url, post.permalink, body.url);
  const error = firstString(post.error, body.error, body.message);

  /*
   * Only the outcomes the product has. "processing", "scheduled" and anything
   * unrecognised are recorded and change nothing — the state a person reads
   * should be the last thing actually known, not the last thing received.
   */
  const outcome =
    /publish|success|complete|live|posted/.test(status) && !/fail|error|reject/.test(status)
      ? "published"
      : /fail|error|reject|denied/.test(status)
        ? "failed"
        : null;

  await db.insert(publishLog).values({
    id: newId("job"),
    tenantId: target.tenantId,
    targetId: target.id,
    attempt: target.attempts || 1,
    idempotencyKey: `webhook:${platformPostId}`,
    state: outcome ?? target.state,
    response: { via: "webhook", signed: Boolean(secret) && signed, ...body },
    error: error?.slice(0, 2000) ?? null,
    durationMs: null,
  });

  if (outcome) {
    await db
      .update(publishTargets)
      .set({
        state: outcome,
        ...(url ? { platformUrl: url } : {}),
        ...(outcome === "failed" && error ? { error: error.slice(0, 2000) } : {}),
        ...(outcome === "published" ? { publishedAt: new Date(), error: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(publishTargets.id, target.id), eq(publishTargets.platformPostId, platformPostId)));
  }

  return Response.json({ ok: true, target: target.id, state: outcome ?? "unchanged" });
}

/** Constant-time comparison of a hex HMAC, tolerant of a `sha256=` prefix. */
function verify(raw: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.replace(/^sha256=/i, "").trim();
  const mine = createHmac("sha256", secret).update(raw).digest("hex");
  if (given.length !== mine.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(mine, "hex"));
  } catch {
    return false;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
