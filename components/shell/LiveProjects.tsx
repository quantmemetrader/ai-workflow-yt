"use client";

import { useEffect } from "react";
import { anythingLive, onBump, pollLive, readLive } from "@/lib/client/live";
import { subscribeRendering } from "@/lib/client/rendering";

/**
 * The one poller behind every live surface.
 *
 * Mounted once in the app layout; draws nothing. It fills the store in
 * `lib/client/live.ts` from `/api/projects/live`: every five seconds while
 * a film is being made (or an auto-cut is counting down, or one just
 * landed and its chip is still up), every twelve otherwise, so a cut
 * started by 剪辑师 from the chat — or by a colleague — shows up on Home
 * and in the sidebar without a reload. Never while the tab is hidden; once
 * more the moment it is looked at again, and at once when something on
 * this page started a job (`bumpLive`, or the editor's own render mark).
 */
const FAST_MS = 5_000;
const SLOW_MS = 12_000;

export function LiveProjects() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      const fast = anythingLive(readLive().projects);
      timer = setTimeout(tick, fast ? FAST_MS : SLOW_MS);
    };
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await pollLive();
      schedule();
    };
    const now = () => {
      if (stopped) return;
      void pollLive().then(schedule);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") now();
    };

    void tick();
    const offBump = onBump(now);
    const offRendering = subscribeRendering(now);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      offBump();
      offRendering();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
