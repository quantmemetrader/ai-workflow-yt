import type { FaceTrack, GraphicSpecV2, Word } from "@/lib/video/v2/types";
import type { CutawaySpec, FramingSegment, LayoutPlan } from "@/lib/video/layout";
import { baseScale, FRAME } from "@/lib/video/layout";
import type { RenderCut, RenderCutaway } from "@/lib/video/render";

/**
 * Director v2's hand-over from the layout (W6) to the motion renderer (W4)
 * and the compositor (W5).
 *
 * The three modules were built side by side against the frozen contracts
 * and each read the loose parts of them its own way; this file is where the
 * readings meet, so neither side has to learn the other's dialect:
 *
 *   - **Graphic props.** The layout writes what it decided in its own terms
 *     (a counter's `landMs` on the timeline clock, a logo as the sourced
 *     asset record, list items with the time each is said). The templates
 *     read times relative to the graphic's first frame, pictures as a path,
 *     list items as a head and a line. `toMotionSpecs` translates.
 *   - **Framing.** The layout frames the host on the *timeline*: a zoom
 *     relative to the scale that just fills the frame with the eye line
 *     where it wants it, and that eye line as a share of the output. The
 *     compositor frames each *cut* on the *source* clock: an absolute crop
 *     zoom, the face point it anchors on, and (now) where that point lands.
 *     `toRenderCuts` splits every cut piece at the layout's framing changes
 *     and converts each part; the parts after the first are seams, whose
 *     sound runs through without the cut fades.
 *   - **Cutaways.** Sourcing hands back the chosen window already cut to its
 *     own file, so the compositor reads it from 0; the split host's zoom and
 *     eye line come over in the compositor's units.
 *
 * Pure: no files are read and nothing is written.
 */

/* ------------------------------------------------------------ graphics */

/** Furniture is one merged still under everything, not a motion clip. */
export const FURNITURE = new Set(["header", "watermark", "footnote"]);

type AssetRef = { asset?: { localPath?: string | null } | null; credit?: string | null } | null | undefined;

const pathOf = (ref: unknown): string | null => {
  const r = ref as AssetRef;
  const p = r?.asset?.localPath;
  return typeof p === "string" && p ? p : null;
};

const rel = (ms: unknown, startMs: number): number | null => (typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, Math.round(ms - startMs)) : null);

/** 「2月 DeepSeek·月之暗面·MiniMax」 → head 2月, line the rest; a line with no short head keeps it all. */
export function splitListItem(text: string): { head: string; text: string } {
  const t = text.trim();
  const m = /^(\S{1,6})\s+(.+)$/.exec(t);
  if (m && /[0-9０-９]|月|年|日|号|第/.test(m[1])) return { head: m[1], text: m[2] };
  return { head: "", text: t };
}

/**
 * One layout graphic in the props the `Clip` composition reads. Times the
 * layout gives on the timeline clock become ms from the graphic's start;
 * pictures become the local file the renderer inlines; the rest passes
 * through untouched (the zone, the enter style, anything a template may
 * learn to read later).
 */
