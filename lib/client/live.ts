"use client";

import { useSyncExternalStore } from "react";
import { notifyRich } from "@/lib/client/notify";
import { DONE_WINDOW_MS, friendlyError, isActive, isRecent, type LiveProject } from "@/lib/projects/live-types";

/**
 * The films being made, followed from every page.
 *
 * One store above every screen, filled by one poller (`LiveProjects` in
 * the app layout) from `/api/projects/live`, and read by whoever draws a
 * project: Home's cards, the sidebar's folders, the channel's status row,
 * the project page's clips card and the corner chip. Module state, like
 * `uploads.ts` and `rendering.ts`: a page that starts a render is not the
 * page that will be open when it finishes.
 *
 * The poller also notices the moment a film lands or fails and says so
 * once — the toast with 打开 and 下载, and a browser notification when the
 * person has allowed those — keyed by the render so a reload within the
 * window does not say it again.
 */
type Snapshot = { at: number; projects: LiveProject[] };

const EVENT = "aura:live";

/** The top bar's free middle (`TopBar`), where the corner chip is drawn
 *  (`RenderWatch`). */
export const TOPBAR_LIVE_SLOT = "aura-topbar-live";
const BUMP_EVENT = "aura:live:bump";
const TOLD_KEY = "aura:live:told";
const EMPTY: Snapshot = { at: 0, projects: [] };

let snapshot: Snapshot = EMPTY;
let inFlight: Promise<void> | null = null;

export function readLive(): Snapshot {
  return snapshot;
}

export function serverLive(): Snapshot {
  return EMPTY;
}

export function subscribeLive(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Every project the poller knows about right now (running, armed, or just landed). */
export function useLiveProjects(): LiveProject[] {
  return useSyncExternalStore(subscribeLive, readLive, serverLive).projects;
}

/** The same, with the clock of the poll that fetched it: what a render reads
 *  instead of `Date.now()` for the two-minute windows, so nothing about a
 *  frame depends on the moment it was drawn. */
export function useLiveSnapshot(): Snapshot {
  return useSyncExternalStore(subscribeLive, readLive, serverLive);
}

/** One project's live state, or null when nothing is happening to it. */
export function useLiveProject(id: string | null | undefined): LiveProject | null {
  const snap = useSyncExternalStore(subscribeLive, readLive, serverLive);
  if (!id) return null;
  return snap.projects.find((p) => p.id === id) ?? null;
}

/** Whether the poller should hurry: anything running or armed, or a film
 *  that landed inside its window (its chip is still counting). */
export function anythingLive(projects: LiveProject[], now = Date.now()): boolean {
  return projects.some((p) => isActive(p) || isRecent(p, now));
}

/** Ask the poller to look now — after starting something, so the chip and
 *  the cards do not wait for the next tick. The person's other tabs of the
 *  studio are told too (a BroadcastChannel), so Home open beside the project
 *  page picks the film up at once rather than on its slow tick. */
export function bumpLive() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BUMP_EVENT));
  try {
    tabs()?.postMessage("bump");
  } catch {
    // A closed channel: this tab still looked.
  }
}

export function onBump(cb: () => void): () => void {
  const fromTab = () => cb();
  window.addEventListener(BUMP_EVENT, cb);
  tabs()?.addEventListener("message", fromTab);
  return () => {
    window.removeEventListener(BUMP_EVENT, cb);
    tabs()?.removeEventListener("message", fromTab);
  };
}

let channel: BroadcastChannel | null | undefined;
function tabs(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("aura:live");
  return channel;
}

/**
 * One poll. Shared: a second caller while one is in flight waits for it
 * rather than making another request.
 */
