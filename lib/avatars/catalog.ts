/**
 * The profile pictures anybody in the studio can pick, and where each one came from.
 *
 * The owner asked for "good pfps from Pinterest". Pictures on Pinterest belong to
 * the people who drew them, so none is copied or linked from there. These are
 * illustrated avatars with the same feel, from styles whose artwork is free to
 * use, drawn once into static SVGs under `public/avatars/<style>/<nn>.svg`:
 *
 *   notionists - DiceBear's remix of "Notionists" by Zoish, CC0 1.0;
 *   lorelei    - DiceBear's remix of "Lorelei" by Lisa Wischofsky, CC0 1.0;
 *
 * No pixel people: pixel faces are how the AI employees look, and the owner
 * wants people and employees told apart at a glance.
 *
 * Credits and links: `public/avatars/LICENSES.md`.
 *
 * Plain data, no React and no database, so a server action can check a choice
 * against it and the chooser can draw it. A saved choice is the file's path
 * (`users.avatar_url` = "/avatars/lorelei/03.svg"): public, the same bytes for
 * everyone, and a new choice is a new path, so nothing stale is ever cached.
 */

export type AvatarStyle = "notionists" | "lorelei";

export type CatalogAvatar = {
  /** "notionists-03": stable, and what the chooser keys its tiles on. */
  id: string;
  style: AvatarStyle;
  /** Served from `public/`: what an <img> loads and what gets saved. */
  path: string;
};

export type AvatarStyleInfo = {
  key: AvatarStyle;
  /** The group's heading in the chooser. */
  zh: string;
  en: string;
  /** How many files `public/avatars/<key>/` holds, 01 to this. */
  count: number;
  /** Who made the artwork, for the credits line. */
  credit: string;
  licence: { name: string; url: string };
  /** The licence as the chooser's zh UI names it beside the group heading. */
  licenceZh: string;
  source: string;
};

export const AVATAR_STYLES: readonly AvatarStyleInfo[] = [
  {
    key: "notionists",
    zh: "插画",
    en: "Sketch",
    count: 12,
    credit: "Notionists by Zoish, remixed by DiceBear",
    licence: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    licenceZh: "CC0 1.0",
    source: "https://www.dicebear.com/styles/notionists/",
  },
  {
    key: "lorelei",
    zh: "线描",
    en: "Line art",
    count: 12,
    credit: "Lorelei by Lisa Wischofsky, remixed by DiceBear",
    licence: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    licenceZh: "CC0 1.0",
    source: "https://www.dicebear.com/styles/lorelei/",
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Every choice, grouped by style in the order above. */
export const AVATARS: readonly CatalogAvatar[] = AVATAR_STYLES.flatMap((s) =>
  Array.from({ length: s.count }, (_, i) => ({
    id: `${s.key}-${pad(i + 1)}`,
    style: s.key,
    path: `/avatars/${s.key}/${pad(i + 1)}.svg`,
  })),
);

const BY_PATH = new Map(AVATARS.map((a) => [a.path, a]));

/** The catalog entry a saved `avatar_url` points at, or null for anything else
 * (an uploaded photo's route, an agent's face, a seed file). */
export function catalogAvatar(path: string | null | undefined): CatalogAvatar | null {
  return path ? (BY_PATH.get(path) ?? null) : null;
}

/** Whether a value off the wire is one of the pictures on offer. */
export function isCatalogAvatar(path: unknown): path is string {
  return typeof path === "string" && BY_PATH.has(path);
}
