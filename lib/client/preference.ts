"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small preference about looking, remembered in this browser.
 *
 * Which view of a folder someone likes is not a fact about the studio, so it
 * does not belong in Postgres, and it is not part of the address of anything,
 * so it does not belong in the URL either. It belongs to the person and their
 * browser, and it should survive a reload rather than snapping back every
 * morning.
 *
 * Read through `useSyncExternalStore` rather than an effect: the server has no
 * `localStorage`, so it renders the fallback, and React swaps in the stored
 * value on hydration without a second render pass or a flash.
 */
const EVENT = "aura:preference";

/* The snapshot is compared by identity on every render, so the parsed value is
 * cached against the raw string it came from. */
const cache = new Map<string, { raw: string | null; value: string | null }>();

function read(key: string): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  const hit = cache.get(key);
  if (!hit || hit.raw !== raw) cache.set(key, { raw, value: raw });
  return cache.get(key)!.value;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLocalPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const value = allowed.includes(stored as T) ? (stored as T) : fallback;

  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        // Site data switched off costs the preference and nothing else.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  return [value, set];
}

/**
 * The same store, for a number inside a range.
 *
 * `useLocalPreference` validates against a list of allowed values, which works
 * for "list | grid | gallery" and not at all for a panel width. Here the
 * bounds are the validation, and anything outside them (or unparseable, or
 * absent) falls back.
 */
export function useLocalNumber(
  key: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): [number, (next: number) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const parsed = stored === null ? NaN : Number(stored);
  const value = Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;

  const set = useCallback(
    (next: number) => {
      try {
        if (!Number.isFinite(next)) localStorage.removeItem(key);
        else localStorage.setItem(key, String(Math.round(next)));
      } catch {
        // Storage being unavailable costs the preference and nothing else.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  return [value, set];
}
