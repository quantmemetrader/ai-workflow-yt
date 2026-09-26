/**
 * Director v2 evaluation harness: the measurements (PLAN.md §2 W7, §3).
 *
 * Everything the grader can decide without a person watching lives here:
 * the input contract a graded run is described by, the pure evaluators
 * that turn measurements into gate results, and the thin wrappers around
 * ffmpeg, the local whisper and the face detector that take those
 * measurements off a rendered file.
 *
 * Three rules, so the harness stays an honest second opinion:
 *
 *   1. **It shares no code with the modules it grades.** The repeat
 *      detector below is not W1's `findRetakes`, the caption geometry is
 *      read back out of the ASS file rather than asked of `ass.ts`, and the
 *      cadence is measured on the plan *and* on the pixels. A gate that
 *      passed because the checker and the checked agree on the same bug is
 *      not a gate.
 *   2. **Pure cores, thin IO.** Every `evaluate*` takes plain data and
 *      returns a `Gate` with issues; every `measure*` shells out with an
 *      argv array and a timeout and returns plain data. `grade.ts` wires
 *      them; nothing here writes outside the file paths it is handed.
 *   3. **Null is an answer.** A gate whose input was not supplied (no
 *      `beats`, no `cutReport`, no `spend`) reports `pass: null` with the
 *      reason in Chinese, never a pass by default.
 *
 * The input contract (`GradeInput`) is what the Stage-2 lab writes beside
 * `out.mp4` and what `grade.ts` builds from the v1 fixture for the
 * baseline. Times are milliseconds on the **output** clock unless the
 * field name says `source`. Boxes are `[x, y, w, h]` in output pixels.
 */
import { execFile, spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { CutReport, Intent, Layout, Silence, Word } from "../../lib/video/v2/types";

const run = promisify(execFile);

/* ================================================================ types */

export type Box = [number, number, number, number];

export type GradeCut = {
  /** The source file the cut is taken from; needed only for the boundary check. */
  file?: string | null;
  inMs: number;
  outMs: number;
  zoom?: number;
  push?: { fromMs: number; toMs: number; to: number } | null;
};

export type GradeGraphic = {
  id: string;
  kind: string;
  startMs: number;
  endMs: number;
  text?: string | null;
  sub?: string | null;
  /** Where the drawn pixels sit on the output frame; null when nobody measured it. */
  box?: Box | null;
  /** A still (PNG with alpha) the box can be measured from when `box` is null. */
  file?: string | null;
  /** Header, watermark, footnote: on screen throughout and exempt from the one-layer and zone rules. */
  furniture?: boolean;
  props?: Record<string, unknown> | null;
};

export type GradeEntity = {
  name: string;
  romanised?: string;
  kind?: "company" | "agency" | "person" | "product" | "publication" | "legislature";
  descriptorZh?: string;
};

export type GradeBeat = {
  id?: string;
  intent?: Intent;
  /** When the thing is said, output clock. */
  atMs?: number;
  entity?: GradeEntity | null;
  must?: string | null;
  mustNot?: string | null;
  /** What the director resolved the beat to. `platform`/`web` count as resolved for the sourcing gate. */
  resolved?: "platform" | "web" | "stock" | "card" | "host" | "none";
};

export type GradeCutaway = {
  startMs: number;
  endMs: number;
  /** `full` / `split` / `run` in v2; the v1 baseline carries its own placements (`pip`, `center`, `top-right`, …). */
  layout: Layout | string;
  still: boolean;
  /** The local asset file, when it is on this box; the mp4's own frame is used otherwise. */
  file?: string | null;
  sourceInMs?: number;
  assetIndex?: number | null;
  runId?: string | null;
  /** Where the picture sits on the frame; the whole frame when null and the layout is full-frame. */
  box?: Box | null;
  beat?: GradeBeat | null;
};

export type GradeAsset = {
  platform: string;
  sourceId: string;
  sourceUrl?: string | null;
  author?: string | null;
  authorUrl?: string | null;
  title?: string | null;
  licence?: string | null;
  file?: string | null;
  width?: number | null;
  height?: number | null;
  kind?: "video" | "image" | "logo";
};

export type GradeCaption = {
  startMs: number;
  endMs: number;
  text: string;
  words?: { text: string; start: number; end: number }[] | null;
};

/** The brief's anchors, in the shape of the gold file's `anchors` block. */
export type GradeAnchors = {
  hookBlock?: string[];
  quotedPhrases?: { text: string; mentions?: { asTranscribed?: string; startMs?: number; endMs?: number }[]; note?: string }[];
  numbers?: { text: string; value?: string; unit?: string; labelZh?: string; mentions?: { asTranscribed?: string; startMs?: number; endMs?: number }[] }[];
  entities?: { name: string; romanised?: string; kind?: string; transcribedAs?: string[]; mentions?: { asTranscribed?: string; startMs?: number; endMs?: number }[] }[];
  terms?: { term: string; definition?: string }[];
  scenes?: { nameZh: string; en?: string }[];
  argumentChain?: string[];
  lowerThird?: { name: string; sub?: string; saidAtMs?: number };
  endCard?: { text?: string; question?: string };
};

export type GradeGlossary = { from: string[]; to: string }[];

export type GradeInput = {
  label: string;
  mp4: string;
  width: number;
  height: number;
  fps: number;
  cuts: GradeCut[];
  cutaways: GradeCutaway[];
  graphics: GradeGraphic[];
  /** The main-language captions as burned in, output clock. */
  captions: GradeCaption[];
  assFile?: string | null;
  assets: GradeAsset[];
  credits?: { line?: string | null; block?: string | null } | null;
  beats?: GradeBeat[] | null;
  cutReport?: CutReport | null;
  /** The take's words and silences on the source clock, for the boundary check. */
  sourceWords?: Word[] | null;
  sourceSilences?: Silence[] | null;
  glossary?: GradeGlossary | null;
  anchors?: GradeAnchors | null;
  /** The gold's labelled retakes on the source clock (`retakes` in the gold file). */
  goldRetakes?: GoldRetake[] | null;
  timings?: Record<string, number> | null;
  spend?: { usd?: number; tikhubRequests?: number; visionUsd?: number } | null;
  /** W6's `lintPlan` output, when the lab ran it. */
  lint?: { rule: string; atMs?: number; textZh: string }[] | null;
  audio?: { voiceChain?: boolean } | null;
};

export type Severity = "high" | "med" | "low";

export type Issue = {
  atMs: number | null;
  area: string;
  severity: Severity;
  text: string;
  textZh: string;
};

export type Gate = {
  id: string;
  name: string;
  nameZh: string;
  /** null: could not be decided from what was supplied. */
  pass: boolean | null;
  value: string;
  threshold: string;
  /** True for the plan's hard gates (§3); false for the softer metrics that feed the checklist. */
  hard: boolean;
  issues: Issue[];
  detail?: Record<string, unknown>;
};

/* ============================================================ constants */

/** §1 zones on a 1080×1920 frame, as shares so a proxy-sized check reads the same. */
export const ZONES = {
  unsafeTop: 220 / 1920,
  unsafeBottom: 1440 / 1920,
  unsafeLeft: 64 / 1080,
  unsafeRight: 930 / 1080,
  zoneT: [230 / 1920, 620 / 1920] as const,
  captionCentreY: 1360 / 1920,
  facePad: 40 / 1920,
  chinGap: 40 / 1920,
} as const;

/** Generic stock libraries: fine for a scene, never "the specific thing". */
export const STOCK_PLATFORMS = new Set(["pexels", "pixabay", "unsplash", "storyblocks", "shutterstock", "getty", "istock", "envato", "coverr", "mixkit"]);

/** Furniture kinds: on screen throughout by the brief's design. */
export const FURNITURE_KINDS = new Set(["header", "watermark", "footnote"]);

/** Layers that may share the screen with another layer: corner chips and the stinger's own moment. */
export const OVERLAP_EXEMPT_KINDS = new Set(["chip"]);

/** The cadence rule's exception: a stinger may sit closer than 0.8 s to its neighbours. */
export const CADENCE_EXEMPT_KINDS = new Set(["stinger"]);

/** v1 picks the lead never wants to see again (PLAN.md §2 W3 acceptance). */
export const BANNED_SOURCE_IDS: Record<string, string> = {
  "7230784": "Pexels 7230784: a woman dancing with a gun and a briefcase of money, placed for 信用卡盗刷",
  "2511460954": "Flickr 2511460954: the 2008 photo titled 'Anthropic' (a Karl Barth quote), placed for Anthropic",
  "51404309297": "Flickr 51404309297: DING XIAOYI action still, placed for 张一鸣",
  "2847551225": "Flickr 2847551225: the Creative Commons logo, placed for 《自然》",
  "196568130": "",
};

/** Words the vision model uses for the stock-actor and cheap-stock failure modes. */
const CHEESY = /staged|actor|actress|smiling|cheesy|posed|stock model|fake/i;

/* ======================================================= text helpers */

const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
const KEEP = /[㐀-䶿一-鿿豈-﫿A-Za-z0-9.%]/g;

export function hanCount(text: string): number {
  return (text.match(HAN) ?? []).length;
}

/**
 * Text for matching: Han, Latin, digits, `.` and `%` only, lower-cased,
 * with the glossary applied longest-form-first so `Anthrobic为什么急`
 * and `Anthropic为什么急` count as the same phrase. Fullwidth digits and
 * percent signs are folded to ASCII, because whisper is inconsistent.
 */
export function normalise(text: string, glossary: GradeGlossary | null | undefined = null): string {
  let t = text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/％/g, "%")
    .replace(/．/g, ".");
  const pairs: { from: string; to: string }[] = [];
  for (const g of glossary ?? []) for (const f of g.from) pairs.push({ from: f, to: g.to });
  pairs.sort((a, b) => b.from.length - a.from.length);
  for (const p of pairs) t = t.split(p.from).join(p.to);
  return (t.match(KEEP) ?? []).join("").toLowerCase();
}

/**
 * The words as one normalised string, with the output time of every
 * character kept beside it, so a phrase found in the string can be placed
 * on the clock. The glossary is applied to the joined text, not per word,
 * because whisper splits 西雅芳 into 西·雅芳 and a per-word replacement
 * would never see the misspelling whole. A replacement's characters take
 * the time of the first character they replaced.
 */
export function normaliseWithMap(words: readonly Word[], glossary: GradeGlossary | null | undefined = null): { text: string; startsMs: number[] } {
  let chars: string[] = [];
  let times: number[] = [];
  for (const w of words) {
    const cs = [...w.text];
    const span = Math.max(1, w.endMs - w.startMs);
    cs.forEach((c, k) => {
      const folded = /[０-９]/.test(c) ? String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30) : c === "％" ? "%" : c === "．" ? "." : c;
      chars.push(folded);
      times.push(w.startMs + Math.round((span * k) / cs.length));
    });
  }
  const pairs: { from: string; to: string }[] = [];
  for (const g of glossary ?? []) for (const f of g.from) if (f) pairs.push({ from: f, to: g.to });
  pairs.sort((a, b) => b.from.length - a.from.length);
  for (const p of pairs) {
    const from = [...p.from];
    const to = [...p.to];
    const nextChars: string[] = [];
    const nextTimes: number[] = [];
    for (let i = 0; i < chars.length; ) {
      let hit = i + from.length <= chars.length;
      for (let k = 0; hit && k < from.length; k++) if (chars[i + k] !== from[k]) hit = false;
      if (hit) {
        for (const c of to) {
          nextChars.push(c);
          nextTimes.push(times[i]);
        }
        i += from.length;
      } else {
        nextChars.push(chars[i]);
        nextTimes.push(times[i]);
        i++;
      }
    }
    chars = nextChars;
    times = nextTimes;
  }
  const outChars: string[] = [];
  const outTimes: number[] = [];
  chars.forEach((c, i) => {
    if (KEEP.test(c)) {
      outChars.push(c.toLowerCase());
      outTimes.push(times[i]);
    }
    KEEP.lastIndex = 0;
  });
  return { text: outChars.join(""), startsMs: outTimes };
}

/**
 * The figures a stat carries: ASCII numbers (with decimals) and runs of
 * Chinese numerals of two or more characters (几千万, 几亿, 十几, 三大).
 * 「63.5%」 and 「63.5 %」 are the same figure; 「几千万到几亿美金」 is
 * spoken when either 几千万 or 几亿 is heard.
 */
export function numberTokens(text: string): string[] {
  const folded = text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 0x30)).replace(/[，,]/g, "");
  const ascii = folded.match(/[0-9]+(?:\.[0-9]+)?/g) ?? [];
  const han = folded.match(/[零一二两三四五六七八九十百千万亿几]{2,}/g) ?? [];
  return [...ascii, ...han];
}

/** Non-overlapping occurrences of `needle` in `hay`. */
export function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** The figures of a stat joined, as its identity for the duplicate check. */
export function digitSignature(text: string): string {
  return numberTokens(text).join("_");
}

/* ====================================================== clock mapping */

