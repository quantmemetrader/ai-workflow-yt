import type { audioTracks, captions, timelineItems, videoClips, videoGraphics } from "@/lib/db/schema";
import { packTracks, type DraftText, type DraftTextStyle, type DraftTrack, type DraftVideoSegment, type Placement } from "@/lib/video/capcut/draft";
import { mergeRanges } from "@/lib/video/ranges";

/**
 * The editor's rows, laid out as a 剪映 draft: which file each segment uses
 * and where everything sits. Pure, so the mapping can be read and tested
 * without footage; `export.ts` does the downloading and writing.
 *
 * What goes over, and as what:
 *
 *   timeline clips   main video track, in order, each with its trim
 *   title cards      a black still on the main track, its words on a text track
 *   transitions      剪映's own 叠化 / 闪黑 on the cut they lead into
 *   muted cuts       volume 0, so the footage under a narration stays silent
 *   captions         one text track per language, the chosen one at the bottom
 *   graphics         their words on text tracks, a picture on an overlay track
 *   cutaways (broll) an overlay video track, silent, framed as placed
 *   voice-over/music their own audio tracks at their gain
 *
 * What does not, and is said in the readme: the Remotion animation of a
 * graphic (剪映 gets the words, not the motion), punch-ins, music ducking,
 * and the burned caption look (剪映 gets plain white subtitles to restyle).
 */

type ItemRow = typeof timelineItems.$inferSelect;
type ClipRow = typeof videoClips.$inferSelect;
type CaptionRow = typeof captions.$inferSelect;
type GraphicRow = typeof videoGraphics.$inferSelect;
type TrackRow = typeof audioTracks.$inferSelect;

export type ProbedMedia = { hasVideo: boolean; hasAudio: boolean; width: number; height: number; durationMs: number };

export type PlanMedia = {
  key: string;
  /** Inside the draft folder. ASCII on purpose: it survives every unzip tool. */
  rel: string;
  /** What 剪映's media panel shows. */
  name: string;
  type: "video" | "audio";
  kind: "video" | "photo" | "audio";
  durationMs: number;
  width: number;
  height: number;
  make: { kind: "copy"; fileId: string } | { kind: "window"; fileId: string; startMs: number; lengthMs: number; hasAudio: boolean } | { kind: "black" };
};

/** A main-track cut, kept for the FCPXML beside the draft. */
export type PlanCut = { media: string; startMs: number; lengthMs: number; sourceInMs: number; title?: string };

export type Plan = {
  media: PlanMedia[];
  tracks: DraftTrack[];
  cuts: PlanCut[];
  overlays: PlanCut[];
  audio: PlanCut[];
  durationMs: number;
  notes: string[];
};

export type PlanInput = {
  title: string;
  width: number;
  height: number;
  accent: string;
  captionLanguage: string;
  items: ItemRow[];
  clips: ClipRow[];
  captions: CaptionRow[];
  graphics: GraphicRow[];
  tracks: TrackRow[];
  fileNames: Map<string, string>;
  fileMimes: Map<string, string | null>;
  probed: Map<string, ProbedMedia>;
  handleMs: number;
  /** Where the director found the face, and in which take: only that take is framed on it. */
  face: { fileId: string; cx: number; cy: number } | null;
};

/**
 * Below this a source is copied whole; above it, and when the cut uses well
 * under the whole take, only the used stretches (with handles) go in the zip.
 * A 30-second reel out of a six-minute, 600 MB interview is the normal case
 * here, and shipping all of it would make the zip twenty times the edit.
 */
const WINDOW_MIN_SOURCE_MS = 60_000;
const WINDOW_MAX_SHARE = 0.6;

