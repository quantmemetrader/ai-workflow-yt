import { NextResponse, type NextRequest } from "next/server";

/**
 * Pictures from Google's own CDNs, served from this origin.
 *
 * YouTube thumbnails and channel avatars live on `i.ytimg.com` and
 * `yt3.ggpht.com`. Both are unreachable from inside mainland China and from
 * plenty of corporate networks — so the Research strip drew a row of empty
 * grey boxes for exactly the people this studio employs, with nothing on
 * screen to say why. The data was there; only the pictures were missing.
 *
 * Fetching them server-side fixes it, and costs almost nothing: the images are
 * tiny, immutable, and cached for a day at the edge and in the browser.
 *
 * Three rules, because an open image proxy is a gift to anybody looking for
 * one:
 *
 *   1. **An allowlist of hosts**, not a pattern. Nothing but Google's picture
 *      CDNs.
 *   2. **Only what looks like a picture comes back.** A response that is not
 *      an image is refused rather than passed through.
 *   3. **Signed-in only.** `proxy.ts` already bounces an anonymous request;
 *      this route is for the app's own screens, not for the internet.
 */
const ALLOWED = new Set(["i.ytimg.com", "img.youtube.com", "yt3.ggpht.com", "yt3.googleusercontent.com"]);

/**
 * The other platforms' picture CDNs, by suffix, because each of them spreads
 * pictures over numbered hosts (p16-, p19-; sns-webpic-qc, sns-img-qc).
 *
 * The Trends strip gained 抖音, 小红书, B站 and TikTok, and every one of their
 * cards drew the grey title box instead of the cover: the allowlist above
 * was YouTube only, so the proxy refused them before it had tried. All four
 * CDNs answer this box directly — measured, 200 and image/jpeg — the refusal
 * was ours. Still suffixes of known picture hosts, never a pattern, so this
 * stays a picture proxy and not an open one.
 */
const ALLOWED_SUFFIXES = [
  ".xhscdn.com",
  "ci.xiaohongshu.com",
  ".tiktokcdn.com",
  ".tiktokcdn-us.com",
  ".tiktokcdn-eu.com",
  ".douyinpic.com",
  ".hdslb.com",
  ".sinaimg.cn",
];

const allowed = (host: string) => ALLOWED.has(host) || ALLOWED_SUFFIXES.some((s) => host === s || host.endsWith(s));

/** A day in the browser, a week at the edge: a thumbnail for a given video id
 * never changes. */
const CACHE = "public, max-age=86400, s-maxage=604800, immutable";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return new NextResponse("missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("not a url", { status: 400 });
  }

  if (!allowed(target.hostname)) return new NextResponse("not allowed", { status: 403 });
  /* 小红书 hands out `http://` cover links. The host serves the same picture
     over TLS, so the scheme is corrected rather than the picture refused. */
  if (target.protocol === "http:") target.protocol = "https:";
  if (target.protocol !== "https:") return new NextResponse("not allowed", { status: 403 });

  const upstream = await fetch(target, {
    // No cookies, no referrer: this is a fetch of a public picture, and it
    // should look like nothing else.
    headers: { accept: "image/*" },
    redirect: "follow",
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok) return new NextResponse("upstream said no", { status: 502 });

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return new NextResponse("not an image", { status: 502 });

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": CACHE,
      "content-length": upstream.headers.get("content-length") ?? "",
    },
  });
}
