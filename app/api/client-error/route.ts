/**
 * Where the browser reports what broke on its side.
 *
 * "This page couldn't load" happened again and again for the studio and left
 * no trace on the server: the failure was in the browser (a script from an
 * older build, a DOM rewritten by the translate extension). The boot script
 * in app/layout.tsx and the error pages send the message here, and it goes to
 * the same log as every server error (`pm2 logs aura`), so the next one can
 * be read instead of guessed at.
 *
 * Nothing is stored and nothing is returned. Bodies are capped, one address
 * gets thirty a minute; a signed-out
 * page never gets here (the proxy sends it to /login), which is fine.
 */
/* So many reports a minute from one address and the rest are dropped: the
   endpoint is open, and the log is shared (security review, 3 Oct). */
const RECENT = new Map<string, { n: number; at: number }>();
const PER_MINUTE = 30;
function allowed(ip: string): boolean {
  const now = Date.now();
  const r = RECENT.get(ip);
  if (!r || now - r.at > 60_000) {
    if (RECENT.size > 5000) RECENT.clear();
    RECENT.set(ip, { n: 1, at: now });
    return true;
  }
  r.n += 1;
  return r.n <= PER_MINUTE;
}

export async function POST(request: Request) {
  if (!allowed(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?")) return new Response(null, { status: 204 });
  let text = "";
  try {
    text = (await request.text()).slice(0, 4000);
  } catch {
    return new Response(null, { status: 204 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { message: text.slice(0, 300) };
  }
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  console.error(
    "[client-error]",
    JSON.stringify({
      kind: s(body.kind, 20),
      url: s(body.url, 300),
      message: s(body.message, 500),
      digest: s(body.digest, 40),
      stack: s(body.stack, 1500),
      ua: (request.headers.get("user-agent") ?? "").slice(0, 160),
    }),
  );
  return new Response(null, { status: 204 });
}