export function toMotionProps(g: GraphicSpecV2): Record<string, unknown> {
  const p: Record<string, unknown> = { ...g.props };
  switch (g.kind) {
    case "hook": {
      const lines = Array.isArray(p.lines) ? (p.lines as unknown[]).map(String) : String(p.text ?? "").split(/\s*\|\s*/);
      p.text = lines.join(" | ");
      const land = Array.isArray(p.landMs) ? (p.landMs as unknown[]).map((x) => rel(x, g.startMs)).filter((x): x is number => x !== null) : [];
      if (land.length) p.stepsMs = land;
      break;
    }
    case "counter": {
      p.value = String(p.text ?? p.value ?? "");
      if (p.sub != null && p.labelZh == null) p.labelZh = p.sub;
      const land = rel(p.landMs, g.startMs);
      if (land !== null) p.landMs = land;
      if (typeof p.countUpMs === "number") p.countMs = Math.max(200, Math.round(p.countUpMs));
      break;
    }
    case "compare": {
      const bars = Array.isArray(p.bars) ? (p.bars as Record<string, unknown>[]) : [];
      p.bars = bars.map((b) => ({ label: String(b.label ?? b.labelZh ?? ""), value: Number(b.value ?? 0), display: String(b.display ?? b.value ?? ""), negative: Boolean(b.negative) }));
      break;
    }
    case "list": {
      const items = Array.isArray(p.items) ? (p.items as { text?: unknown; atMs?: unknown }[]) : [];
      p.items = items.map((it) => splitListItem(String(it.text ?? "")));
      const steps = items.map((it) => rel(it.atMs, g.startMs));
      if (steps.every((x) => x !== null)) p.stepsMs = steps;
      break;
    }
    case "diagram": {
      const steps = Array.isArray(p.steps) ? (p.steps as unknown[]) : [];
      p.steps = steps.map((s) => (typeof s === "string" ? { label: s } : s));
      break;
    }
    case "entity":
    case "chip": {
      const own = pathOf(p.logo);
      const group = Array.isArray(p.group) ? (p.group as { logo?: unknown }[]) : [];
      const fromGroup = group.map((m) => pathOf(m.logo)).find(Boolean) ?? null;
      const logo = own ?? fromGroup;
      if (logo) p.logo = logo;
      else delete p.logo;
      delete p.group;
      break;
    }
    case "stinger": {
      /* The template draws the index itself (「05」 in the accent); the layout's text carries it too. */
      const title = typeof p.titleZh === "string" && p.titleZh ? p.titleZh : String(p.text ?? "").replace(/^\s*\d{1,2}\s+/, "");
      p.text = title;
      break;
    }
    case "headline": {
      const img = pathOf(p.image);
      const credit = (p.image as AssetRef)?.credit ?? null;
      if (img) {
        p.image = img;
        if (credit) p.imageCredit = credit;
      } else delete p.image;
      break;
    }
    default:
      break;
  }
  return p;
}

/** The layout's graphics as the motion renderer's specs: furniture left out, props translated. */
export function toMotionSpecs(graphics: readonly GraphicSpecV2[]): GraphicSpecV2[] {
  return graphics.filter((g) => !FURNITURE.has(g.kind) && g.endMs > g.startMs).map((g) => ({ ...g, props: toMotionProps(g) }));
}

/* -------------------------------------------------------------- framing */

/** Where the face is in the source for a stretch of it: the point a cut anchors on. */
export type FaceAt = (inMs: number, outMs: number) => { anchor: [number, number]; faceHeight: number };

/** A part shorter than this is folded into its neighbour: a frame or two of a new framing reads as a glitch. */
const MIN_PART_MS = 120;

/**
 * The cut pieces (source clock, in timeline order) split at every framing
 * change the layout made (timeline clock), each part converted to the
 * compositor's framing. `face` is the take's median track (what the layout
 * planned on); `faceAt` gives the anchor for each part's own stretch, so a
 * presenter who shifts in her chair stays centred.
 */