export function planDraft(input: PlanInput): Plan {
  const notes: string[] = [];
  const clipById = new Map(input.clips.map((c) => [c.id, c]));
  const W = input.width;
  const H = input.height;

  /* ---- which stretches of which file are used --------------------------- */
  type Use = { fileId: string; inMs: number; outMs: number };
  const uses: Use[] = [];
  for (const i of input.items) {
    if (i.kind !== "clip" || !i.clipId) continue;
    const c = clipById.get(i.clipId);
    if (!c || !input.probed.has(c.fileId)) continue;
    const out = i.outMs ?? c.durationMs ?? input.probed.get(c.fileId)!.durationMs;
    uses.push({ fileId: c.fileId, inMs: i.inMs, outMs: out });
  }
  const brolls = input.graphics.filter((g) => g.kind === "broll" && g.endMs > g.startMs);
  for (const g of brolls) {
    const c = clipById.get(String(g.options?.clipId ?? ""));
    if (!c || !input.probed.has(c.fileId)) continue;
    const sourceIn = Math.max(0, Number(g.options?.sourceInMs ?? 0) || 0);
    uses.push({ fileId: c.fileId, inMs: sourceIn, outMs: sourceIn + (g.endMs - g.startMs) });
  }

  const media: PlanMedia[] = [];
  /** Per file: its windows (or one whole-file entry), to find the one a use falls in. */
  const windowsOf = new Map<string, { key: string; startMs: number; endMs: number }[]>();
  const videoFiles = [...new Set(uses.map((u) => u.fileId))];
  videoFiles.forEach((fileId, n) => {
    const p = input.probed.get(fileId)!;
    const name = input.fileNames.get(fileId) ?? `clip ${n + 1}`;
    // Stretches closer than two handles apart become one file: two files for one sentence with a breath cut out is clutter.
    const ranges = mergeRanges(
      uses.filter((u) => u.fileId === fileId).map((u) => ({ startMs: Math.max(0, u.inMs - input.handleMs), endMs: Math.min(p.durationMs, u.outMs + input.handleMs) })),
      input.handleMs,
    ).map((r) => ({ start: r.startMs, end: r.endMs }));
    const used = ranges.reduce((s, r) => s + (r.end - r.start), 0);
    const windowed = p.durationMs > WINDOW_MIN_SOURCE_MS && used < p.durationMs * WINDOW_MAX_SHARE;
    if (!windowed) {
      const key = `${fileId}#all`;
      media.push({ key, rel: `materials/clip${pad(n + 1)}${extOf(name, ".mp4")}`, name, type: "video", kind: "video", durationMs: p.durationMs, width: p.width, height: p.height, make: { kind: "copy", fileId } });
      windowsOf.set(fileId, [{ key, startMs: 0, endMs: p.durationMs }]);
      return;
    }
    const list: { key: string; startMs: number; endMs: number }[] = [];
    ranges.forEach((r, k) => {
      const key = `${fileId}#${k}`;
      media.push({
        key,
        rel: `materials/clip${pad(n + 1)}_${pad(k + 1)}.mp4`,
        name: `${stem(name)} ${clock(r.start)}–${clock(r.end)}.mp4`,
        type: "video",
        kind: "video",
        durationMs: r.end - r.start,
        width: p.width,
        height: p.height,
        make: { kind: "window", fileId, startMs: r.start, lengthMs: r.end - r.start, hasAudio: p.hasAudio },
      });
      list.push({ key, startMs: r.start, endMs: r.end });
    });
    windowsOf.set(fileId, list);
    notes.push(`「${name}」只带了用到的 ${list.length} 段（各留 ${Math.round(input.handleMs / 1000)} 秒余量），原片仍在腾亚的文件库里。`);
  });

  /** The material and the in point inside it, for a use of a file. */
  const locate = (fileId: string, inMs: number, outMs: number) => {
    const w = windowsOf.get(fileId)?.find((x) => inMs >= x.startMs && outMs <= x.endMs + 1);
    return w ? { key: w.key, sourceInMs: inMs - w.startMs } : null;
  };

  /* ---- main track -------------------------------------------------------- */
  const main: DraftVideoSegment[] = [];
  const cuts: PlanCut[] = [];
  const titleTexts: DraftText[] = [];
  let at = 0;
  let black: string | null = null;
  for (const i of input.items) {
    const transitionIn = main.length && i.transition !== "cut" ? { kind: i.transition === "dip" ? ("dip" as const) : ("dissolve" as const), ms: Math.max(80, Math.min(4000, i.transitionMs)) } : undefined;
    if (i.kind === "title") {
      const hold = Math.max(200, i.holdMs);
      if (!black) {
        black = "black";
        media.push({ key: black, rel: "materials/black.png", name: "黑场.png", type: "video", kind: "photo", durationMs: 10_800_000, width: W, height: H, make: { kind: "black" } });
      }
      main.push({ material: black, startMs: at, lengthMs: hold, sourceInMs: 0, volume: 1, transitionIn });
      cuts.push({ media: black, startMs: at, lengthMs: hold, sourceInMs: 0, title: i.text ?? "" });
      if ((i.text ?? "").trim()) titleTexts.push({ startMs: at, endMs: at + hold, text: (i.text ?? "").trim(), style: { size: 12, bold: true, align: 1, stroke: false, wrap: true }, x: 0, y: 0 });
      at += hold;
      continue;
    }
    const c = i.clipId ? clipById.get(i.clipId) : undefined;
    if (!c || !input.probed.has(c.fileId)) {
      notes.push(`时间线第 ${input.items.indexOf(i) + 1} 段的素材已被删除或无法读取，没有导出。`);
      continue;
    }
    const p = input.probed.get(c.fileId)!;
    const out = Math.min(i.outMs ?? c.durationMs ?? p.durationMs, p.durationMs);
    const length = out - i.inMs;
    if (length < 40) continue;
    const loc = locate(c.fileId, i.inMs, out);
    if (!loc) continue;
    const mute = Boolean((i.options as { mute?: unknown } | null)?.mute);
    main.push({ material: loc.key, startMs: at, lengthMs: length, sourceInMs: loc.sourceInMs, volume: mute ? 0 : 1, transitionIn, place: fillPlace(p, W, H, input.face?.fileId === c.fileId ? input.face : null) });
    cuts.push({ media: loc.key, startMs: at, lengthMs: length, sourceInMs: loc.sourceInMs });
    at += length;
  }
  if (!main.length) throw new Error("时间线上所有片段的素材都已被删除，无法导出。");
  if (main.some((s) => s.transitionIn)) {
    notes.push("叠化/闪黑转场已放在对应的剪辑点上；剪映里转场会让前后两段重叠，总时长可能比腾亚里的成片略长或略短，字幕请以剪映里的画面为准微调。");
  }
  const durationMs = at;

  /* ---- overlays: cutaways and pictures ----------------------------------- */
  type Over = DraftVideoSegment & { endMs: number };
  const overs: Over[] = [];
  const overlays: PlanCut[] = [];
  for (const g of brolls) {
    const c = clipById.get(String(g.options?.clipId ?? ""));
    if (!c || !input.probed.has(c.fileId)) continue;
    const p = input.probed.get(c.fileId)!;
    const sourceIn = Math.max(0, Number(g.options?.sourceInMs ?? 0) || 0);
    const length = Math.min(g.endMs - g.startMs, p.durationMs - sourceIn);
    if (length < 200) continue;
    const loc = locate(c.fileId, sourceIn, sourceIn + length);
    if (!loc) continue;
    const place = g.placement === "full" || !g.placement || g.placement === "center" ? fillPlace(p, W, H, null) : cornerPlace(p, W, H, g.placement, 0.36);
    overs.push({ material: loc.key, startMs: g.startMs, lengthMs: length, endMs: g.startMs + length, sourceInMs: loc.sourceInMs, volume: 0, place });
    overlays.push({ media: loc.key, startMs: g.startMs, lengthMs: length, sourceInMs: loc.sourceInMs });
  }
  let pictureN = 0;
  for (const g of input.graphics) {
    if (!g.fileId || g.kind === "broll" || g.endMs <= g.startMs) continue;
    const p = input.probed.get(g.fileId);
    const mime = input.fileMimes.get(g.fileId) ?? "";
    if (!p || !/^image\//.test(mime) || !p.width || !p.height) continue;
    pictureN += 1;
    const key = `${g.fileId}#img`;
    if (!media.some((m) => m.key === key)) {
      const name = input.fileNames.get(g.fileId) ?? `图片 ${pictureN}`;
      media.push({ key, rel: `materials/image${pad(pictureN)}${extOf(name, ".png")}`, name, type: "video", kind: "photo", durationMs: 10_800_000, width: p.width, height: p.height, make: { kind: "copy", fileId: g.fileId } });
    }
    const share = Math.max(0.05, Math.min(0.9, (g.scale || 30) / 100));
    const place = g.placement === "full" ? fillPlace(p, W, H, null) : pictureSpot(p, W, H, g.placement, share);
    overs.push({ material: key, startMs: g.startMs, lengthMs: g.endMs - g.startMs, endMs: g.endMs, sourceInMs: 0, volume: 1, place });
  }

  /* ---- words: graphics, title cards, captions ---------------------------- */
  const graphicTexts: DraftText[] = [...titleTexts];
  for (const g of input.graphics) {
    if (g.kind === "broll" || g.kind === "punch" || g.endMs <= g.startMs) continue;
    const words = graphicWords(g);
    if (!words) continue;
    graphicTexts.push({ startMs: g.startMs, endMs: g.endMs, text: words, ...graphicLook(g, input.accent, H > W) });
  }
  if (input.graphics.some((g) => g.kind === "punch")) notes.push("推镜（punch in）没有导出：剪映里可在对应片段上用关键帧放大来做。");
  if (input.graphics.some((g) => g.options?.v2 === true)) notes.push("动态图形（计数、示意图、开场钩子等）以可编辑文字导出，动画效果需要在剪映里重新加。");

  const languages = [...new Set(input.captions.map((c) => c.language))].sort((a, b) => (a === input.captionLanguage ? -1 : b === input.captionLanguage ? 1 : a.localeCompare(b)));
  const portrait = H > W;
  const captionTracks: DraftTrack[] = languages.map((lang, n) => {
    /* A line held past the start of the next one is ended there: one track
       cannot hold two segments at once, and the burned captions never show
       two lines of one language together either. */
    const sorted = input.captions.filter((c) => c.language === lang && c.endMs > c.startMs && c.text.trim()).sort((x, y) => x.startMs - y.startMs);
    const lines = sorted
      .map((c, k) => ({ ...c, endMs: k + 1 < sorted.length ? Math.min(c.endMs, sorted[k + 1].startMs) : c.endMs }))
      .filter((c) => c.endMs - c.startMs >= 40);
    // The chosen language sits lowest; a second one just above it, the way the bilingual preset stacks them.
    const y = (portrait ? -0.42 : -0.8) + n * (portrait ? 0.09 : 0.12);
    const style: DraftTextStyle = { size: n === 0 ? (portrait ? 7 : 6) : portrait ? 5 : 4.5, align: 1, stroke: true, wrap: true, maxLineWidth: portrait ? 0.86 : 0.82 };
    return { type: "text", name: `字幕 ${lang}`, segments: lines.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text.trim(), style, x: 0, y })) };
  });
  if (input.captions.length) notes.push("字幕以普通白字导出（每种语言一条文字轨），腾亚里的字幕样式和逐字高亮需要在剪映里用「文本 > 预设样式」重新套用。");

  /* ---- sound -------------------------------------------------------------- */
  const audioTracksOut: DraftTrack[] = [];
  const audio: PlanCut[] = [];
  let audioN = 0;
  for (const kind of ["voiceover", "music"] as const) {
    const rows = input.tracks.filter((t) => t.kind === kind && t.fileId && input.probed.has(t.fileId));
    if (!rows.length) continue;
    const segs = rows.map((t) => {
      const p = input.probed.get(t.fileId!)!;
      const key = `${t.fileId}#audio`;
      if (!media.some((m) => m.key === key)) {
        audioN += 1;
        const name = input.fileNames.get(t.fileId!) ?? (t.label || `音频 ${audioN}`);
        media.push({ key, rel: `materials/audio${pad(audioN)}${extOf(name, ".mp3")}`, name, type: "audio", kind: "audio", durationMs: p.durationMs, width: 0, height: 0, make: { kind: "copy", fileId: t.fileId! } });
      }
      const length = Math.min(t.durationMs ?? p.durationMs, p.durationMs);
      audio.push({ media: key, startMs: t.startMs, lengthMs: length, sourceInMs: 0 });
      return { material: key, startMs: t.startMs, endMs: t.startMs + length, lengthMs: length, sourceInMs: 0, volume: Math.max(0, Math.min(4, t.gain)) };
    });
    packTracks(segs).forEach((lane, n) => audioTracksOut.push({ type: "audio", name: `${kind === "voiceover" ? "配音" : "音乐"}${n ? ` ${n + 1}` : ""}`, segments: lane }));
    if (kind === "music" && rows.some((t) => t.duckUnderSpeech)) notes.push("音乐的「说话时自动压低」没有导出，剪映里可以用音量关键帧或「人声增强」处理。");
  }

  const tracks: DraftTrack[] = [
    { type: "video", name: "", segments: main },
    ...packTracks(overs).map((lane, n): DraftTrack => ({ type: "video", name: `画中画${n ? ` ${n + 1}` : ""}`, segments: lane })),
    ...packTracks(graphicTexts).map((lane, n): DraftTrack => ({ type: "text", name: `图形文字${n ? ` ${n + 1}` : ""}`, segments: lane })),
    ...captionTracks,
    ...audioTracksOut,
  ];
  return { media, tracks, cuts, overlays, audio, durationMs, notes };
}

