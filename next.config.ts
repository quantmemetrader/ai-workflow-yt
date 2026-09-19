import type { NextConfig } from "next";

/*
 * Two things are served from here.
 *
 * 1. The product. Real routes under app/ — signed in, reading the database:
 *    /login, /chat, /files today, the other modules as the build works through
 *    the spec's order.
 *
 * 2. The approved design canvas. Every screen of every module exists as a
 *    static page in public/app (built by design/canvas/build-site.mjs). A
 *    module that is not built yet still opens its approved screen, so the rail
 *    is never a dead end, and the whole canvas stays reachable under /demo for
 *    review.
 *
 * `beforeFiles` runs ahead of the filesystem, so anything listed here wins
 * over app/. Modules move out of DESIGN_ONLY as they go live.
 */
/** Every module, for the /demo routes that publish the design canvas itself. */
const ALL_MODULES = "login|chat|files|research|script|video|publish|accounting|finance|legal|hr|admin";

const nextConfig: NextConfig = {
  /*
   * Standalone output: `next build` emits a self-contained server under
   * .next/standalone that runs as a plain Node process. That is what pm2
   * supervises on the Cherry box — no Vercel functions, no per-request billing,
   * and a long-lived process keeps the Postgres pool warm between requests,
   * which matters more than usual while the database is a continent away.
   *
   * Not on Vercel: it builds its own output and traces the server itself, and
   * standalone mode makes that step fail outright (a missing
   * `next-server.js.nft.json`). The fallback deployment has to keep building.
   */
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),

  async rewrites() {
    return {
      beforeFiles: [
        // The design canvas, in full, for review.
        { source: "/demo", destination: "/app/login.html" },
        { source: `/demo/:mod(${ALL_MODULES})`, destination: "/app/:mod.html" },
        { source: `/demo/:mod(${ALL_MODULES})/:sub([a-z-]+)`, destination: "/app/:mod/:sub.html" },

        // Modules whose screens are approved but not yet built are real routes
        // now (app/(app)/<module>/page.tsx), so that entitlement is checked
        // before anything is shown. They embed their design from /demo.
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  // Uploads go straight to R2 from the browser, so nothing here needs a large
  // body; server actions carry form data only.
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