export function toRenderCuts(
  pieces: readonly { clipId: string; inMs: number; outMs: number }[],
  cutZooms: readonly FramingSegment[],
  opts: { file: string; face: FaceTrack | null; faceAt: FaceAt },
): RenderCut[] {
  const out: RenderCut[] = [];
  let at = 0;
  const segs = [...cutZooms].sort((a, b) => a.inMs - b.inMs);
  for (const piece of pieces) {
    const tIn = at;
    const tOut = at + (piece.outMs - piece.inMs);
    at = tOut;
    /* The layout's parts inside this piece, clipped to it. */
    const parts: { a: number; b: number; seg: FramingSegment | null }[] = [];
    for (const s of segs) {
      const a = Math.max(tIn, s.inMs);
      const b = Math.min(tOut, s.outMs);
      if (b - a > 0) parts.push({ a, b, seg: s });
    }
    if (!parts.length) parts.push({ a: tIn, b: tOut, seg: null });
    /* Close any crack the layout left, and fold slivers into the part before (or after, for the first). */
    parts[0].a = tIn;
    parts[parts.length - 1].b = tOut;
    for (let i = 1; i < parts.length; i++) parts[i].a = parts[i - 1].b;
    const merged: typeof parts = [];
    for (const p of parts) {
      const prev = merged[merged.length - 1];
      if (prev && p.b - p.a < MIN_PART_MS) prev.b = p.b;
      else if (prev && prev.b - prev.a < MIN_PART_MS) merged[merged.length - 1] = { ...p, a: prev.a };
      else merged.push({ ...p });
    }
    merged.forEach((p, i) => {
      const inMs = piece.inMs + (p.a - tIn);
      const outMs = piece.inMs + (p.b - tIn);
      const seg = p.seg;
      const eyeOut = seg ? seg.anchor[1] : 0.33;
      const scale = baseScale(opts.face, eyeOut);
      const zoom = round3(scale * (seg?.zoom ?? 1));
      const { anchor, faceHeight } = opts.faceAt(inMs, outMs);
      const cut: RenderCut = { clipId: piece.clipId, file: opts.file, inMs, outMs, zoom, anchor, faceHeight, eyeOut: round3(eyeOut) };
      if (i > 0) cut.seam = true;
      if (seg?.push) {
        /* The layout's push window is its ramp (5 frames for a snap, the whole part for a slow push); it holds to the part's end. */
        const from = Math.max(inMs, piece.inMs + (seg.push.fromMs - tIn));
        const rampMs = Math.max(33, seg.push.toMs - seg.push.fromMs);
        if (outMs - from > 200) cut.push = { fromMs: Math.round(from), toMs: outMs, to: round3(scale * seg.push.to), rampMs };
      }
      out.push(cut);
    });
  }
  return out;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------- cutaways */

/**
 * The layout's cutaways for the compositor. A sourced clip is usually the
 * chosen window already (sourcing cut it to its own file, and the layout
 * then reads it from 0); a cutaway longer than its clip is shortened to the clip rather than
 * freezing on the last frame. A cutaway whose file is not on this box is
 * left out, with the reason.
 */
export function toRenderCutaways(
  cutaways: readonly CutawaySpec[],
  hints: LayoutPlan["renderHints"],
  face: FaceTrack | null,
): { cutaways: RenderCutaway[]; skipped: { id: string; reason: string }[] } {
  const out: RenderCutaway[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const splitEye = hints.split.hostEyeY / FRAME.height;
  const splitZoom = round3(baseScale(face, splitEye) * hints.split.hostZoom);
  for (const c of cutaways) {
    const file = c.asset.localPath;
    if (!file) {
      skipped.push({ id: c.id, reason: "no local file" });
      continue;
    }
    let endMs = c.endMs;
    if (!c.still && c.asset.durationMs && c.asset.durationMs > 0) endMs = Math.min(endMs, c.startMs + Math.max(400, c.asset.durationMs - c.sourceInMs - 80));
    if (endMs - c.startMs < 400) {
      skipped.push({ id: c.id, reason: "clip too short" });
      continue;
    }
    out.push({
      file,
      startMs: c.startMs,
      endMs,
      sourceInMs: c.sourceInMs,
      cropX: c.cropX,
      still: c.still,
      layout: c.layout,
      ...(c.runId ? { runId: c.runId } : {}),
      ...(c.layout === "split" ? { hostZoom: splitZoom, hostEyeY: round3(splitEye) } : {}),
    });
  }
  return { cutaways: out, skipped };
}

/* ---------------------------------------------------------------- words */

/** Source-clock words onto the timeline of the cut; a word the cut removed (even in part) is dropped. */
export function wordsOnTimeline(words: readonly Word[], pieces: readonly { inMs: number; outMs: number }[]): Word[] {
  let at = 0;
  const placed = pieces.map((p) => {
    const row = { t: at, srcIn: p.inMs, srcOut: p.outMs };
    at += p.outMs - p.inMs;
    return row;
  });
  const map = (ms: number): number | null => {
    for (const p of placed) if (ms >= p.srcIn && ms < p.srcOut) return ms - p.srcIn + p.t;
    return null;
  };
  const out: Word[] = [];
  for (const w of words) {
    const a = map(w.startMs);
    const b = map(Math.max(w.startMs, w.endMs - 1));
    if (a === null || b === null || b < a) continue;
    out.push({ text: w.text, startMs: Math.round(a), endMs: Math.round(b + 1) });
  }
  return out;
}
