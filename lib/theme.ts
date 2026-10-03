/** The person's appearance choice, kept in a cookie so the server can draw the page in it. */
export const THEME_COOKIE = "tg-theme";
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export function themeOf(v: string | undefined | null): Theme {
  return v === "dark" || v === "system" ? v : "light";
}

/**
 * Dark mode as one layer over the whole page (4 Oct). The product writes its
 * colours inline in some 5,000 places; inverting the page and turning hues
 * back keeps every one of them readable without touching them, and pictures,
 * video, canvases (the office) and avatars are turned back again so they keep
 * their real colours. Anything else that must keep its colours carries
 * data-keep-colors.
 */
const DARK = "filter: invert(1) hue-rotate(180deg); background: #fff;";
const KEEP = "img, video, canvas, picture, iframe, [data-keep-colors]";
const FLIP = "filter: invert(1) hue-rotate(180deg);";
export const THEME_CSS = `
html[data-theme="dark"] { ${DARK} }
html[data-theme="dark"] :is(${KEEP}) { ${FLIP} }
@media (prefers-color-scheme: dark) {
  html[data-theme="system"] { ${DARK} }
  html[data-theme="system"] :is(${KEEP}) { ${FLIP} }
}
`;