/** Output milliseconds of a source moment through the cut list, or null when it was cut away. */
export function toOutputMs(sourceMs: number, cuts: GradeCut[]): number | null {
  let t = 0;
  for (const c of cuts) {
    if (sourceMs >= c.inMs && sourceMs < c.outMs) return t + (sourceMs - c.inMs);
    t += c.outMs - c.inMs;
  }
  return null;
}

/** Output boundaries between consecutive cuts (the last cut's end is not a boundary). */
export function cutBoundaries(cuts: GradeCut[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    t += cuts[i].outMs - cuts[i].inMs;
    out.push(t);
  }
  return out;
}

export function totalMs(input: Pick<GradeInput, "cuts">): number {
  return input.cuts.reduce((a, c) => a + (c.outMs - c.inMs), 0);
}

/** Words said inside a window, joined the way the language reads (no spaces between Han). */
export function wordsIn(words: readonly Word[], startMs: number, endMs: number): string {
  let out = "";
  for (const w of words) {
    if (w.endMs < startMs || w.startMs > endMs) continue;
    const latinJoin = /[A-Za-z]$/.test(out) && /^[A-Za-z]/.test(w.text);
    out += (latinJoin ? " " : "") + w.text;
  }
  return out.trim();
}

/* ================================================== repeat detection */

export type RepeatCluster = {
  /** Output ms where the first saying starts and where the second starts. */
  firstMs: number;
  secondMs: number;
  /** The longest run of characters said twice. */
  chars: number;
  text: string;
  /** `retake` at six characters or more; `suspect` at five, which is where parallel rhetoric lives (一轮比一轮官方 / 一轮比一轮激进). */
  kind: "retake" | "suspect";
  runs: number;
};

/**
 * Phrases said twice within twenty seconds, from word timings alone.
 *
 * Every character gets a time (interpolated across its word), the stream
 * is scanned for five-character runs that recur inside the window, each
 * hit is extended to the longest common run, and hits that belong to the
 * same re-say (first starts within six seconds, same offset within three)
 * are clustered. A restart such as 而且这些账号不是正常注册的… followed by
 * 而且这些账号被Anthropic指控不是正常注册的… produces three or four runs
 * that all point at one event; the cluster reports the longest.
 *
 * Deliberately simpler than W1's `findRetakes` — no brief phrases, no
 * model — because its job is to catch what W1 missed, on the *output*.
 */
export function findRepeats(words: readonly Word[], opts: { windowMs?: number; minChars?: number } = {}): RepeatCluster[] {
  const windowMs = opts.windowMs ?? 20_000;
  const minChars = opts.minChars ?? 5;
  const chars: string[] = [];
  const times: number[] = [];
  for (const w of words) {
    const cs = (w.text.match(KEEP) ?? []).map((c) => c.toLowerCase());
    if (!cs.length) continue;
    const span = Math.max(1, w.endMs - w.startMs);
    cs.forEach((c, k) => {
      chars.push(c);
      times.push(w.startMs + Math.round((span * k) / cs.length));
    });
  }
  const n = chars.length;
  const hits: { i: number; j: number; len: number }[] = [];
  /* Index of every 5-gram's positions, so the scan is linear in practice. */
  const index = new Map<string, number[]>();
  for (let i = 0; i + minChars <= n; i++) {
    const g = chars.slice(i, i + minChars).join("");
    const list = index.get(g);
    if (list) list.push(i);
    else index.set(g, [i]);
  }
  const covered = new Set<number>();
  for (let i = 0; i + minChars <= n; i++) {
    if (covered.has(i)) continue;
    const g = chars.slice(i, i + minChars).join("");
    const positions = index.get(g) ?? [];
    const j = positions.find((p) => p >= i + minChars && times[p] - times[i] <= windowMs && times[p] > times[i]);
    if (j === undefined) continue;
    let len = minChars;
    while (i + len < j && j + len < n && chars[i + len] === chars[j + len]) len++;
    hits.push({ i, j, len });
    for (let k = i; k < i + len; k++) covered.add(k);
  }
  const clusters: RepeatCluster[] = [];
  for (const h of hits) {
    const firstMs = times[h.i];
    const secondMs = times[h.j];
    /* One re-say event: the first runs start within six seconds of each
       other and the second runs follow in order within twelve — a restart
       that inserts a clause between two shared runs still counts once. */
    const near = clusters.find((c) => Math.abs(c.firstMs - firstMs) <= 6000 && secondMs >= c.secondMs - 2000 && secondMs - c.secondMs <= 12000);
    if (near) {
      near.runs++;
      if (h.len > near.chars) {
        near.chars = h.len;
        near.text = chars.slice(h.i, h.i + h.len).join("");
        near.firstMs = Math.min(near.firstMs, firstMs);
      }
      near.kind = near.chars >= 6 ? "retake" : "suspect";
      continue;
    }
    clusters.push({ firstMs, secondMs, chars: h.len, text: chars.slice(h.i, h.i + h.len).join(""), kind: h.len >= 6 ? "retake" : "suspect", runs: 1 });
  }
  return clusters.sort((a, b) => a.firstMs - b.firstMs);
}

/* ====================================================== ASS parsing */

export type AssStyle = { name: string; family: string; size: number; bold: boolean; outline: number; alignment: number; marginL: number; marginR: number; marginV: number };
export type AssEvent = { layer: number; startMs: number; endMs: number; style: string; raw: string; text: string; lines: string[] };
export type AssFile = { playResX: number; playResY: number; styles: Map<string, AssStyle>; events: AssEvent[] };

function assTime(s: string): number {
  const m = /^(\d+):(\d\d):(\d\d)\.(\d\d)$/.exec(s.trim());
  if (!m) return 0;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10;
}

/**
 * The parts of an ASS file the checks need: the styles' geometry and each
 * event's visible text with its `\N` breaks kept as lines. Override tags
 * are stripped, so 「{\c&H..\fs76}三大安全机构{\r}」 reads as the words.
 */
export function parseAss(text: string): AssFile {
  const out: AssFile = { playResX: 1080, playResY: 1920, styles: new Map(), events: [] };
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^PlayResX:/i.test(line)) out.playResX = Number(line.split(":")[1]) || out.playResX;
    else if (/^PlayResY:/i.test(line)) out.playResY = Number(line.split(":")[1]) || out.playResY;
    else if (/^Format:/i.test(line)) {
      const cols = line.slice(7).split(",").map((c) => c.trim());
      if (cols.includes("Fontname")) styleFormat = cols;
      else if (cols.includes("Text")) eventFormat = cols;
    } else if (/^Style:/i.test(line) && styleFormat.length) {
      const vals = line.slice(6).split(",").map((v) => v.trim());
      const col = (name: string) => vals[styleFormat.indexOf(name)] ?? "";
      const st: AssStyle = {
        name: col("Name"),
        family: col("Fontname"),
        size: Number(col("Fontsize")) || 0,
        bold: col("Bold") === "-1" || col("Bold") === "1",
        outline: Number(col("Outline")) || 0,
        alignment: Number(col("Alignment")) || 2,
        marginL: Number(col("MarginL")) || 0,
        marginR: Number(col("MarginR")) || 0,
        marginV: Number(col("MarginV")) || 0,
      };
      out.styles.set(st.name, st);
    } else if (/^Dialogue:/i.test(line) && eventFormat.length) {
      const body = line.slice(9);
      const parts = body.split(",");
      const textIdx = eventFormat.indexOf("Text");
      const head = parts.slice(0, textIdx);
      const raw = parts.slice(textIdx).join(",");
      const col = (name: string) => head[eventFormat.indexOf(name)]?.trim() ?? "";
      const visible = raw.replace(/\{[^}]*\}/g, "");
      const lines = visible.split(/\\N/).map((l) => l.replace(/\\[nh]/g, " ").trim()).filter(Boolean);
      out.events.push({ layer: Number(col("Layer")) || 0, startMs: assTime(col("Start")), endMs: assTime(col("End")), style: col("Style"), raw, text: lines.join(""), lines });
    }
  }
  return out;
}

/**
 * Where a caption event sits on the frame, from its style alone.
 *
 * libass places a bottom-centre style with its last line's baseline
 * `MarginV` above the frame's bottom; the box is the lines stacked at the
 * font size with the outline around them, and the width the widest line
 * would take at one em per Han character (Latin at roughly half). It is a
 * geometry estimate for zone and face checks, not a rasteriser.
 */
export function captionBox(event: AssEvent, style: AssStyle, W: number, H: number): Box {
  const lineH = Math.round(style.size * 1.15);
  const h = lineH * Math.max(1, event.lines.length) + style.outline * 2;
  const widest = Math.max(
    1,
    ...event.lines.map((l) => hanCount(l) * style.size + (l.length - hanCount(l)) * style.size * 0.55),
  );
  const w = Math.min(W - style.marginL - style.marginR, Math.round(widest) + style.outline * 2);
  const x = Math.round((W - w) / 2);
  const bottomAligned = style.alignment <= 3;
  const middle = style.alignment >= 4 && style.alignment <= 6;
  const y = bottomAligned ? H - style.marginV - h : middle ? Math.round((H - h) / 2) : style.marginV;
  return [x, y, w, h];
}

/* ==================================================== geometry helpers */

export function intersects(a: Box, b: Box, pad = 0): boolean {
  return a[0] < b[0] + b[2] + pad && a[0] + a[2] + pad > b[0] && a[1] < b[1] + b[3] + pad && a[1] + a[3] + pad > b[1];
}

