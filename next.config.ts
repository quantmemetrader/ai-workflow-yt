import type { NextConfig } from "next";

/*
 * The live demo: every screen from the design canvas is a static page in
 * public/app (built by design/canvas/build-site.mjs). These rewrites give them
 * clean URLs and take precedence over the scaffold routes in app/.
 */
const MODULES = "login|chat|files|research|script|video|publish|accounting|finance|legal|hr|admin";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/app/login.html" },
        { source: `/:mod(${MODULES})`, destination: "/app/:mod.html" },
        { source: `/:mod(${MODULES})/:sub([a-z-]+)`, destination: "/app/:mod/:sub.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
