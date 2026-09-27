import type { Beat, Credits, FaceTrack, GraphicSpecV2, Layout, Sentence, Sourced, Word } from "@/lib/video/v2/types";

/**
 * Where everything goes, and when: the code half of director v2.
 *
 * The model decides *what* (`lib/video/v2/design.ts`: which sentence wants
 * a picture, a number, a card, and the queries to find it). This file
 * decides *when and where*, from the style spec in PLAN.md §1, with no
 * model in the loop: every number below is a measurement or a rule from
 * that spec, and every decision can be replayed from the same inputs.
 *
 * What it schedules, in priority order:
 *
 *   1. The furniture (header, watermark, footnote) for the whole video;
 *      outside the one-layer rule because it is the frame the rest sits in.
 *   2. The hook block at 0 s, the end card over the last seconds, the lower
 *      third where she says her name (or a name chip at 2–6 s when she only
 *      says it at the end), a stinger at every chapter.
 *   3. The beats, priority 1 then 2 then 3, each as the visual its intent
 *      asks for: a sourced cutaway (full / split / run by the asset's
 *      shape), a counter landing on the spoken number, compare bars, a list
 *      build, an entity card at first mention and a chip after, a headline
 *      card, a term card, the one diagram. A beat whose asset did not
 *      arrive becomes a designed card, or stays on the host: a designed
 *      card always beats a weak clip.
 *   4. Cadence: something changes on screen every 2–4 s on average, never
 *      more than 5 s without a change, nothing closer than 0.8 s (stingers
 *      excepted); cutaways cover 30–40 % of the runtime; the host stays
 *      visible ≥ 55 %.
 *   5. Framing: 1.00 / 1.12 alternating on jump cuts ≥ 1.2 s apart, 1.00
 *      under a Zone-T graphic, a slow push on long takes, a snap push on a
 *      punchline held to the sentence end, at most one per 15 s, never
 *      above 1.25.
 *
 * Zones (px on 1080×1920): unsafe top 220 / bottom 480 / right 150 / left
 * 64; **T** (hook, cards, stats, entity, headline) y 230–620; **F** the face
 * box + 40 px, no text ever; **C** the zh caption centred at y 1360 with its
 * top edge ≥ chin + 40.
 *
 * One thing the spec did not foresee, resolved here and flagged to the
 * lead: on the 蒸馏 take the face is big (eye line at 40 % of the frame,
 * chin at 53 %, face 25 % of the height), so with the eye line framed at
 * 30–36 % the face box reaches from y ≈ 350 to 920 and every Zone-T
 * graphic would sit on her forehead. So under a Zone-T graphic the host is
 * *dropped* — reframed with the eye line low enough that the face box
 * clears Zone T — the same move the `split` layout makes under a clip. The
 * geometry is computed from the face track (`hostUnderZoneT`,
 * `splitGeometry`), never hard-coded, so a smaller face keeps the spec's
 * own numbers and a bigger one still fits.
 *
 * Pure: no I/O, nothing random, ids derived from the beat and the kind.
 */

/* ------------------------------------------------------------- constants */

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;
const MS_PER_FRAME = 1000 / FRAME.fps;

/** The screen zones of §1, in pixels. */
export const ZONES = {
  unsafe: { top: 220, bottom: 1440, left: 64, right: FRAME.width - 150 },
  T: { x0: 64, x1: FRAME.width - 150, y0: 230, y1: 620 },
  /** The zh caption line: centre y and the allowed drift. */
  caption: { zhY: 1360, drift: 40, zhSize: 72, enY: 1420, faceGap: 40 },
  faceMargin: 40,
  /** The `run` layout as measured from the channel's own edit. */
  run: { cx: 0.74, cy: 0.31, diameter: 0.28, darken: 0.55 },
  /** The `split` layout: the clip's box and the host's framing under it. */
  split: { clip: { x: 0, y: 230, w: 1080, h: 608 }, radius: 24, hostZoom: 1.12, hostEyeY: 1150 },
} as const;

/** Every timing rule of §1, in one place, in milliseconds. */
export const TIMING = {
  hookMs: 2500,
  hookMaxMs: 4000,
  hookLineMs: 120,
  chipWindow: [2000, 6000] as const,
  lowerThirdMs: 3000,
  chipMs: 2000,
  /** The name chip at 2–6 s when she only says her name at the end: short, so the first cutaway can follow by 6 s. */
  nameChipMs: 2000,
  minChangeGapMs: 800,
  /** Two events closer than this are one event (an entrance on a cut). */
  sameMomentMs: 60,
  maxNoChangeMs: 5000,
  meanChangeMs: [2000, 4000] as const,
  cutaway: { min: 1500, max: 3500, avg: 2200, long: 4500, still: [2000, 3000] as const },
  firstCutawayBy: 5000,
  cutawayEvery: [5000, 8000] as const,
  coverage: [0.3, 0.4] as const,
  hostVisible: 0.55,
  runShare: 0.3,
  run: { min: 6000, max: 12000, clipEvery: [2000, 4000] as const, clips: [2, 4] as const },
  entityCard: [1500, 2500] as const,
  /** Three or more names in one breath (「DeepSeek、月之暗面和MiniMax」): cards back to back, each shorter (name and logo only), never below the 0.8 s change floor. */
  entityCardCrowded: [1100, 1500] as const,
  counter: { countUp: 700, hold: 2500 },
  compare: { barMs: 500, hold: [3000, 5000] as const },
  /** A list builds an item at a time across the sentences that say them (2月 → 6月 → 9月 spans 11 s here) and holds after the last. */
  list: { hold: 1500, max: 16000 },
  headline: [2500, 4000] as const,
  termMs: 3000,
  diagramMax: 8000,
  stingerMs: 700,
  endCardMax: 3000,
  /** A short: 90 s or less. It ends on her face, with the credits small over the picture for the last 2.5 s. */
  shortMaxMs: 90_000,
  shortCreditsMs: 2500,
  /** Start on the first syllable of the noun: −2 … +3 frames. */
  land: [-2 * MS_PER_FRAME, 3 * MS_PER_FRAME] as const,
  enterMs: 300,
  exitMs: 170,
} as const;

export const FRAMING = {
  base: 1.0,
  alternate: 1.12,
  jumpCutMin: 1200,
  slowPush: { min: 6000, to: 1.05 },
  snap: { to: 1.18, frames: 5, every: 15000 },
  maxZoom: 1.25,
  /** Eye line as a share of the frame height for a plain talking head. */
  eyeY: 0.33,
} as const;

export type LayoutPace = "calm" | "channel" | "hype";

/* ----------------------------------------------------------------- types */

/**
 * A beat as the design step hands it over: the frozen `Beat` plus what the
 * layout needs and W3's sourcing does not. `id` is the sentence id for the
 * first beat of a sentence and `sNNN.2`, `sNNN.3` for the rest. The design
 * step rewrites every `Sourced.beatId` to one of these ids before the plan
 * is laid out (W3 answers with its own `bNN-sNNN-intent` ids, see
 * `design.ts:sourcedForLayout`), so here an asset belongs to exactly one
 * beat and a sentence may own several.
 */
export type DesignBeat = Beat & {
  id: string;
  /** The word or phrase in the sentence the visual lands on. */
  anchor?: string;
  /** A chapter starts at this sentence. */
  chapter?: { index: number; titleZh: string };
  term?: { term: string; definitionZh: string };
  diagram?: { steps: string[] };
  compareTitleZh?: string;
  bars?: { labelZh: string; value: number; display: string; negative?: boolean }[];
  /** When each bar's figure is said (timeline ms), from the design step; the bars grow in that order and the card holds after the last. */
  barsAtMs?: number[];
  listTitleZh?: string;
  /** Why the design step downgraded or changed it, for the notes. */
  reasonZh?: string;
};

export type FramingSegment = {
  /** Timeline time. */
  inMs: number;
  outMs: number;
  zoom: number;
  /** Where the eye line goes, as fractions of the frame: [x, y]. */
  anchor: [number, number];
  push?: { fromMs: number; toMs: number; to: number };
  why: string;
};

export type CutawaySpec = {
  id: string;
  beatId: string;
  sentenceId: string;
  startMs: number;
  endMs: number;
  sourceInMs: number;
  layout: Layout;
  cropX: number;
  still: boolean;
  runId?: string;
  kind: Sourced["kind"];
  score: number;
  reasonZh: string;
  label: string;
  asset: Sourced["asset"];
  candidate: Sourced["candidate"];
  credit: string;
};

export type RunSpec = { id: string; startMs: number; endMs: number; cutawayIds: string[] };

export type LayoutStats = {
  totalMs: number;
  cutawayMs: number;
  coverage: number;
  hostVisible: number;
  runMs: number;
  runShare: number;
  changes: number;
  meanChangeMs: number;
  maxGapMs: number;
  gapsOver5s: { fromMs: number; toMs: number }[];
  graphics: Record<string, number>;
  cutaways: Record<Layout, number>;
  pushes: number;
  skipped: { beatId: string; reasonZh: string }[];
};

export type LayoutPlan = {
  graphics: GraphicSpecV2[];
  cutaways: CutawaySpec[];
  /** Framing per segment of the timeline: the plan's `cuts[].zoom/anchor/push`. */
  cutZooms: FramingSegment[];
  pushes: { startMs: number; endMs: number; to: number; sentenceId: string }[];
  runs: RunSpec[];
  /** Every visual change, sorted, for the cadence gates. */
  changes: number[];
  /** The changes that happen inside a graphic already up (list items, bars, diagram steps, hook lines): counted, excepted from the 0.8 s rule like stingers. */
  steps: number[];
  renderHints: RenderHints;
  stats: LayoutStats;
  notesZh: string[];
};

export type RenderHints = {
  /** The host's framing under a Zone-T graphic, from the face track; `scale` is the absolute scale of the source that framing needs. */
  zoneT: { zoom: number; eyeY: number; scale: number };
  /** The base framing's absolute scale (zoom 1.00 at the spec's eye line). */
  baseScale: number;
  /** The `split` layout's clip box and host framing, from the face track. */
  split: { clip: { x: number; y: number; w: number; h: number }; hostZoom: number; hostEyeY: number };
  run: typeof ZONES.run;
  /** Where the caption line goes, from the chin under the plain framing. */
  captionZhY: number;
  face: FaceTrack | null;
};

export type LayoutInput = {
  beats: DesignBeat[];
  sourced: Sourced[];
  /** Sentences on the *timeline* clock (after the cut), ids stable. */
  sentences: Sentence[];
  /** The cut pieces on the timeline clock: where the jump cuts are. */
  pieces: { inMs: number; outMs: number }[];
  face: FaceTrack | null;
  pace: LayoutPace;
  totalMs: number;
  hook: { lines: string[]; landOn?: string[] };
  chapters: { sentenceId: string; titleZh: string }[];
  lowerThird: { name: string; sub: string; sentenceId: string | null };
  endCard: { titleZh: string; questionZh: string; sentenceId: string | null };
  furniture: { header: { title: string; sub: string | null }; watermark: string | null; footnote: string | null };
  credits?: Credits | null;
  /** The entity mentions per sentence for chips (name → sentence ids after the first). */
  mentions?: Record<string, string[]>;
  /**
   * Logos resolved per entity (name → the sourced logo), from W3's
   * `entityVisual`. A logo rides on the entity's card; it is never a
   * cutaway of its own.
   */
  logos?: Record<string, Sourced>;
  /** Where each placement went, and why a slot was refused, one line at a time (the lab writes it to trace.txt). */
  trace?: (line: string) => void;
};

/* --------------------------------------------------------------- helpers */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v);

/** A stable id from the beat and the kind: the same plan twice gives the same rows. */
const gid = (kind: string, key: string, n = 0) => `${kind}:${key}${n ? `#${n}` : ""}`;

/**
 * The words of a sentence that spell `anchor`, and when the first of them
 * starts. Whisper splits Chinese into one-to-three character words and
 * Latin names into fragments, so the match runs over the joined text and
 * maps the character offset back to a word. `null` when the phrase is not
 * in the sentence at all (the model quoted from memory, not the line).
 */
export function anchorIn(sentence: Sentence, anchor: string | undefined): { startMs: number; endMs: number } | null {
  if (!anchor) return null;
  const needle = anchor.replace(/[\s，,。.、【】「」]/g, "").toLowerCase();
  if (!needle) return null;
  let text = "";
  const spans: { from: number; to: number; w: Word }[] = [];
  for (const w of sentence.words) {
    const t = w.text.replace(/[\s，,。.、!?！？；;：:]/g, "").toLowerCase();
    spans.push({ from: text.length, to: text.length + t.length, w });
    text += t;
  }
  const at = text.indexOf(needle);
  if (at < 0) return null;
  const first = spans.find((s) => s.to > at);
  const last = spans.find((s) => s.to >= at + needle.length) ?? spans[spans.length - 1];
  if (!first) return null;
  return { startMs: first.w.startMs, endMs: last ? last.w.endMs : first.w.endMs };
}

/** The sentence, or null. */
const byId = (sentences: readonly Sentence[]) => new Map(sentences.map((s) => [s.id, s]));