/* ------------------------------------------------------------ placing */

/**
 * Fill the canvas, the way the render does, centred on the face when the
 * director found one. In a draft, scale 1 is "fit inside the canvas" and the
 * offset is in half-canvas units with y pointing up.
 */
export function fillPlace(p: { width: number; height: number }, W: number, H: number, face: { cx: number; cy: number } | null): Placement | undefined {
  if (!p.width || !p.height) return undefined;
  const fit = Math.min(W / p.width, H / p.height);
  const cover = Math.max(W / p.width, H / p.height);
  const scale = round(cover / fit);
  if (Math.abs(scale - 1) < 0.01) return undefined;
  const dispW = p.width * cover;
  const dispH = p.height * cover;
  const fx = face?.cx ?? 0.5;
  const fy = face?.cy ?? 0.5;
  const dx = clamp((0.5 - fx) * dispW, (dispW - W) / 2);
  const dy = clamp((0.5 - fy) * dispH, (dispH - H) / 2);
  return { scale, x: round(dx / (W / 2)), y: round(-dy / (H / 2)) };
}

/** A cutaway in a corner, `share` of the canvas width, inset from the edges. */
function cornerPlace(p: { width: number; height: number }, W: number, H: number, placement: string, share: number): Placement {
  const fit = Math.min(W / (p.width || W), H / (p.height || H));
  const scale = round((W * share) / ((p.width || W) * fit));
  const w = (p.width || W) * fit * scale;
  const h = (p.height || H) * fit * scale;
  const margin = Math.round(Math.min(W, H) * 0.04);
  const left = placement.endsWith("left");
  const top = placement.startsWith("top");
  const cx = left ? margin + w / 2 : W - margin - w / 2;
  const cy = top ? margin + h / 2 : H - margin - h / 2;
  return { scale, x: round((cx - W / 2) / (W / 2)), y: round(-(cy - H / 2) / (H / 2)) };
}

