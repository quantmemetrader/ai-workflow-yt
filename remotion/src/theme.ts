/**
 * The values every composition reads.
 *
 * One family, one weight scale, one accent. `BRAND-TRUTH.md` in the studio's
 * reference work is a whole document about a film painted in a colour the
 * product never shipped, because a brand file said so and nobody checked. So
 * the accent here is a parameter with a dull default rather than a guess that
 * looks confident.
 */
export const THEME = {
  family: '"Inter", "Noto Sans CJK SC", "PingFang SC", "Helvetica Neue", -apple-system, sans-serif',
  /** The CJK face first, for a line that is mostly Chinese. */
  cjk: '"Noto Sans CJK SC", "PingFang SC", "Inter", sans-serif',
  ink: "#ffffff",
  quiet: "rgba(255,255,255,0.68)",
  void: "#000000",
  accent: "#007be0",
} as const;

/** Sizes are shares of frame height, so a 16:9 cut and a 9:16 cut agree. */
export const ratio = (height: number, share: number) => Math.round(height * share);
