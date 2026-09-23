"use client";

/**
 * What is happening right now, and what it is happening to.
 *
 * Every screen had a local `busy` from its own `useTransition`, which changed a
 * button's label and nothing else. If you were looking anywhere but at that
 * button, pressing it looked like pressing a dead control: the work happened
 * on the server, took a round trip to Singapore, and the page said nothing.
 *
 * Two deliberate choices about *where* it says it:
 *
 *   — It sits in the bottom-left corner, in the sidebar's own empty space
 *     above whoever is signed in. A banner across the middle of the window
 *     interrupts what you are reading to tell you that something unrelated is
 *     loading.
 *   — The **agent is not in here.** A model turn belongs to the panel that
 *     asked for it: the answer appears there, so the waiting should too.
 *
 * A list rather than a counter, because the indicator names what it is working
 * on, and two things at once should not overwrite each other's label.
 */
export const BUSY_EVENT = "aura:busy";

export type Work = { id: number; label: string | null };

let seq = 0;
let live: Work[] = [];

function publish() {
  // A fresh array each time: `useSyncExternalStore` compares by identity, and
  // mutating the same one in place would never look like a change.
  live = [...live];
  window.dispatchEvent(new Event(BUSY_EVENT));
}

/**
 * Say something has started, and get back the only way to say it has stopped.
 *
 * `label` is shown to the person: "Collecting nvidia", "Rendering 16:9". Left
 * out, the indicator just says something is happening.
 */
export function beginWork(label?: string): () => void {
  if (typeof window === "undefined") return () => {};
  const id = ++seq;
  live = [...live, { id, label: label ?? null }];
  publish();

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    live = live.filter((w) => w.id !== id);
    publish();
  };
}

export function subscribeBusy(onChange: () => void): () => void {
  window.addEventListener(BUSY_EVENT, onChange);
  return () => window.removeEventListener(BUSY_EVENT, onChange);
}

export function currentWork(): Work[] {
  return live;
}

const NOTHING: Work[] = [];
/** The server has no work in flight; it also has no window to dispatch on. */
export function serverWork(): Work[] {
  return NOTHING;
}