/** The face track in source pixels of a 1080×1920 frame, whichever units it came in (fractions when every value ≤ 1). */
function facePx(face: FaceTrack): { x: number; y: number; w: number; h: number; eye: number; chin: number } {
  const frac = face.box.every((v) => v <= 1) && face.eyeY <= 1;
  const [x, y, w, h] = frac ? face.box.map((v, i) => v * (i % 2 === 0 ? FRAME.width : FRAME.height)) : face.box;
  return { x, y, w, h, eye: frac ? face.eyeY * FRAME.height : face.eyeY, chin: frac ? face.chinY * FRAME.height : face.chinY };
}

/**
 * The least scale of the source that fills the frame with the eye line
 * at `eyeY`.
 *
 * The compositor's "zoom 1.00" is relative to this: a portrait take with
 * the eyes at 40 % of its own height cannot show them at 33 % without
 * either black under the frame or a scale-up, and the plan never asks for
 * black. So the base framing is the scale that just fills, and the
 * alternate 1.12, the slow push and the snap push multiply it. Frames are
 * never scaled below 1 (never upscaled from a crop smaller than the
 * output, which would be soft).
 */
export function baseScale(face: FaceTrack | null, eyeY: number): number {
  if (!face) return 1;
  const f = facePx(face);
  const H = FRAME.height;
  const top = (eyeY * H) / Math.max(1, f.eye);
  const bottom = ((1 - eyeY) * H) / Math.max(1, H - f.eye);
  return Math.max(1, top, bottom);
}

/**
 * Where the face sits in the output frame under a given framing.
 *
 * The host is framed by scaling the source by `baseScale × zoom` about
 * the face and placing the eye line at `eyeY` (a fraction of the height),
 * which is what the compositor does per cut, so the box this returns is
 * the box the viewer sees, with the 40 px margin of Zone F already added.
 */
export function faceBoxUnder(face: FaceTrack | null, zoom: number, eyeY: number): { x0: number; y0: number; x1: number; y1: number; eye: number; chin: number; scale: number } | null {
  if (!face) return null;
  const f = facePx(face);
  const scale = baseScale(face, eyeY) * zoom;
  const eyeOut = eyeY * FRAME.height;
  const cx = f.x + f.w / 2;
  const toY = (y: number) => eyeOut + (y - f.eye) * scale;
  const toX = (x: number) => FRAME.width / 2 + (x - cx) * scale;
  return {
    x0: toX(f.x) - ZONES.faceMargin,
    x1: toX(f.x + f.w) + ZONES.faceMargin,
    y0: toY(f.y) - ZONES.faceMargin,
    y1: toY(f.y + f.h) + ZONES.faceMargin,
    eye: eyeOut,
    chin: toY(f.chin),
    scale,
  };
}

/** The top edge of the zh caption line whose centre is at `zhY`. */
const captionTopOf = (zhY: number) => zhY - ZONES.caption.zhSize / 2;

/**
 * The host's framing under a Zone-T graphic.
 *
 * Zoom 1.00 always (§1: "1.00 forced under a Zone-T graphic"). The eye
 * line starts at the spec's 0.33 and moves down, a hundredth at a time,
 * until the face box (+40) clears the bottom of Zone T, and never so far
 * that the chin + 40 reaches the caption line's top edge (`captionZhY` is
 * the line the plan actually uses, see `captionLine`). Moving the eye line
 * down raises the base scale (see `baseScale`), which is what makes the
 * drop possible on a take with no headroom. With no face track, or a face
 * that cannot be cleared, the spec's own number stands and the lint says
 * so.
 */
export function hostUnderZoneT(face: FaceTrack | null, captionZhY: number = ZONES.caption.zhY): { zoom: number; eyeY: number; scale: number; clears: boolean } {
  const zoom = FRAMING.base;
  if (!face) return { zoom, eyeY: FRAMING.eyeY, scale: 1, clears: true };
  for (let eyeY = FRAMING.eyeY; eyeY <= 0.62; eyeY += 0.01) {
    const box = faceBoxUnder(face, zoom, eyeY);
    if (!box) break;
    if (box.chin + ZONES.caption.faceGap > captionTopOf(captionZhY)) break;
    const clearsT = box.y0 >= ZONES.T.y1 || box.x1 <= ZONES.T.x0 || box.x0 >= ZONES.T.x1;
    if (clearsT) return { zoom, eyeY: Number(eyeY.toFixed(2)), scale: Number(box.scale.toFixed(3)), clears: true };
  }
  const box = faceBoxUnder(face, zoom, FRAMING.eyeY);
  return { zoom, eyeY: FRAMING.eyeY, scale: Number((box?.scale ?? 1).toFixed(3)), clears: false };
}

/**
 * The `split` layout's geometry for this face.
 *
 * The spec's numbers (clip 1080×608 at y 230, host at 1.12 with the eye
 * line at 1150) hold when the face fits between the clip's bottom edge and
 * the caption's top edge. When it does not, the host zoom drops to 1.00
 * and then the clip narrows (to 900 px at the least, centred, 16:9) until
 * the head clears the clip and the chin clears the caption. When nothing
 * fits — the 蒸馏 face is 490 px tall before any scaling, and the band
 * between a 16:9 clip and the caption is narrower than that — `possible`
 * is false and the layout shows landscape clips as a lone `run` (the host
 * in the circle) instead, which is the channel's own move for them.
 */
export function splitGeometry(face: FaceTrack | null, captionZhY: number = ZONES.caption.zhY): RenderHints["split"] & { keptSpec: boolean; possible: boolean } {
  const spec = ZONES.split;
  const base = { clip: { ...spec.clip }, hostZoom: spec.hostZoom, hostEyeY: spec.hostEyeY, keptSpec: true, possible: true };
  if (!face) return base;
  const fits = (clipBottom: number, zoom: number) => {
    for (let eye = spec.hostEyeY; eye >= 700; eye -= 10) {
      const box = faceBoxUnder(face, zoom, eye / FRAME.height);
      if (!box) return null;
      if (box.chin + ZONES.caption.faceGap > captionTopOf(captionZhY)) continue;
      if (box.y0 >= clipBottom + 20) return eye;
    }
    return null;
  };
  const eyeSpec = fits(spec.clip.y + spec.clip.h, spec.hostZoom);
  if (eyeSpec !== null) return { ...base, hostEyeY: eyeSpec, keptSpec: eyeSpec === spec.hostEyeY };
  for (let w = spec.clip.w; w >= 900; w -= 30) {
    const h = Math.round((w * 9) / 16);
    const clip = { x: Math.round((FRAME.width - w) / 2), y: spec.clip.y, w, h };
    const eye = fits(clip.y + clip.h, 1.0);
    if (eye !== null) return { clip, hostZoom: 1.0, hostEyeY: eye, keptSpec: false, possible: true };
  }
  return { ...base, hostZoom: 1.0, keptSpec: false, possible: false };
}

/* --------------------------------------------------- the occupancy ledger */

type Slot = { id: string; startMs: number; endMs: number; layer: "graphic" | "cutaway" | "stinger" };

/**
 * One non-caption layer at a time, and no two visual changes within 0.8 s.
 *
 * `changes` are the instants something moves: a jump cut, a graphic's
 * entrance or exit, a cutaway's start or end, a clip switch inside a run,
 * a snap push. An entrance within `sameMomentMs` of a cut is the same
 * event, not two.
 */
class Ledger {
  slots: Slot[] = [];
  changes: number[] = [];
  /** A stinger's entrance and exit: excepted from the 0.8 s rule (§1), so they are changes for the cadence count but never block a neighbour. */
  stingerPoints = new Set<number>();
  /** Moments a graphic already on screen moves inside itself (a list's next item, a bar growing, a diagram's step, a hook line landing): changes for the cadence, excepted from the 0.8 s rule like a stinger. */
  stepPoints: number[] = [];

  constructor(cuts: number[]) {
    this.changes = cuts.slice().sort((a, b) => a - b);
  }

  free(startMs: number, endMs: number, ignore?: (s: Slot) => boolean): boolean {
    return !this.slots.some((s) => !(ignore && ignore(s)) && startMs < s.endMs && s.startMs < endMs);
  }

  /** The first moment at or after `ms` that no slot covers. */
  nextFree(ms: number): number {
    let at = ms;
    for (let guard = 0; guard < 50; guard++) {
      const hit = this.slots.find((s) => at < s.endMs && s.startMs <= at);
      if (!hit) return at;
      at = hit.endMs;
    }
    return at;
  }

  /** A change at `ms` is fine when nothing else changed within 0.8 s (or it is the same moment as a cut); a stinger's own points do not count. */
  quietAround(ms: number, gap = TIMING.minChangeGapMs): boolean {
    return !this.changes.some((c) => {
      const d = Math.abs(c - ms);
      return d > TIMING.sameMomentMs && d < gap && !this.stingerPoints.has(c) && !this.stepPoints.includes(c);
    });
  }

  /** A step inside a graphic: counted, never blocking. */
  addStep(ms: number) {
    this.stepPoints.push(round(ms));
    this.addChange(round(ms));
  }

  take(slot: Slot, exempt = false) {
    this.slots.push(slot);
    if (!exempt) {
      this.changes.push(slot.startMs, slot.endMs);
    } else {
      this.changes.push(slot.startMs, slot.endMs);
      this.stingerPoints.add(slot.startMs);
      this.stingerPoints.add(slot.endMs);
    }
    this.changes.sort((a, b) => a - b);
  }

  addChange(ms: number) {
    this.changes.push(ms);
    this.changes.sort((a, b) => a - b);
  }
}

/**
 * Find a slot for a layer near where it wants to be.
 *
 * The candidates for the start, in order: the wanted moment; then every
 * existing change point and every slot's end between the wanted moment
 * and `latestStartMs` (an entrance *on* a cut or *on* the previous card's
 * exit is one event, not two — the editor's own move, cards back to
 * back); then the wanted moment in 400 ms steps. A candidate is taken
 * when it is free, quiet (nothing else changes within 0.8 s, unless it is
 * the same moment) and leaves at least `minMs` before the next thing. The
 * exit must be quiet too: when it is not, it is pulled onto the change
 * point it was near, or back by 200 ms until it is. Null when there is no
 * room: the beat stays on the host and is listed as skipped.
 */
/** How far past its own longest form a layer may run to end exactly on the change it is near (a still ending on the jump cut it hides). */
const SNAP_OVERRUN_MS = 500;

function findSlot(
  ledger: Ledger,
  want: { startMs: number; minMs: number; maxMs: number; latestStartMs: number; hardEndMs: number; softEndAfter?: (startMs: number) => number; snapBackMs?: number },
  exempt = false,
  trace?: (line: string) => void,
): { startMs: number; endMs: number } | null {
  const earliest = Math.max(0, want.startMs);
  const t = (line: string) => trace?.(`    ${line}`);
  if (earliest > want.latestStartMs) {
    t(`wanted ${earliest} is past the latest start ${want.latestStartMs}`);
    return null;
  }
  const gap = TIMING.minChangeGapMs;
  const starts = new Set<number>([earliest]);
  /*
   * A change just before the wanted moment (a cut she made before the word)
   * is the better start: the entrance and the cut are one event. Three
   * frames by default; a layer whose landing is not its entrance (a counter
   * counts up to its word) may reach back as far as `snapBackMs`, which is
   * how a counter wanted 150 ms after a jump cut lands on the cut instead of
   * waiting 0.8 s and missing its figure.
   */
  const back = Math.max(100, want.snapBackMs ?? 0);
  for (const c of ledger.changes) if (c >= earliest - back && c <= want.latestStartMs) starts.add(Math.max(0, c));
  for (const s of ledger.slots) if (s.endMs > earliest && s.endMs <= want.latestStartMs) starts.add(s.endMs);
  for (let at = earliest + 400; at <= want.latestStartMs; at += 400) starts.add(at);
  const sorted = Array.from(starts).sort((a, b) => a - b);
  for (const wanted of sorted) {
    let start = ledger.nextFree(wanted);
    /* `nextFree` is monotonic, so once it passes the latest start every later candidate does too. */
    if (start > want.latestStartMs) {
      t(`${wanted}: next free moment ${start} is past the latest start ${want.latestStartMs}`);
      break;
    }
    /* Onto the change it is nearly on, so the entrance and the cut are one frame. */
    const same = ledger.changes.find((c) => Math.abs(c - start) <= TIMING.sameMomentMs && c !== start);
    if (same !== undefined && ledger.nextFree(same) === same && same <= want.latestStartMs) start = same;
    if (!exempt && !ledger.quietAround(start)) {
      t(`${wanted}→${start}: not quiet (a change within 0.8 s: ${ledger.changes.filter((c) => Math.abs(c - start) < gap && Math.abs(c - start) > TIMING.sameMomentMs).join(",")})`);
      continue;
    }
    const nextSlot = ledger.slots.filter((s) => s.startMs >= start).sort((a, b) => a.startMs - b.startMs)[0];
    const nextStart = nextSlot ? nextSlot.startMs : Infinity;
    /* The soft end (the next beat's word, measured from where this one actually starts) shortens the hold but never below `minMs`. */
    const soft = want.softEndAfter ? Math.max(start + want.minMs, want.softEndAfter(start)) : Infinity;
    const cap = Math.min(want.hardEndMs, nextStart, soft);
    let end = Math.min(start + want.maxMs, cap);
    if (!exempt) {
      /*
       * The exit must be a quiet moment too. Forward first, onto the change
       * it is near (a cutaway ending on the jump cut it hides; a card
       * leaving as the next arrives), as long as that does not overrun the
       * layer's own length or its hard end by more than `SNAP_OVERRUN_MS`
       * and never into the next slot; else back onto the last change that
       * still leaves `minMs`; else back by 200 ms and look again.
       */
      for (let tries = 0; tries < 12 && end - start >= want.minMs && !ledger.quietAround(end); tries++) {
        const fwd = ledger.changes.find((c) => c > end && c - end < gap && c <= nextStart && c <= want.hardEndMs + SNAP_OVERRUN_MS && c <= start + want.maxMs + SNAP_OVERRUN_MS);
        if (fwd !== undefined) {
          end = fwd;
          break;
        }
        const near = ledger.changes.filter((c) => c < end && c >= start + want.minMs).pop();
        end = near !== undefined && end - near < gap ? near : end - 200;
      }
    }
    if (end - start >= want.minMs && ledger.free(start, end)) {
      t(`placed ${round(start)}–${round(end)}`);
      return { startMs: round(start), endMs: round(end) };
    }
    t(`${wanted}→${start}: only ${end - start} ms free before ${cap} (need ${want.minMs}); next: ${nextSlot ? `${nextSlot.id} at ${nextSlot.startMs}` : "nothing"}`);
  }
  return null;
}

