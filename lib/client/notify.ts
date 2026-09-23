"use client";

/**
 * Saying something went wrong, without a browser alert box.
 *
 * `window.alert` freezes the page, prints the origin above the message, cannot
 * be styled, and is the same box a phishing page uses. It was how this product
 * reported a failed upload, a refused rename and a vendor error.
 *
 * A dispatched event rather than a context: every call site is inside a
 * different tree, the toaster lives in the app layout above all of them, and
 * an event costs one line at each call site instead of a provider each.
 */
export const NOTIFY_EVENT = "aura:notify";

export type NoticeKind = "error" | "ok" | "info";

export type Notice = { id: number; kind: NoticeKind; text: string };

let seq = 0;

export function notify(text: string, kind: NoticeKind = "error") {
  if (typeof window === "undefined" || !text) return;
  window.dispatchEvent(
    new CustomEvent<Notice>(NOTIFY_EVENT, { detail: { id: ++seq, kind, text } }),
  );
}
