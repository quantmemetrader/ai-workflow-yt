/**
 * Grade a rendered reel against the plan's hard gates and checklist.
 *
 *   cd /home/ubuntu/wt/dv2-W7 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/grade.ts --input <run>/grade-input.json --out /tmp/dv2_lab/W7/rNN \
 *       [--gold /tmp/dv2_lab/fixture/zhengliu.gold.json] [--prev /tmp/dv2_lab/W7/rMM/report.json] \
 *       [--skip whisper,face,vision,frames,scene] [--max-frames 150] [--concurrency 8] [--label rNN]
 *
 *   # the v1 baseline, straight from the fixture and W5's `renderTimeline` output:
 *     scripts/dv2/grade.ts --v1 --fixture /tmp/dv2_lab/fixture/zhengliu.json --mp4 /tmp/dv2_lab/W5/a_v1.mp4 \
 *       --stills /tmp/dv2_lab/W5/a --plan /tmp/dv2_lab/W5/a_plan.json --assets /tmp/dv2_lab/W5/assets \
 *       --ass /tmp/dv2_lab/W5/captions.ass --out /tmp/dv2_lab/W7/r00
 *
 * What a run does, in order:
 *
 *   1. Loads or builds the `GradeInput` (see `metrics.ts`): the cut, the
 *      cutaways with their asset records, the graphics with their boxes,
 *      the captions, the credits, the brief's anchors and glossary from the
 *      gold file. The v1 adapter parses the fixture's credit strings for
 *      provider ids and authors and measures each still's box from the PNG
 *      the compositor actually laid over the picture.
 *   2. Measures, in parallel: the local whisper on the output (with the
 *      brief's names as hotwords), silences, loudness, scene changes, the
 *      frames for the sheets and the vision check, the face at every host
 *      moment, and one representative frame per cutaway (from the asset
 *      itself when it is on this box, so a 34 % window does not hide what
 *      was chosen) with its dHash and source size.
 *   3. Asks the vision model twice: `scoreCandidates` on every cutaway's
 *      frame against the line said under it (the independent relevance
 *      re-score), and `checkFrame` on up to 150 sampled frames, eight at a
 *      time. About a cent per run; no ledger row is written.
 *   4. Evaluates every gate, scores the checklist, writes `report.json`,
 *      `report.txt`, `input.json` and the sheet/strip paths, and diffs the
 *      gates against the previous run when one is given or found beside
 *      this one.
 *
 * Nothing here touches the database or R2; every path written is under
 * `--out` (plus a silences cache for the raw take beside the run dirs).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VISION, checkFrame, scoreCandidates, visionSpend, type CheckResult } from "../../lib/video/vision";
import type { Silence, Word } from "../../lib/video/v2/types";
import { pmap, sampleFrames, type FrameSet } from "./frames";
import {
  alphaBox,
  autoChecklist,
  clickCheck,
  cutBoundaries,
  dhash,
  evaluateAnchors,
  evaluateBoundaries,
  evaluateBudgets,
  evaluateCadence,
  evaluateCaptions,
  evaluateCoverage,
  evaluateCredits,
  evaluateCutReport,
  evaluateFace,
  evaluateHook,
  evaluateLayouts,
  evaluateLint,
  evaluateLowerThird,
  evaluateMix,
  evaluateOverlaps,
  evaluateRelevance,
  evaluateResolution,
  evaluateRetakes,
  evaluateShotList,
  evaluateStats,
  evaluateUniqueness,
  evaluateZones,
  evaluatePauses,
  evaluateSound,
  greyThumb,
  measureFaces,
  measureLoudness,
  measureSceneChanges,
  measureSilences,
  parseAss,
  parseCredit,
  pcmOf,
  probeSize,
  readJson,
  toOutputMs,
  totalMs,
  transcribeOutput,
  wordsIn,
  type ChecklistItem,
  type CutawayScore,
  type FaceSample,
  type Gate,
  type GradeAnchors,
  type GradeAsset,
  type GradeBeat,
  type GradeCutaway,
  type GradeGlossary,
  type GradeGraphic,
  type GradeInput,
  type GoldRetake,
  type Issue,
  pausesFromPcm,
} from "./metrics";

const run = promisify(execFile);

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const arg = (name: string, fallback = ""): string => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(name);

const OUT = arg("--out", "/tmp/dv2_lab/W7/r00");
const LABEL = arg("--label", path.basename(OUT));
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");
const PREV = arg("--prev", "");
const SKIP = new Set(arg("--skip", "").split(",").filter(Boolean));
const MAX_FRAMES = Number(arg("--max-frames", "150")) || 150;
const CONCURRENCY = Number(arg("--concurrency", "8")) || 8;
const FACE_PYTHON = process.env.FACE_PYTHON || "/home/ubuntu/.venvs/dv2face/bin/python";
const FACE_SCRIPT = arg("--face-script", process.env.FACE_SCRIPT || "");
const CACHE = arg("--cache", path.join(path.dirname(OUT), "cache"));

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;

/* --------------------------------------------------------------- fixture */