/** A picture graphic: `share` of the canvas height, at its placement. */
function pictureSpot(p: { width: number; height: number }, W: number, H: number, placement: string, share: number): Placement {
  const fit = Math.min(W / p.width, H / p.height);
  const scale = round((H * share) / (p.height * fit));
  const w = p.width * fit * scale;
  const h = p.height * fit * scale;
  const margin = Math.round(Math.min(W, H) * 0.05);
  const x = placement.endsWith("left") ? margin + w / 2 : placement.endsWith("right") ? W - margin - w / 2 : W / 2;
  const y = placement.startsWith("top") ? margin + h / 2 : placement.startsWith("bottom") ? H - margin - h / 2 : H / 2;
  return { scale, x: round((x - W / 2) / (W / 2)), y: round(-(y - H / 2) / (H / 2)) };
}

/** A graphic's words, as a person would retype them: lines kept, the accent brackets taken off. */
export function graphicWords(g: Pick<GraphicRow, "kind" | "text" | "sub" | "options">): string {
  const o = (g.options ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(o.lines) && o.lines.every((l) => typeof l === "string") ? (o.lines as string[]) : null;
  const steps = Array.isArray(o.steps) && o.steps.every((l) => typeof l === "string") ? (o.steps as string[]) : null;
  // A stinger keeps its card title in its props rather than in `text`.
  let main = lines ? lines.join("\n") : g.text.trim() || (typeof o.titleZh === "string" ? o.titleZh : "");
  if (steps && g.kind === "diagram") main = `${g.text}\n${steps.join(" → ")}`;
  if (g.kind === "counter" && typeof o.unit === "string" && !main.endsWith(o.unit)) main = `${main}${o.unit}`;
  const sub = g.sub?.trim();
  const text = [main.trim(), sub].filter(Boolean).join("\n");
  return text.replace(/[【】]/g, "").trim();
}

/** Size, weight and spot by kind: close to where the render draws each, and every one editable. */
function graphicLook(g: Pick<GraphicRow, "kind" | "placement" | "options">, accent: string, portrait: boolean): { style: DraftTextStyle; x: number; y: number } {
  const zone = String((g.options ?? {}).zone ?? "");
  const spot = (placement: string): { x: number; y: number; align: 0 | 1 | 2 } => {
    const x = placement.endsWith("left") ? -0.55 : placement.endsWith("right") ? 0.55 : 0;
    const y = placement.startsWith("top") ? 0.82 : placement.startsWith("bottom") ? -0.86 : zone === "T" ? 0.5 : 0;
    return { x, y, align: placement.endsWith("left") ? 0 : placement.endsWith("right") ? 2 : 1 };
  };
  const s = spot(g.placement || "center");
  const big = portrait ? 11 : 10;
  switch (g.kind) {
    case "hook":
    case "title":
    case "statement":
      return { style: { size: big, bold: true, align: s.align, stroke: true, wrap: true }, x: s.x, y: s.y };
    case "counter":
    case "stat":
      return { style: { size: big + 2, bold: true, color: accent, align: 1, stroke: true, wrap: true }, x: s.x, y: s.y };
    case "lower-third":
    case "entity":
      return { style: { size: 7, bold: true, align: 0, stroke: true, wrap: true }, x: -0.45, y: portrait ? -0.2 : -0.55 };
    case "header":
    case "chapter":
      return { style: { size: 5, bold: true, align: s.align, stroke: true, wrap: true, alpha: 0.9 }, x: s.x, y: s.y };
    case "watermark":
      return { style: { size: 4, align: 1, stroke: false, wrap: true, alpha: 0.6 }, x: s.x, y: portrait ? -0.9 : -0.9 };
    case "footnote":
      return { style: { size: 3.5, align: 1, stroke: false, wrap: true, alpha: 0.8 }, x: 0, y: -0.95 };
    case "end-card":
      return { style: { size: 9, bold: true, align: 1, stroke: true, wrap: true }, x: 0, y: portrait ? -0.1 : -0.2 };
    default:
      return { style: { size: 8, bold: true, align: s.align, stroke: true, wrap: true }, x: s.x, y: s.y };
  }
}

/* ------------------------------------------------------------- small */

const pad = (n: number) => String(n).padStart(2, "0");
const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (v: number, limit: number) => Math.max(-Math.max(0, limit), Math.min(Math.max(0, limit), v));

function extOf(name: string, fallback: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}

function stem(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "");
}

/** m:ss for a material's name. */
function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
