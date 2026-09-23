/**
 * What is still being collected, remembered across pages.
 *
 * Search & compare queues a real job and says "collecting". Until now the only
 * thing that knew about it was that page's own React state, and the phrases
 * lived in the URL, so navigating away made the whole thing vanish. The work
 * did not stop (the worker has the job either way); the person just lost every
 * trace of it and had to type the phrases again to find out whether it had
 * finished.
 *
 * This app runs with Cache Components off, so React's `<Activity>` does not
 * keep a page mounted across a navigation. The state therefore has to live
 * above the page: in the browser, read by a component mounted in the app
 * layout.
 *
 * `localStorage` rather than memory, because it should also survive a reload
 * and a second tab. It holds no content, only the phrases the person typed and
 * the window they chose.
 */
export type CollectingWindow = "1m" | "3m" | "6m";

export type Collecting = {
  queries: string[];
  window: CollectingWindow;
  /** When this was started, so a job that never lands can be given up on. */
  at: number;
};

const KEY = "aura:collecting";
const EVENT = "aura:collecting";

/** A collection nobody has seen finish in half an hour is not going to. */
const GIVE_UP_AFTER = 30 * 60_000;

function parse(raw: string | null): Collecting | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Collecting>;
    if (!Array.isArray(v.queries) || !v.queries.length) return null;
    if (v.window !== "1m" && v.window !== "3m" && v.window !== "6m") return null;
    const at = typeof v.at === "number" ? v.at : 0;
    if (Date.now() - at > GIVE_UP_AFTER) return null;
    return { queries: v.queries.filter((q) => typeof q === "string").slice(0, 5), window: v.window, at };
  } catch {
    return null;
  }
}

/*
 * `useSyncExternalStore` calls the snapshot on every render and compares by
 * identity, so parsing afresh each time would loop forever. The parsed value is
 * cached against the raw string it came from.
 */
let cachedRaw: string | null = null;
let cachedValue: Collecting | null = null;

export function readCollecting(): Collecting | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // A browser with site data switched off is not a reason to break the app.
    return null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parse(raw);
  }
  return cachedValue;
}

/** The server renders nothing: there is no browser storage during SSR, and a
 * toast that flashes in on hydration is worse than one that arrives a beat
 * late. */
export function serverCollecting(): null {
  return null;
}

export function writeCollecting(value: Omit<Collecting, "at"> | null) {
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...value, at: Date.now() }));
  } catch {
    // Same: storage being unavailable costs the toast, nothing else.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeCollecting(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  // `storage` fires in the *other* tabs, which is exactly where the local
  // event does not reach.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