/* ------------------------------------------------------------- the plan */

/**
 * The layout: graphics, cutaways, framing, runs, and the numbers that say
 * whether it keeps the spec.
 */
export function resolveLayout(input: LayoutInput): LayoutPlan {
  const { sentences, totalMs, pace } = input;
  const sentence = byId(sentences);
  const notes: string[] = [];
  const skipped: LayoutStats["skipped"] = [];
  const graphics: GraphicSpecV2[] = [];
  const cutaways: CutawaySpec[] = [];
  const runs: RunSpec[] = [];
  const pushes: LayoutPlan["pushes"] = [];

  const cutPoints = input.pieces.slice(1).map((p) => p.inMs);
  const ledger = new Ledger(cutPoints);

  const captionZhY = captionLine(input.face);
  const zoneT = hostUnderZoneT(input.face, captionZhY);
  const split = splitGeometry(input.face, captionZhY);
  const entityCardDone = new Set<string>();
  if (!split.possible) notes.push("分屏布局放不下这张脸（16:9 视频框和字幕之间的空间比脸还小），横屏素材改用单段圆框布局。");
  else if (!split.keptSpec) notes.push(`分屏布局按人脸重算：视频框 ${split.clip.w}×${split.clip.h}，主播 ${split.hostZoom.toFixed(2)} 倍、眼线 y≈${split.hostEyeY}（规格里的 1080×608 / 1.12 / 1150 放不下这张脸）。`);
  if (zoneT.clears && zoneT.eyeY !== FRAMING.eyeY) notes.push(`上方图形出现时主播眼线降到 ${Math.round(zoneT.eyeY * 100)}% 高度（画面 ${zoneT.scale.toFixed(2)} 倍填满），让人脸避开 T 区；规格的 30–36% 会压在额头上。`);
  if (!zoneT.clears) notes.push("这张脸在任何取景下都无法避开 T 区：上方图形会与人脸框重叠，见 lint。");

  /*
   * Assets by the beat that owns them (`Sourced.beatId` is a design beat id
   * here, see `DesignBeat`). A `split` pick falls back to `run` when this
   * face leaves no room for the split. The other way round too: sourcing
   * answers `run` for a landscape asset under 1280 wide, but the run layout
   * is a *sequence* of 2–4 clips under the presenter's circle, and a single
   * picture in it reads as pasted (r01: one upscaled 1280×720 still with the
   * circle over the backdrop's text). A lone asset goes in the split, where
   * a 16:9 picture fits its box; only the run pass below puts clips back
   * in the circle, and only when there are two or more of them.
   */
  const sourcedByBeat = new Map(
    input.sourced.map((s) => [s.beatId, !split.possible && s.layout === "split" ? { ...s, layout: "run" as Layout } : split.possible && s.layout === "run" ? { ...s, layout: "split" as Layout } : s]),
  );
  const usedSourced = new Set<string>();
  /** How many entity cards one sentence asks for: three or more and they go back to back, shorter. */
  const entityBeatsIn = new Map<string, number>();
  for (const b of input.beats) if ((b.intent === "org" || b.intent === "product" || b.intent === "person") && b.priority < 3) entityBeatsIn.set(b.sentenceId, (entityBeatsIn.get(b.sentenceId) ?? 0) + 1);
  /*
   * Where the chosen window starts inside the asset's own file. Sourcing
   * cuts (local) or imports (files) only the window when it has one —
   * `asset.window` says so — and then the file begins at the window: its
   * duration is the whole clip there is, and it is read from 0. Only an
   * asset imported whole is read from `windowMs[0]`.
   */
  const inFileMs = (src: Sourced): number => (src.asset.window ? 0 : Math.max(0, src.windowMs[0]));
  /** How much of a sourced clip is there to play from its window's start. */
  const availableMs = (src: Sourced): number => {
    if (src.kind !== "video") return Infinity;
    const total = src.asset.durationMs ?? src.candidate.durationMs;
    return total ? Math.max(0, total - inFileMs(src)) : src.windowMs[1] - src.windowMs[0];
  };
  const cutawayOf = (beat: DesignBeat, s: Sentence, src: Sourced, slot: { startMs: number; endMs: number }, runId?: string): CutawaySpec => ({
    id: gid("cutaway", beat.id),
    beatId: beat.id,
    sentenceId: s.id,
    startMs: slot.startMs,
    endMs: slot.endMs,
    sourceInMs: inFileMs(src),
    layout: runId ? "run" : src.layout,
    cropX: (runId ? "run" : src.layout) === "run" ? cropBesideCircle(src.subjectX, src.asset.width, src.asset.height) : src.subjectX,
    still: src.kind !== "video",
    runId,
    kind: src.kind,
    score: src.score,
    reasonZh: src.reasonZh,
    label: beat.entity?.name ?? beat.anchor ?? beat.intent,
    asset: src.asset,
    candidate: src.candidate,
    credit: src.asset.credit || src.candidate.credit,
  });

  /* ---- 1. furniture ------------------------------------------------ */
  if (input.furniture.header.title) {
    graphics.push({ id: gid("header", "all"), kind: "header", startMs: 0, endMs: totalMs, zone: "corner", props: { text: input.furniture.header.title, sub: input.furniture.header.sub, opacity: 0.9, enter: "fade" } });
  }
  if (input.furniture.watermark) {
    graphics.push({ id: gid("watermark", "all"), kind: "watermark", startMs: 0, endMs: totalMs, zone: "lower", props: { text: input.furniture.watermark, enter: "fade" } });
  }
  if (input.furniture.footnote) {
    graphics.push({ id: gid("footnote", "all"), kind: "footnote", startMs: 0, endMs: totalMs, zone: "lower", props: { text: input.furniture.footnote, enter: "fade" } });
  }

  /* ---- 2. hook ------------------------------------------------------ */
  const first = sentences[0];
  const hookLines = input.hook.lines.slice(0, 3).map((l) => l.trim()).filter(Boolean);
  if (hookLines.length) {
    /*
     * Each line lands on the word it quotes: the model's `landOn` when it
     * names the words, else the line itself, else the line's last four,
     * three, two characters (罕见联手 → 联手, 点名中国AI【蒸馏】 → 蒸馏),
     * searched over the first three sentences. A line whose words are not
     * said inside the block's window lands a quarter second after the one
     * before it.
     */
    const landOn = input.hook.landOn ?? [];
    const opening = sentences.slice(0, 3);
    const find = (key: string): number | null => {
      for (const s of opening) {
        const hit = anchorIn(s, key);
        if (hit) return hit.startMs;
      }
      return null;
    };
    const lands: number[] = [];
    let lastLand = 0;
    hookLines.forEach((line, i) => {
      const plain = line.replace(/[【】]/g, "");
      const keys = [landOn[i]?.replace(/[【】]/g, ""), plain, plain.slice(-4), plain.slice(-3), plain.slice(-2)].filter((k): k is string => Boolean(k && k.length >= 2));
      let at: number | null = null;
      for (const k of keys) {
        const hit = find(k);
        if (hit !== null && hit <= TIMING.hookMaxMs - 600) {
          at = hit;
          break;
        }
      }
      lands.push(round(Math.max(lastLand + 250, at ?? Math.max(lastLand + 400, i * 500))));
      lastLand = lands[i];
    });
    /*
     * The whole block holds 1.2 s after its last line lands (it was 0.9 s
     * and the full claim was readable for under a second on r01), inside
     * the 2.5–4 s the spec allows.
     */
    const holdEnd = round(clamp(lastLand + 1200, TIMING.hookMs, Math.min(TIMING.hookMaxMs, totalMs)));
    /* Out on the jump cut just before, when there is one within 0.6 s: the block leaves, the cut and the first picture after it are one change, not three. */
    const endMs = cutPoints.filter((c) => c >= Math.max(TIMING.hookMs, lastLand + 700) && c <= holdEnd && holdEnd - c <= 600).pop() ?? holdEnd;
    /* The snap push on the hook's last key word (蒸馏), if it is said inside the block. */
    const punchKey = hookLines[hookLines.length - 1].match(/【([^】]+)】/)?.[1];
    const punchAt = punchKey ? (find(punchKey) ?? undefined) : undefined;
    graphics.push({
      id: gid("hook", "open"),
      kind: "hook",
      startMs: 0,
      endMs,
      zone: "T",
      props: { lines: hookLines, landMs: lands, lineMs: TIMING.hookLineMs, size: 120, snapOn: punchAt !== undefined && punchAt < endMs ? punchAt : null },
    });
    ledger.take({ id: gid("hook", "open"), startMs: 0, endMs, layer: "graphic" });
    for (const at of lands) if (at > 0 && at < endMs) ledger.addStep(at);
    if (punchAt !== undefined && punchAt < endMs) {
      const s = first && punchAt <= first.endMs ? first : sentences[1];
      pushes.push({ startMs: round(punchAt), endMs: round(Math.min(s?.endMs ?? punchAt + 1500, punchAt + 4000)), to: FRAMING.snap.to, sentenceId: s?.id ?? first?.id ?? "s000" });
    }
  }

  /* ---- 3. end card, lower third / chip, stingers -------------------- */
  /*
   * A short (a Reel, a Short: 90 s or less) ends on her face. The full-screen
   * card took the last 3 s of a 21 s reel and blacked her out on the
   * punchline (「但是创造不了新的能力」 said over the void); a short keeps only
   * the 素材来源 line, small, over the picture, and no chapter stingers.
   */
  const short = totalMs <= TIMING.shortMaxMs;
  const creditsLine = input.credits?.line ?? "";
  const endStart = short && !creditsLine ? totalMs : round(Math.max(0, totalMs - (short ? TIMING.shortCreditsMs : TIMING.endCardMax)));
  if (endStart < totalMs) {
    graphics.push({
      id: gid("end-card", "close"),
      kind: "end-card",
      startMs: endStart,
      endMs: totalMs,
      zone: short ? "lower" : "full",
      props: { text: input.endCard.titleZh, sub: input.endCard.questionZh, creditsLine, enter: "fade", ...(short ? { compact: true } : {}) },
    });
    if (!short) ledger.take({ id: gid("end-card", "close"), startMs: endStart, endMs: totalMs, layer: "graphic" });
  }

  const nameSentence = input.lowerThird.sentenceId ? sentence.get(input.lowerThird.sentenceId) : undefined;
  const nameAt = nameSentence ? (anchorIn(nameSentence, `我是${input.lowerThird.name}`) ?? anchorIn(nameSentence, input.lowerThird.name))?.startMs ?? nameSentence.startMs : null;
  const nameInIntro = nameAt !== null && nameAt <= TIMING.chipWindow[1];
  if (nameAt !== null) {
    const slot = findSlot(ledger, { startMs: nameAt + TIMING.land[0], minMs: 2000, maxMs: TIMING.lowerThirdMs, latestStartMs: nameAt + 1500, hardEndMs: endStart });
    if (slot) {
      graphics.push({ id: gid("lower-third", "name"), kind: "lower-third", startMs: slot.startMs, endMs: slot.endMs, zone: "lower", props: { text: input.lowerThird.name, sub: input.lowerThird.sub, enter: "rise" } });
      ledger.take({ id: gid("lower-third", "name"), ...slot, layer: "graphic" });
    } else notes.push("姓名条没有位置（她说名字的那一句被其他图形占满），已略过。");
  }
  /*
   * She only says her name at the end (or never): a small chip at 2–6 s.
   * Placed after the footage (see the passes below): on r01 the chip took
   * 3.7–5.7 s and the NSA / CISA / FBI pictures that open the story, all
   * verified 9–10/10, found no room. The picture of the thing said wins;
   * the chip takes what is left of its window.
   */
  const placeNameChip = () => {
    if (nameInIntro) return;
    const hookEnd = graphics.find((g) => g.kind === "hook")?.endMs ?? 0;
    const slot = findSlot(ledger, { startMs: Math.max(TIMING.chipWindow[0], hookEnd), minMs: 1500, maxMs: TIMING.nameChipMs, latestStartMs: TIMING.chipWindow[1] - 1500, hardEndMs: TIMING.chipWindow[1] + 1500 });
    if (slot) {
      graphics.push({ id: gid("chip", "name"), kind: "chip", startMs: slot.startMs, endMs: slot.endMs, zone: "corner", props: { text: input.lowerThird.name, sub: input.lowerThird.sub, enter: "pop", name: true } });
      ledger.take({ id: gid("chip", "name"), ...slot, layer: "graphic" });
    }
  };

  (short ? [] : input.chapters).forEach((ch, i) => {
    const s = sentence.get(ch.sentenceId);
    if (!s) return;
    /* On the jump cut the chapter opens with, when there is one within five frames; else two frames before the first word. */
    const wanted = s.startMs + TIMING.land[0];
    const onCut = cutPoints.find((c) => Math.abs(c - wanted) <= 5 * MS_PER_FRAME);
    const startMs = round(clamp(onCut ?? wanted, 0, totalMs - TIMING.stingerMs));
    if (startMs < 1500) return; // never over the hook
    const endMs = startMs + TIMING.stingerMs;
    if (!ledger.free(startMs, endMs)) {
      skipped.push({ beatId: `chapter:${ch.sentenceId}`, reasonZh: `章节转场「${ch.titleZh}」与其他图形重叠，略过` });
      return;
    }
    graphics.push({ id: gid("stinger", ch.sentenceId), kind: "stinger", startMs, endMs, zone: "full", props: { index: i + 1, text: `${String(i + 1).padStart(2, "0")} ${ch.titleZh}`, titleZh: ch.titleZh, enter: "cut" } });
    ledger.take({ id: gid("stinger", ch.sentenceId), startMs, endMs, layer: "stinger" }, true);
  });

  /* ---- 5. beats by priority ----------------------------------------- */
  /*
   * Spans first (a list that builds across three sentences, the diagram),
   * because they need the long slot and a card dropped in the middle of
   * one would cut it short; then everything else by priority and time.
   */
  const spanFirst = (b: DesignBeat) => (b.intent === "list" || (b.intent === "concept" && b.diagram?.steps?.length) ? 0 : 1);
  const order = input.beats
    .slice()
    .sort((a, b) => spanFirst(a) - spanFirst(b) || a.priority - b.priority || (sentence.get(a.sentenceId)?.startMs ?? 0) - (sentence.get(b.sentenceId)?.startMs ?? 0));

  let lastSnap = -Infinity;
  /** Beats whose sourced picture the footage pass put on screen. */
  const footageDone = new Set<string>();
  /** Beats whose name went on a group card with their sentence-mates. */
  const groupCarded = new Set<string>();
  /**
   * When the next thing wants the screen: the moments every beat of
   * priority 1–2 lands on, sorted. A card holds no longer than the next
   * one's word, so the greedy placement in time order does not let a
   * headline's four seconds swallow the term card that follows it.
   */
  const wantStarts = input.beats
    .filter((b) => b.priority < 3 && b.intent !== "none")
    .map((b) => {
      const s = sentence.get(b.sentenceId);
      if (!s) return null;
      const hit = anchorIn(s, b.anchor ?? (b.number ? `${b.number.value}${b.number.unit}` : undefined));
      return round(clamp((hit?.startMs ?? s.startMs) + TIMING.land[0], 0, totalMs));
    })
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const upcomingAfter = (fromMs: number, minMs: number): number => wantStarts.find((w) => w > fromMs + minMs) ?? Infinity;

  /* One beat: its punchline push, its sourced cutaway, else the designed graphic its intent asks for. */
  const placeBeat = (beat: DesignBeat) => {
    const s = sentence.get(beat.sentenceId);
    if (!s) {
      skipped.push({ beatId: beat.id, reasonZh: "句子不在成片里（已被剪掉）" });
      return;
    }
    /* The host herself is introduced by the lower third / name chip; an entity card with her monogram next to it reads as a glitch (r02 at 4:57). */
    const hostName = input.lowerThird.name.trim();
    if (hostName && beat.intent === "person" && (beat.entity?.name ?? beat.anchor ?? "").includes(hostName)) {
      skipped.push({ beatId: beat.id, reasonZh: "主播本人已有名条，不再加人物卡" });
      return;
    }
    const hit = anchorIn(s, beat.anchor);
    const wantStart = round(clamp((hit?.startMs ?? s.startMs) + TIMING.land[0], 0, totalMs));
    const phraseEnd = round(Math.min(s.endMs, totalMs));
    /*
     * A visual may arrive up to 1.2 s after its word, or later while the
     * phrase still has 0.8 s to run. Half a second was too tight on a cut
     * this dense (a jump cut every 3 s, each blocking 0.8 s either side):
     * nineteen of forty beats found no slot on the first integrated run.
     */
    const latest = Math.max(wantStart + 1200, phraseEnd - 800);
    const crowdedHere = (entityBeatsIn.get(beat.sentenceId) ?? 0) >= 3 && (beat.intent === "org" || beat.intent === "product" || beat.intent === "person");

    /* A punchline is a framing move, not a layer; it can ride with anything, and it snaps onto a cut it is nearly on. */
    if (beat.punchline && wantStart - lastSnap >= FRAMING.snap.every && wantStart > 2500 && wantStart < endStart) {
      const onCut = ledger.changes.find((c) => Math.abs(c - wantStart) < TIMING.minChangeGapMs && c >= wantStart - 100);
      const at = onCut !== undefined ? onCut : ledger.quietAround(wantStart) ? wantStart : null;
      if (at !== null && at < phraseEnd - 800) {
        pushes.push({ startMs: at, endMs: round(Math.min(phraseEnd, at + 6000)), to: FRAMING.snap.to, sentenceId: s.id });
        ledger.addChange(at);
        lastSnap = at;
      }
    }

    /* The footage pass already put this beat's picture up: nothing more to add (a crowded breath still gets its group card). */
    if (footageDone.has(beat.id) && !crowdedHere) return;

    const src = sourcedByBeat.get(beat.id);
    /*
     * A headline's image goes behind its card and a logo on its entity's
     * card; neither is a cutaway of its own. Three names in one breath get
     * the group card (every logo at once) rather than one name's building
     * for three seconds while the other two go unseen.
     */
    const wantsFootage = ["person", "org", "product", "scene", "metaphor", "concept"].includes(beat.intent) && src?.kind !== "logo";

    /* a. the sourced cutaway */
    if (src && wantsFootage && !usedSourced.has(src.beatId)) {
      const still = src.kind !== "video";
      const isLong = beat.intent === "person" || (beat.intent === "scene" && beat.priority === 1);
      /* Three names in a breath: the owner's clip is a two-second glimpse, then the group card names them all. */
      const minMs = still ? TIMING.cutaway.still[0] : TIMING.cutaway.min;
      const maxMs = Math.min(crowdedHere ? Math.max(minMs, 2000) : still ? TIMING.cutaway.still[1] : isLong ? TIMING.cutaway.long : TIMING.cutaway.max, availableMs(src));
      /* A clip may run a little past the phrase (onto the next jump cut, which it then hides); a card may not. */
      input.trace?.(`${beat.id} cutaway ${src.candidate.id} (${src.layout}, ${still ? "still" : "video"}) wants ${wantStart}, latest ${latest}, ${minMs}–${maxMs} ms`);
      const slot = maxMs >= minMs ? findSlot(ledger, { startMs: wantStart, minMs, maxMs, latestStartMs: latest, hardEndMs: Math.min(phraseEnd + (crowdedHere ? 400 : 1500), endStart), softEndAfter: (st) => upcomingAfter(st, minMs) }, false, input.trace) : null;
      if (slot) {
        const spec = cutawayOf(beat, s, src, slot);
        cutaways.push(spec);
        usedSourced.add(src.beatId);
        ledger.take({ id: spec.id, startMs: spec.startMs, endMs: spec.endMs, layer: "cutaway" });
        /* The glimpse does not stand for the name in a crowded breath: the group card that follows still lists it. */
        if (!crowdedHere && (beat.intent === "org" || beat.intent === "product" || beat.intent === "person")) entityCardDone.add(beat.entity?.name ?? beat.anchor ?? beat.id);
        if (!crowdedHere) return;
      }
      skipped.push({ beatId: beat.id, reasonZh: `「${beat.anchor ?? s.text.slice(0, 12)}」的素材没有位置，改用设计卡片或留在主播` });
    }

    /* b. the designed graphic for the intent */
    /* A card holds its own length from the word it lands on, past the phrase end when the word comes late in the sentence (技术套利 is the last word of its line); spans pass their own end. */
    const place = (kind: string, minMs: number, maxMs: number, zone: GraphicSpecV2["zone"], props: Record<string, unknown>, opts: { startMs?: number; latest?: number; hardEnd?: number; snapBackMs?: number } = {}) => {
      const startMs = opts.startMs ?? wantStart;
      const latestStartMs = opts.latest ?? latest;
      input.trace?.(`${beat.id} ${kind} 「${String(props.text ?? "")}」 wants ${startMs}, latest ${latestStartMs}, ${minMs}–${maxMs} ms`);
      const slot = findSlot(
        ledger,
        {
          startMs,
          minMs,
          maxMs,
          latestStartMs,
          /* The hold is measured from wherever the card actually starts, so a card that waited for the one before keeps its length; a span (list, compare, diagram) passes its own end and is not cut by what comes next. */
          hardEndMs: Math.min(opts.hardEnd ?? Math.max(phraseEnd + 600, latestStartMs + maxMs), endStart),
          softEndAfter: opts.hardEnd === undefined ? (st) => upcomingAfter(st, minMs) : undefined,
          snapBackMs: opts.snapBackMs,
        },
        false,
        input.trace,
      );
      if (!slot) {
        skipped.push({ beatId: beat.id, reasonZh: `${kindZh(kind)}「${String(props.text ?? beat.anchor ?? "")}」没有位置` });
        return null;
      }
      const id = gid(kind, beat.id);
      graphics.push({ id, kind, startMs: slot.startMs, endMs: slot.endMs, zone, props });
      ledger.take({ id, ...slot, layer: "graphic" });
      return slot;
    };

    switch (beat.intent) {
      case "number": {
        if (!beat.number) break;
        /* The count-up ends on the spoken figure: the graphic starts 0.7 s before the word, and no later than 0.4 s after it. */
        const wantedLand = round(beat.number.saidAtMs || hit?.startMs || s.startMs);
        const startMs = Math.max(0, wantedLand - TIMING.counter.countUp);
        const props: Record<string, unknown> = {
          text: beat.number.value,
          unit: beat.number.unit,
          sub: beat.number.labelZh,
          landMs: wantedLand,
          countUpMs: TIMING.counter.countUp,
          enter: "pop",
        };
        /* Onto a jump cut up to 0.4 s before the count-up would start: the counter enters on the cut and shows its zero for at most that long before counting. */
        const slot = place("counter", 1800, TIMING.counter.hold + TIMING.counter.countUp, "T", props, {
          startMs,
          latest: Math.max(startMs, wantedLand + 400),
          hardEnd: Math.min(wantedLand + TIMING.counter.hold + 400, totalMs),
          snapBackMs: 400,
        });
        /*
         * The slot may open later than the count-up wanted (a change just
         * before it, another card leaving): the count-up is shortened to what
         * is left before the word, never under 200 ms, so the figure still
         * lands on it; and a graphic that could only start after the word
         * lands 200 ms in, rather than carrying a landing before its own
         * first frame. The props are edited in place: `place` pushed them.
         */
        if (slot) {
          const landMs = Math.max(wantedLand, slot.startMs + 200);
          props.landMs = landMs;
          props.countUpMs = Math.min(TIMING.counter.countUp, landMs - slot.startMs);
          if (landMs !== wantedLand) props.landLateMs = landMs - wantedLand;
        }
        break;
      }
      case "compare": {
        if (!beat.bars?.length) break;
        const bars = beat.bars.slice(0, 3);
        /*
         * The bars grow in the order their figures are said: from the first
         * figure's word (63.5%) to the last (35.5%) and then a 3–5 s hold.
         * When the figures sit in different sentences (几千万–几亿美金 …
         * 几千–几十万美金, eight seconds apart) the card spans them, like a
         * list. It leaves for the next figure of the same sentence (便宜6到9成)
         * before that one's count-up starts.
         */
        const at = (beat.barsAtMs ?? []).filter((x) => Number.isFinite(x));
        const firstAt = at.length ? Math.min(...at) : wantStart;
        const lastAt = at.length ? Math.max(...at) : wantStart;
        const startMs = round(clamp(Math.min(firstAt + TIMING.land[0], wantStart), 0, totalMs));
        const nextStat = input.beats
          .filter((b) => b.sentenceId === beat.sentenceId && b.intent === "number" && b.number && b.number.saidAtMs > lastAt + 1000)
          .map((b) => b.number!.saidAtMs)
          .sort((a, b) => a - b)[0];
        const minMs = Math.max(TIMING.compare.hold[0], lastAt - startMs + 1500);
        const maxMs = Math.max(minMs, lastAt - startMs + TIMING.compare.hold[1]);
        const compareSlot = place("compare", minMs, maxMs, "T", {
          text: beat.compareTitleZh ?? beat.anchor ?? "",
          bars,
          barMs: TIMING.compare.barMs,
          stepsMs: at.length === bars.length ? at.map((x) => Math.max(0, round(x - startMs))) : bars.map((_, i) => i * TIMING.compare.barMs),
          enter: "rise",
        }, { startMs, latest: startMs + 500, hardEnd: nextStat !== undefined ? Math.max(startMs + minMs, nextStat - TIMING.counter.countUp) : Math.min(startMs + maxMs, totalMs) });
        if (compareSlot) for (const x of at) if (x > compareSlot.startMs + TIMING.sameMomentMs && x < compareSlot.endMs) ledger.addStep(x);
        break;
      }
      case "list": {
        if (!beat.items?.length) break;
        const items = beat.items.slice(0, 5).map((it) => {
          const its = sentence.get(it.sentenceId) ?? s;
          const at = anchorIn(its, it.textZh.split(/\s+/)[0])?.startMs ?? its.startMs;
          return { text: it.textZh, atMs: round(at) };
        });
        const firstAt = Math.min(...items.map((i) => i.atMs));
        const lastAt = Math.max(...items.map((i) => i.atMs));
        const lastS = sentence.get(beat.items[beat.items.length - 1].sentenceId) ?? s;
        const listSlot = place("list", Math.min(TIMING.list.max, lastAt - firstAt + 1200), Math.min(TIMING.list.max, lastAt - firstAt + TIMING.list.hold + 1500), "T", {
          text: beat.listTitleZh ?? "",
          items: items.map((i) => ({ text: i.text, atMs: i.atMs })),
          enter: "rise",
        }, { startMs: Math.max(0, firstAt + TIMING.land[0]), latest: firstAt + 600, hardEnd: Math.min(lastS.endMs + 800, totalMs) });
        if (listSlot) for (const i of items) if (i.atMs > listSlot.startMs + TIMING.sameMomentMs && i.atMs < listSlot.endMs) ledger.addStep(i.atMs);
        break;
      }
      case "concept": {
        if (beat.diagram?.steps?.length && !graphics.some((g) => g.kind === "diagram")) {
          const steps = beat.diagram.steps.slice(0, 3);
          const span = Math.min(TIMING.diagramMax, Math.max(3000, phraseEnd - wantStart));
          const stepsMs = steps.map((_, i) => round((span * (i + 0.15)) / steps.length));
          /* The row's text is what the editor lists: the term when the beat carries one, else the mechanism spelt out (老师模型 → 输出 → 学生模型). */
          const diagramSlot = place("diagram", 3000, span, "T", { steps, stepsMs, text: beat.term?.term || steps.join(" → "), enter: "rise" });
          if (diagramSlot) for (const st of stepsMs.slice(1)) if (diagramSlot.startMs + st < diagramSlot.endMs) ledger.addStep(diagramSlot.startMs + st);
        } else if (beat.term) {
          place("term", 2200, TIMING.termMs, "T", { text: beat.term.term, sub: beat.term.definitionZh, enter: "rise" });
        }
        break;
      }
      case "headline": {
        if (!beat.headline) break;
        const img = src && src.kind === "image" && !usedSourced.has(src.beatId) ? src : null;
        const slot = place("headline", TIMING.headline[0], TIMING.headline[1], "T", {
          text: beat.headline.quoteZh,
          outlet: beat.headline.outlet,
          date: beat.headline.date,
          url: beat.headline.url ?? null,
          /* 「」 only around her own words or the brief's (design.ts:groundHeadlines). */
          verbatim: (beat.headline as { verbatim?: boolean }).verbatim !== false,
          image: img ? { asset: img.asset, credit: img.asset.credit || img.candidate.credit, opacity: 0.3 } : null,
          enter: "slide-blur",
        });
        if (slot && img) usedSourced.add(img.beatId);
        break;
      }
      case "org":
      case "product":
      case "person": {
        const name = beat.entity?.name ?? beat.anchor ?? "";
        if (!name) break;
        if (groupCarded.has(beat.id)) break;
        if (!entityCardDone.has(name)) {
          /* The logo comes from the entity resolver (per entity), or from this beat's own sourcing when that found one. */
          const fromBeat = src && src.kind === "logo" && !usedSourced.has(src.beatId) ? src : null;
          const logo = input.logos?.[name] ?? fromBeat;
          const crowded = (entityBeatsIn.get(beat.sentenceId) ?? 1) >= 3;
          /*
           * Three or more names in one breath (「美国国安局、网络安全局和FBI」)
           * and no card yet for any of them: one card naming them all, with
           * every logo the resolver found, instead of three cards of a
           * second each that nobody could read. A name that already has its
           * card (or its cutaway) is left out of the group.
           */
          const others = crowded
            ? input.beats.filter((b) => b.sentenceId === beat.sentenceId && b.id !== beat.id && b.priority < 3 && (b.intent === "org" || b.intent === "product" || b.intent === "person") && !entityCardDone.has(b.entity?.name ?? b.anchor ?? "") && !groupCarded.has(b.id))
            : [];
          if (others.length >= 1) {
            const members = [beat, ...others].map((b) => ({ name: b.entity?.name ?? b.anchor ?? "", romanised: b.entity?.romanised ?? null, kind: b.entity?.kind ?? null }));
            /* The card lands on the first of the names as it is said, not on the sentence's first word. */
            const said = [beat, ...others].map((b) => anchorIn(s, b.anchor)?.startMs).filter((x): x is number => x !== undefined);
            const groupStart = said.length ? round(clamp(Math.min(...said) + TIMING.land[0], 0, totalMs)) : wantStart;
            const slot = place("entity", 2000, 3000, "T", {
              text: members.map((m) => m.name).join(" · "),
              sub: "",
              romanised: null,
              kind: beat.entity?.kind ?? null,
              logo: logo ? { asset: logo.asset, credit: logo.asset.credit || logo.candidate.credit } : null,
              group: members.map((m) => {
                const l = input.logos?.[m.name];
                return { ...m, logo: l ? { asset: l.asset, credit: l.asset.credit || l.candidate.credit } : null };
              }),
              enter: "pop",
            }, { startMs: groupStart, latest: Math.max(groupStart + 500, phraseEnd + 1500) });
            if (slot) {
              for (const m of members) entityCardDone.add(m.name);
              for (const b of others) groupCarded.add(b.id);
              if (fromBeat && logo === fromBeat) usedSourced.add(fromBeat.beatId);
              break;
            }
          }
          const [minMs, maxMs] = crowded ? TIMING.entityCardCrowded : TIMING.entityCard;
          const slot = place("entity", minMs, maxMs, "T", {
            text: name,
            /* Three names in a breath: name and logo only, there is no time to read a descriptor. */
            sub: crowded ? "" : (beat.entity?.descriptorZh ?? ""),
            romanised: beat.entity?.romanised ?? null,
            kind: beat.entity?.kind ?? null,
            logo: logo ? { asset: logo.asset, credit: logo.asset.credit || logo.candidate.credit } : null,
            enter: "pop",
          }, crowded ? { latest: Math.max(latest, phraseEnd + 1000) } : {});
          if (slot) {
            entityCardDone.add(name);
            if (fromBeat && logo === fromBeat) usedSourced.add(fromBeat.beatId);
          }
        } else {
          place("chip", 1200, TIMING.chipMs, "corner", { text: name, enter: "pop" });
        }
        break;
      }
      default:
        break;
    }
  };

  /*
   * Two passes around the runs: first the cards the brief itself asks
   * for and the spans (a list that builds across three sentences, the
   * diagram, the term cards), so a run of scene footage cannot take the
   * seconds a 术语卡 needs; then the runs; then everything else.
   */
  const early = (b: DesignBeat) => b.intent === "list" || (b.intent === "concept" && Boolean(b.diagram?.steps?.length || b.term));
  for (const beat of order) if (early(beat)) placeBeat(beat);
  /*
   * Then the figures: a counter must land on its spoken number (a window of
   * about a second) and compare bars on theirs, while a picture can wait for
   * the rest of its phrase. Tight windows first is what keeps both.
   */
  const tight = (b: DesignBeat) => !early(b) && (b.intent === "number" || b.intent === "compare");
  for (const beat of order) if (tight(beat)) placeBeat(beat);

  /* ---- 4. runs: consecutive footage back to back over the host in the circle ---- */
  /*
   * The channel's own edit spends half its time in this layout (HOUSE_FORMAT):
   * the presenter in the circle, 2–4 clips changing every 2–4 s underneath,
   * 6–12 s a run. A run forms from consecutive beats that own a video
   * asset (any intent but a named person, whose interview clip deserves
   * the whole frame or the split), no more than 2.5 s apart, when there
   * are three of them, or two with a clip that only fits the circle layout
   * (landscape under 1280 wide). The clips are laid wall to wall from the
   * first beat's word: the second clip starts when the first runs out, not
   * on its own noun, because a hole in a run is the host in a circle over
   * nothing. A run that ends up with fewer than two clips, or shorter
   * than 6 s, is dissolved and its beats go back to being single cutaways.
   */
  const listSentences = new Set(input.beats.filter((b) => b.intent === "list" && b.items?.length).flatMap((b) => [b.sentenceId, ...b.items!.map((it) => it.sentenceId)]));
  const runEligible = (b: DesignBeat) => {
    const s = sourcedByBeat.get(b.id);
    /* A sentence inside a list build keeps its Zone T for the list; its clip stays single, if it fits at all. */
    return Boolean(s && b.priority < 3 && s.kind === "video" && !listSentences.has(b.sentenceId) && b.intent !== "person" && b.intent !== "headline" && ["scene", "org", "product", "concept", "metaphor"].includes(b.intent));
  };
  {
    const ordered = input.beats.filter(runEligible).sort((a, b) => (sentence.get(a.sentenceId)?.startMs ?? 0) - (sentence.get(b.sentenceId)?.startMs ?? 0));
    let group: DesignBeat[] = [];
    let runMs = 0;
    const flush = () => {
      if (group.length >= 2) {
        const firstS = sentence.get(group[0].sentenceId)!;
        const lastS = sentence.get(group[group.length - 1].sentenceId)!;
        const firstHit = anchorIn(firstS, group[0].anchor);
        const startMs = round(clamp((firstHit?.startMs ?? firstS.startMs) + TIMING.land[0], 0, totalMs));
        const wantEnd = round(clamp(lastS.endMs, startMs + TIMING.run.min, Math.min(startMs + TIMING.run.max, totalMs)));
        if (wantEnd - startMs >= TIMING.run.min && (runMs + wantEnd - startMs) / totalMs <= TIMING.runShare && ledger.free(startMs, wantEnd) && startMs >= TIMING.firstCutawayBy - 1000) {
          const id = `run:${group[0].sentenceId}`;
          const clips: CutawaySpec[] = [];
          let at = startMs;
          for (const b of group) {
            const src = sourcedByBeat.get(b.id)!;
            if (at + TIMING.run.clipEvery[0] > wantEnd || clips.length >= TIMING.run.clips[1]) break;
            const len = clamp(Math.min(availableMs(src), TIMING.run.clipEvery[1]), TIMING.run.clipEvery[0], TIMING.run.clipEvery[1]);
            let end = Math.min(wantEnd, at + len);
            /* A clip switch within 0.8 s of a jump cut lands on the cut instead: one change, and the cut is hidden. */
            const onCut = cutPoints.find((c) => Math.abs(c - end) < TIMING.minChangeGapMs && c >= at + TIMING.run.clipEvery[0] && c <= Math.min(wantEnd, at + TIMING.run.clipEvery[1] + SNAP_OVERRUN_MS));
            if (onCut !== undefined) end = onCut;
            if (end - at < TIMING.run.clipEvery[0]) break;
            clips.push(cutawayOf(b, sentence.get(b.sentenceId)!, src, { startMs: at, endMs: round(end) }, id));
            at = round(end);
          }
          if (clips.length >= 2 && at - startMs >= TIMING.run.min) {
            const run: RunSpec = { id, startMs, endMs: at, cutawayIds: clips.map((c) => c.id) };
            runs.push(run);
            cutaways.push(...clips);
            ledger.take({ id, startMs, endMs: at, layer: "cutaway" });
            for (const c of clips.slice(1)) ledger.addChange(c.startMs);
            for (const c of clips) {
              usedSourced.add(c.beatId);
              const b = group.find((x) => x.id === c.beatId)!;
              if (b.intent === "org" || b.intent === "product") entityCardDone.add(b.entity?.name ?? b.anchor ?? b.id);
            }
            runMs += at - startMs;
          }
        }
      }
      group = [];
    };
    for (const b of ordered) {
      const prev = group[group.length - 1];
      const gap = prev ? (sentence.get(b.sentenceId)?.startMs ?? 0) - (sentence.get(prev.sentenceId)?.endMs ?? 0) : 0;
      if (prev && gap > 2500) flush();
      group.push(b);
    }
    flush();
  }

  /*
   * ---- 5a. the footage, before any other card -------------------------
   *
   * Real pictures are the main layer of the reel (30–40 % of the runtime,
   * PLAN.md §1), so every verified asset gets its slot before an entity
   * card, a headline or a chip can take the moment. r01 placed cards first
   * and footage after: 3 of 12 assets reached the screen, 2.9 % coverage.
   *
   * Each picture wants its word; it may come up on the jump cut just before
   * the word (the cut is then hidden under it, one change instead of two)
   * and as late as the end of its phrase; failing that, anywhere in the
   * rest of its sentence plus 2.5 s, while the thing is still being talked
   * about.
   */
  const placeFootage = (beat: DesignBeat) => {
    const s = sentence.get(beat.sentenceId);
    const src = sourcedByBeat.get(beat.id);
    if (!s || !src || src.kind === "logo" || usedSourced.has(src.beatId)) return;
    if (!["person", "org", "product", "scene", "metaphor", "concept"].includes(beat.intent)) return;
    const hit = anchorIn(s, beat.anchor);
    const wantStart = round(clamp((hit?.startMs ?? s.startMs) + TIMING.land[0], 0, totalMs));
    const phraseEnd = round(Math.min(s.endMs, totalMs));
    const crowdedHere = (entityBeatsIn.get(beat.sentenceId) ?? 0) >= 3 && (beat.intent === "org" || beat.intent === "product" || beat.intent === "person");
    const still = src.kind !== "video";
    const isLong = beat.intent === "person" || (beat.intent === "scene" && beat.priority === 1);
    const minMs = still ? TIMING.cutaway.still[0] : TIMING.cutaway.min;
    const maxMs = Math.min(crowdedHere ? Math.max(minMs, 2000) : still ? TIMING.cutaway.still[1] : isLong ? TIMING.cutaway.long : TIMING.cutaway.max, availableMs(src));
    if (maxMs < minMs) return;
    /* Back onto a cut at most 0.6 s before the word, never before the sentence itself starts. */
    const snapBackMs = clamp(wantStart - s.startMs + 100, 100, 600);
    input.trace?.(`${beat.id} footage ${src.candidate.id} (${src.layout}, ${still ? "still" : "video"}) wants ${wantStart}, latest ${Math.max(wantStart + 1200, phraseEnd)}, ${minMs}–${maxMs} ms`);
    let slot = findSlot(ledger, { startMs: wantStart, minMs, maxMs, latestStartMs: Math.max(wantStart + 1200, phraseEnd), hardEndMs: Math.min(phraseEnd + (crowdedHere ? 400 : 1500), endStart), softEndAfter: (st) => upcomingAfter(st, minMs), snapBackMs }, false, input.trace);
    if (!slot && !crowdedHere) {
      const latestStartMs = Math.min(s.endMs + 2500, endStart - minMs);
      input.trace?.(`${beat.id} footage, later in the sentence: latest ${latestStartMs}`);
      slot = findSlot(ledger, { startMs: wantStart, minMs, maxMs, latestStartMs, hardEndMs: Math.min(s.endMs + 3500, endStart), softEndAfter: (st) => upcomingAfter(st, minMs) }, false, input.trace);
    }
    if (!slot) return;
    const spec = cutawayOf(beat, s, src, slot);
    cutaways.push(spec);
    usedSourced.add(src.beatId);
    footageDone.add(beat.id);
    ledger.take({ id: spec.id, startMs: spec.startMs, endMs: spec.endMs, layer: "cutaway" });
    if (!crowdedHere && (beat.intent === "org" || beat.intent === "product" || beat.intent === "person")) entityCardDone.add(beat.entity?.name ?? beat.anchor ?? beat.id);
  };
  const byTime = (a: DesignBeat, b: DesignBeat) => (sentence.get(a.sentenceId)?.startMs ?? 0) - (sentence.get(b.sentenceId)?.startMs ?? 0) || a.priority - b.priority;
  for (const beat of input.beats.filter((b) => b.priority < 3).sort(byTime)) placeFootage(beat);

  placeNameChip();

  for (const beat of order) if (!early(beat) && !tight(beat)) placeBeat(beat);

  /*
   * ---- 5b. footage the first pass had no room for --------------------
   *
   * The first pass lands every visual on its own word, cards first, and a
   * clip that lost its word to a counter or a list is dropped. On a dense
   * cut that was most of them (the first integrated run: 14 assets sourced,
   * 4 on screen, 4 % coverage). A verified picture of the thing said is
   * still the best thing to show a few seconds later, while the sentence
   * or the one after it is running, so each unplaced asset gets a second
   * look at the rest of its sentence plus 2.5 s, in time order.
   */
  const secondLook = input.beats
    .filter((b) => {
      const src = sourcedByBeat.get(b.id);
      return Boolean(src && src.kind !== "logo" && !usedSourced.has(src.beatId) && b.priority < 3 && ["person", "org", "product", "scene", "metaphor", "concept", "headline"].includes(b.intent));
    })
    .sort((a, b) => (sentence.get(a.sentenceId)?.startMs ?? 0) - (sentence.get(b.sentenceId)?.startMs ?? 0));
  for (const beat of secondLook) {
    const src = sourcedByBeat.get(beat.id)!;
    const s = sentence.get(beat.sentenceId);
    if (!s || usedSourced.has(src.beatId)) continue;
    const still = src.kind !== "video";
    const minMs = still ? TIMING.cutaway.still[0] : TIMING.cutaway.min;
    const maxMs = Math.min(still ? TIMING.cutaway.still[1] : TIMING.cutaway.max, availableMs(src));
    if (maxMs < minMs) continue;
    const latestStartMs = Math.min(s.endMs + 2500, endStart - minMs);
    input.trace?.(`${beat.id} second look ${src.candidate.id} (${src.layout}) from ${s.startMs}, latest ${latestStartMs}`);
    const slot = findSlot(ledger, { startMs: s.startMs, minMs, maxMs, latestStartMs, hardEndMs: Math.min(s.endMs + 3500, endStart), softEndAfter: (st) => upcomingAfter(st, minMs) }, false, input.trace);
    if (!slot) continue;
    const spec = cutawayOf(beat, s, src, slot);
    cutaways.push(spec);
    usedSourced.add(src.beatId);
    ledger.take({ id: spec.id, startMs: spec.startMs, endMs: spec.endMs, layer: "cutaway" });
    const k = skipped.findIndex((x) => x.beatId === beat.id && /素材没有位置/.test(x.reasonZh));
    if (k >= 0) skipped.splice(k, 1);
  }


  /* ---- 6. chips on later mentions where the cadence needs them ------- */
  const mentionChips: { name: string; s: Sentence }[] = [];
  for (const [name, ids] of Object.entries(input.mentions ?? {})) {
    for (const id of ids) {
      const s = sentence.get(id);
      if (s && entityCardDone.has(name)) mentionChips.push({ name, s });
    }
  }
  mentionChips.sort((a, b) => a.s.startMs - b.s.startMs);

  const fillGaps = () => {
    const gaps = cadenceGaps(ledger.changes, totalMs);
    for (const g of gaps) {
      /* Prefer a chip for a name said in the gap; else a slow push is added later by the framing pass. */
      const chip = mentionChips.find((m) => m.s.startMs >= g.fromMs + 800 && m.s.startMs <= g.toMs - 1500 && !graphics.some((x) => x.kind === "chip" && String(x.props.text) === m.name && Math.abs(x.startMs - m.s.startMs) < 15000));
      if (!chip) continue;
      const at = anchorIn(chip.s, chip.name)?.startMs ?? chip.s.startMs;
      const slot = findSlot(ledger, { startMs: at + TIMING.land[0], minMs: 1200, maxMs: TIMING.chipMs, latestStartMs: Math.min(g.toMs - 1200, chip.s.endMs), hardEndMs: Math.min(chip.s.endMs + 500, endStart) });
      if (!slot) continue;
      const id = gid("chip", `${chip.s.id}:${chip.name}`);
      graphics.push({ id, kind: "chip", startMs: slot.startMs, endMs: slot.endMs, zone: "corner", props: { text: chip.name, enter: "pop" } });
      ledger.take({ id, ...slot, layer: "graphic" });
    }
  };
  fillGaps();

  /* ---- 7. coverage: stretch or trim cutaways toward 30–40 % ---------- */
  /*
   * Under 30 %, the best-scored single cutaways are held longer, up to the
   * long form (4.5 s, or 3 s for a still) and never past what the source
   * clip has, into the next sentence by at most 1.5 s (a clip may run over
   * the phrase boundary; a card may not), and never within 0.8 s of the
   * next thing. Over 40 %, the weakest are trimmed back toward the minimum.
   */
  const coverageOf = () => cutaways.reduce((sum, c) => sum + (c.endMs - c.startMs), 0) / totalMs;
  if (coverageOf() < TIMING.coverage[0]) {
    for (const c of cutaways.slice().sort((a, b) => b.score - a.score)) {
      if (coverageOf() >= TIMING.coverage[0]) break;
      if (c.runId) continue;
      const s = sentence.get(c.sentenceId)!;
      const src = sourcedByBeat.get(c.beatId);
      const cap = Math.min(c.still ? TIMING.cutaway.still[1] : TIMING.cutaway.long, src ? availableMs(src) : Infinity);
      const next = ledger.slots.filter((x) => x.id !== c.id && x.startMs >= c.endMs).sort((a, b) => a.startMs - b.startMs)[0];
      const nextChange = ledger.changes.find((x) => x > c.endMs + TIMING.sameMomentMs);
      const limit = Math.min(s.endMs + 1500, c.startMs + cap, next ? next.startMs : totalMs, nextChange !== undefined ? Math.max(c.endMs, nextChange - TIMING.minChangeGapMs) : totalMs, endStart);
      if (limit > c.endMs + 200) {
        const slot = ledger.slots.find((x) => x.id === c.id);
        if (slot) slot.endMs = round(limit);
        c.endMs = round(limit);
      }
    }
    ledger.changes = rebuildChanges(cutPoints, ledger.slots, pushes, cutaways, runs, ledger.stepPoints);
  }
  if (coverageOf() > TIMING.coverage[1]) {
    for (const c of cutaways.slice().sort((a, b) => a.score - b.score)) {
      if (coverageOf() <= TIMING.coverage[1]) break;
      const min = c.still ? TIMING.cutaway.still[0] : TIMING.cutaway.min;
      const trimmed = Math.max(c.startMs + min, c.endMs - 800);
      const slot = ledger.slots.find((x) => x.id === c.id);
      if (slot) slot.endMs = trimmed;
      c.endMs = trimmed;
    }
    ledger.changes = rebuildChanges(cutPoints, ledger.slots, pushes, cutaways, runs, ledger.stepPoints);
  }

  /* ---- 8. framing ----------------------------------------------------- */
  const zoneTSpans = graphics.filter((g) => g.zone === "T").map((g) => ({ startMs: g.startMs, endMs: g.endMs }));
  const splitSpans = cutaways.filter((c) => c.layout === "split").map((c) => ({ startMs: c.startMs, endMs: c.endMs }));
  const runSpans = [...runs.map((r) => ({ startMs: r.startMs, endMs: r.endMs })), ...cutaways.filter((c) => c.layout === "run" && !c.runId).map((c) => ({ startMs: c.startMs, endMs: c.endMs }))];
  let cutZooms = framing(input.pieces, zoneTSpans, splitSpans, pushes, { zoneT, split: { zoom: split.hostZoom, eyeY: split.hostEyeY / FRAME.height }, totalMs, runs: runSpans });
  for (const seg of cutZooms) if (seg.push && seg.push.to === FRAMING.slowPush.to) ledger.addChange(seg.push.fromMs);
  /*
   * A stretch of more than 5 s with no change at all (r02: 2:44 and 3:12,
   * one long take with nothing on it) gets a reframe in the middle: the
   * plain host segment under it switches between 1.00 and 1.12, the cut-in
   * a reel editor makes inside a long take. Only on a plain framing
   * segment (not Zone T, split, run or a punchline), at the gap's middle
   * snapped to a word start when one is within 0.6 s.
   */
  {
    const wordStarts = sentences.flatMap((x) => (x.words ?? []).map((w) => w.startMs));
    const plain = new Set(["base", "alternate", "slow push"]);
    const current = () => Array.from(new Set(ledger.changes.map(round))).sort((a, b) => a - b);
    for (const g of cadenceGaps(current(), totalMs)) {
      if (g.toMs - g.fromMs <= 5000) continue;
      const mid = (g.fromMs + g.toMs) / 2;
      const near = wordStarts.filter((w) => Math.abs(w - mid) <= 600).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
      const at = round(near ?? mid);
      const k = cutZooms.findIndex((seg) => seg.inMs + TIMING.minChangeGapMs <= at && at <= seg.outMs - TIMING.minChangeGapMs && plain.has(seg.why));
      if (k < 0) continue;
      const seg = cutZooms[k];
      const other = seg.zoom === FRAMING.base ? FRAMING.alternate : FRAMING.base;
      const a: FramingSegment = { inMs: seg.inMs, outMs: at, zoom: seg.zoom, anchor: seg.anchor, why: seg.why === "slow push" ? "base" : seg.why };
      const b: FramingSegment = { inMs: at, outMs: seg.outMs, zoom: other, anchor: [0.5, FRAMING.eyeY], why: "reframe" };
      cutZooms = [...cutZooms.slice(0, k), a, b, ...cutZooms.slice(k + 1)];
      ledger.addChange(at);
    }
  }

  /* ---- 9. the numbers ------------------------------------------------- */
  const changes = Array.from(new Set(ledger.changes.map(round))).sort((a, b) => a - b);
  const gaps = cadenceGaps(changes, totalMs);
  const cutawayMs = cutaways.reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
  const hostHiddenMs = cutaways.filter((c) => c.layout === "full").reduce((sum, c) => sum + (c.endMs - c.startMs), 0) + graphics.filter((g) => g.zone === "full").reduce((sum, g) => sum + (g.endMs - g.startMs), 0);
  const runMs = runs.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);
  const kinds: Record<string, number> = {};
  for (const g of graphics) kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
  const layouts: Record<Layout, number> = { full: 0, split: 0, run: 0 };
  for (const c of cutaways) layouts[c.layout]++;
  const intervals = changes.slice(1).map((c, i) => c - changes[i]).filter((d) => d > TIMING.sameMomentMs);

  const stats: LayoutStats = {
    totalMs,
    cutawayMs,
    coverage: cutawayMs / totalMs,
    hostVisible: 1 - hostHiddenMs / totalMs,
    runMs,
    runShare: runMs / totalMs,
    changes: changes.length,
    meanChangeMs: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : totalMs,
    maxGapMs: Math.max(0, ...gaps.map((g) => g.toMs - g.fromMs), ...intervals),
    gapsOver5s: gaps,
    graphics: kinds,
    cutaways: layouts,
    pushes: pushes.length,
    skipped,
  };
  if (pace === "calm") notes.push("节奏设为「克制」：本版仍按频道规格排布，克制档只影响文案密度的提示。");

  graphics.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  cutaways.sort((a, b) => a.startMs - b.startMs);

  return {
    graphics,
    cutaways,
    cutZooms,
    pushes: pushes.sort((a, b) => a.startMs - b.startMs),
    runs,
    changes,
    steps: Array.from(new Set(ledger.stepPoints)).sort((a, b) => a - b),
    renderHints: {
      zoneT: { zoom: zoneT.zoom, eyeY: zoneT.eyeY, scale: zoneT.scale },
      baseScale: Number(baseScale(input.face, FRAMING.eyeY).toFixed(3)),
      split: { clip: split.clip, hostZoom: split.hostZoom, hostEyeY: split.hostEyeY },
      run: ZONES.run,
      captionZhY,
      face: input.face,
    },
    stats,
    notesZh: notes,
  };
}