type Fixture = {
  project: { title: string; accent: string; captionPreset: string };
  brief: string;
  source: { path: string; clipId: string; durationMs: number };
  clips: { id: string; label: string; durationMs: number | null; file: { name: string; storageKey: string; mime: string } }[];
  timeline: { ord: number; clipId: string; kind: string; inMs: number; outMs: number | null }[];
  captions: Record<string, { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[] | null }[]>;
  graphics: {
    id: string; kind: string; text: string; sub: string | null; startMs: number; endMs: number; fileId: string | null; placement: string | null; scale: number | null;
    options: Record<string, unknown>; file: { name: string; mime: string; storageKey: string } | null;
  }[];
  sourceWords: { words: { text: string; start: number; end: number }[] };
};

type Gold = { anchors?: GradeAnchors; glossary?: { mustFix?: { from_: string[]; to: string }[] }; retakes?: GoldRetake[] };

/**
 * Spellings whisper gives the brief's terms on the *output* re-transcription
 * that the gold's glossary (written against the raw take) does not list.
 * Only for matching anchors in the transcript; the caption glossary gate
 * still uses the gold's list alone.
 */
const TRANSCRIPT_GLOSSARY: GradeGlossary = [{ from: ["蒸瘤"], to: "蒸馏" }];

/** W5's naming for a fetched storage key. */
const assetPath = (dir: string, key: string) => path.join(dir, key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120));

/**
 * The v1 baseline as a `GradeInput`, from the fixture rows the v1 director
 * wrote and the files W5's renderer used. Stills are matched to the
 * compositor's `graphic-<i>.png` through the plan it wrote (kind, start,
 * end), so the boxes are the ones on the picture.
 */
