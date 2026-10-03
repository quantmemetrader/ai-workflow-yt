/**
 * Where to go after signing in: the `?next=` that `proxy.ts` puts on the
 * login link, only when it is a path on this site.
 *
 * One leading slash and not two, and no backslash second (`//host` and `/\host`
 * are other hosts to a browser). No whitespace, control characters or
 * backslashes anywhere: browsers drop tabs and newlines from a URL, so
 * `/\t/host` would become `//host` after the first check passed. Not back to
 * the login screens. Null otherwise, and the caller uses its usual landing page.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  if (!/^\/[^/\\]/.test(raw)) return null;
  for (const c of raw) {
    const n = c.charCodeAt(0);
    if (n <= 0x20 || n === 0x7f || c === "\\") return null;
  }
  if (/^\/login(?:[/?#]|$)/.test(raw)) return null;
  return raw;
}
