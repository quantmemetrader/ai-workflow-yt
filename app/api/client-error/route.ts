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
 * Nothing is stored and nothing is returned. Bodies are capped; a signed-out
 * page never gets here (the proxy sends it to /login), which is fine.
 */
export async function POST(request: Request) {
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