/**
 * The zh caption's centre line: 1360, moved down (never up) by as much of
 * the ±40 drift as the chin under the alternate framing needs so the top
 * edge stays ≥ chin + 40.
 */
/**
 * The crop centre for a `run` cutaway that keeps the picture's subject out
 * from under the presenter's circle (ZONES.run, centred at x 0.74). The
 * compositor covers the 9:16 frame and crops around `cropX`; this moves
 * the crop so the subject lands at x ≈ 0.30 of the frame instead of the
 * middle, where the circle's left edge (0.60) is close enough to cover a
 * face (r02: 张一鸣's face under the circle at 3:44). The compositor clamps
 * the crop to the picture, so a subject near the left edge stays put.
 * Pure.
 */
export function cropBesideCircle(subjectX: number | undefined, width: number | undefined, height: number | undefined): number {
  const x = subjectX ?? 0.5;
  if (!width || !height) return x;
  /* The share of the source's width the 9:16 cover crop shows. */
  const frac = Math.min(1, (height * FRAME.width) / FRAME.height / width);
  if (frac >= 0.999) return x;
  const want = 0.3;
  return clamp(x + (0.5 - want) * frac, frac / 2, 1 - frac / 2);
}

export function captionLine(face: FaceTrack | null): number {
  const box = faceBoxUnder(face, FRAMING.alternate, FRAMING.eyeY);
  if (!box) return ZONES.caption.zhY;
  const needTop = box.chin + ZONES.caption.faceGap;
  const centre = needTop + ZONES.caption.zhSize / 2;
  return round(clamp(Math.max(ZONES.caption.zhY, centre), ZONES.caption.zhY, ZONES.caption.zhY + ZONES.caption.drift));
}

