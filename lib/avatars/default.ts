/**
 * The picture somebody has before they pick one.
 *
 * Everybody used to start as a grey square with their initials, and most people
 * never changed it, so a studio chat read as a column of "CA", "RY", "AV". Now a
 * person with no `avatar_url` is drawn with one of the illustrated avatars,
 * chosen from their user id: the same face on every screen and every visit, for
 * every colleague, with nothing stored and nothing to migrate. Picking a picture
 * (or uploading one) replaces it; "use the default" brings it back.
 *
 * Pure, so the server pages and the client components agree on it and a
 * hydrated screen shows the same face the server drew.
 */
import { AVATARS } from "./catalog";

/*
 * The defaults are the two illustrated sets, alternating so neighbours in a
 * list tend to differ in style as well as face. Pixel people are left out on
 * purpose: they sit beside the AI employees' pixel faces, and a colleague who
 * happens to be drawn in pixels by default reads as one more employee. They
 * stay a choice.
 *
 * Written out rather than derived from the catalog: a person's default must not
 * move because somebody added a picture to the chooser. Extend the chooser
 * freely; change this list only knowing it re-deals everybody's default.
 */
const POOL: readonly string[] = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return [`/avatars/notionists/${n}.svg`, `/avatars/lorelei/${n}.svg`];
}).flat();

/* Every pool entry has to be a real file in the catalog. Checked once at load,
   where a typo shows up in the first test run rather than as a broken image. */
const KNOWN = new Set(AVATARS.map((a) => a.path));
for (const path of POOL) {
  if (!KNOWN.has(path)) throw new Error(`default avatar ${path} is not in the catalog`);
}

/** FNV-1a, 32 bit: small, fast, and spreads short similar ids well. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The catalog path this person is drawn with when they have not chosen one. */
export function defaultAvatarFor(userId: string): string {
  return POOL[hash(userId) % POOL.length];
}

/**
 * What to draw for a studio member: their own picture when they have one, their
 * default when they do not, and null only when there is nobody to go on (no id
 * and no picture), where the caller falls back to initials.
 */
export function avatarOf(userId: string | null | undefined, avatarUrl: string | null | undefined): string | null {
  if (avatarUrl) return avatarUrl;
  return userId ? defaultAvatarFor(userId) : null;
}

/** "Vincent Chow" -> "VC"; "谢亚芳" -> "谢". The text behind a picture that
 * could not load, and the tile for somebody with no id to pick a default by. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return ((Array.from(first)[0] ?? "") + (last ? (Array.from(last)[0] ?? "") : "")).toUpperCase();
}
