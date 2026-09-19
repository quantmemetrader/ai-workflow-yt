import { NextResponse, type NextRequest } from "next/server";

/**
 * A cheap front gate (Next 16 renamed middleware to proxy).
 *
 * All it does is bounce a request with no session cookie to the login screen,
 * so a signed-out visitor never sees a module shell flash before redirecting.
 * It is *not* the security boundary: the cookie's validity, the person behind
 * it and every permission are checked again inside each page, action and route
 * handler, where the database is. A proxy that matched nothing would leak no
 * data — it would only be uglier.
 *
 * `/demo/*` stays open: that is the approved design canvas, published for
 * review, with no live data behind it.
 */
const SESSION_COOKIE = "af_session";

const PUBLIC = [/^\/login$/, /^\/demo(\/|$)/, /^\/api\/health$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  // A single leading slash only. `//evil.example` is a valid pathname and a
  // protocol-relative URL, so anything that later reads `next` and redirects to
  // it would send people off this host. Nothing reads it yet; this is so that
  // whatever does cannot inherit an open redirect.
  if (pathname !== "/" && /^\/[^/\\]/.test(pathname)) {
    login.searchParams.set("next", pathname);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets, the favicon, and the design
     * canvas's static bundle. Note that Server Functions post back to the
     * route that rendered them, so anything excluded here is still checked by
     * the action itself.
     */
    "/((?!_next/static|_next/image|favicon.ico|avatars/|app/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)",
  ],
};
