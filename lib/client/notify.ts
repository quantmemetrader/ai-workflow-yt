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
 *
 * A notice can carry a title and a press or two (`notifyRich`): "《蒸馏之战》
 * 成片已出" with 打开 and 下载 under it, when a film lands while you are on
 * another page (`lib/client/live.ts`). Plain `notify` is the same event with
 * text alone.
 */
export const NOTIFY_EVENT = "aura:notify";

export type NoticeKind = "error" | "ok" | "info";

export type NoticeAction = { label: string; href: string; /** A file to save rather than a page to open. */ download?: boolean };

export type Notice = {
  id: number;
  kind: NoticeKind;
  text: string;
  /** A bold first line above the text. */
  title?: string;
  /** Small buttons under the text; each is a link inside this app or a file. */
  actions?: NoticeAction[];
  /** How long it stays, in ms; 0 is until dismissed. Defaults per kind. */
  hold?: number;
};

let seq = 0;

export function notify(text: string, kind: NoticeKind = "error") {
  if (typeof window === "undefined" || !text) return;
  window.dispatchEvent(
    new CustomEvent<Notice>(NOTIFY_EVENT, { detail: { id: ++seq, kind, text } }),
  );
}

/** Fired by `clearErrorNotices`; the toaster drops its error notices. */
export const CLEAR_ERRORS_EVENT = "aura:notify-clear-errors";

/**
 * Take down the error notices still on screen. Errors stay until dismissed,
 * so once the same thing has been tried again and has worked, the refusal
 * from the attempt before is no longer true and should not sit there.
 */
export function clearErrorNotices() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLEAR_ERRORS_EVENT));
}

export function notifyRich(notice: Omit<Notice, "id">) {
  if (typeof window === "undefined" || (!notice.text && !notice.title)) return;
  window.dispatchEvent(new CustomEvent<Notice>(NOTIFY_EVENT, { detail: { ...notice, id: ++seq } }));
}