/** Stretches of more than 5 s with nothing changing on screen. */
export function cadenceGaps(changes: readonly number[], totalMs: number): { fromMs: number; toMs: number }[] {
  const pts = Array.from(new Set([0, ...changes, totalMs])).sort((a, b) => a - b);
  const out: { fromMs: number; toMs: number }[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > TIMING.maxNoChangeMs) out.push({ fromMs: pts[i - 1], toMs: pts[i] });
  return out;
}

function rebuildChanges(cuts: number[], slots: Slot[], pushes: LayoutPlan["pushes"], cutaways: CutawaySpec[], runs: RunSpec[], steps: number[] = []): number[] {
  const out = [...cuts, ...steps];
  for (const s of slots) {
    out.push(s.startMs);
    if (s.layer !== "stinger") out.push(s.endMs);
  }
  for (const p of pushes) out.push(p.startMs);
  for (const r of runs) for (const id of r.cutawayIds) out.push(cutaways.find((c) => c.id === id)!.startMs);
  return out.sort((a, b) => a - b);
}

/**
 * Framing segments for the compositor.
 *
 * Each cut piece starts at the base zoom, alternating 1.00 / 1.12 on jump
 * cuts at least 1.2 s apart (a shorter piece keeps its neighbour's zoom:
 * two reframes in a second read as a stutter). Inside a piece the segment
 * is split wherever a Zone-T graphic or a split cutaway starts or ends,
 * because the host is reframed under them, and wherever a snap push lands,
 * held to the end of its sentence. A plain segment longer than 6 s gets
 * the slow push 1.00 → 1.05 across its length.
 */