export function pollLive(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/projects/live", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { at: string; projects: LiveProject[] };
      const projects = Array.isArray(data.projects) ? data.projects : [];
      announce(projects);
      snapshot = { at: Date.now(), projects };
      window.dispatchEvent(new Event(EVENT));
    } catch {
      // A dropped poll is not worth a word; the next one runs.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ---------------------------------------------------- saying it landed */

function toldKeys(): string[] {
  try {
    const raw = localStorage.getItem(TOLD_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markTold(key: string) {
  try {
    localStorage.setItem(TOLD_KEY, JSON.stringify([...toldKeys().slice(-49), key]));
  } catch {
    // Private mode: the toast still shows this once.
  }
}

/** The toast and the notification for every film that landed or failed
 *  inside the window and has not been said yet — the transition the poller
 *  is there to catch. */
function announce(projects: LiveProject[]) {
  const now = Date.now();
  const told = new Set(toldKeys());
  const zh = !(document.documentElement.lang || "zh").startsWith("en");
  /* A hidden tab (it polls while a film is being made) sends only the
     browser notification, once for all tabs (keyed); the toast is left for
     a tab the person is looking at, which says it when they come back
     inside the window. Otherwise a background tab would use the toast up
     and the tab in front would never show it. */
  const hidden = document.visibilityState !== "visible";
  for (const p of projects) {
    if (!isRecent(p, now)) continue;
    const key = p.state === "done" ? `done:${p.exportId ?? p.id}` : `failed:${p.id}:${p.finishedAt ?? ""}`;
    if (hidden) {
      if (!notificationsGranted() || told.has(key) || told.has(`pushed:${key}`)) continue;
      markTold(`pushed:${key}`);
      const title = p.state === "done" ? (zh ? `《${p.title}》成片已出` : `“${p.title}” is out`) : zh ? `《${p.title}》渲染没成功` : `“${p.title}” failed to render`;
      const body = p.state === "done" ? (zh ? "点开看成片，或到项目页下载。" : "Open it to watch, or download it from the project.") : friendlyError(p.error, zh);
      pushNotification(title, body, `/projects/${p.id}`, key);
      continue;
    }
    if (told.has(key)) continue;
    markTold(key);
    const name = `《${p.title}》`;
    if (p.state === "done") {
      const facts = [p.aspect, p.durationMs ? clock(p.durationMs) : null].filter(Boolean).join(" · ");
      notifyRich({
        kind: "ok",
        title: zh ? `${name}成片已出` : `“${p.title}” is out`,
        text: facts ? (zh ? `${facts} · 可以直接看、下载。` : `${facts} · watch it or download it.`) : zh ? "可以直接看、下载。" : "Watch it or download it.",
        actions: [
          { label: zh ? "打开" : "Open", href: `/projects/${p.id}` },
          ...(p.fileId ? [{ label: zh ? "下载" : "Download", href: `/api/files/${p.fileId}/download?download=1`, download: true }] : []),
        ],
      });
      if (!told.has(`pushed:${key}`)) pushNotification(zh ? `${name}成片已出` : `“${p.title}” is out`, zh ? "点开看成片，或到项目页下载。" : "Open it to watch, or download it from the project.", `/projects/${p.id}`, key);
    } else {
      notifyRich({
        kind: "error",
        title: zh ? `${name}渲染没成功` : `“${p.title}” failed to render`,
        text: friendlyError(p.error, zh),
        actions: [{ label: zh ? "重试" : "Try again", href: `/projects/${p.id}` }],
        hold: 20_000,
      });
      if (!told.has(`pushed:${key}`)) pushNotification(zh ? `${name}渲染没成功` : `“${p.title}” failed to render`, friendlyError(p.error, zh), `/projects/${p.id}`, key);
    }
  }
}

/** "2:31" — the film's length, in the toast. */
function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* --------------------------------------------- the browser notification */

/** Whether this browser could still be asked (the project page asks once). */
export function canAskNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "default";
}

export function notificationsGranted(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

export async function askNotifications(): Promise<boolean> {
  if (!canAskNotifications()) return notificationsGranted();
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Only when allowed, and only when the tab is not the one being looked at:
 *  the toast is enough for the page in front. */
function pushNotification(title: string, body: string, href: string, tag: string) {
  if (!notificationsGranted()) return;
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      window.location.assign(href);
      n.close();
    };
  } catch {
    // A browser that lists the API but refuses the constructor (some mobile ones).
  }
}

export { DONE_WINDOW_MS };
