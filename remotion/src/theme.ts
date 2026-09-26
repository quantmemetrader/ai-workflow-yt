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

/**
 * Director v2's style sheet (PLAN.md §1), as numbers.
 *
 * Everything the v2 templates draw is specified in pixels on a 1080×1920
 * frame — "hook 120, stat 150, card headline 68, caption 72, meta 32, credits
 * 26; radius 24; 64 px side margins; Zone T y 230–620" — so this file keeps
 * those numbers literally and the templates scale them by the frame's height
 * (`px()` in `v2.tsx`). A reader with the plan open can check any value here
 * against it without converting shares.
 *
 * The same object is read by `lib/video/motion.ts` (the box a clip is cropped
 * to, the in/out segment lengths) and, by hand, by the editor's preview
 * (`components/video/LivePreviewOverlay.tsx`), so a change here is a change
 * in three places and should be made once, in the plan.
 */
export const V2 = {
  /** The reference frame every number below is written for. */
  frame: { width: 1080, height: 1920 },

  /* ---- colour: #0E0E10, #FFFFFF, the project accent; red only for the negative bar */
  ink: "#FFFFFF",
  void: "#0E0E10",
  negative: "#FF453A",
  accent: "#d6e64f",
  quiet: "rgba(255,255,255,0.75)",
  meta: "rgba(255,255,255,0.68)",
  credits: "rgba(255,255,255,0.58)",
  /** A plate behind type that has to read over busy footage (headline, stinger). */
  plate: "rgba(14,14,16,0.92)",
  tile: "#FFFFFF",

  /* ---- type: Noto Sans CJK SC Black/Bold + Inter with tabular numerals */
  /** The heavy CJK faces `fonts.ts` registers under one family name (Black at 900, Bold at 700),
   *  distinct from the system "Noto Sans CJK SC" so a request for 900 can never land on a
   *  synthesised bold of the Regular. */
  heavy: '"Noto CJK Heavy", "Noto Sans CJK SC", "PingFang SC", "Source Han Sans SC", sans-serif',
  /** Numbers and Latin: Inter first, the CJK face for anything it lacks. */
  latin: '"Inter", "Noto CJK Heavy", "Noto Sans CJK SC", "PingFang SC", sans-serif',
  size: {
    hook: 120,
    stat: 150,
    headline: 68,
    caption: 72,
    meta: 32,
    credits: 26,
    /** The rest are the plan's sizes applied to the templates it does not size explicitly. */
    term: 96,
    definition: 48,
    unit: 68,
    label: 40,
    value: 48,
    listHead: 44,
    listText: 40,
    chip: 32,
    boxLabel: 40,
    boxSub: 28,
    endSub: 44,
  },

  /* ---- shape: radius 24, one shadow, 64 px side margins */
  radius: 24,
  shadow: "0 8px 24px rgba(0,0,0,0.35)",
  textShadow: "0 4px 24px rgba(0,0,0,0.35)",
  side: 64,
  /** Platform UI on the right: nothing sits past x = width − 150. */
  rightUnsafe: 150,

  /* ---- zones (y on the 1920 frame) */
  zones: {
    /** Hook, cards, stats, entity, headline. */
    T: { top: 230, bottom: 620 },
    /** A name card in portrait: above the captions, below the chin. */
    lower: { top: 1080, bottom: 1290 },
    /** A chip: top right under the header band, clear of Zone T's first line. */
    corner: { top: 264, bottom: 340 },
    unsafeTop: 220,
    unsafeBottom: 1440,
    /** The furniture the end card must clear: watermark band and footnote band. */
    watermark: { top: 1573, bottom: 1613 },
    footnote: { top: 1811, bottom: 1834 },
  },

  /**
   * The pixel box a clip of each zone is cropped to (`MotionClip.x/y/w/h`).
   * A little larger than the zone, so a shadow or the chip's overshoot is
   * never clipped, and far smaller than the frame, so Chrome draws a fifth
   * of the pixels it would for a full-frame overlay.
   */
  boxes: {
    T: { x: 0, y: 200, w: 1080, h: 500 },
    lower: { x: 0, y: 1040, w: 1080, h: 290 },
    corner: { x: 380, y: 224, w: 700, h: 170 },
    full: { x: 0, y: 0, w: 1080, h: 1920 },
  },

  /* ---- motion */
  /** Enter 250–350 ms on `cubic-bezier(.2,.8,.2,1)`; exit 150–200 ms. */
  enterMs: 300,
  exitMs: 180,
  bezier: [0.2, 0.8, 0.2, 1] as const,
  /** The one spring, for the chip: damping 14, stiffness 180, mass 0.9 (≈ 12.6 % overshoot,
   *  scaled down to ≤ 3 % where it is applied). */
  spring: { damping: 14, stiffness: 180, mass: 0.9 },
  /** Counters count up over 0.7 s, ease-out, and finish on the spoken number. */
  countMs: 700,
  /** Comparison bars grow in sequence, 0.5 s each. */
  barMs: 500,
  /** Headline: slides up 250 ms, blur to sharp. */
  headlineMs: 250,
  /** Stinger: 0.7 s in all, 150 ms wipe in; out on the common 180 ms exit, so the
   *  plate's fade is the same `envelope().exit` every other graphic leaves on
   *  (measured to the end of the last frame, which is therefore fully out). */
  stingerMs: 700,
  stingerInMs: 150,
  stingerOutMs: 180,
  /** Hook lines: scale 0.92→1.0 over 120 ms, centred on the word. */
  hookLineMs: 120,

  /**
   * A static-after-entrance graphic is rendered as three parts: `in` (the
   * first 12 frames, 400 ms, which covers every entrance above), one `hold`
   * PNG (frame 12), and `out` (the last 6 frames, 200 ms, which covers the
   * 180 ms exit). The compositor loops the PNG between them.
   */
  inFrames: 12,
  outFrames: 6,
} as const;

export type ZoneKey = keyof typeof V2.boxes;