export function framing(
  pieces: { inMs: number; outMs: number }[],
  zoneT: { startMs: number; endMs: number }[],
  splits: { startMs: number; endMs: number }[],
  pushes: LayoutPlan["pushes"],
  opts: { zoneT: { zoom: number; eyeY: number }; split: { zoom: number; eyeY: number }; totalMs: number; runs?: { startMs: number; endMs: number }[] },
): FramingSegment[] {
  const out: FramingSegment[] = [];
  let zoom: number = FRAMING.base;
  let lastCut = -Infinity;
  const runs = opts.runs ?? [];
  const under = (spans: { startMs: number; endMs: number }[], at: number) => spans.find((s) => s.startMs <= at && at < s.endMs);
  for (const piece of pieces) {
    if (piece.inMs - lastCut >= FRAMING.jumpCutMin && out.length) zoom = zoom === FRAMING.base ? FRAMING.alternate : FRAMING.base;
    lastCut = piece.inMs;
    /* Every boundary inside this piece where the framing might change; a mark within a frame of another is the same mark, so no crack opens between segments. */
    const marks = new Set<number>([piece.inMs, piece.outMs]);
    for (const s of [...zoneT, ...splits, ...runs]) for (const m of [s.startMs, s.endMs]) if (m > piece.inMs + 40 && m < piece.outMs - 40) marks.add(m);
    for (const p of pushes) for (const m of [p.startMs, p.endMs]) if (m > piece.inMs + 40 && m < piece.outMs - 40) marks.add(m);
    const pts = Array.from(marks)
      .sort((a, b) => a - b)
      .filter((m, i, all) => i === 0 || m - all[i - 1] >= 40 || i === all.length - 1);
    for (let i = 0; i < pts.length - 1; i++) {
      const inMs = pts[i];
      const outMs = pts[i + 1];
      if (outMs <= inMs) continue;
      const mid = (inMs + outMs) / 2;
      const t = under(zoneT, mid);
      const sp = under(splits, mid);
      const run = under(runs, mid);
      const push = pushes.find((p) => p.startMs <= mid && mid < p.endMs);
      if (sp) {
        out.push({ inMs, outMs, zoom: opts.split.zoom, anchor: [0.5, Number(opts.split.eyeY.toFixed(3))], why: "split" });
      } else if (run) {
        /* The host in the circle: the compositor crops the circle from the base framing; nothing to push. */
        out.push({ inMs, outMs, zoom: FRAMING.base, anchor: [0.5, FRAMING.eyeY], why: "run" });
      } else if (t) {
        out.push({ inMs, outMs, zoom: opts.zoneT.zoom, anchor: [0.5, opts.zoneT.eyeY], why: "zone-T" });
      } else if (push) {
        const snapEnd = push.startMs + FRAMING.snap.frames * MS_PER_FRAME;
        out.push({ inMs, outMs, zoom: FRAMING.base, anchor: [0.5, FRAMING.eyeY], push: { fromMs: push.startMs, toMs: round(Math.min(snapEnd, outMs)), to: Math.min(push.to, FRAMING.maxZoom) }, why: "punchline" });
      } else if (zoom === FRAMING.base && outMs - inMs > FRAMING.slowPush.min) {
        out.push({ inMs, outMs, zoom, anchor: [0.5, FRAMING.eyeY], push: { fromMs: inMs, toMs: outMs, to: FRAMING.slowPush.to }, why: "slow push" });
      } else {
        out.push({ inMs, outMs, zoom, anchor: [0.5, FRAMING.eyeY], why: zoom === FRAMING.base ? "base" : "alternate" });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ lint */

export type Violation = { rule: string; atMs: number; detailZh: string; ids?: string[] };

const ZONE_FOR: Record<string, GraphicSpecV2["zone"][]> = {
  hook: ["T"],
  counter: ["T"],
  compare: ["T"],
  list: ["T"],
  entity: ["T"],
  headline: ["T"],
  term: ["T"],
  diagram: ["T"],
  chip: ["corner"],
  stinger: ["full"],
  "end-card": ["full"],
  "lower-third": ["lower"],
  header: ["corner"],
  watermark: ["lower"],
  footnote: ["lower"],
};

const FURNITURE = new Set(["header", "watermark", "footnote"]);

/**
 * The gates a plan must pass before anything is written. Shared with W7's
 * grader, which runs the same checks on the rendered file's plan.
 */
export function lintPlan(plan: LayoutPlan, ctx: { totalMs: number; face?: FaceTrack | null; hookLines?: string[]; captions?: { startMs: number; endMs: number; text: string }[] } = { totalMs: plan.stats.totalMs }): Violation[] {
  const v: Violation[] = [];
  const layers = [
    ...plan.graphics.filter((g) => !FURNITURE.has(g.kind)).map((g) => ({ id: g.id, startMs: g.startMs, endMs: g.endMs, kind: g.kind })),
    ...plan.cutaways.filter((c) => !c.runId).map((c) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, kind: `cutaway:${c.layout}` })),
    ...plan.runs.map((r) => ({ id: r.id, startMs: r.startMs, endMs: r.endMs, kind: "run" })),
  ].sort((a, b) => a.startMs - b.startMs);

  /* one layer at a time */
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const a = layers[i];
      const b = layers[j];
      if (b.startMs >= a.endMs) break;
      v.push({ rule: "overlap", atMs: b.startMs, detailZh: `${a.kind} 与 ${b.kind} 同时在画面上`, ids: [a.id, b.id] });
    }
  }

  /* zones by kind, and inside the frame */
  for (const g of plan.graphics) {
    const allowed = ZONE_FOR[g.kind];
    if (allowed && !allowed.includes(g.zone)) v.push({ rule: "zone", atMs: g.startMs, detailZh: `${g.kind} 放在了 ${g.zone} 区，应为 ${allowed.join("/")}`, ids: [g.id] });
    if (g.startMs < 0 || g.endMs > ctx.totalMs + 1 || g.endMs <= g.startMs) v.push({ rule: "range", atMs: g.startMs, detailZh: `${g.kind} 的时间超出成片`, ids: [g.id] });
  }

  /* hook */
  const hook = plan.graphics.find((g) => g.kind === "hook");
  if (!hook) v.push({ rule: "hook", atMs: 0, detailZh: "没有开场论断块" });
  else {
    if (hook.startMs !== 0 || hook.endMs < TIMING.hookMs) v.push({ rule: "hook", atMs: 0, detailZh: `开场论断块应从 0 s 停到 ≥ 2.5 s，实际 ${hook.startMs}–${hook.endMs} ms`, ids: [hook.id] });
    if (ctx.hookLines && JSON.stringify(hook.props.lines) !== JSON.stringify(ctx.hookLines)) v.push({ rule: "hook", atMs: 0, detailZh: "开场论断块的文字与简报不一致", ids: [hook.id] });
    const lines = (hook.props.lines as string[]) ?? [];
    if (lines.length > 3 || lines.some((l) => l.replace(/[【】]/g, "").length > 8)) v.push({ rule: "hook", atMs: 0, detailZh: "开场论断块超过 3 行或某行超过 8 字", ids: [hook.id] });
  }

  /* cadence */
  const gap = TIMING.minChangeGapMs;
  const ch = plan.changes;
  const stingerStarts = new Set([...plan.graphics.filter((g) => g.kind === "stinger").flatMap((g) => [g.startMs, g.endMs]), ...(plan.steps ?? [])]);
  const cutPoints = new Set(plan.cutZooms.map((s) => s.inMs));
  const layerPoints = new Set([...plan.graphics.flatMap((g) => [g.startMs, g.endMs]), ...plan.cutaways.flatMap((c) => [c.startMs, c.endMs]), ...plan.pushes.map((p) => p.startMs)]);
  for (let i = 1; i < ch.length; i++) {
    const d = ch[i] - ch[i - 1];
    if (d > TIMING.sameMomentMs && d < gap && !stingerStarts.has(ch[i]) && !stingerStarts.has(ch[i - 1])) {
      /* Two jump cuts this close are the cut's doing, not the layout's; said so, for the cutter. */
      const cutOnly = [ch[i], ch[i - 1]].every((m) => cutPoints.has(m) && !layerPoints.has(m));
      v.push({ rule: "cadence", atMs: ch[i], detailZh: `两次画面变化只隔 ${d} ms（< 800 ms）${cutOnly ? "，两个都是剪辑点" : ""}` });
    }
  }
  for (const g of plan.stats.gapsOver5s) v.push({ rule: "cadence", atMs: g.fromMs, detailZh: `${((g.toMs - g.fromMs) / 1000).toFixed(1)} s 没有任何画面变化（> 5 s）` });
  if (plan.stats.meanChangeMs < TIMING.meanChangeMs[0] || plan.stats.meanChangeMs > TIMING.meanChangeMs[1]) v.push({ rule: "cadence", atMs: 0, detailZh: `平均 ${(plan.stats.meanChangeMs / 1000).toFixed(2)} s 一次变化，应在 2–4 s` });

  /* coverage */
  if (plan.stats.coverage < TIMING.coverage[0] || plan.stats.coverage > TIMING.coverage[1]) v.push({ rule: "coverage", atMs: 0, detailZh: `空镜占比 ${(plan.stats.coverage * 100).toFixed(1)}%，应在 30–40%` });
  if (plan.stats.hostVisible < TIMING.hostVisible) v.push({ rule: "coverage", atMs: 0, detailZh: `主播可见 ${(plan.stats.hostVisible * 100).toFixed(1)}%，应 ≥ 55%` });
  if (plan.stats.runShare > TIMING.runShare) v.push({ rule: "coverage", atMs: 0, detailZh: `圆框布局占 ${(plan.stats.runShare * 100).toFixed(1)}%，应 ≤ 30%` });

  /* cutaway lengths and starts (a still may run up to half a second past its form to end on the cut it hides) */
  for (const c of plan.cutaways) {
    const len = c.endMs - c.startMs;
    const max = (c.still ? TIMING.cutaway.still[1] : TIMING.cutaway.long) + SNAP_OVERRUN_MS;
    const min = c.still ? TIMING.cutaway.still[0] : c.runId ? TIMING.run.clipEvery[0] : TIMING.cutaway.min;
    if (len < min - 1 || len > max + 1) v.push({ rule: "cutaway", atMs: c.startMs, detailZh: `空镜 ${(len / 1000).toFixed(2)} s，应在 ${min / 1000}–${max / 1000} s`, ids: [c.id] });
  }
  const firstCut = plan.cutaways[0];
  if (firstCut && firstCut.startMs > TIMING.firstCutawayBy + 3000) v.push({ rule: "cutaway", atMs: firstCut.startMs, detailZh: `第一个空镜在 ${(firstCut.startMs / 1000).toFixed(1)} s，应在 3–5 s 内（钩子之后）` });

  /* framing */
  for (const seg of plan.cutZooms) {
    if (seg.zoom > FRAMING.maxZoom || (seg.push && seg.push.to > FRAMING.maxZoom)) v.push({ rule: "framing", atMs: seg.inMs, detailZh: "推近超过 1.25" });
  }
  let lastSnap = -Infinity;
  for (const p of plan.pushes) {
    if (p.startMs - lastSnap < FRAMING.snap.every) v.push({ rule: "framing", atMs: p.startMs, detailZh: "15 秒内出现两次金句推近" });
    lastSnap = p.startMs;
  }
  /* 1.00 under a Zone-T graphic */
  for (const g of plan.graphics.filter((x) => x.zone === "T")) {
    for (const seg of plan.cutZooms) {
      if (seg.outMs <= g.startMs || seg.inMs >= g.endMs) continue;
      if (seg.zoom !== FRAMING.base) v.push({ rule: "framing", atMs: seg.inMs, detailZh: `${g.kind} 在画面上时主播不是 1.00 倍`, ids: [g.id] });
    }
  }

  /* the face: Zone-T text must not sit on it, under the framing that is on at the time */
  if (ctx.face) {
    for (const g of plan.graphics.filter((x) => x.zone === "T")) {
      /* Every framing segment the graphic is up over, not just the one at its first frame. */
      for (const seg of plan.cutZooms.filter((s) => s.outMs > g.startMs + 40 && s.inMs < g.endMs - 40)) {
        const box = faceBoxUnder(ctx.face, seg.zoom, seg.anchor[1]);
        if (!box) continue;
        const overlaps = box.y0 < ZONES.T.y1 && box.y1 > ZONES.T.y0 && box.x0 < ZONES.T.x1 && box.x1 > ZONES.T.x0;
        if (overlaps) {
          v.push({ rule: "face", atMs: Math.max(g.startMs, seg.inMs), detailZh: `${g.kind} 的 T 区与人脸框重叠（脸框 y ${Math.round(box.y0)}–${Math.round(box.y1)}，取景 ${seg.why}）`, ids: [g.id] });
          break;
        }
      }
    }
    /* the caption's top edge ≥ chin + 40 under every framing */
    const captionTop = plan.renderHints.captionZhY - ZONES.caption.zhSize / 2;
    for (const seg of plan.cutZooms) {
      const box = faceBoxUnder(ctx.face, seg.push?.to ?? seg.zoom, seg.anchor[1]);
      if (box && box.chin + ZONES.caption.faceGap > captionTop + 1) v.push({ rule: "caption", atMs: seg.inMs, detailZh: `字幕上沿 ${captionTop} 低于下巴+40（${Math.round(box.chin + 40)}），取景 ${seg.why} ${seg.zoom}` });
    }
  }

  /* stat check: the digits of every counter/compare in the captions within ±1.5 s */
  if (ctx.captions) {
    for (const g of plan.graphics.filter((x) => x.kind === "counter" || x.kind === "compare")) {
      const values = g.kind === "counter" ? [String(g.props.text)] : ((g.props.bars as { display: string }[]) ?? []).map((b) => b.display);
      const near = ctx.captions.filter((c) => c.endMs >= g.startMs - 1500 && c.startMs <= g.endMs + 1500).map((c) => c.text).join("");
      for (const value of values) {
        if (!saidNear(value, near)) v.push({ rule: "stat", atMs: g.startMs, detailZh: `数字「${value}」在 ±1.5 s 的字幕里没有说到`, ids: [g.id] });
      }
    }
  }

  /* every used asset carries a credit */
  for (const c of plan.cutaways) if (!c.credit) v.push({ rule: "credit", atMs: c.startMs, detailZh: "空镜没有来源信息", ids: [c.id] });
  const end = plan.graphics.find((g) => g.kind === "end-card");
  if (plan.cutaways.length && end && !String(end.props.creditsLine ?? "").trim()) v.push({ rule: "credit", atMs: end.startMs, detailZh: "片尾卡没有素材来源行", ids: [end.id] });

  return v.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Caption text with the noise out of the way of a figure match: commas and
 * spaces gone, and a Han digit that stands in for an Arabic one (六到九成,
 * 三家) written as the digit when it sits next to a unit, a range word or
 * another digit, so 「便宜六到九成」 and 「便宜6到9成」 read the same.
 */
export function plainFigures(text: string): string {
  const han: Record<string, string> = { 零: "0", 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
  return text
    .replace(/[,，\s]/g, "")
    .replace(/([零一二两三四五六七八九])(?=[到成倍个条页次万亿千百家轮%％]|[零一二两三四五六七八九\d])/g, (m, d: string) => han[d] ?? m)
    .replace(/(?<=[到比\d])([零一二两三四五六七八九])/g, (m, d: string) => han[d] ?? m);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `digits` (63.5, 3500, 1.51) stands as a whole figure in the text: not a slice of a bigger one (6 inside 63.5). */
export function hasFigure(digits: string, plain: string): boolean {
  return new RegExp(`(?<![\\d.])${escapeRe(digits)}(?![\\d.])`).test(plain);
}

/**
 * Whether a figure was said in a stretch of caption text.
 *
 * A value is one figure (154, 1.51亿, 3500多, 近30万, 63.5%) or a range or
 * a pair (6–9, 63.5 vs 35.5, 几千万–几亿): each part must be there. A part
 * with digits must appear as a whole figure — `6` is not said when the
 * text has `63.5` — and a part in Han numerals (十几, 几千万) as its
 * literal string with punctuation stripped.
 */
export function saidNear(value: string, text: string): boolean {
  const plain = plainFigures(text);
  const parts = value
    .replace(/[,，\s]/g, "")
    .split(/[–\-—~～]|到|vs|比|至|和/i)
    .map((p) => p.replace(/[%％]/g, ""))
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((part) => {
    const digits = part.match(/\d+(?:\.\d+)?/g) ?? [];
    if (digits.length) return digits.every((d) => hasFigure(d, plain));
    /* Han numerals: the literal, or the literal without its unit (几千万美金 is said as 几千万甚至是几亿美金). */
    const bare = part.replace(/(美金|美元|元|次|条|个|页|倍|成|人|家|轮|篇|款|种)$/, "");
    return plain.includes(part) || (bare.length > 0 && plain.includes(bare));
  });
}

const KIND_ZH: Record<string, string> = {
  hook: "开场论断",
  counter: "计数",
  compare: "对比条",
  list: "列表",
  entity: "机构卡",
  chip: "标识",
  headline: "新闻卡",
  term: "术语卡",
  diagram: "示意图",
  stinger: "章节转场",
  "lower-third": "姓名条",
  "end-card": "片尾卡",
  cutaway: "空镜",
};

export function kindZh(kind: string): string {
  return KIND_ZH[kind] ?? kind;
}

/* ---------------------------------------------- the timeline clock */

/**
 * Sentences on the finished timeline.
 *
 * The cut planner works in source time; the layout in timeline time. A
 * kept piece `[inMs, outMs)` of the source lands at `offset` on the
 * timeline, so a word at source `t` inside it moves to `t − inMs +
 * offset`. Words in no kept piece were cut and are dropped; a sentence
 * left with no words was cut whole and is left out, and one cut in the
 * middle keeps its id with the words that survived. Ids never change, so
 * the outline, the cut report and the gold labels still name the same
 * line.
 */
export function sentencesOnTimeline(sentences: readonly Sentence[], pieces: readonly { clipId?: string; inMs: number; outMs: number }[]): { sentences: Sentence[]; pieces: { inMs: number; outMs: number }[]; totalMs: number } {
  let at = 0;
  const placed = pieces.map((p) => {
    const row = { inMs: at, outMs: at + (p.outMs - p.inMs), srcIn: p.inMs, srcOut: p.outMs };
    at = row.outMs;
    return row;
  });
  const map = (ms: number): number | null => {
    for (const p of placed) if (ms >= p.srcIn && ms < p.srcOut) return ms - p.srcIn + p.inMs;
    return null;
  };
  const out: Sentence[] = [];
  for (const s of sentences) {
    const words: Word[] = [];
    for (const w of s.words) {
      const a = map(w.startMs);
      const b = map(Math.max(w.startMs, w.endMs - 1));
      if (a === null || b === null) continue;
      words.push({ text: w.text, startMs: round(a), endMs: round(Math.max(a, b + 1)) });
    }
    if (!words.length) continue;
    out.push({ ...s, words, startMs: words[0].startMs, endMs: words[words.length - 1].endMs, text: s.words.length === words.length ? s.text : words.map((w) => w.text).join("") });
  }
  return { sentences: out, pieces: placed.map((p) => ({ inMs: p.inMs, outMs: p.outMs })), totalMs: at };
}