export function overlapMs(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

/** The layout §2 W3 prescribes for a source of this size. */
export function layoutBySource(width: number, height: number): Layout | "upscaled" {
  if (height >= width) return width >= 1080 ? "full" : "upscaled";
  if (width >= 3840) return "full";
  if (width >= 1280 && height >= 720) return "split";
  return Math.min(width, height) >= 540 ? "run" : "upscaled";
}

/* ================================================================ dHash */

/** 64-bit difference hash of a 9×8 grey thumbnail, as a 16-hex string. */
export function dhash(grey9x8: Uint8Array): string {
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += grey9x8[y * 9 + x] < grey9x8[y * 9 + x + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/* ============================================================ credits */

/**
 * A v1 credit string into an asset record.
 *
 *   Stock clip by Kuiyibo Campos — Pexels License — https://www.pexels.com/video/…-28709421/
 *   “Anthropic” by Brett Jordan — CC BY 2.0 — https://www.flickr.com/photos/55497864@N00/2511460954
 *
 * The platform is read from the link's host, the id from the link's tail
 * (Pexels' trailing number, Flickr's photo id, Commons' `curid`), the
 * author from `by …`, the licence from the middle clause.
 */
export function parseCredit(credit: string, fallbackTitle = ""): GradeAsset {
  const url = (/https?:\/\/\S+/.exec(credit) ?? [""])[0].replace(/[)\]]+$/, "");
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const platform = /pexels/.test(host) ? "pexels" : /pixabay/.test(host) ? "pixabay" : /flickr/.test(host) ? "flickr" : /wikimedia|wikipedia/.test(host) ? "wikimedia" : /douyin/.test(host) ? "douyin" : /tiktok/.test(host) ? "tiktok" : /bilibili/.test(host) ? "bilibili" : /youtu/.test(host) ? "youtube" : /pinterest/.test(host) ? "pinterest" : host || "unknown";
  let sourceId = "";
  if (platform === "pexels") sourceId = (/-(\d+)\/?$/.exec(url) ?? [])[1] ?? (/\/(\d+)\/?$/.exec(url) ?? [])[1] ?? "";
  else if (platform === "wikimedia") sourceId = (/curid=(\d+)/.exec(url) ?? [])[1] ?? (/File:([^&?#]+)/.exec(url) ?? [])[1] ?? "";
  else sourceId = (/\/([^/?#]+)\/?(?:[?#].*)?$/.exec(url) ?? [])[1] ?? "";
  const author = (/\bby\s+(.+?)\s+—/.exec(credit) ?? [])[1]?.trim() ?? null;
  const title = (/[“"「]([^”"」]+)[”"」]/.exec(credit) ?? [])[1] ?? fallbackTitle;
  const clauses = credit.split("—").map((c) => c.trim());
  const licence = clauses.length >= 3 ? clauses[clauses.length - 2] : null;
  return { platform, sourceId: sourceId || url, sourceUrl: url || null, author, title, licence };
}

/* ======================================================= measurements */

const FFMPEG_TIMEOUT = 170_000;

/** Width and height of a media file's first video stream (rotation applied), or null. */
export async function probeSize(file: string): Promise<{ width: number; height: number; durationMs: number } | null> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:format=duration", "-of", "json", file],
      { timeout: 30_000 },
    );
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } };
    const s = j.streams?.[0];
    if (!s?.width || !s.height) return null;
    const rot = s.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? 0;
    const swap = Math.abs(rot) % 180 === 90;
    return { width: swap ? s.height : s.width, height: swap ? s.width : s.height, durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000) };
  } catch {
    return null;
  }
}

/** Integrated loudness, range and true peak from ffmpeg's ebur128. */
export async function measureLoudness(file: string): Promise<{ I: number; LRA: number; TP: number }> {
  const text = await stderrOf("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], FFMPEG_TIMEOUT);
  const num = (re: RegExp) => Number((re.exec(text) ?? [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+([\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/** Silences at `db` lasting `minS` or more, in ms. */
export async function measureSilences(file: string, db = -32, minS = 0.35): Promise<Silence[]> {
  const text = await stderrOf("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${db}dB:d=${minS}`, "-f", "null", "-"], FFMPEG_TIMEOUT);
  const out: Silence[] = [];
  let start: number | null = null;
  for (const m of text.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === "start") start = Math.round(Number(m[2]) * 1000);
    else if (start !== null) {
      out.push({ startMs: start, endMs: Math.round(Number(m[2]) * 1000) });
      start = null;
    }
  }
  return out;
}

/** Scene changes ffmpeg sees at `threshold`, on a 270-px-wide proxy for speed. */
export async function measureSceneChanges(file: string, threshold = 0.3): Promise<number[]> {
  const text = await stderrOf(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", `scale=270:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
    FFMPEG_TIMEOUT,
  );
  return [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
}

/** Mono 48 kHz PCM of a file as floats, for the click check. */
export async function pcmOf(file: string): Promise<Float32Array> {
  const buf = await stdoutOf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], FFMPEG_TIMEOUT);
  const out = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/**
 * Pauses from the PCM itself, against the recording's own floor.
 *
 * `silencedetect` at a fixed −32 dB is right for the raw take (it is what
 * the gold's silences were measured with) and wrong for the output, whose
 * `loudnorm` lifts the room tone by ten or twelve decibels and hides most
 * of the pauses from a fixed threshold. So the floor is measured: the peak
 * level of every 10 ms hop, its 10th percentile taken as the room tone
 * (speech pauses more than a tenth of the time), and a pause is a run of
 * hops that stays within `marginDb` of that floor for `minMs` or longer.
 * On the raw take the same rule lands within a few decibels of −32.
 */
export function pausesFromPcm(pcm: Float32Array, sampleRate: number, opts: { hopMs?: number; minMs?: number; marginDb?: number; ceilingDb?: number } = {}): { pauses: Silence[]; floorDb: number; thresholdDb: number } {
  const hop = Math.max(1, Math.round(((opts.hopMs ?? 10) / 1000) * sampleRate));
  const minHops = Math.ceil((opts.minMs ?? 350) / (opts.hopMs ?? 10));
  const peaks: number[] = [];
  for (let s = 0; s + hop <= pcm.length; s += hop) {
    let m = 0;
    for (let i = s; i < s + hop; i++) m = Math.max(m, Math.abs(pcm[i]));
    peaks.push(20 * Math.log10(Math.max(m, 1e-6)));
  }
  const sorted = [...peaks].sort((a, b) => a - b);
  const floorDb = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const thresholdDb = Math.min(opts.ceilingDb ?? -20, floorDb + (opts.marginDb ?? 6));
  const pauses: Silence[] = [];
  let runStart = -1;
  for (let k = 0; k <= peaks.length; k++) {
    const quiet = k < peaks.length && peaks[k] <= thresholdDb;
    if (quiet && runStart < 0) runStart = k;
    if (!quiet && runStart >= 0) {
      if (k - runStart >= minHops) pauses.push({ startMs: Math.round((runStart * hop * 1000) / sampleRate), endMs: Math.round((k * hop * 1000) / sampleRate) });
      runStart = -1;
    }
  }
  return { pauses, floorDb, thresholdDb };
}

/**
 * Clicks at the cuts: the largest sample-to-sample jump within 6 ms of each
 * boundary against the 95th percentile of the same statistic sampled every
 * half second across the film. A join that clicks is several times the
 * voice's own steepest edge.
 */
export function clickCheck(pcm: Float32Array, boundariesMs: number[]): { worst: number; typical: number; over: number[] } {
  const maxDelta = (from: number, to: number) => {
    let m = 0;
    for (let i = Math.max(1, from); i < Math.min(pcm.length, to); i++) m = Math.max(m, Math.abs(pcm[i] - pcm[i - 1]));
    return m;
  };
  const win = Math.round(0.006 * 48000);
  const at = boundariesMs.map((ms) => maxDelta(Math.round((ms / 1000) * 48000) - win, Math.round((ms / 1000) * 48000) + win));
  const typ: number[] = [];
  for (let c = win; c < pcm.length - win; c += 24000) typ.push(maxDelta(c - win, c + win));
  typ.sort((a, b) => a - b);
  const typical = typ[Math.floor(typ.length * 0.95)] ?? 0;
  return { worst: Math.max(0, ...at), typical, over: boundariesMs.filter((_, i) => at[i] > Math.max(0.25, typical * 2.5)) };
}

/** A 9×8 grey thumbnail of one frame (or of a still image), for dHash. */
export async function greyThumb(file: string, tS: number | null): Promise<Uint8Array | null> {
  try {
    const args = ["-hide_banner", "-loglevel", "error", ...(tS !== null ? ["-ss", tS.toFixed(3)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=9:8:flags=area", "-f", "rawvideo", "-pix_fmt", "gray", "-"];
    const buf = await stdoutOf("ffmpeg", args, 60_000);
    return buf.length >= 72 ? new Uint8Array(buf.buffer, buf.byteOffset, 72) : null;
  } catch {
    return null;
  }
}

/**
 * The bounding box of the opaque pixels of a still with alpha, scaled to the
 * output frame. Stills are drawn at the frame's size, so the box is where
 * the graphic sits on screen.
 */
export async function alphaBox(png: string, W: number, H: number): Promise<Box | null> {
  const size = await probeSize(png);
  if (!size) return null;
  const buf = await stdoutOf("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", png, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], 60_000).catch(() => null);
  if (!buf || buf.length < size.width * size.height * 4) return null;
  let x0 = size.width;
  let y0 = size.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size.height; y++) {
    const row = y * size.width * 4;
    for (let x = 0; x < size.width; x++) {
      if (buf[row + x * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const sx = W / size.width;
  const sy = H / size.height;
  return [Math.round(x0 * sx), Math.round(y0 * sy), Math.round((x1 - x0 + 1) * sx), Math.round((y1 - y0 + 1) * sy)];
}

export type FaceSample = { t: number; box: Box | null; eyeY: number | null; chinY: number | null; score: number };

/**
 * The face at given moments of the rendered file, through W5's `face.py`
 * (YuNet in its own venv). Boxes come back as shares of the frame and are
 * scaled to output pixels here. Missing detector: an empty list and a
 * warning, never a pass.
 */
export async function measureFaces(mp4: string, timesS: number[], opts: { python: string; script: string; W: number; H: number }): Promise<FaceSample[]> {
  if (!timesS.length) return [];
  const ok = await stat(opts.script).then(() => true, () => false);
  if (!ok) {
    console.warn(`[metrics] face detector not found at ${opts.script}; face checks will be skipped`);
    return [];
  }
  const { stdout } = await run(opts.python, [opts.script, mp4, "--times", timesS.map((t) => t.toFixed(3)).join(","), "--width", "540"], {
    timeout: Math.max(170_000, timesS.length * 2_000),
    maxBuffer: 16e6,
    env: { ...process.env, OMP_NUM_THREADS: "4", OPENCV_LOG_LEVEL: "ERROR" },
  });
  const parsed = JSON.parse(stdout) as { samples: { t: number; box: number[] | null; eyeY: number | null; chinY: number | null; score: number }[] };
  return parsed.samples.map((s) => ({
    t: s.t,
    box: s.box ? [Math.round(s.box[0] * opts.W), Math.round(s.box[1] * opts.H), Math.round(s.box[2] * opts.W), Math.round(s.box[3] * opts.H)] : null,
    eyeY: s.eyeY,
    chinY: s.chinY,
    score: s.score,
  }));
}

/**
 * The output re-transcribed by the local whisper, with the brief's names as
 * hotwords so the anchors are heard the way the brief spells them. Words
 * come back on the output clock in milliseconds. Cached by the caller.
 */
export async function transcribeOutput(mp4: string, wav: string, hotwords: string[], opts: { python?: string; script?: string } = {}): Promise<{ text: string; words: Word[] }> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: FFMPEG_TIMEOUT });
  const python = opts.python ?? process.env.WHISPER_PYTHON ?? "/opt/whisper/venv/bin/python";
  const script = opts.script ?? process.env.WHISPER_SCRIPT ?? "/opt/whisper/transcribe.py";
  const prompt = hotwords.length ? `本期提到：${hotwords.join("、")}。` : "";
  const { stdout } = await run(python, [script, wav, "--language", "zh", "--threads", process.env.WHISPER_THREADS || "6"], {
    timeout: 20 * 60_000,
    maxBuffer: 64e6,
    env: { ...process.env, WHISPER_PROMPT: prompt, HF_HOME: process.env.WHISPER_CACHE || "/opt/whisper/models", OMP_NUM_THREADS: process.env.WHISPER_THREADS || "6" },
  });
  const parsed = JSON.parse(stdout) as { text?: string; words?: { text: string; start: number; end: number }[] };
  const words: Word[] = (parsed.words ?? [])
    .filter((w) => typeof w.text === "string" && typeof w.start === "number")
    .map((w) => ({ text: w.text.trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(Math.max(w.start, w.end) * 1000) }))
    .filter((w) => w.text);
  return { text: parsed.text ?? words.map((w) => w.text).join(""), words };
}

function stderrOf(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err = (err + String(c)).slice(-400_000)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(err);
    });
  });
}

function stdoutOf(cmd: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

/** Read a JSON file, or null. */
export async function readJson<T>(file: string): Promise<T | null> {
  return readFile(file, "utf8").then((t) => JSON.parse(t) as T, () => null);
}

/* ========================================================== evaluators */

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;

function issue(atMs: number | null, area: string, severity: Severity, text: string, textZh: string): Issue {
  return { atMs, area, severity, text, textZh };
}

function gate(id: string, name: string, nameZh: string, hard: boolean, pass: boolean | null, value: string, threshold: string, issues: Issue[] = [], detail?: Record<string, unknown>): Gate {
  return { id, name, nameZh, hard, pass, value, threshold, issues, detail };
}

/** A retake the gold labelled on the source clock: the first take's span and the drop the cut should make. */
export type GoldRetake = { name: string; kind?: string; dropStartMs: number; dropEndMs: number; firstTake?: { startMs: number; endMs: number } };

/**
 * 0 retakes in the output: the harness's own detector on the
 * re-transcription, plus the gold's labelled spans mapped through the cut
 * (a first take that is still more than half on the timeline was kept).
 * The two are independent — whisper merged one of the 蒸馏 takes into a
 * single phrase, which only the span check can see — and a fault found by
 * either counts.
 */
export function evaluateRetakes(outputWords: Word[] | null, cuts: GradeCut[], goldRetakes: GoldRetake[] | null | undefined): Gate {
  const issues: Issue[] = [];
  const clusters = outputWords ? findRepeats(outputWords) : [];
  const retakes = clusters.filter((c) => c.kind === "retake");
  for (const c of clusters) {
    issues.push(issue(c.firstMs, "cut", c.kind === "retake" ? "high" : "low", `${c.kind}: 「${c.text}」 said at ${fmt(c.firstMs)} and again at ${fmt(c.secondMs)} (${c.chars} chars, ${c.runs} runs)`, `${c.kind === "retake" ? "重说" : "疑似重说"}：「${c.text}」在 ${fmt(c.firstMs)} 和 ${fmt(c.secondMs)} 各说一次（${c.chars} 字）`));
  }
  const kept: { name: string; share: number; atMs: number | null }[] = [];
  for (const g of goldRetakes ?? []) {
    const span = g.firstTake ?? { startMs: g.dropStartMs, endMs: g.dropEndMs };
    let onTimeline = 0;
    let firstOut: number | null = null;
    for (let ms = span.startMs; ms < span.endMs; ms += 50) {
      const o = toOutputMs(ms, cuts);
      if (o !== null) {
        onTimeline += 50;
        if (firstOut === null) firstOut = o;
      }
    }
    const share = Math.min(1, onTimeline / Math.max(1, span.endMs - span.startMs));
    if (share >= 0.5) {
      kept.push({ name: g.name, share, atMs: firstOut });
      issues.push(issue(firstOut, "cut", "high", `gold retake kept: ${g.name} (${(share * 100).toFixed(0)} % of the first take is on the timeline)`, `已知重说没有剪掉：${g.name}（第一遍有 ${(share * 100).toFixed(0)} % 留在成片里）`));
    }
  }
  if (!outputWords) issues.push(issue(null, "cut", "med", "output transcript missing; only the gold spans were checked", "没有成片转写，只核对了已知重说的时间段"));
  const total = retakes.length + kept.length;
  return gate("cut.retakes", "no retakes in the output", "成片无重说", true, !outputWords && !goldRetakes ? null : total === 0, `${retakes.length} by transcript, ${kept.length} gold spans kept, ${clusters.length - retakes.length} suspect`, "0 retakes", issues, { clusters, kept });
}

/** Every brief anchor exactly once in the output transcript. */
export function evaluateAnchors(outputWords: Word[] | null, anchors: GradeAnchors | null | undefined, glossary: GradeGlossary | null | undefined): Gate {
  if (!outputWords || !anchors) return gate("cut.anchors", "every brief anchor exactly once", "简报锚点各出现一次", true, null, "缺输入", "each = 1", [issue(null, "cut", "med", "transcript or anchors missing", "缺成片转写或锚点清单")]);
  const mapped = normaliseWithMap(outputWords, glossary);
  const hay = mapped.text;
  const issues: Issue[] = [];
  const rows: { text: string; count: number; atMs: number[] }[] = [];
  const check = (text: string, variants: string[]) => {
    const forms = [text, ...variants].map((v) => normalise(v, glossary)).filter(Boolean);
    let count = 0;
    let best = forms[0] ?? "";
    for (const f of forms) {
      const n = countOccurrences(hay, f);
      if (n > count) {
        count = n;
        best = f;
      }
    }
    const atMs: number[] = [];
    let i = hay.indexOf(best);
    while (best && i !== -1) {
      atMs.push(mapped.startsMs[i] ?? 0);
      i = hay.indexOf(best, i + best.length);
    }
    rows.push({ text, count, atMs });
    if (count !== 1) {
      issues.push(issue(atMs[1] ?? atMs[0] ?? null, "cut", count === 0 ? "high" : "med", `anchor 「${text}」 appears ${count} times${atMs.length ? ` (${atMs.map(fmt).join(", ")})` : ""}`, count === 0 ? `锚点「${text}」在成片里消失了` : `锚点「${text}」出现了 ${count} 次（${atMs.map(fmt).join("、")}）`));
    }
  };
  for (const p of anchors.quotedPhrases ?? []) check(p.text, (p.mentions ?? []).map((m) => m.asTranscribed ?? ""));
  for (const n of anchors.numbers ?? []) check(n.text, (n.mentions ?? []).map((m) => m.asTranscribed ?? ""));
  const bad = rows.filter((r) => r.count !== 1);
  return gate("cut.anchors", "every brief anchor exactly once", "简报锚点各出现一次", true, bad.length === 0, `${rows.length - bad.length}/${rows.length} exactly once (${rows.filter((r) => r.count === 0).length} missing, ${rows.filter((r) => r.count > 1).length} repeated)`, "each = 1", issues, { rows });
}

/** Output ms where a phrase is first said, on the glossary-mapped text. */
function firstWordAt(words: Word[], needle: string, glossary: GradeGlossary | null | undefined): number | null {
  const mapped = normaliseWithMap(words, glossary);
  const i = mapped.text.indexOf(needle);
  return i === -1 ? null : (mapped.startsMs[i] ?? null);
}

/** First word within 0.3 s and no pause over 0.35 s left in. */
export function evaluatePauses(outputWords: Word[] | null, silences: Silence[] | null, totalMsOut: number, floor?: { floorDb: number; thresholdDb: number }): Gate {
  const issues: Issue[] = [];
  if (!silences) return gate("cut.pauses", "no pause over 0.35 s", "无超过 0.35 秒的停顿", true, null, "未测量", "0", [issue(null, "cut", "med", "silences not measured", "未测量成片停顿")]);
  /* The lead-in before the first word, the tail after the last and the end card are not pauses. */
  const lastWord = outputWords?.length ? outputWords[outputWords.length - 1].endMs : totalMsOut - 300;
  const inner = silences.filter((s) => s.startMs > 300 && s.startMs < lastWord - 200);
  const sum = inner.reduce((a, s) => a + (s.endMs - s.startMs), 0);
  for (const s of inner.slice(0, 80)) issues.push(issue(s.startMs, "cut", s.endMs - s.startMs > 800 ? "med" : "low", `pause of ${((s.endMs - s.startMs) / 1000).toFixed(2)} s`, `停顿 ${((s.endMs - s.startMs) / 1000).toFixed(2)} 秒`));
  const firstWord = outputWords?.[0]?.startMs ?? null;
  if (firstWord !== null && firstWord > 300) issues.unshift(issue(0, "hook", "med", `first word at ${(firstWord / 1000).toFixed(2)} s`, `第一个字在 ${(firstWord / 1000).toFixed(2)} 秒才出现（应 ≤ 0.3 秒）`));
  return gate("cut.pauses", "no pause over 0.35 s", "无超过 0.35 秒的停顿", true, inner.length === 0, `${inner.length} pauses ≥ 0.35 s (${(sum / 1000).toFixed(1)} s in total${floor ? `; floor ${floor.floorDb.toFixed(0)} dB, threshold ${floor.thresholdDb.toFixed(0)} dB` : ""}); first word at ${firstWord === null ? "?" : (firstWord / 1000).toFixed(2)} s`, "0 pauses; first word ≤ 0.3 s", issues, { pauses: inner.length, pauseMs: sum, firstWordMs: firstWord, floor });
}

/**
 * Every cut boundary inside a measured silence of the source or on a word
 * boundary with 40 ms of air on both sides — otherwise it is a mid-word or
 * mid-phrase cut (v1's round-second ranges: 搞工业规模蒸|蒸馏核心).
 */
export function evaluateBoundaries(cuts: GradeCut[], sourceWords: Word[] | null | undefined, sourceSilences: Silence[] | null | undefined): Gate {
  if (!sourceWords?.length || !sourceSilences) return gate("cut.boundaries", "cuts on silences or word boundaries", "剪点落在停顿或词边界", true, null, "缺源词时或源停顿", "100 %", [issue(null, "cut", "med", "source words or silences missing", "缺原片词时或停顿数据")]);
  const points: { ms: number; edge: "in" | "out"; outMs: number }[] = [];
  let t = 0;
  cuts.forEach((c, i) => {
    if (i > 0) points.push({ ms: c.inMs, edge: "in", outMs: t });
    t += c.outMs - c.inMs;
    if (i < cuts.length - 1) points.push({ ms: c.outMs, edge: "out", outMs: t });
  });
  const issues: Issue[] = [];
  let good = 0;
  const rows: { ms: number; edge: string; ok: boolean; why: string }[] = [];
  for (const p of points) {
    const inSilence = sourceSilences.some((s) => p.ms >= s.startMs - 40 && p.ms <= s.endMs + 40);
    const inside = sourceWords.find((w) => p.ms > w.startMs + 40 && p.ms < w.endMs - 40);
    const prev = sourceWords.filter((w) => w.endMs <= p.ms + 20).at(-1);
    const next = sourceWords.find((w) => w.startMs >= p.ms - 20);
    const onBoundary = !inside && prev && next && next.startMs - prev.endMs >= 40;
    const ok = inSilence || Boolean(onBoundary);
    if (ok) good++;
    const why = inSilence ? "silence" : onBoundary ? "word boundary" : inside ? `inside 「${inside.text}」` : "no air between words";
    rows.push({ ms: p.ms, edge: p.edge, ok, why });
    if (!ok) issues.push(issue(p.outMs, "cut", inside ? "high" : "med", `${p.edge} point at source ${(p.ms / 1000).toFixed(2)} s is ${why}`, inside ? `剪点切在词中间「${inside.text}」（原片 ${(p.ms / 1000).toFixed(2)} 秒）` : `剪点不在停顿里（原片 ${(p.ms / 1000).toFixed(2)} 秒）`));
  }
  return gate("cut.boundaries", "cuts on silences or word boundaries", "剪点落在停顿或词边界", true, points.length === 0 || good === points.length, `${good}/${points.length} boundaries clean`, "100 %", issues, { rows });
}

/** The cut report explains every removal; nothing dropped for length. */
export function evaluateCutReport(report: CutReport | null | undefined, totalMsOut: number): Gate {
  if (!report) return gate("cut.report", "cut report present", "剪辑报告完整", false, null, "无剪辑报告", "every removal has a reason", [issue(null, "cut", "med", "no cut report (v1 has none)", "没有剪辑报告：v1 不记录删了什么")]);
  const unexplained = report.removed.filter((r) => !r.reason || !r.text);
  const issues = unexplained.map((r) => issue(null, "cut", "high", `removal without reason: ${r.sentenceIds.join(",")}`, `删除无理由：${r.sentenceIds.join(",")}`));
  if (report.overBudgetMs > 0) issues.push(issue(null, "cut", "low", `over budget by ${(report.overBudgetMs / 1000).toFixed(1)} s (nothing dropped for length)`, `超出目标 ${(report.overBudgetMs / 1000).toFixed(1)} 秒（未为时长删内容）`));
  const removedMs = report.removed.reduce((a, r) => a + r.ms, 0);
  return gate("cut.report", "cut report present", "剪辑报告完整", false, unexplained.length === 0, `${report.removed.length} removals (${(removedMs / 1000).toFixed(1)} s), ${report.restored.length} restored, ${(totalMsOut / 1000).toFixed(1)} s kept`, "every removal has a reason", issues, { noteZh: report.noteZh });
}

export type CutawayScore = { index: number; score: number | null; reason: string; scoredOn: "asset" | "frame" | "none"; line: string; dhash: string | null; source: { width: number; height: number } | null; needsPerson: boolean };

/** 0 repeated assets (id or dHash ≤ 10), ≤ 2 per author. */
export function evaluateUniqueness(input: GradeInput, scores: CutawayScore[]): Gate {
  const issues: Issue[] = [];
  const byId = new Map<string, number[]>();
  const byAuthor = new Map<string, number[]>();
  input.cutaways.forEach((c, i) => {
    const a = c.assetIndex != null ? input.assets[c.assetIndex] : null;
    if (!a) return;
    const key = `${a.platform}:${a.sourceId}`;
    byId.set(key, [...(byId.get(key) ?? []), i]);
    if (a.author) {
      const ak = `${a.platform}:${a.author.trim().toLowerCase()}`;
      byAuthor.set(ak, [...(byAuthor.get(ak) ?? []), i]);
    }
  });
  let repeats = 0;
  for (const [key, idx] of byId) {
    if (idx.length < 2) continue;
    repeats += idx.length - 1;
    issues.push(issue(input.cutaways[idx[1]].startMs, "cutaways", "high", `asset ${key} used ${idx.length}× at ${idx.map((i) => fmt(input.cutaways[i].startMs)).join(", ")}`, `素材 ${key} 用了 ${idx.length} 次（${idx.map((i) => fmt(input.cutaways[i].startMs)).join("、")}）`));
  }
  let authorOver = 0;
  for (const [key, idx] of byAuthor) {
    if (idx.length <= 2) continue;
    authorOver++;
    issues.push(issue(input.cutaways[idx[2]].startMs, "cutaways", "med", `author ${key} has ${idx.length} assets (cap 2)`, `同一作者 ${key} 的素材 ${idx.length} 条（上限 2）`));
  }
  /* Near-duplicate frames across different ids: the same footage re-imported as three files. */
  let near = 0;
  const hashed = scores.filter((s) => s.dhash);
  for (let a = 0; a < hashed.length; a++) {
    for (let b = a + 1; b < hashed.length; b++) {
      const ca = input.cutaways[hashed[a].index];
      const cb = input.cutaways[hashed[b].index];
      const ka = ca.assetIndex != null ? `${input.assets[ca.assetIndex]?.platform}:${input.assets[ca.assetIndex]?.sourceId}` : `#${hashed[a].index}`;
      const kb = cb.assetIndex != null ? `${input.assets[cb.assetIndex]?.platform}:${input.assets[cb.assetIndex]?.sourceId}` : `#${hashed[b].index}`;
      if (ka === kb) continue;
      const d = hamming(hashed[a].dhash!, hashed[b].dhash!);
      if (d <= 10) {
        near++;
        issues.push(issue(cb.startMs, "cutaways", "med", `frames at ${fmt(ca.startMs)} and ${fmt(cb.startMs)} are near-identical (dHash distance ${d}) under different ids ${ka} / ${kb}`, `${fmt(ca.startMs)} 与 ${fmt(cb.startMs)} 的画面几乎相同（dHash 距离 ${d}）`));
      }
    }
  }
  return gate("cutaways.unique", "no repeated asset, ≤ 2 per author", "素材不重复、同作者 ≤ 2", true, repeats === 0 && authorOver === 0 && near === 0, `${repeats} repeats by id, ${near} near-duplicate frames, ${authorOver} authors over the cap`, "0 / 0 / 0", issues, { byId: Object.fromEntries([...byId].map(([k, v]) => [k, v.length])), byAuthor: Object.fromEntries([...byAuthor].map(([k, v]) => [k, v.length])) });
}

/** Platform mix and the variety of visual kinds. */
export function evaluateMix(input: GradeInput): Gate {
  const platforms = new Map<string, number>();
  input.cutaways.forEach((c) => {
    const a = c.assetIndex != null ? input.assets[c.assetIndex] : null;
    const p = a?.platform ?? "unknown";
    platforms.set(p, (platforms.get(p) ?? 0) + 1);
  });
  const n = input.cutaways.length;
  const top = [...platforms].sort((a, b) => b[1] - a[1])[0];
  const share = top && n ? top[1] / n : 0;
  const kinds = new Set<string>();
  input.cutaways.forEach((c) => kinds.add(c.still ? "still" : "video"));
  input.graphics.forEach((g) => {
    if (!FURNITURE_KINDS.has(g.kind) && !g.furniture) kinds.add(g.kind);
  });
  const issues: Issue[] = [];
  if (n >= 3 && share > 0.4) issues.push(issue(null, "cutaways", "med", `${top[0]} supplies ${(share * 100).toFixed(0)} % of the cutaways (cap 40 %)`, `${top[0]} 占了 ${(share * 100).toFixed(0)} % 的镜头（上限 40 %）`));
  return gate("cutaways.mix", "≤ 40 % of cutaways from one platform", "单一平台 ≤ 40 %", true, n < 3 || share <= 0.4, `${n} cutaways; top platform ${top ? `${top[0]} ${(share * 100).toFixed(0)} %` : "none"}; ${kinds.size} visual kinds`, "≤ 40 %", issues, { platforms: Object.fromEntries(platforms), kinds: [...kinds] });
}

/** Cutaways 30–40 % of the runtime; the host visible ≥ 55 %. */
export function evaluateCoverage(input: GradeInput): Gate {
  const total = totalMs(input);
  const covered = mergedMs(input.cutaways.map((c) => ({ startMs: c.startMs, endMs: c.endMs })));
  /* `full` and `split` take the host off screen (split keeps a small host under the band, which still reads as a cutaway); `run`, pip and corner pictures keep the host. */
  const hostHidden = mergedMs(input.cutaways.filter((c) => c.layout === "full" || c.layout === "split").map((c) => ({ startMs: c.startMs, endMs: c.endMs })));
  const share = total ? covered / total : 0;
  const host = total ? 1 - hostHidden / total : 1;
  const issues: Issue[] = [];
  if (share < 0.3 || share > 0.4) issues.push(issue(null, "rhythm", "med", `cutaway coverage ${(share * 100).toFixed(1)} % (want 30–40 %)`, `切出镜头占 ${(share * 100).toFixed(1)} %（应 30–40 %）`));
  if (host < 0.55) issues.push(issue(null, "rhythm", "med", `host visible ${(host * 100).toFixed(0)} % (want ≥ 55 %)`, `主持人可见 ${(host * 100).toFixed(0)} %（应 ≥ 55 %）`));
  return gate("cutaways.coverage", "cutaway coverage 30–40 %", "切出镜头占 30–40 %", true, share >= 0.3 && share <= 0.4 && host >= 0.55, `${(share * 100).toFixed(1)} % covered (${(covered / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s); host visible ${(host * 100).toFixed(0)} %`, "30–40 %; host ≥ 55 %", issues, { coverage: share, hostVisible: host });
}

function mergedMs(spans: { startMs: number; endMs: number }[]): number {
  const s = [...spans].sort((a, b) => a.startMs - b.startMs);
  let sum = 0;
  let cur: { startMs: number; endMs: number } | null = null;
  for (const x of s) {
    if (!cur || x.startMs > cur.endMs) {
      if (cur) sum += cur.endMs - cur.startMs;
      cur = { ...x };
    } else cur.endMs = Math.max(cur.endMs, x.endMs);
  }
  if (cur) sum += cur.endMs - cur.startMs;
  return sum;
}

/** Layout by source aspect; the v1 window banned; upscaled sources flagged; the in-point past the head of long clips. */
export function evaluateLayouts(input: GradeInput, scores: CutawayScore[]): Gate {
  const issues: Issue[] = [];
  let wrong = 0;
  let banned = 0;
  let headStarts = 0;
  input.cutaways.forEach((c, i) => {
    const s = scores.find((x) => x.index === i);
    if (!["full", "split", "run"].includes(c.layout)) {
      banned++;
      issues.push(issue(c.startMs, "layout", "high", `cutaway uses the v1 placement '${c.layout}' (the 34 % window / centred picture), not full/split/run`, `切出镜头用的是 v1 的「${c.layout}」摆法（34 % 小窗或居中贴图），不是 full/split/run`));
    } else if (s?.source) {
      const want = layoutBySource(s.source.width, s.source.height);
      if (want === "upscaled") {
        wrong++;
        issues.push(issue(c.startMs, "layout", "med", `source ${s.source.width}×${s.source.height} is below the 540 px short side / 1080 wide floor`, `素材 ${s.source.width}×${s.source.height} 分辨率不够，会被放大`));
      } else if (want !== c.layout && !c.still) {
        wrong++;
        issues.push(issue(c.startMs, "layout", "med", `source ${s.source.width}×${s.source.height} wants '${want}', plan says '${c.layout}'`, `素材 ${s.source.width}×${s.source.height} 应用「${want}」，计划用了「${c.layout}」`));
      }
    }
    if (!c.still && (c.sourceInMs ?? 0) === 0) headStarts++;
  });
  const clipCount = input.cutaways.filter((c) => !c.still).length;
  if (clipCount && headStarts === clipCount) issues.push(issue(null, "cutaways", "low", `every clip starts at its own first frame (sourceInMs 0)`, `每条素材都从第 0 帧开始，没有挑窗口`));
  return gate("cutaways.layout", "layout by source aspect; no v1 window", "按素材尺寸选版式；无 v1 小窗", true, banned === 0 && wrong === 0, `${banned} v1 placements, ${wrong} layout/resolution mismatches, ${headStarts}/${clipCount} clips start at frame 0`, "0 / 0", issues);
}

/** Every cutaway ≥ 7 (people ≥ 8) on the harness's own re-score. */
export function evaluateRelevance(input: GradeInput, scores: CutawayScore[]): Gate {
  const issues: Issue[] = [];
  let scored = 0;
  let ok = 0;
  let sum = 0;
  for (const s of scores) {
    if (s.score === null) continue;
    scored++;
    sum += s.score;
    const need = s.needsPerson ? 8 : 7;
    const c = input.cutaways[s.index];
    const a = c.assetIndex != null ? input.assets[c.assetIndex] : null;
    const who = a ? `${a.platform}:${a.sourceId}` : `cutaway #${s.index}`;
    if (s.score >= need) {
      ok++;
      continue;
    }
    issues.push(issue(c.startMs, "relevance", s.score <= 3 ? "high" : "med", `${who} scores ${s.score}/10 against 「${s.line.slice(0, 40)}」: ${s.reason}`, `${who} 与「${s.line.slice(0, 30)}」的相关度 ${s.score}/10：${s.reason}`));
    if (a && BANNED_SOURCE_IDS[a.sourceId] !== undefined && BANNED_SOURCE_IDS[a.sourceId]) issues.push(issue(c.startMs, "relevance", "high", `known v1 mispick: ${BANNED_SOURCE_IDS[a.sourceId]}`, `v1 的错误素材又回来了：${a.platform}:${a.sourceId}`));
    if (CHEESY.test(s.reason)) issues.push(issue(c.startMs, "cringe", "med", `vision calls it staged stock: ${s.reason}`, `视觉模型认为是摆拍素材：${s.reason}`));
  }
  const pass = scored === 0 ? null : ok === scored;
  return gate("cutaways.relevance", "every cutaway ≥ 7 (people ≥ 8) on re-score", "每个切出镜头相关度 ≥ 7（人物 ≥ 8）", true, pass, scored ? `${ok}/${scored} pass, mean ${(sum / scored).toFixed(1)}` : "not scored", "all ≥ 7 / 8", issues, { scores: scores.map((s) => ({ index: s.index, score: s.score, reason: s.reason, scoredOn: s.scoredOn })) });
}

/** ≥ 60 % of entity/person/product beats resolved to a platform/web asset that also scores. */
export function evaluateResolution(input: GradeInput, scores: CutawayScore[]): Gate {
  const beats = (input.beats ?? []).filter((b) => b.intent === "person" || b.intent === "org" || b.intent === "product");
  if (!beats.length) return gate("cutaways.resolved", "≥ 60 % of entity beats resolved to a platform/web asset", "≥ 60 % 的实体镜头来自平台/网络素材", true, null, "no entity beats supplied", "≥ 60 %", [issue(null, "sourcing", "low", "no beats supplied", "没有 beats 清单")]);
  const issues: Issue[] = [];
  let resolved = 0;
  for (const b of beats) {
    const at = b.atMs ?? null;
    const hit = at === null ? -1 : input.cutaways.findIndex((c) => c.endMs >= at - 1000 && c.startMs <= at + 4000);
    const c = hit >= 0 ? input.cutaways[hit] : null;
    const a = c && c.assetIndex != null ? input.assets[c.assetIndex] : null;
    const s = hit >= 0 ? scores.find((x) => x.index === hit) : null;
    const isWeb = a ? !STOCK_PLATFORMS.has(a.platform) : b.resolved === "platform" || b.resolved === "web";
    const relevant = !s || s.score === null || s.score >= (b.entity?.kind === "person" ? 8 : 7);
    if (a && isWeb && relevant) {
      resolved++;
      continue;
    }
    const name = b.entity?.name ?? b.id ?? "?";
    issues.push(issue(at, "sourcing", "med", `${name}: ${!a ? "no asset" : !isWeb ? `generic stock (${a.platform})` : "asset does not show it"}`, `${name}：${!a ? "没有素材" : !isWeb ? `只是通用库存（${a.platform}）` : "素材不是它"}`));
  }
  const share = resolved / beats.length;
  return gate("cutaways.resolved", "≥ 60 % of entity beats resolved to a platform/web asset", "≥ 60 % 的实体镜头来自平台/网络素材", true, share >= 0.6, `${resolved}/${beats.length} (${(share * 100).toFixed(0)} %)`, "≥ 60 %", issues);
}

/** One non-caption layer at a time (furniture and chips excepted). */
export function evaluateOverlaps(input: GradeInput): Gate {
  type Layer = { id: string; kind: string; startMs: number; endMs: number };
  const layers: Layer[] = [
    ...input.graphics.filter((g) => !g.furniture && !FURNITURE_KINDS.has(g.kind) && !OVERLAP_EXEMPT_KINDS.has(g.kind)).map((g) => ({ id: g.id, kind: g.kind, startMs: g.startMs, endMs: g.endMs })),
    ...input.cutaways.map((c, i) => ({ id: `cutaway#${i}`, kind: `cutaway:${c.layout}`, startMs: c.startMs, endMs: c.endMs })),
  ].sort((a, b) => a.startMs - b.startMs);
  const issues: Issue[] = [];
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const a = layers[i];
      const b = layers[j];
      if (b.startMs >= a.endMs) break;
      /* Clips inside one `run` are a sequence, not an overlap. */
      if (a.kind.startsWith("cutaway:run") && b.kind.startsWith("cutaway:run")) continue;
      const ms = overlapMs(a, b);
      if (ms < 120) continue;
      issues.push(issue(b.startMs, "layout", "high", `${a.kind} (${a.id}) and ${b.kind} (${b.id}) share the screen for ${(ms / 1000).toFixed(1)} s`, `${a.kind} 和 ${b.kind} 同时在画面上 ${(ms / 1000).toFixed(1)} 秒`));
    }
  }
  return gate("layout.overlaps", "one non-caption layer at a time", "同一时间只有一层非字幕元素", true, issues.length === 0, `${issues.length} overlaps`, "0", issues);
}

/** Every non-furniture graphic inside x 64–930 / y 220–1440. */
export function evaluateZones(input: GradeInput): Gate {
  const { width: W, height: H } = input;
  const issues: Issue[] = [];
  let measured = 0;
  for (const g of input.graphics) {
    if (g.furniture || FURNITURE_KINDS.has(g.kind) || !g.box) continue;
    measured++;
    const [x, y, w, h] = g.box;
    const bad: string[] = [];
    if (y < ZONES.unsafeTop * H - 2) bad.push(`top ${y} < ${Math.round(ZONES.unsafeTop * H)}`);
    if (y + h > ZONES.unsafeBottom * H + 2) bad.push(`bottom ${y + h} > ${Math.round(ZONES.unsafeBottom * H)}`);
    if (x < ZONES.unsafeLeft * W - 2) bad.push(`left ${x} < ${Math.round(ZONES.unsafeLeft * W)}`);
    if (x + w > ZONES.unsafeRight * W + 2) bad.push(`right ${x + w} > ${Math.round(ZONES.unsafeRight * W)}`);
    if (bad.length) issues.push(issue(g.startMs, "layout", "med", `${g.kind} 「${(g.text ?? "").slice(0, 20)}」 leaves the safe area: ${bad.join(", ")}`, `${g.kind}「${(g.text ?? "").slice(0, 20)}」超出安全区：${bad.join("，")}`));
  }
  const unmeasured = input.graphics.filter((g) => !g.furniture && !FURNITURE_KINDS.has(g.kind) && !g.box).length;
  return gate("layout.zones", "no text in platform UI zones", "文字不进平台 UI 区", true, measured === 0 && unmeasured > 0 ? null : issues.length === 0, `${issues.length} of ${measured} graphics outside the safe area${unmeasured ? ` (${unmeasured} unmeasured)` : ""}`, "0", issues);
}

/**
 * No text on the face: at every sampled host frame, the graphics on screen
 * and the caption must clear the detected face box by 40 px; the caption's
 * top edge must sit 40 px under the chin.
 */
export function evaluateFace(input: GradeInput, faces: FaceSample[], ass: AssFile | null): Gate {
  const { width: W, height: H } = input;
  if (!faces.length) return gate("layout.face", "no text on the face", "文字不压脸", true, null, "no face samples", "0 hits", [issue(null, "layout", "low", "face detector did not run", "人脸检测未运行")]);
  const pad = Math.round(ZONES.facePad * H);
  const chinGap = Math.round(ZONES.chinGap * H);
  const issues: Issue[] = [];
  let hits = 0;
  let checked = 0;
  let chinBad = 0;
  const eyes: number[] = [];
  for (const f of faces) {
    if (!f.box) continue;
    checked++;
    if (f.eyeY !== null) eyes.push(f.eyeY);
    const tMs = Math.round(f.t * 1000);
    const face: Box = [f.box[0] - pad, f.box[1] - pad, f.box[2] + pad * 2, f.box[3] + pad * 2];
    for (const g of input.graphics) {
      if (g.furniture || FURNITURE_KINDS.has(g.kind) || !g.box) continue;
      if (tMs < g.startMs || tMs > g.endMs) continue;
      if (intersects(g.box, face)) {
        hits++;
        issues.push(issue(tMs, "layout", "high", `${g.kind} 「${(g.text ?? "").slice(0, 20)}」 covers the face at ${f.t.toFixed(1)} s`, `${g.kind}「${(g.text ?? "").slice(0, 20)}」在 ${f.t.toFixed(1)} 秒压在脸上`));
      }
    }
    if (ass) {
      for (const e of ass.events) {
        if (tMs < e.startMs || tMs > e.endMs) continue;
        const st = ass.styles.get(e.style);
        if (!st) continue;
        const box = captionBox(e, st, W, H);
        if (intersects(box, face)) {
          hits++;
          issues.push(issue(tMs, "layout", "high", `caption 「${e.text.slice(0, 16)}」 covers the face at ${f.t.toFixed(1)} s`, `字幕「${e.text.slice(0, 16)}」在 ${f.t.toFixed(1)} 秒压在脸上`));
        } else if (f.chinY !== null && e.layer === 0 && box[1] < f.chinY * H + chinGap) {
          chinBad++;
          if (chinBad <= 5) issues.push(issue(tMs, "layout", "low", `caption top ${box[1]} is within 40 px of the chin (${Math.round(f.chinY * H)}) at ${f.t.toFixed(1)} s`, `字幕上沿离下巴不足 40 px（${f.t.toFixed(1)} 秒）`));
        }
      }
    }
  }
  const eyeIn = eyes.filter((e) => e >= 0.3 && e <= 0.38).length;
  return gate("layout.face", "no text on the face", "文字不压脸", true, hits === 0, `${hits} hits over ${checked} host frames; eye line 30–38 % in ${eyeIn}/${eyes.length}`, "0 hits", issues, { checked, hits, chinBad, eyeLine: { inBand: eyeIn, of: eyes.length, min: eyes.length ? Math.min(...eyes) : null, max: eyes.length ? Math.max(...eyes) : null } });
}

/** Visual change every 2–4 s on average, never > 5 s without one, none closer than 0.8 s. */
export function evaluateCadence(input: GradeInput, sceneChanges: number[] | null): Gate {
  const total = totalMs(input);
  type Ev = { ms: number; what: string; exempt: boolean };
  const events: Ev[] = [{ ms: 0, what: "start", exempt: true }];
  for (const b of cutBoundaries(input.cuts)) events.push({ ms: b, what: "cut", exempt: false });
  for (const c of input.cuts) if (c.push) {
    const at = toOutputMs(c.push.fromMs, input.cuts);
    if (at !== null) events.push({ ms: at, what: "push", exempt: false });
  }
  for (const c of input.cutaways) {
    events.push({ ms: c.startMs, what: `cutaway in`, exempt: false }, { ms: c.endMs, what: "cutaway out", exempt: false });
  }
  for (const g of input.graphics) {
    if (g.furniture || FURNITURE_KINDS.has(g.kind)) continue;
    const ex = CADENCE_EXEMPT_KINDS.has(g.kind);
    events.push({ ms: g.startMs, what: `${g.kind} in`, exempt: ex }, { ms: g.endMs, what: `${g.kind} out`, exempt: ex });
  }
  events.push({ ms: total, what: "end", exempt: true });
  events.sort((a, b) => a.ms - b.ms);
  const merged: Ev[] = [];
  for (const e of events) {
    const last = merged[merged.length - 1];
    if (last && e.ms - last.ms < 100) continue;
    merged.push(e);
  }
  const gaps: { from: Ev; to: Ev; ms: number }[] = [];
  for (let i = 1; i < merged.length; i++) gaps.push({ from: merged[i - 1], to: merged[i], ms: merged[i].ms - merged[i - 1].ms });
  const inner = gaps.filter((g) => g.from.what !== "start" && g.to.what !== "end");
  const mean = inner.length ? inner.reduce((a, g) => a + g.ms, 0) / inner.length : total;
  const longest = gaps.reduce((a, g) => (g.ms > a.ms ? g : a), gaps[0] ?? { from: merged[0], to: merged[0], ms: 0 });
  const tooClose = inner.filter((g) => g.ms < 800 && !g.from.exempt && !g.to.exempt);
  const tooLong = gaps.filter((g) => g.ms > 5000);
  const issues: Issue[] = [];
  for (const g of tooLong.slice(0, 40)) issues.push(issue(g.from.ms, "rhythm", g.ms > 8000 ? "high" : "med", `${(g.ms / 1000).toFixed(1)} s with no visual change after ${g.from.what}`, `${g.from.what} 之后 ${(g.ms / 1000).toFixed(1)} 秒画面没有变化`));
  for (const g of tooClose.slice(0, 20)) issues.push(issue(g.to.ms, "rhythm", "low", `${g.from.what} → ${g.to.what} only ${g.ms} ms apart`, `${g.from.what} 到 ${g.to.what} 只隔 ${g.ms} 毫秒`));
  const measured = sceneChanges ? sceneChanges.filter((t) => t > 200 && t < total - 200) : null;
  const measuredMean = measured && measured.length > 1 ? (measured[measured.length - 1] - measured[0]) / (measured.length - 1) : null;
  const pass = tooLong.length === 0 && tooClose.length === 0 && mean >= 2000 && mean <= 4000;
  return gate("rhythm.cadence", "a change every 2–4 s, never > 5 s, none < 0.8 s", "每 2–4 秒有变化，不超过 5 秒，不密于 0.8 秒", true, pass, `mean ${(mean / 1000).toFixed(2)} s, longest ${(longest.ms / 1000).toFixed(1)} s at ${fmt(longest.from.ms)}, ${tooLong.length} gaps > 5 s, ${tooClose.length} < 0.8 s; pixels: ${measured ? `${measured.length} scene changes, mean ${measuredMean === null ? "?" : (measuredMean / 1000).toFixed(2)} s` : "not measured"}`, "mean 2–4 s; max ≤ 5 s; min ≥ 0.8 s", issues, { events: merged.length, meanMs: mean, longestMs: longest.ms, measuredSceneChanges: measured?.length ?? null });
}

/**
 * Captions: one heavy CJK face at the spec size, one line of 4–12 Han
 * characters on screen ≥ 0.5 s, breaks never inside a number or a glossary
 * term, and none of the transcriber's misspellings burned in.
 */
export function evaluateCaptions(ass: AssFile | null, glossary: GradeGlossary | null | undefined, terms: string[], spec: { size: number; secondSize: number; family: RegExp }): Gate[] {
  if (!ass) {
    const none = [issue(null, "captions", "med", "no ASS file", "没有字幕文件")];
    return [
      gate("captions.splits", "no caption split inside a number or a term", "字幕不在数字或术语中间断行", true, null, "no ASS", "0", none),
      gate("captions.glossary", "no glossary misses in the captions", "字幕无术语拼错", true, null, "no ASS", "0", none),
      gate("captions.typography", "one heavy CJK face at the spec size, one line each", "一种粗黑体、规定字号、单行", false, null, "no ASS", "Black 72/36, 1 line", none),
    ];
  }
  const main = ass.events.filter((e) => e.layer === 0);
  const issues: Issue[] = [];
  let splits = 0;
  let wordSplits = 0;
  let shortMs = 0;
  let tooLong = 0;
  let tooShort = 0;
  let multiLine = 0;
  /* ICU's Chinese word dictionary, when this Node has it: a break inside
     one of its words (三大|安全 is fine; 安|全 is not) is a split too. */
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
  const insideWord = (a: string, b: string): string | null => {
    if (!segmenter) return null;
    const tail = a.slice(-6);
    const joined = tail + b.slice(0, 6);
    const cut = tail.length;
    for (const s of segmenter.segment(joined)) {
      const end = s.index + s.segment.length;
      if (s.isWordLike && s.index < cut && end > cut && hanCount(s.segment) >= 2) return s.segment;
    }
    return null;
  };
  for (let i = 0; i < main.length; i++) {
    const e = main[i];
    const next = main[i + 1];
    if (e.lines.length > 1) multiLine++;
    for (const l of e.lines) {
      const n = hanCount(l);
      if (n > 12) tooLong++;
      if (n < 4 && n > 0) tooShort++;
    }
    if (e.endMs - e.startMs < 500) shortMs++;
    /* A break inside a number: the line (or the sub-line) ends on a digit or a
       decimal point and the next begins with a digit, a point or a unit. */
    const pieces = [...e.lines, ...(next && next.startMs - e.endMs < 400 ? [next.lines[0] ?? ""] : [])];
    for (let k = 0; k + 1 < pieces.length; k++) {
      const a = pieces[k];
      const b = pieces[k + 1];
      if (!a || !b) continue;
      if (/[0-9.．]$/.test(a) && /^[0-9.．%％亿万千]/.test(b)) {
        splits++;
        issues.push(issue(e.startMs, "captions", "high", `number split across lines: 「${a.slice(-6)}|${b.slice(0, 6)}」`, `数字被断开：「${a.slice(-6)}|${b.slice(0, 6)}」`));
        continue;
      }
      const joined = normalise(a.slice(-8) + b.slice(0, 8));
      const cut = normalise(a.slice(-8)).length;
      let termHit = false;
      for (const t of terms) {
        const nt = normalise(t);
        if (nt.length < 2) continue;
        const at = joined.indexOf(nt);
        if (at !== -1 && at < cut && at + nt.length > cut) {
          splits++;
          termHit = true;
          issues.push(issue(e.startMs, "captions", "high", `term 「${t}」 split across lines: 「${a.slice(-6)}|${b.slice(0, 6)}」`, `术语「${t}」被断开：「${a.slice(-6)}|${b.slice(0, 6)}」`));
          break;
        }
      }
      if (termHit) continue;
      const word = insideWord(a, b);
      if (word) {
        wordSplits++;
        issues.push(issue(e.startMs, "captions", "med", `word 「${word}」 split across lines: 「${a.slice(-6)}|${b.slice(0, 6)}」`, `词「${word}」被断开：「${a.slice(-6)}|${b.slice(0, 6)}」`));
      }
    }
  }
  const missIssues: Issue[] = [];
  let misses = 0;
  for (const e of main) {
    for (const g of glossary ?? []) {
      for (const f of g.from) {
        if (f && e.text.includes(f)) {
          misses++;
          missIssues.push(issue(e.startMs, "captions", "high", `「${f}」 burned in (should be 「${g.to}」)`, `字幕里是「${f}」，应为「${g.to}」`));
        }
      }
    }
  }
  const style = ass.styles.get("Aura") ?? [...ass.styles.values()][0];
  const second = ass.styles.get("Second");
  const typo: Issue[] = [];
  const sizeOk = style ? Math.abs(style.size - spec.size) <= 3 : false;
  const familyOk = style ? spec.family.test(style.family) : false;
  if (style && !familyOk) typo.push(issue(null, "typography", "med", `caption face is "${style.family}" ${style.bold ? "bold" : "regular"}, not the Black face`, `字幕字体是「${style.family}」${style.bold ? "粗体" : "常规"}，不是 Black`));
  if (style && !sizeOk) typo.push(issue(null, "typography", "med", `caption size ${style.size}, spec ${spec.size}`, `字幕字号 ${style.size}，规格 ${spec.size}`));
  if (second && Math.abs(second.size - spec.secondSize) > 3) typo.push(issue(null, "typography", "low", `second line size ${second.size}, spec ${spec.secondSize}`, `英文行字号 ${second.size}，规格 ${spec.secondSize}`));
  if (multiLine) typo.push(issue(null, "typography", "med", `${multiLine} captions wrap to two lines`, `${multiLine} 条字幕折成两行`));
  if (tooLong) typo.push(issue(null, "captions", "med", `${tooLong} lines over 12 Han characters`, `${tooLong} 行超过 12 个汉字`));
  if (shortMs) typo.push(issue(null, "captions", "low", `${shortMs} captions on screen under 0.5 s`, `${shortMs} 条字幕停留不足 0.5 秒`));
  const lengths = main.flatMap((e) => e.lines.map(hanCount)).filter((n) => n > 0);
  const in6to11 = lengths.filter((n) => n >= 6 && n <= 11).length;
  return [
    gate("captions.splits", "no caption split inside a number or a term", "字幕不在数字或术语中间断行", true, splits === 0 && wordSplits === 0, `${splits} number/term splits, ${wordSplits} word splits over ${main.length} captions`, "0", issues),
    gate("captions.glossary", "no glossary misses in the captions", "字幕无术语拼错", true, misses === 0, `${misses} misses`, "0", missIssues),
    gate("captions.typography", "one heavy CJK face at the spec size, one line each", "一种粗黑体、规定字号、单行", false, familyOk && sizeOk && multiLine === 0 && tooLong === 0 && shortMs === 0, `${style?.family ?? "?"}${style?.bold ? " bold" : ""} ${style?.size ?? "?"} px, second ${second?.size ?? "-"} px; ${multiLine} two-line, ${tooLong} > 12 chars, ${tooShort} < 4 chars, ${shortMs} < 0.5 s; ${lengths.length ? ((in6to11 / lengths.length) * 100).toFixed(0) : 0} % of lines 6–11 chars`, "Black face, 72/36 px, 1 line, 4–12 chars, ≥ 0.5 s", typo, { family: style?.family, size: style?.size, secondSize: second?.size, lines: lengths.length, in6to11 }),
  ];
}

/** Loudness I −16 ±0.5, TP ≤ −1; no clicks at the cuts. */
export function evaluateSound(loud: { I: number; LRA: number; TP: number } | null, clicks: { worst: number; typical: number; over: number[] } | null, voiceChain: boolean | undefined): Gate[] {
  const li: Issue[] = [];
  let lp: boolean | null = null;
  if (loud && Number.isFinite(loud.I)) {
    lp = Math.abs(loud.I + 16) <= 0.5 && loud.TP <= -1;
    if (Math.abs(loud.I + 16) > 0.5) li.push(issue(null, "sound", "med", `integrated loudness ${loud.I} LUFS`, `响度 ${loud.I} LUFS（应 −16 ±0.5）`));
    if (loud.TP > -1) li.push(issue(null, "sound", "med", `true peak ${loud.TP} dBTP`, `真峰值 ${loud.TP} dBTP（应 ≤ −1）`));
  }
  if (voiceChain === false) li.push(issue(null, "sound", "low", "voice chain (highpass, compressor, de-esser) not applied", "未用人声链（高通、压缩、去齿音）"));
  const ci: Issue[] = (clicks?.over ?? []).map((ms) => issue(ms, "sound", "med", `click at the cut at ${fmt(ms)}`, `${fmt(ms)} 的剪点有咔哒声`));
  return [
    gate("sound.loudness", "−16 LUFS ±0.5, TP ≤ −1", "响度 −16 ±0.5，真峰值 ≤ −1", true, lp, loud ? `I ${loud.I} LUFS, LRA ${loud.LRA}, TP ${loud.TP}` : "not measured", "I −16 ±0.5; TP ≤ −1", li, loud ?? undefined),
    gate("sound.clicks", "no clicks at the cuts", "剪点无咔哒声", true, clicks ? clicks.over.length === 0 : null, clicks ? `worst delta ${clicks.worst.toFixed(3)} vs typical ${clicks.typical.toFixed(3)}; ${clicks.over.length} over` : "not measured", "0", ci),
  ];
}

/** Every used asset recorded with platform + author + url; the line on the end card; the block parses. */
export function evaluateCredits(input: GradeInput): Gate[] {
  const used = new Set<number>();
  input.cutaways.forEach((c) => {
    if (c.assetIndex != null) used.add(c.assetIndex);
  });
  const ri: Issue[] = [];
  let complete = 0;
  for (const i of used) {
    const a = input.assets[i];
    const missing = [!a?.platform && "platform", !a?.author && "author", !a?.sourceUrl && "url"].filter(Boolean);
    if (!missing.length) complete++;
    else ri.push(issue(null, "credits", "med", `asset ${a?.platform ?? "?"}:${a?.sourceId ?? i} lacks ${missing.join(", ")}`, `素材 ${a?.platform ?? "?"}:${a?.sourceId ?? i} 缺 ${missing.join("、")}`));
  }
  const unrecorded = input.cutaways.filter((c) => c.assetIndex == null).length;
  if (unrecorded) ri.push(issue(null, "credits", "high", `${unrecorded} cutaways have no asset record`, `${unrecorded} 个切出镜头没有素材记录`));
  const line = input.credits?.line?.trim() ?? "";
  const endCard = input.graphics.find((g) => g.kind === "end-card");
  const cardLine = String(endCard?.props?.creditsLine ?? "").trim();
  const li: Issue[] = [];
  if (!endCard) li.push(issue(null, "credits", "med", "no end card", "没有结尾卡"));
  else if (!cardLine && !line) li.push(issue(endCard.startMs, "credits", "high", "end card carries no 素材来源 line", "结尾卡没有「素材来源」一行"));
  else if (cardLine && line && cardLine !== line) li.push(issue(endCard.startMs, "credits", "low", "end-card line differs from director.credits.line", "结尾卡的来源行和记录不一致"));
  if (endCard && endCard.endMs - endCard.startMs > 3000) li.push(issue(endCard.startMs, "design", "low", `end card ${((endCard.endMs - endCard.startMs) / 1000).toFixed(1)} s (spec ≤ 3 s)`, `结尾卡 ${((endCard.endMs - endCard.startMs) / 1000).toFixed(1)} 秒（规格 ≤ 3 秒）`));
  if (endCard && endCard.endMs - endCard.startMs < 2000) li.push(issue(endCard.startMs, "design", "low", `end card only ${((endCard.endMs - endCard.startMs) / 1000).toFixed(1)} s`, `结尾卡只有 ${((endCard.endMs - endCard.startMs) / 1000).toFixed(1)} 秒`));
  const block = input.credits?.block?.trim() ?? "";
  const bi: Issue[] = [];
  const bullets = block.split(/\r?\n/).filter((l) => /^[-·•]\s|^\d+[.)]\s/.test(l.trim())).length;
  if (!block) bi.push(issue(null, "credits", "high", "no credits block for the publish copy", "没有发布文案用的素材来源文本"));
  else {
    if (!/素材来源|Sources/.test(block)) bi.push(issue(null, "credits", "med", "block lacks the 素材来源 / Sources heading", "文本缺「素材来源 / Sources」标题"));
    if (!/仅作评论引用|版权归原作者|联系我们删除/.test(block)) bi.push(issue(null, "credits", "med", "block lacks the takedown line", "文本缺免责/删除声明"));
    if (used.size && bullets < used.size) bi.push(issue(null, "credits", "low", `${bullets} entries for ${used.size} assets`, `${bullets} 条来源对应 ${used.size} 个素材`));
  }
  return [
    gate("credits.record", "every used asset has platform + author + url", "每个素材都记录平台、作者、链接", true, used.size === 0 && unrecorded === 0 ? null : complete === used.size && unrecorded === 0, `${complete}/${used.size} complete, ${unrecorded} unrecorded cutaways`, "all", ri),
    gate("credits.endcard", "credits line on the end card", "结尾卡有素材来源行", true, Boolean(cardLine || (line && endCard)), cardLine || line ? `「${(cardLine || line).slice(0, 60)}」` : "absent", "present", li),
    gate("credits.block", "credits block parses", "素材来源文本完整", true, Boolean(block) && bi.every((i) => i.severity === "low"), block ? `${bullets} entries, ${block.length} chars` : "absent", "heading + entries + takedown line", bi),
  ];
}

/** The hook: the brief's statement block in Zone T from 0–2.5 s, not a topic label. */
export function evaluateHook(input: GradeInput, hookBlock: string[] | undefined, firstWordMs: number | null): Gate {
  const early = input.graphics.filter((g) => !g.furniture && !FURNITURE_KINDS.has(g.kind) && g.startMs <= 2500).sort((a, b) => a.startMs - b.startMs);
  const first = early[0] ?? null;
  const issues: Issue[] = [];
  const want = (hookBlock ?? []).map((l) => normalise(l));
  const shown = first ? normalise(`${first.text ?? ""} ${first.sub ?? ""} ${JSON.stringify(first.props ?? {})}`) : "";
  const linesHit = want.filter((l) => l && shown.includes(l)).length;
  if (!first) issues.push(issue(0, "hook", "high", "no graphic in the first 2.5 s", "开头 2.5 秒没有任何图形"));
  else if (want.length && linesHit < want.length) issues.push(issue(first.startMs, "hook", "high", `first graphic is a ${first.kind} 「${(first.text ?? "").slice(0, 24)}」, not the brief's block (${linesHit}/${want.length} lines)`, `开场是 ${first.kind}「${(first.text ?? "").slice(0, 24)}」，不是简报的论断块（${linesHit}/${want.length} 行）`));
  if (first && first.kind !== "hook" && first.kind !== "statement") issues.push(issue(first.startMs, "hook", "med", `hook kind is '${first.kind}'`, `开场图形类型是「${first.kind}」`));
  if (firstWordMs !== null && firstWordMs > 300) issues.push(issue(0, "hook", "med", `first word at ${firstWordMs} ms`, `第一个字在 ${firstWordMs} 毫秒`));
  const pass = Boolean(first) && (!want.length || linesHit === want.length) && (firstWordMs === null || firstWordMs <= 300);
  return gate("design.hook", "the brief's block at 0–2.5 s; first word ≤ 0.3 s", "开场是简报论断块；第一个字 ≤ 0.3 秒", true, pass, first ? `${first.kind} at ${first.startMs} ms 「${(first.text ?? "").slice(0, 30)}」; block lines ${linesHit}/${want.length}; first word ${firstWordMs ?? "?"} ms` : "no early graphic", "hook block; ≤ 0.3 s", issues);
}

/** The lower third: a card or chip at 2–6 s, and a card where the name is said. */
export function evaluateLowerThird(input: GradeInput, outputWords: Word[] | null, anchors: GradeAnchors | null | undefined, glossary: GradeGlossary | null | undefined): Gate {
  const lowers = input.graphics.filter((g) => g.kind === "lower-third" || g.kind === "chip");
  const early = lowers.find((g) => g.startMs >= 1500 && g.startMs <= 6500);
  const issues: Issue[] = [];
  if (!early) issues.push(issue(2000, "design", "med", "no lower third or name chip at 2–6 s", "2–6 秒没有下方名条或名字标识"));
  let saidAt: number | null = null;
  const name = anchors?.lowerThird?.name;
  if (outputWords && name) {
    saidAt = firstWordAt(outputWords, normalise(`我是${name}`, glossary), glossary) ?? firstWordAt(outputWords, normalise(name, glossary), glossary);
  }
  let atName: GradeGraphic | null = null;
  if (saidAt !== null) {
    atName = lowers.find((g) => g.kind === "lower-third" && Math.abs(g.startMs - saidAt!) <= 2500) ?? null;
    if (!atName) issues.push(issue(saidAt, "design", "med", `she says her name at ${fmt(saidAt)} with no lower third there`, `${fmt(saidAt)} 说出名字，那里没有名条`));
  }
  const stray = lowers.filter((g) => g !== early && g !== atName);
  for (const g of stray) issues.push(issue(g.startMs, "design", "low", `${g.kind} at ${fmt(g.startMs)} is neither at 2–6 s nor where the name is said`, `${g.kind} 在 ${fmt(g.startMs)}，既不在 2–6 秒也不在说名字处`));
  return gate("design.lowerThird", "lower third at 2–6 s (and where the name is said)", "名条在 2–6 秒（及说名字处）", false, Boolean(early) && (saidAt === null || Boolean(atName)), `${lowers.length} lower-third/chip rows: ${lowers.map((g) => `${g.kind}@${fmt(g.startMs)}`).join(", ") || "none"}; name said at ${saidAt === null ? "?" : fmt(saidAt)}`, "one at 2–6 s", issues);
}

/** Zero duplicate stats; every stat's digits spoken within ±1.5 s of its window. */
export function evaluateStats(input: GradeInput, outputWords: Word[] | null): Gate {
  const stats = input.graphics.filter((g) => ["stat", "counter", "compare"].includes(g.kind));
  const issues: Issue[] = [];
  const seen = new Map<string, GradeGraphic>();
  let dupes = 0;
  let unspoken = 0;
  for (const g of stats) {
    const sig = digitSignature(`${g.text ?? ""} ${g.sub ?? ""} ${JSON.stringify(g.props ?? {})}`);
    if (sig) {
      const prev = seen.get(sig);
      if (prev) {
        dupes++;
        issues.push(issue(g.startMs, "design", "high", `stat 「${(g.text ?? "").slice(0, 20)}」 repeats the figure shown at ${fmt(prev.startMs)}`, `数据卡「${(g.text ?? "").slice(0, 20)}」重复了 ${fmt(prev.startMs)} 的数字`));
      } else seen.set(sig, g);
    }
    if (outputWords && sig) {
      const heard = wordsIn(outputWords, g.startMs - 1500, g.endMs + 1500);
      const heardAscii = numberTokens(heard).filter((t) => /^[0-9]/.test(t));
      /* An ASCII figure must be heard as that figure; a Chinese-numeral run (几千万, 十几) as a substring. */
      const spoken = numberTokens(`${g.text ?? ""} ${g.sub ?? ""}`).some((t) => (/^[0-9]/.test(t) ? heardAscii.includes(t) : heard.includes(t)));
      if (!spoken) {
        unspoken++;
        issues.push(issue(g.startMs, "design", "high", `stat 「${(g.text ?? "").slice(0, 20)}」 is not spoken within ±1.5 s (heard: 「${wordsIn(outputWords, g.startMs - 1500, g.endMs + 1500).slice(0, 30)}」)`, `数据卡「${(g.text ?? "").slice(0, 20)}」出现时 ±1.5 秒内没有说到这个数`));
      }
    }
  }
  return gate("design.stats", "no duplicate stat; every stat spoken within ±1.5 s", "数据卡不重复、出现时正在说这个数", true, dupes === 0 && unspoken === 0, `${stats.length} stats; ${dupes} duplicates; ${unspoken} not spoken`, "0 / 0", issues);
}

/** The §1 expected shot list for the clip, matched by text against the graphics and by mention against the cutaways. */
export function evaluateShotList(input: GradeInput, anchors: GradeAnchors | null | undefined, scores: CutawayScore[]): Gate {
  if (!anchors) return gate("design.shotlist", "the expected shot list is present", "预期镜头清单齐全", false, null, "no anchors", "≥ 80 %", []);
  const texts = input.graphics.map((g) => ({ g, n: normalise(`${g.text ?? ""} ${g.sub ?? ""} ${JSON.stringify(g.props ?? {})}`) }));
  const has = (kinds: string[], needle: string) => texts.some((t) => kinds.includes(t.g.kind) && t.n.includes(normalise(needle)));
  const rows: { item: string; present: boolean }[] = [];
  for (const n of anchors.numbers ?? []) rows.push({ item: `counter ${n.text}`, present: has(["stat", "counter", "compare"], n.value ?? n.text) || has(["stat", "counter", "compare"], n.text) });
  for (const t of anchors.terms ?? []) rows.push({ item: `term ${t.term}`, present: has(["term", "card", "statement", "diagram"], t.term) });
  rows.push({ item: "diagram", present: input.graphics.some((g) => g.kind === "diagram") });
  rows.push({ item: "list", present: input.graphics.some((g) => g.kind === "list") });
  const chapters = input.graphics.filter((g) => g.kind === "stinger" || g.kind === "chapter").length;
  rows.push({ item: `chapters 4–6 (${chapters})`, present: chapters >= 4 && chapters <= 6 });
  for (const e of anchors.entities ?? []) {
    const at = e.mentions?.[0]?.startMs;
    const out = at === undefined ? null : toOutputMs(at, input.cuts);
    const idx = out === null ? -1 : input.cutaways.findIndex((c) => c.endMs >= out - 1000 && c.startMs <= out + 4000);
    const s = idx >= 0 ? scores.find((x) => x.index === idx) : null;
    const card = has(["entity", "chip"], e.name) || (e.romanised ? has(["entity", "chip"], e.romanised) : false);
    rows.push({ item: `entity ${e.name}`, present: card || (idx >= 0 && (!s || s.score === null || s.score >= 7)) });
  }
  rows.push({ item: "lower third", present: input.graphics.some((g) => g.kind === "lower-third") });
  rows.push({ item: "end card with the question", present: input.graphics.some((g) => g.kind === "end-card" && normalise(`${g.text ?? ""} ${g.sub ?? ""} ${JSON.stringify(g.props ?? {})}`).includes(normalise(anchors.endCard?.question ?? "").slice(0, 6))) });
  const present = rows.filter((r) => r.present).length;
  const share = rows.length ? present / rows.length : 0;
  const issues = rows.filter((r) => !r.present).map((r) => issue(null, "design", "low", `missing: ${r.item}`, `缺：${r.item}`));
  return gate("design.shotlist", "the expected shot list is present", "预期镜头清单齐全", false, share >= 0.8, `${present}/${rows.length} (${(share * 100).toFixed(0)} %)`, "≥ 80 %", issues, { rows });
}

/** Render ≤ 6 min (ceiling 15), director ≤ 5 min, spend ≤ $0.35. */
export function evaluateBudgets(input: GradeInput): Gate[] {
  const t = input.timings ?? {};
  const renderMs = t.renderMs ?? t.encodeMs ?? null;
  const directorMs = t.directorMs ?? null;
  const usd = input.spend?.usd ?? null;
  return [
    gate("time.render", "render ≤ 6 min", "渲染 ≤ 6 分钟", true, renderMs === null ? null : renderMs <= 6 * 60_000, renderMs === null ? "unknown" : `${(renderMs / 1000).toFixed(0)} s`, "≤ 360 s (ceiling 900)", renderMs !== null && renderMs > 6 * 60_000 ? [issue(null, "time", renderMs > 15 * 60_000 ? "high" : "med", `render took ${(renderMs / 1000).toFixed(0)} s`, `渲染用了 ${(renderMs / 1000).toFixed(0)} 秒`)] : []),
    gate("time.director", "director ≤ 5 min before render", "导演流程 ≤ 5 分钟", false, directorMs === null ? null : directorMs <= 5 * 60_000, directorMs === null ? "unknown" : `${(directorMs / 1000).toFixed(0)} s`, "≤ 300 s", []),
    gate("cost.spend", "paid spend ≤ $0.35", "付费调用 ≤ $0.35", true, usd === null ? null : usd <= 0.35, usd === null ? "unknown" : `$${usd.toFixed(3)}${input.spend?.tikhubRequests !== undefined ? `, TikHub ${input.spend.tikhubRequests} req` : ""}`, "≤ $0.35", usd !== null && usd > 0.35 ? [issue(null, "cost", "med", `spend $${usd.toFixed(3)}`, `花费 $${usd.toFixed(3)}`)] : []),
  ];
}

/** W6's lint, when the lab ran it: zero violations. */
export function evaluateLint(input: GradeInput): Gate {
  if (!input.lint) return gate("design.lint", "lintPlan: zero violations", "布局 lint 零违规", false, null, "not run", "0", []);
  return gate("design.lint", "lintPlan: zero violations", "布局 lint 零违规", false, input.lint.length === 0, `${input.lint.length} violations`, "0", input.lint.map((l) => issue(l.atMs ?? null, "lint", "med", `${l.rule}: ${l.textZh}`, l.textZh)));
}

/* ==================================================== checklist score */

export type ChecklistItem = { n: number; item: string; itemZh: string; score: 0 | 1 | 2 | null; why: string };

/**
 * A machine's first pass at the plan's 12-item checklist (§3), 0/1/2 each,
 * from the gates alone. Item 10 (motion) needs eyes on the strips and is
 * left null; the lead's own scoring is the one that counts. The rules are
 * conservative: a 2 needs every related gate green.
 */
export function autoChecklist(gates: Gate[]): ChecklistItem[] {
  const g = (id: string) => gates.find((x) => x.id === id);
  const passed = (id: string) => g(id)?.pass === true;
  const issuesOf = (id: string) => g(id)?.issues.length ?? 0;
  const items: ChecklistItem[] = [];
  const push = (n: number, item: string, itemZh: string, score: 0 | 1 | 2 | null, why: string) => items.push({ n, item, itemZh, score, why });

  push(1, "Hook", "开场", passed("design.hook") ? 2 : g("design.hook")?.pass === null ? null : issuesOf("design.hook") <= 1 ? 1 : 0, g("design.hook")?.value ?? "");
  const cleanFails = ["cut.retakes", "cut.boundaries", "cut.pauses"].filter((id) => g(id)?.pass === false).length;
  push(2, "Clean cut", "干净剪辑", ["cut.retakes", "cut.boundaries", "cut.pauses"].some((id) => g(id)?.pass === null) ? null : cleanFails === 0 ? 2 : cleanFails === 1 && issuesOf("cut.pauses") <= 3 ? 1 : 0, `${g("cut.retakes")?.value}; ${g("cut.boundaries")?.value}; ${g("cut.pauses")?.value}`);
  const anchorsGate = g("cut.anchors");
  const missing = ((anchorsGate?.detail?.rows as { count: number }[] | undefined) ?? []).filter((r) => r.count === 0).length;
  push(3, "Nothing lost", "内容不丢", anchorsGate?.pass === null ? null : anchorsGate?.pass && g("cut.report")?.pass !== false ? 2 : missing <= 1 ? 1 : 0, `${anchorsGate?.value}; ${g("cut.report")?.value}`);
  const rel = g("cutaways.relevance");
  const relScores = ((rel?.detail?.scores as { score: number | null }[] | undefined) ?? []).filter((s) => s.score !== null) as { score: number }[];
  const relOk = relScores.filter((s) => s.score >= 7).length;
  const relMean = relScores.length ? relScores.reduce((a, s) => a + s.score, 0) / relScores.length : 0;
  push(4, "Relevance", "相关", rel?.pass === null ? null : rel?.pass && relMean >= 8 ? 2 : relScores.length && relOk / relScores.length >= 0.8 ? 1 : 0, rel?.value ?? "");
  const uniq = g("cutaways.unique");
  push(5, "Variety", "不重复", uniq?.pass === null ? null : uniq?.pass && passed("cutaways.mix") && passed("design.stats") ? 2 : uniq?.pass ? 1 : 0, `${uniq?.value}; ${g("cutaways.mix")?.value}`);
  const cad = g("rhythm.cadence");
  const meanMs = Number(cad?.detail?.meanMs ?? 0);
  const longest = Number(cad?.detail?.longestMs ?? 0);
  push(6, "Rhythm", "节奏", cad?.pass === null ? null : cad?.pass && passed("cutaways.coverage") ? 2 : longest <= 6000 && meanMs >= 1500 && meanMs <= 5000 ? 1 : 0, `${cad?.value}; ${g("cutaways.coverage")?.value}`);
  const shot = g("design.shotlist");
  const rows = (shot?.detail?.rows as { item: string; present: boolean }[] | undefined) ?? [];
  const core = ["diagram", "list"].every((k) => rows.find((r) => r.item === k)?.present) && rows.some((r) => r.item.startsWith("counter") && r.present);
  push(7, "Clarity", "清晰", shot?.pass === null ? null : shot?.pass && core ? 2 : rows.length && rows.filter((r) => r.present).length / rows.length >= 0.5 ? 1 : 0, shot?.value ?? "");
  const layoutFails = ["layout.overlaps", "layout.zones", "layout.face", "cutaways.layout"].filter((id) => g(id)?.pass === false).length;
  const layoutIssues = ["layout.overlaps", "layout.zones", "layout.face", "cutaways.layout"].reduce((a, id) => a + issuesOf(id), 0);
  push(8, "Layout", "版式", ["layout.overlaps", "layout.zones", "layout.face"].every((id) => g(id)?.pass === null) ? null : layoutFails === 0 ? 2 : layoutIssues <= 2 ? 1 : 0, `${g("layout.overlaps")?.value}; ${g("layout.zones")?.value}; ${g("layout.face")?.value}`);
  const typoFails = ["captions.typography", "captions.glossary", "captions.splits"].filter((id) => g(id)?.pass === false).length;
  push(9, "Typography", "字体", g("captions.typography")?.pass === null ? null : typoFails === 0 ? 2 : typoFails === 1 ? 1 : 0, `${g("captions.typography")?.value}; glossary ${g("captions.glossary")?.value}; splits ${g("captions.splits")?.value}`);
  push(10, "Motion", "动效", null, "needs eyes on the motion strips");
  const loudOk = passed("sound.loudness");
  push(11, "Look and sound", "画面与声音", g("sound.loudness")?.pass === null ? null : loudOk && passed("sound.clicks") && issuesOf("sound.loudness") === 0 ? 2 : loudOk ? 1 : 0, `${g("sound.loudness")?.value}; ${g("sound.clicks")?.value}`);
  const creditsOk = ["credits.record", "credits.endcard", "credits.block"].every((id) => passed(id));
  const cringe = gates.flatMap((x) => x.issues).filter((i) => i.area === "cringe" || /known v1 mispick/.test(i.text)).length;
  push(12, "Not cringe, and credited", "不尬、有致谢", ["credits.record", "credits.endcard", "credits.block"].every((id) => g(id)?.pass === null) ? null : creditsOk && cringe === 0 ? 2 : creditsOk ? 1 : 0, `credits ${creditsOk ? "complete" : "incomplete"}; ${cringe} cringe/banned flags`);
  return items;
}
