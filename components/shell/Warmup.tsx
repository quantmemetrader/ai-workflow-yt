"use client";

import { useEffect } from "react";

/**
 * Fetch every page's scripts in the background, once per build.
 *
 * See `app/api/chunks/route.ts` for why. It waits until the page has settled,
 * then adds `<link rel="prefetch">` tags, which the browser downloads at the
 * lowest priority and keeps in its cache. The files are immutable and cached
 * for a year, so after the first visit to a new build this costs nothing.
 * A slow or metered connection skips it.
 */
const KEY = "aura:warm";

export function Warmup() {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") return;

    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/chunks", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { files } = (await res.json()) as { files: string[] };
        if (!files?.length) return;
        const stamp = files.length + ":" + files[0] + files[files.length - 1];
        try {
          if (sessionStorage.getItem(KEY) === stamp) return;
        } catch {}
        const have = new Set(
          Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]")).map(
            (el) => new URL((el as HTMLScriptElement).src || (el as HTMLLinkElement).href, location.href).pathname,
          ),
        );
        for (const href of files) {
          if (have.has(href)) continue;
          const link = document.createElement("link");
          link.rel = "prefetch";
          link.as = href.endsWith(".css") ? "style" : "script";
          link.href = href;
          document.head.appendChild(link);
        }
        try {
          sessionStorage.setItem(KEY, stamp);
        } catch {}
      } catch {
        // Warming is a nicety; a failure costs only the speed it would have bought.
      }
    };

    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const timer = setTimeout(() => (idle ? idle(() => void run(), { timeout: 4000 }) : void run()), 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return null;
}