async function inputFromFixtureV1(fixture: Fixture, gold: Gold | null, opts: { mp4: string; stills: string; plan: string; assets: string; ass: string }): Promise<GradeInput> {
  const raw = fixture.source.path;
  const cuts = fixture.timeline
    .filter((t) => t.kind === "clip" && t.clipId === fixture.source.clipId)
    .sort((a, b) => a.ord - b.ord)
    .map((t) => ({ file: raw, inMs: t.inMs, outMs: t.outMs ?? fixture.source.durationMs }));

  const plan = opts.plan ? await readJson<{ stills: { kind: string; startMs: number; endMs: number; text: string }[] }>(opts.plan) : null;
  const stillFile = (g: { kind: string; startMs: number; endMs: number }): string | null => {
    if (!plan || !opts.stills) return null;
    const i = plan.stills.findIndex((s) => s.kind === g.kind && s.startMs === g.startMs && s.endMs === g.endMs);
    return i >= 0 ? path.join(opts.stills, `graphic-${i}.png`) : null;
  };

  const assets: GradeAsset[] = [];
  const assetIndex = (credit: string, title: string, file: string | null, kind: GradeAsset["kind"]): number => {
    const parsed = parseCredit(credit, title);
    const key = `${parsed.platform}:${parsed.sourceId}`;
    const found = assets.findIndex((a) => `${a.platform}:${a.sourceId}` === key);
    if (found >= 0) return found;
    assets.push({ ...parsed, file, kind });
    return assets.length - 1;
  };

  const entityBeats: GradeBeat[] = [];
  for (const e of gold?.anchors?.entities ?? []) {
    const at = e.mentions?.[0]?.startMs;
    const out = at === undefined ? null : toOutputMs(at, cuts);
    const kind = (e.kind ?? "company") as NonNullable<GradeBeat["entity"]>["kind"];
    entityBeats.push({ id: e.name, intent: kind === "person" ? "person" : kind === "product" ? "product" : "org", atMs: out ?? undefined, entity: { name: e.name, romanised: e.romanised, kind } });
  }
  const beatFor = (startMs: number, endMs: number): GradeBeat | null => entityBeats.find((b) => b.atMs !== undefined && b.atMs >= startMs - 1500 && b.atMs <= endMs + 500) ?? null;

  const graphics: GradeGraphic[] = [];
  const cutaways: GradeCutaway[] = [];
  for (const g of [...fixture.graphics].sort((a, b) => a.startMs - b.startMs)) {
    if (g.endMs <= g.startMs || g.kind === "punch") continue;
    if (g.kind === "broll") {
      const clip = fixture.clips.find((c) => c.id === String(g.options.clipId ?? ""));
      const file = clip ? assetPath(opts.assets, clip.file.storageKey) : null;
      const sourceInMs = Math.max(0, Number(g.options.sourceInMs ?? 0) || 0);
      const available = clip?.durationMs ? clip.durationMs - sourceInMs : null;
      const length = available === null ? g.endMs - g.startMs : Math.min(g.endMs - g.startMs, available);
      cutaways.push({
        startMs: g.startMs, endMs: g.startMs + length, layout: g.placement || "full", still: false, file: file && (await exists(file)) ? file : null, sourceInMs,
        assetIndex: assetIndex(String(g.options.credit ?? ""), g.text, file, "video"), beat: beatFor(g.startMs, g.startMs + length),
      });
      continue;
    }
    if (g.kind === "image") {
      const file = g.file ? assetPath(opts.assets, g.file.storageKey) : null;
      const still = stillFile(g);
      cutaways.push({
        startMs: g.startMs, endMs: g.endMs, layout: g.placement || "center", still: true, file: file && (await exists(file)) ? file : null, sourceInMs: 0,
        assetIndex: assetIndex(String(g.options.credit ?? ""), g.file?.name ?? "", file, "image"), beat: beatFor(g.startMs, g.endMs),
        box: still && (await exists(still)) ? await alphaBox(still, 1080, 1920) : null,
      });
      continue;
    }
    const furniture = ["header", "watermark", "footnote"].includes(g.kind);
    graphics.push({ id: g.id, kind: g.kind, startMs: g.startMs, endMs: g.endMs, text: g.text, sub: g.sub, furniture, file: stillFile(g), props: { placement: g.placement, scale: g.scale, ...g.options } });
  }

  const glossary: GradeGlossary = (gold?.glossary?.mustFix ?? []).map((m) => ({ from: m.from_, to: m.to }));
  const zh = fixture.captions["zh-CN"] ?? [];
  return {
    label: LABEL,
    mp4: opts.mp4,
    width: 1080,
    height: 1920,
    fps: 30,
    cuts,
    cutaways,
    graphics,
    captions: zh.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words })),
    assFile: opts.ass || null,
    assets,
    credits: { line: null, block: null },
    beats: entityBeats,
    cutReport: null,
    sourceWords: fixture.sourceWords.words.map((w) => ({ text: w.text, startMs: Math.round(w.start * 1000), endMs: Math.round(Math.max(w.start, w.end) * 1000) })),
    sourceSilences: null,
    glossary,
    anchors: gold?.anchors ?? null,
    goldRetakes: gold?.retakes ?? null,
    timings: null,
    spend: null,
    lint: null,
    audio: { voiceChain: false },
  };
}

/* ------------------------------------------------------------ measuring */

async function cached<T>(file: string, compute: () => Promise<T>): Promise<T> {
  const hit = await readJson<T>(file);
  if (hit) return hit;
  const v = await compute();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(v), "utf8");
  return v;
}

async function fileKey(file: string): Promise<string> {
  const s = await stat(file);
  return createHash("sha1").update(`${path.resolve(file)}|${s.size}|${Math.round(s.mtimeMs)}`).digest("hex").slice(0, 12);
}

/** One representative frame per cutaway, from the asset when it is here, else from the render; plus its dHash and source size. */
async function cutawayFrames(input: GradeInput, dir: string): Promise<{ index: number; frame: string | null; scoredOn: "asset" | "frame" | "none"; dhash: string | null; source: { width: number; height: number } | null }[]> {
  await mkdir(dir, { recursive: true });
  return pmap(input.cutaways, 6, async (c, i) => {
    const frame = path.join(dir, `c${String(i).padStart(2, "0")}.jpg`);
    let scoredOn: "asset" | "frame" | "none" = "none";
    let source: { width: number; height: number } | null = null;
    let thumb: Uint8Array | null = null;
    if (c.file && (await exists(c.file))) {
      const size = await probeSize(c.file);
      if (size) source = { width: size.width, height: size.height };
      const tS = c.still ? null : ((c.sourceInMs ?? 0) + (c.endMs - c.startMs) / 2) / 1000;
      const ok = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...(tS !== null ? ["-ss", tS.toFixed(3)] : []), "-i", c.file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "3", frame], { timeout: 60_000 }).then(() => true, () => false);
      if (ok) {
        scoredOn = "asset";
        thumb = await greyThumb(c.file, tS);
      }
    }
    if (scoredOn === "none") {
      const tS = (c.startMs + c.endMs) / 2000;
      const ok = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", tS.toFixed(3), "-i", input.mp4, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", frame], { timeout: 60_000 }).then(() => true, () => false);
      if (ok) {
        scoredOn = "frame";
        thumb = await greyThumb(input.mp4, tS);
      }
    }
    return { index: i, frame: scoredOn === "none" ? null : frame, scoredOn, dhash: thumb ? dhash(thumb) : null, source };
  });
}

