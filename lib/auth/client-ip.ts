/**
 * The address a request came from, for throttling, the audit log, sessions
 * and trusted devices.
 *
 * tengya.media sits behind Cloudflare, and Caddy hands Node the connection's
 * own address in `x-forwarded-for` — Cloudflare's edge, not the person. So
 * `cf-connecting-ip` (the visitor, as Cloudflare saw them) comes first, then
 * the first `x-forwarded-for` hop, then `x-real-ip`.
 *
 * Trusting `cf-connecting-ip` is only safe while the box takes traffic for
 * this site from Cloudflare alone: if Caddy ever answers the open internet
 * directly, anyone can send that header and pick their own address (and
 * dodge the sign-in throttle). Keep the origin locked to Cloudflare, or drop
 * the first line here.
 */
export function clientIp(h: { get(name: string): string | null }): string | undefined {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd.slice(0, 64);
  return h.get("x-real-ip")?.trim().slice(0, 64) || undefined;
}
