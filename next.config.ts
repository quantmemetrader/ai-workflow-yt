import type { NextConfig } from "next";

/*
  When API_ORIGIN is set, every /api call is proxied to the machine that owns
  the database instead of being answered locally.

  A rewrite rather than a client-side base URL, deliberately: the browser keeps
  talking to one origin, so the httpOnly session cookie stays first-party, there
  is no CORS to configure, and the API host is never exposed to the page. The
  proxy hop is server to server.
*/
const apiOrigin = process.env.API_ORIGIN?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /*
    The site and the API are two builds of this repo, and rewrites are baked
    into the route manifest at build time rather than read at boot. Building
    once and running both from the same output gives the API host the site's
    proxy rule, so it forwards /api to itself and every request hangs. Separate
    output directories keep the two honest.
  */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    if (!apiOrigin) return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async redirects() {
    return [
      { source: "/", destination: "/en", permanent: false },
      { source: "/workflow", destination: "/en/workflow", permanent: false },
      { source: "/agents", destination: "/en/agents", permanent: false },
      { source: "/security", destination: "/en/security", permanent: false },
      { source: "/demo", destination: "/en/workspace", permanent: false },
      { source: "/workspace", destination: "/en/workspace", permanent: false },
      // The workspace used to live at /demo. Old links keep working.
      {
        source: "/:lang(en|zh)/demo",
        destination: "/:lang/workspace",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