/** Host-visible moments: every two seconds, clear of any cutaway by 300 ms. */
function hostTimes(input: GradeInput): number[] {
  const total = totalMs(input);
  const out: number[] = [];
  for (let t = 1000; t < total - 1000; t += 2000) {
    const busy = input.cutaways.some((c) => t > c.startMs - 300 && t < c.endMs + 300 && (c.layout === "full" || c.layout === "split" || c.layout === "run" || c.layout === "pip"));
    if (!busy) out.push(t / 1000);
  }
  return out;
}

/* --------------------------------------------------------------- vision */

async function scoreCutaways(input: GradeInput, frames: Awaited<ReturnType<typeof cutawayFrames>>, words: Word[] | null, context: string): Promise<CutawayScore[]> {
  return pmap(frames, 4, async (f) => {
    const c = input.cutaways[f.index];
    const line = (words ? wordsIn(words, c.startMs - 300, c.endMs + 300) : "") || input.captions.filter((x) => x.endMs >= c.startMs && x.startMs <= c.endMs).map((x) => x.text).join("") || "(no words)";
    const before = input.captions.filter((x) => x.endMs <= c.startMs).at(-1)?.text ?? "";
    const after = input.captions.find((x) => x.startMs >= c.endMs)?.text ?? "";
    const entity = c.beat?.entity ? { name: c.beat.entity.name, romanised: c.beat.entity.romanised, descriptorZh: c.beat.entity.descriptorZh } : undefined;
    const needsPerson = c.beat?.entity?.kind === "person";
    const base = { index: f.index, line, dhash: f.dhash, source: f.source, needsPerson };
    if (!f.frame || SKIP.has("vision")) return { ...base, score: null, reason: SKIP.has("vision") ? "vision skipped" : "no frame", scoredOn: "none" as const };
    try {
      const r = await scoreCandidates(line, `${context}\nBefore: ${before}\nAfter: ${after}`, [f.frame], { entity, must: c.beat?.must ?? undefined, mustNot: c.beat?.mustNot ?? undefined });
      const s = r.scores[0];
      return { ...base, score: s?.score ?? 0, reason: s?.reason ?? r.raw.slice(0, 80), scoredOn: f.scoredOn };
    } catch (err) {
      return { ...base, score: null, reason: `vision failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120), scoredOn: f.scoredOn };
    }
  });
}

type FrameCheck = { index: number; tMs: number; why: string; file: string; ok: boolean | null; issues: CheckResult["issues"]; read: string; error?: string };

async function checkFrames(frames: FrameSet["frames"]): Promise<FrameCheck[]> {
  return pmap(frames, CONCURRENCY, async (f) => {
    try {
      const r = await checkFrame(f.file);
      return { index: f.index, tMs: f.tMs, why: f.why, file: f.file, ok: r.ok, issues: r.issues, read: r.captionTextRead };
    } catch (err) {
      return { index: f.index, tMs: f.tMs, why: f.why, file: f.file, ok: null, issues: [], read: "", error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** The brief's furniture: a faint grey footnote and a watermark are by design, and the model reads them as unreadable text. */
const FURNITURE_FINDING = /disclaimer|footnote|watermark|注[:：]|仅作为观点|投资建议|腾亚创变/i;

/**
 * The frame check as a gate: ok on ≥ 97 %, zero high-severity findings.
 * Face findings are advisory (Stage 0 found a false positive; the face
 * gate is decided by the detector's boxes), and a low-contrast finding
 * about the footnote or the watermark is the brief's own choice, demoted
 * to low. A frame whose only findings are advisory counts as ok.
 */
function evaluateFrameCheck(checks: FrameCheck[]): Gate {
  const answered = checks.filter((c) => c.ok !== null);
  const advisory = (i: CheckResult["issues"][number]) => i.type === "face_occluded" || (i.type === "low_contrast" && FURNITURE_FINDING.test(i.detail));
  const ok = answered.filter((c) => c.ok || c.issues.every(advisory)).length;
  const high = answered.flatMap((c) => c.issues.filter((i) => i.severity === "high" && !advisory(i)).map((i) => ({ c, i })));
  const faceFlags = answered.filter((c) => c.issues.some((i) => i.type === "face_occluded")).length;
  const issues: Issue[] = [];
  for (const c of answered) {
    for (const i of c.issues) {
      if (advisory(i) && i.severity !== "high") continue;
      issues.push({ atMs: c.tMs, area: "frames", severity: advisory(i) ? "low" : i.severity, text: `${i.type} (${i.severity}): ${i.detail} [${c.why}]`, textZh: `${i.type}（${i.severity}）：${i.detail}` });
    }
  }
  const share = answered.length ? ok / answered.length : 0;
  return {
    id: "frames.check", name: "checkFrame ok on ≥ 97 % of frames, 0 high", nameZh: "视觉复核 ≥ 97 % 通过、无高严重度", hard: false,
    pass: answered.length === 0 ? null : share >= 0.97 && high.length === 0,
    value: `${ok}/${answered.length} ok (${(share * 100).toFixed(1)} %), ${high.length} high, ${faceFlags} face flags (advisory), ${checks.length - answered.length} unanswered`,
    threshold: "≥ 97 %; 0 high", issues, detail: { answered: answered.length, ok, high: high.length, faceFlags },
  };
}

/* --------------------------------------------------------------- report */

type Report = {
  label: string;
  at: string;
  mp4: string;
  durationMs: number;
  hard: { passed: number; failed: number; undecided: number; total: number; failedIds: string[] };
  checklist: { items: ChecklistItem[]; score: number; max: number };
  gates: Gate[];
  issues: Issue[];
  frames: { sheets: string[]; strips: { name: string; nameZh: string; tMs: number; file: string }[]; checks: FrameCheck[] };
  cutaways: CutawayScore[];
  cost: ReturnType<typeof visionSpend> & { usd: number };
  timings: Record<string, number>;
  diff: { prev: string; hardFrom: number; hardTo: number; checklistFrom: number; checklistTo: number; flipped: { id: string; from: boolean | null; to: boolean | null }[]; changed: { id: string; from: string; to: string }[] } | null;
};

function diffReports(prev: Report | null, cur: Omit<Report, "diff">, prevPath: string): Report["diff"] {
  if (!prev) return null;
  const flipped: { id: string; from: boolean | null; to: boolean | null }[] = [];
  const changed: { id: string; from: string; to: string }[] = [];
  for (const g of cur.gates) {
    const p = prev.gates.find((x) => x.id === g.id);
    if (!p) continue;
    if (p.pass !== g.pass) flipped.push({ id: g.id, from: p.pass, to: g.pass });
    else if (p.value !== g.value) changed.push({ id: g.id, from: p.value, to: g.value });
  }
  return { prev: prevPath, hardFrom: prev.hard.passed, hardTo: cur.hard.passed, checklistFrom: prev.checklist.score, checklistTo: cur.checklist.score, flipped, changed };
}

function textReport(r: Report): string {
  const mark = (p: boolean | null) => (p === true ? "PASS" : p === false ? "FAIL" : " n/a");
  const lines: string[] = [];
  lines.push(`Director v2 grade: ${r.label} (${r.at})`, `mp4: ${r.mp4} (${(r.durationMs / 1000).toFixed(1)} s)`, "");
  lines.push(`HARD GATES: ${r.hard.passed} pass, ${r.hard.failed} fail, ${r.hard.undecided} undecided of ${r.hard.total}`);
  for (const g of r.gates.filter((g) => g.hard)) lines.push(`  ${mark(g.pass)}  ${g.id.padEnd(20)} ${g.value}   [${g.threshold}]`);
  lines.push("", "METRICS:");
  for (const g of r.gates.filter((g) => !g.hard)) lines.push(`  ${mark(g.pass)}  ${g.id.padEnd(20)} ${g.value}   [${g.threshold}]`);
  lines.push("", `CHECKLIST (auto, conservative): ${r.checklist.score}/${r.checklist.max} scored; item 10 needs eyes`);
  for (const c of r.checklist.items) lines.push(`  ${c.n.toString().padStart(2)} ${String(c.score ?? "-").padStart(2)}  ${c.item.padEnd(26)} ${c.why.slice(0, 150)}`);
  lines.push("", `ISSUES (${r.issues.length}; top 80 by severity then time):`);
  const order = { high: 0, med: 1, low: 2 };
  for (const i of [...r.issues].sort((a, b) => order[a.severity] - order[b.severity] || (a.atMs ?? -1) - (b.atMs ?? -1)).slice(0, 80)) {
    lines.push(`  ${i.severity.padEnd(4)} ${i.atMs === null ? "  --  " : fmt(i.atMs).padStart(6)} ${i.area.padEnd(10)} ${i.textZh}  |  ${i.text}`);
  }
  lines.push("", `CUTAWAYS (${r.cutaways.length}):`);
  for (const c of r.cutaways) lines.push(`  #${String(c.index).padStart(2)} ${String(c.score ?? "-").padStart(2)}/10 on ${c.scoredOn.padEnd(5)} ${c.source ? `${c.source.width}x${c.source.height}`.padEnd(9) : "?".padEnd(9)} 「${c.line.slice(0, 28)}」 ${c.reason}`);
  lines.push("", `FRAMES: ${r.frames.sheets.length} sheets, ${r.frames.strips.length} strips, ${r.frames.checks.length} checked`);
  for (const s of r.frames.sheets) lines.push(`  ${s}`);
  for (const s of r.frames.strips) lines.push(`  ${s.file}  (${s.name} @ ${fmt(s.tMs)})`);
  lines.push("", `COST: ${r.cost.calls} vision calls, $${r.cost.usd.toFixed(4)}, ${(r.cost.ms / 1000).toFixed(0)} s model time`);
  lines.push(`TIMINGS: ${Object.entries(r.timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(", ")}`);
  if (r.diff) {
    lines.push("", `DIFF vs ${r.diff.prev}: hard ${r.diff.hardFrom} → ${r.diff.hardTo}, checklist ${r.diff.checklistFrom} → ${r.diff.checklistTo}`);
    for (const f of r.diff.flipped) lines.push(`  ${f.id}: ${mark(f.from)} → ${mark(f.to)}`);
    for (const c of r.diff.changed.slice(0, 30)) lines.push(`  ${c.id}: ${c.from} → ${c.to}`);
  }
  return lines.join("\n") + "\n";
}

/* ----------------------------------------------------------------- main */

async function main() {
  const started = Date.now();
  const timings: Record<string, number> = {};
  const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const r = await fn();
    timings[name] = Date.now() - t0;
    console.log(`  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return r;
  };
  await mkdir(OUT, { recursive: true });
  const gold = await readJson<Gold>(GOLD);

  /* ---- input ---- */
  let input: GradeInput;
  if (flag("--v1")) {
    const fixture = await readJson<Fixture>(arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json"));
    if (!fixture) throw new Error("fixture not found");
    input = await inputFromFixtureV1(fixture, gold, {
      mp4: arg("--mp4", "/tmp/dv2_lab/W5/a_v1.mp4"),
      stills: arg("--stills", "/tmp/dv2_lab/W5/a"),
      plan: arg("--plan", "/tmp/dv2_lab/W5/a_plan.json"),
      assets: arg("--assets", "/tmp/dv2_lab/W5/assets"),
      ass: arg("--ass", "/tmp/dv2_lab/W5/captions.ass"),
    });
    const renderS = Number(arg("--render-s", "0"));
    if (renderS > 0) input.timings = { renderMs: Math.round(renderS * 1000) };
    else {
      const w5 = await readJson<{ timings?: Record<string, number> }>("/tmp/dv2_lab/W5/report.json");
      const s = w5?.timings?.a_encode ?? w5?.timings?.a_total;
      if (s) input.timings = { renderMs: Math.round(s * 1000) };
    }
    const brief = fixture.brief;
    input.credits = { line: null, block: null };
    (input as GradeInput & { brief?: string }).brief = brief;
  } else {
    const loaded = await readJson<GradeInput>(arg("--input", ""));
    if (!loaded) throw new Error("--input <grade-input.json> is required (or --v1)");
    input = { ...loaded, label: loaded.label || LABEL };
    if (!input.anchors && gold?.anchors) input.anchors = gold.anchors;
    if (!input.glossary && gold?.glossary?.mustFix) input.glossary = gold.glossary.mustFix.map((m) => ({ from: m.from_, to: m.to }));
    if (!input.goldRetakes && gold?.retakes) input.goldRetakes = gold.retakes;
  }
  const transcriptGlossary: GradeGlossary = [...(input.glossary ?? []), ...TRANSCRIPT_GLOSSARY];
  if (!(await exists(input.mp4))) throw new Error(`mp4 not found: ${input.mp4}`);
  const brief = (input as GradeInput & { brief?: string }).brief ?? "";
  const context = brief ? `Video brief (zh): ${brief.slice(0, 320).replace(/\s+/g, " ")}` : "A Chinese tech-explainer reel.";
  const total = totalMs(input);
  const probe = await probeSize(input.mp4);
  console.log(`grading ${input.label}: ${input.mp4} (${probe ? `${probe.width}x${probe.height}, ${(probe.durationMs / 1000).toFixed(1)} s` : "?"}; plan ${(total / 1000).toFixed(1)} s), ${input.cuts.length} cuts, ${input.cutaways.length} cutaways, ${input.graphics.length} graphics, ${input.assets.length} assets`);
  if (probe && Math.abs(probe.durationMs - total) > 1500) console.warn(`  plan and file disagree on length by ${((probe.durationMs - total) / 1000).toFixed(1)} s`);

  /* Boxes for graphics that came with a still but no box. */
  await timed("boxes", () =>
    pmap(input.graphics, 8, async (g) => {
      if (!g.box && g.file && (await exists(g.file))) g.box = await alphaBox(g.file, input.width, input.height);
    }),
  );
  await writeFile(path.join(OUT, "input.json"), JSON.stringify(input, null, 1), "utf8");

  /* ---- measurements, in parallel ---- */
  const hotwords = [
    ...(input.anchors?.entities ?? []).map((e) => e.name),
    ...(input.anchors?.entities ?? []).map((e) => e.romanised ?? "").filter(Boolean),
    ...(input.anchors?.terms ?? []).map((t) => t.term),
    ...(input.anchors?.lowerThird ? [input.anchors.lowerThird.name, input.anchors.lowerThird.sub ?? ""] : []),
  ].filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 30);
  const mp4Key = await fileKey(input.mp4);
  const rawFile = input.cuts.find((c) => c.file)?.file ?? null;
  /* W5 owns face.py; a worktree that has it (after the merge) uses its own copy, W5's branch is the fallback until then. */
  const ownFace = path.join(process.cwd(), "scripts", "dv2", "face.py");
  const faceScript = FACE_SCRIPT || ((await exists(ownFace)) ? ownFace : "/home/ubuntu/wt/dv2-W5/scripts/dv2/face.py");

  /* The whisper, the face samples and the scene changes depend only on the
     file (and, for the faces, on the sample times), so they are cached
     beside the run dirs: a re-grade after a harness change costs the
     vision calls and nothing else. */
  const times = hostTimes(input);
  const timesKey = createHash("sha1").update(times.join(",")).digest("hex").slice(0, 8);
  const [whisper, loud, scenes, frameSet, sourceSilences, cutFrames, faces, pcm] = await Promise.all([
    SKIP.has("whisper")
      ? readJson<{ text: string; words: Word[] }>(path.join(OUT, "whisper.json"))
      : timed("whisper", () => cached(path.join(CACHE, `whisper-${mp4Key}.json`), () => transcribeOutput(input.mp4, path.join(OUT, "audio.wav"), hotwords))),
    timed("loudness", () => measureLoudness(input.mp4)),
    SKIP.has("scene") ? Promise.resolve(null) : timed("scene", () => cached(path.join(CACHE, `scene-${mp4Key}.json`), () => measureSceneChanges(input.mp4, 0.3))),
    SKIP.has("frames") ? Promise.resolve<FrameSet>({ frames: [], sheets: [], strips: [], tiles: [] }) : timed("frames", () => sampleFrames(input.mp4, input, { out: OUT, max: MAX_FRAMES, concurrency: CONCURRENCY })),
    input.sourceSilences
      ? Promise.resolve(input.sourceSilences)
      : rawFile
        ? timed("sourceSilences", async () => cached<Silence[]>(path.join(CACHE, `silences-${await fileKey(rawFile)}.json`), () => measureSilences(rawFile, -32, 0.25)))
        : Promise.resolve(null),
    timed("cutawayFrames", () => cutawayFrames(input, path.join(OUT, "cutaways"))),
    SKIP.has("face")
      ? Promise.resolve<FaceSample[]>([])
      : timed("faces", () => cached(path.join(CACHE, `faces-${mp4Key}-${timesKey}.json`), () => measureFaces(input.mp4, times, { python: FACE_PYTHON, script: faceScript, W: input.width, H: input.height }))),
    timed("pcm", () => pcmOf(input.mp4)),
  ]);
  if (whisper) await writeFile(path.join(OUT, "whisper.json"), JSON.stringify(whisper), "utf8");
  const words = whisper?.words ?? null;
  input.sourceSilences = sourceSilences;
  const pauses = pausesFromPcm(pcm, 48000, { minMs: 350 });
  const silences = pauses.pauses;

  /* ---- vision ---- */
  const scores = await timed("relevance", () => scoreCutaways(input, cutFrames, words, context));
  const checks = SKIP.has("vision") ? [] : await timed("checkFrame", () => checkFrames(frameSet.frames));
  const ass = input.assFile && (await exists(input.assFile)) ? parseAss(await readFile(input.assFile, "utf8")) : null;

  /* ---- gates ---- */
  const clicks = clickCheck(pcm, cutBoundaries(input.cuts));
  const firstWordMs = words?.[0]?.startMs ?? null;
  const terms = [...(input.anchors?.terms ?? []).map((t) => t.term), ...(input.anchors?.entities ?? []).map((e) => e.name), ...(input.glossary ?? []).map((g) => g.to)];
  const gates: Gate[] = [
    evaluateRetakes(words, input.cuts, input.goldRetakes),
    evaluateAnchors(words, input.anchors, transcriptGlossary),
    evaluateBoundaries(input.cuts, input.sourceWords, input.sourceSilences),
    evaluatePauses(words, silences, total, { floorDb: pauses.floorDb, thresholdDb: pauses.thresholdDb }),
    evaluateCutReport(input.cutReport, total),
    evaluateUniqueness(input, scores),
    evaluateMix(input),
    evaluateCoverage(input),
    evaluateLayouts(input, scores),
    evaluateRelevance(input, scores),
    evaluateResolution(input, scores),
    evaluateOverlaps(input),
    evaluateZones(input),
    evaluateFace(input, faces, ass),
    evaluateCadence(input, scenes),
    ...evaluateCaptions(ass, input.glossary, terms, { size: 72, secondSize: 36, family: /Black/ }),
    ...evaluateSound(loud, clicks, input.audio?.voiceChain),
    ...evaluateCredits(input),
    evaluateHook(input, input.anchors?.hookBlock, firstWordMs),
    evaluateLowerThird(input, words, input.anchors, transcriptGlossary),
    evaluateStats(input, words),
    evaluateShotList(input, input.anchors, scores),
    ...evaluateBudgets(input),
    evaluateLint(input),
    evaluateFrameCheck(checks),
  ];
  const faceGate = gates.find((g) => g.id === "layout.face");
  if (faceGate) faceGate.detail = { ...(faceGate.detail ?? {}), visionFaceFlags: checks.filter((c) => c.issues.some((i) => i.type === "face_occluded")).length };

  const hard = gates.filter((g) => g.hard);
  const checklist = autoChecklist(gates);
  const scored = checklist.filter((c) => c.score !== null);
  const spend = visionSpend();
  const issues = gates.flatMap((g) => g.issues);
  timings.total = Date.now() - started;
  const base: Omit<Report, "diff"> = {
    label: input.label,
    at: new Date().toISOString(),
    mp4: input.mp4,
    durationMs: probe?.durationMs ?? total,
    hard: { passed: hard.filter((g) => g.pass === true).length, failed: hard.filter((g) => g.pass === false).length, undecided: hard.filter((g) => g.pass === null).length, total: hard.length, failedIds: hard.filter((g) => g.pass === false).map((g) => g.id) },
    checklist: { items: checklist, score: scored.reduce((a, c) => a + (c.score ?? 0), 0), max: scored.length * 2 },
    gates,
    issues,
    frames: { sheets: frameSet.sheets, strips: frameSet.strips, checks },
    cutaways: scores,
    cost: { ...spend, usd: spend.costMicros / 1e6 },
    timings,
  };

  /* ---- diff against the previous run ---- */
  let prevPath = PREV;
  if (!prevPath) {
    const parent = path.dirname(OUT);
    const names = (await readdir(parent).catch(() => [] as string[])).filter((n) => n !== path.basename(OUT));
    let newest = { p: "", at: 0 };
    for (const n of names) {
      const p = path.join(parent, n, "report.json");
      const s = await stat(p).catch(() => null);
      if (s && s.mtimeMs > newest.at) newest = { p, at: s.mtimeMs };
    }
    prevPath = newest.p;
  }
  const prev = prevPath ? await readJson<Report>(prevPath) : null;
  const report: Report = { ...base, diff: diffReports(prev, base, prevPath) };

  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1), "utf8");
  const text = textReport(report);
  await writeFile(path.join(OUT, "report.txt"), text, "utf8");
  console.log("\n" + text);
  console.log(`models: score ${VISION.score}, check ${VISION.check}; wrote ${path.join(OUT, "report.json")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
