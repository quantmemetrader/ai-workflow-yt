/**
 * Director v2 lab: the whole pipeline on a fixture, end to end, with no
 * database or storage writes (PLAN.md Stage 2 and §3).
 *
 *   cd /home/ubuntu/wt/dv2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/lab.ts --fixture /tmp/dv2_lab/fixture/zhengliu.json --raw /home/ubuntu/raw/zhengliu.mp4 \
 *     --out /tmp/dv2_lab/runs/rNN [--from transcribe|cut|design|source|motion|render|grade] \
 *     [--cache /tmp/dv2_lab/cache] [--gold /tmp/dv2_lab/fixture/zhengliu.gold.json] [--no-grade]
 *
 * Stages, one JSON each in the run directory, every later stage reading the
 * earlier ones' files so `--from <stage>` re-runs from there on:
 *
 *   transcribe  whisper with the brief's hotwords (cached per file), the
 *               glossary (deterministic + one cheap call)      transcribe.json
 *   cut         silences, whisper's holes, sentences, retakes, the cut plan
 *               (W1 planCut; two cheap calls)                   cut.json, cut-report.txt
 *   design      the face track, reel caption lines on the cut's clock, the
 *               English line per caption, the outline call (W6) design.json
 *   source      W3 sourcing in local mode (nothing to the DB or R2), the
 *               entity logos, the layout (W6 planDesign)        source.json, plan.json, credits.txt
 *   motion      W4 Remotion alpha clips for every graphic      motion.json
 *   render      furniture still, ASS, W5 renderTimeline        render.json, out.mp4
 *   grade       W7 grade.ts on grade-input.json                 grade/report.json
 *
 * Plus timings.json and cost.json. Paid calls: the glossary, the two cut
 * calls, the translation, the outline, the vision judge; TikHub through the
 * media library's cache and budget. Everything is written under `--out`
 * and `--cache` only.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Beat, MotionClip, Sourced } from "@/lib/video/v2/types";
import type { GradeInput, GradeAsset, GradeBeat, GradeCutaway, GradeGraphic } from "./metrics";
import { FURNITURE } from "@/lib/video/v2/render-plan";
import {
  cutReportText,
  cutTake,
  designTake,
  furnitureStill,
  captionsAss,
  motionTake,
  pmap,
  sourceTake,
  transcribeTake,
  v2RenderPlan,
  type CutOut,
  type DesignOut,
  type Hooks,
  type MotionOut,
  type SourceOut,
  type Take,
  type TranscribeOut,
} from "@/lib/video/v2/pipeline";

const run = promisify(execFile);

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(name);

const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const OUT = arg("--out", "/tmp/dv2_lab/runs/r00");
const CACHE = arg("--cache", "/tmp/dv2_lab/cache");
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");
const PRESET = arg("--preset", "bilingual-reel");
/** The translation model, named so the lab never asks the database which one the studio chose. */
const TRANSLATE_MODEL = arg("--translate-model", "qwen/qwen3.8-flash");
const TIKHUB = Number(arg("--tikhub", "60"));
const STAGES = ["transcribe", "cut", "design", "source", "motion", "render", "grade"] as const;
type Stage = (typeof STAGES)[number];
const FROM = arg("--from", "transcribe") as Stage;
if (!STAGES.includes(FROM)) throw new Error(`--from must be one of ${STAGES.join(", ")}`);
const runs = (s: Stage) => STAGES.indexOf(s) >= STAGES.indexOf(FROM);

const W = 1080;
const H = 1920;

type Fixture = {
  project: { id: string; title: string; tenantName: string | null; accent: string };
  brief: string;
  source: { path: string; clipId: string; durationMs: number };
  graphics: { kind: string; placement: string | null; scale: number | null }[];
};

/* --------------------------------------------------------------- helpers */

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));
const readJson = async <T,>(p: string): Promise<T> => JSON.parse(await readFile(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => writeFile(p, JSON.stringify(v, null, 1), "utf8");
const sec = (ms: number) => (ms / 1000).toFixed(2);
const log = (line: string) => console.log(`[lab ${new Date().toISOString().slice(11, 19)}] ${line}`);

const timings: Record<string, number> = {};
const cost = { modelMicros: 0, calls: [] as { what: string; micros: number }[] };
const spent = (what: string, micros: number | null | undefined) => {
  if (!micros) return;
  cost.modelMicros += micros;
  cost.calls.push({ what, micros });
};

async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  log(`${stage}: start`);
  const r = await fn();
  timings[`${stage}Ms`] = Date.now() - t0;
  log(`${stage}: done in ${sec(Date.now() - t0)} s`);
  await writeJson(path.join(OUT, "timings.json"), timings);
  return r;
}

/*
 * The stages themselves live in `lib/video/v2/pipeline.ts`, which the
 * product's director runs too; the lab adds only what is around them: one
 * JSON per stage in the run directory, `--from`, the kept sourcing answers,
 * the contact sheets, the cost file and the grade.
 */

const take = (fixture: Fixture): Take => ({ raw: RAW, clipId: fixture.source.clipId, durationMs: fixture.source.durationMs, brief: fixture.brief, title: fixture.project.title, cacheDir: CACHE });
const hooks: Hooks = { log, usage: (what, u) => spent(what, u.costMicros) };

/* ============================================================ transcribe */

async function stageTranscribe(fixture: Fixture): Promise<TranscribeOut> {
  const file = path.join(OUT, "transcribe.json");
  if (!runs("transcribe")) return readJson<TranscribeOut>(file);
  return timed("transcribe", async () => {
    const out = await transcribeTake(take(fixture), hooks);
    await writeJson(file, out);
    return out;
  });
}

/* =================================================================== cut */

async function stageCut(fixture: Fixture, tr: TranscribeOut): Promise<CutOut> {
  const file = path.join(OUT, "cut.json");
  if (!runs("cut")) return readJson<CutOut>(file);
  return timed("cut", async () => {
    const out = await cutTake(take(fixture), tr, hooks);
    await writeJson(file, out);
    await writeFile(path.join(OUT, "cut-report.txt"), cutReportText(fixture.project.title, out, fixture.source.durationMs), "utf8");
    return out;
  });
}

/* ================================================================ design */

async function stageDesign(fixture: Fixture, cut: CutOut): Promise<DesignOut> {
  const file = path.join(OUT, "design.json");
  if (!runs("design")) return readJson<DesignOut>(file);
  return timed("design", async () => {
    const { faceTrackCached } = await import("@/lib/video/face");
    const out = await designTake(
      take(fixture),
      cut,
      {
        accent: fixture.project.accent,
        tenantName: fixture.project.tenantName,
        face: () => faceTrackCached(RAW, { cacheDir: CACHE, clipId: fixture.source.clipId }),
        preset: PRESET,
        translateModel: TRANSLATE_MODEL,
      },
      hooks,
    );
    await writeJson(file, out);
    return out;
  });
}

/* ================================================================ source */

async function stageSource(fixture: Fixture, cut: CutOut, d: DesignOut): Promise<SourceOut> {
  const file = path.join(OUT, "source.json");
  if (!runs("source")) return readJson<SourceOut>(file);
  return timed("source", async () => {
    const { sheet } = await import("@/lib/video/contactsheet");
    const workDir = path.join(OUT, "source");
    await mkdir(workDir, { recursive: true });

    /*
     * The sourcing answer is kept per beat list in the run directory, so a
     * layout change re-runs from `source` in seconds instead of re-judging
     * every candidate; `--resource` asks again.
     */
    const answerFile = (beats: Beat[]) => path.join(workDir, `answer-${createHash("sha1").update(JSON.stringify(beats)).digest("hex").slice(0, 12)}.json`);
    const logoFile = path.join(workDir, "logos.json");
    const logosKept: Record<string, Sourced | null> = !flag("--resource") && (await exists(logoFile)) ? await readJson<Record<string, Sourced | null>>(logoFile) : {};

    const out = await sourceTake(
      take(fixture),
      cut,
      d,
      {
        accent: fixture.project.accent,
        tenantName: fixture.project.tenantName,
        into: "local",
        workDir,
        media: { cacheDir: CACHE, tikhubBudget: TIKHUB },
        memo: {
          answers: {
            get: async (beats) => (!flag("--resource") && (await exists(answerFile(beats))) ? readJson(answerFile(beats)) : null),
            put: (beats, kept) => writeJson(answerFile(beats), kept),
          },
          logos: {
            get: async (name) => (name in logosKept ? logosKept[name] : undefined),
            put: async (name, found) => {
              logosKept[name] = found;
              await writeJson(logoFile, logosKept);
            },
          },
          /* The chosen-windows sheet: every pick with its line and credit. */
          onReport: async (report, beats) => {
            const cells = report.sourced.map((s) => {
              const t = report.traces.find((x) => x.beatId === s.beatId);
              return { image: t?.chosenImage ?? null, label: `${s.beatId} ${t?.line.slice(0, 26) ?? ""}\n${s.asset.credit.slice(0, 44)}\n${s.score}/10 · ${s.kind} · ${s.layout}\n${s.candidate.licence ?? "平台引用（署名）"}` };
            });
            if (cells.length) await sheet(cells, path.join(OUT, "sheets", "sourced.jpg"), { cols: 5, cellW: 300, cellH: 300, labelLines: 4, title: `${fixture.project.title} · sourced ${report.sourced.length}/${beats.length}` }).catch((err) => log(`source: sheet failed ${err}`));
          },
        },
      },
      hooks,
    );
    await writeFile(path.join(OUT, "trace.txt"), out.traceLines.join("\n"), "utf8");
    spent("vision (sourcing)", out.spend.vision.costMicros);
    await writeJson(file, out);
    await writeJson(path.join(OUT, "plan.json"), out.design.plan);
    await writeFile(path.join(OUT, "credits.txt"), `${out.design.credits.line}\n\n${out.design.credits.block}\n`, "utf8");
    return out;
  });
}

/* ================================================================ motion */

async function stageMotion(fixture: Fixture, src: SourceOut): Promise<MotionOut> {
  const file = path.join(OUT, "motion.json");
  if (!runs("motion")) return readJson<MotionOut>(file);
  return timed("motion", async () => {
    const out = await motionTake(src.design.plan.graphics, { accent: fixture.project.accent, dir: path.join(OUT, "motion") }, hooks);
    await writeJson(file, out);
    return out;
  });
}

/* ================================================================ render */

type RenderOut = { mp4: string; assFile: string; furniture: string | null; plan: unknown; skipped: unknown[]; durationMs: number; renderMs: number };

async function stageRender(fixture: Fixture, cut: CutOut, d: DesignOut, src: SourceOut, motion: MotionOut): Promise<RenderOut> {
  const file = path.join(OUT, "render.json");
  if (!runs("render")) return readJson<RenderOut>(file);
  return timed("render", async () => {
    const { renderTimeline } = await import("@/lib/video/render");
    const dir = path.join(OUT, "render");
    await mkdir(dir, { recursive: true });

    const assFile = path.join(OUT, "captions.ass");
    await writeFile(assFile, await captionsAss(d.captions, { accent: fixture.project.accent, chinY: d.chinY, preset: PRESET }), "utf8");
    /* The channel's furniture where the project's own rows put it. */
    const channel = (kind: string) => fixture.graphics.find((g) => g.kind === kind);
    const furniture = await furnitureStill(src.design.plan.graphics, { accent: fixture.project.accent, dir, placement: channel });

    const { plan, skipped } = await v2RenderPlan({
      raw: RAW,
      pieces: cut.pieces,
      cutZooms: src.design.plan.cutZooms,
      renderHints: src.design.plan.renderHints,
      cutaways: src.design.plan.cutaways,
      face: d.face,
      motion: motion.clips,
      furniture,
      assFile,
      accent: fixture.project.accent,
      workDir: dir,
    });
    await writeJson(path.join(OUT, "render-plan.json"), plan);
    log(`render: ${plan.cuts.length} cuts (${plan.cuts.filter((c) => c.seam).length} seams), ${plan.cutaways.length} cutaways (${skipped.length} skipped), ${motion.clips.length} motion clips`);
    const mp4 = path.join(OUT, "out.mp4");
    const t0 = Date.now();
    let lastPct = -10;
    const res = await renderTimeline(plan, mp4, (p) => {
      if (p.doneMs !== undefined && p.totalMs) {
        const pct = Math.floor((p.doneMs / p.totalMs) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          log(`render: ${pct} %`);
        }
      }
    });
    const renderMs = Date.now() - t0;
    await writeFile(path.join(OUT, "render-command.txt"), res.command, "utf8");
    const out: RenderOut = { mp4, assFile, furniture, plan: { cuts: plan.cuts.length, cutaways: plan.cutaways.length, motion: motion.clips.length }, skipped, durationMs: res.durationMs, renderMs };
    await writeJson(file, out);
    return out;
  });
}

/* ================================================================= grade */

/** Each motion clip's middle frame laid on a transparent full frame, for the grader's box measurement. */
async function graphicStills(clips: readonly MotionClip[], dir: string): Promise<Map<string, string>> {
  await mkdir(dir, { recursive: true });
  const found = new Map<string, string>();
  await pmap(clips, 8, async (c) => {
    const out = path.join(dir, `${c.id.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`);
    const base = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H},format=rgba`];
    const input = c.parts.hold ? ["-i", c.parts.hold] : c.parts.full ? ["-c:v", "libvpx-vp9", "-ss", ((c.endMs - c.startMs) / 2000).toFixed(3), "-i", c.parts.full] : null;
    if (!input) return;
    const ok = await run("ffmpeg", [...base, ...input, "-filter_complex", `[0:v][1:v]overlay=${Math.round(c.x)}:${Math.round(c.y)}:format=auto,format=rgba[v]`, "-map", "[v]", "-frames:v", "1", out], { timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (ok) found.set(c.id, out);
  });
  return found;
}

const PLATFORM_KIND: Record<string, GradeBeat["resolved"]> = { douyin: "platform", tiktok: "platform", bilibili: "platform", youtube: "platform", pinterest: "platform", xiaohongshu: "platform", bing: "web", wikimedia: "web", openverse: "web", web: "web", pexels: "stock", pixabay: "stock", unsplash: "stock", stock: "stock" };

async function stageGrade(fixture: Fixture, tr: TranscribeOut, cut: CutOut, d: DesignOut, src: SourceOut, motion: MotionOut, rendered: RenderOut) {
  if (!runs("grade") || flag("--no-grade")) return null;
  return timed("grade", async () => {
    const design = src.design;
    const plan = design.plan;
    const stills = await graphicStills(motion.clips, path.join(OUT, "grade-stills"));

    /* Assets: every picture and clip on screen (cutaways, logos on cards, headline images), once each. */
    const assets: GradeAsset[] = [];
    const assetIndex = (a: Sourced["asset"], kind: GradeAsset["kind"]): number => {
      const c = a.candidate;
      const at = assets.findIndex((x) => x.sourceId === c.id);
      if (at >= 0) return at;
      assets.push({ platform: c.platform, sourceId: c.id, sourceUrl: c.url, author: c.author?.name ?? null, authorUrl: c.author?.url ?? null, title: c.title, licence: c.licence ?? null, file: a.localPath ?? null, width: a.width ?? null, height: a.height ?? null, kind });
      return assets.length - 1;
    };
    const beatById = new Map(design.beats.map((b) => [b.id, b]));
    const sentence = new Map(d.timelineSentences.map((s) => [s.id, s]));
    const gradeBeat = (beatId: string, resolved: GradeBeat["resolved"]): GradeBeat | null => {
      const b = beatById.get(beatId);
      if (!b) return null;
      return { id: b.id, intent: b.intent, atMs: sentence.get(b.sentenceId)?.startMs, entity: b.entity ? { name: b.entity.name, romanised: b.entity.romanised, kind: b.entity.kind, descriptorZh: b.entity.descriptorZh } : null, must: b.must ?? null, mustNot: b.mustNot ?? null, resolved };
    };

    const cutaways: GradeCutaway[] = plan.cutaways.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      layout: c.layout,
      still: c.still,
      file: c.asset.localPath ?? null,
      sourceInMs: c.sourceInMs,
      assetIndex: assetIndex(c.asset, c.kind),
      runId: c.runId ?? null,
      box: c.layout === "split" ? [plan.renderHints.split.clip.x, plan.renderHints.split.clip.y, plan.renderHints.split.clip.w, plan.renderHints.split.clip.h] : null,
      beat: gradeBeat(c.beatId, PLATFORM_KIND[c.candidate.platform] ?? "web"),
    }));

    const graphics: GradeGraphic[] = plan.graphics.map((g) => {
      for (const field of ["logo", "image"]) {
        const ref = g.props[field] as { asset?: Sourced["asset"] } | null | undefined;
        if (ref?.asset?.candidate) assetIndex(ref.asset, field === "logo" ? "logo" : "image");
      }
      const text = Array.isArray(g.props.lines) ? (g.props.lines as string[]).join(" ") : g.props.text == null ? null : String(g.props.text);
      /* A compare card shows its figures on the bars, not in a sub line: those are what the viewer reads, so they are what the stat check hears for. */
      const bars = Array.isArray(g.props.bars) ? (g.props.bars as { display?: string }[]).map((b) => b.display ?? "").filter(Boolean).join(" ") : "";
      const sub = g.props.sub == null ? (bars || null) : String(g.props.sub);
      return { id: g.id, kind: g.kind, startMs: g.startMs, endMs: g.endMs, text, sub, furniture: FURNITURE.has(g.kind), file: stills.get(g.id) ?? null, props: JSON.parse(JSON.stringify(g.props, (k, v) => (k === "asset" ? undefined : v))) as Record<string, unknown> };
    });
    if (rendered.furniture) for (const g of graphics) if (g.furniture) g.file = rendered.furniture;

    /* Beats: what each footage / entity beat resolved to. */
    const onScreen = new Set(plan.cutaways.map((c) => c.beatId));
    const carded = new Set(plan.graphics.filter((g) => g.kind === "entity" || g.kind === "headline" || g.kind === "chip").map((g) => g.id.split(":").slice(1).join(":")));
    const beats: GradeBeat[] = design.beats
      .filter((b) => ["person", "org", "product", "headline", "scene", "concept", "metaphor"].includes(b.intent))
      .map((b) => {
        const cutaway = plan.cutaways.find((c) => c.beatId === b.id);
        const logo = b.entity ? design.logos[b.entity.name] : undefined;
        const resolved: GradeBeat["resolved"] = cutaway ? (PLATFORM_KIND[cutaway.candidate.platform] ?? "web") : logo && carded.has(b.id) ? (PLATFORM_KIND[logo.candidate.platform] ?? "web") : carded.has(b.id) ? "card" : onScreen.has(b.id) ? "web" : "host";
        const gb = gradeBeat(b.id, resolved)!;
        /* An asset was sourced for this beat and is neither a cutaway nor on a card: say so, with the layout's reason. */
        const had = design.sourced.find((x) => x.beatId === b.id);
        if (had && !cutaway && !carded.has(b.id)) gb.unplaced = plan.stats.skipped.find((x) => x.beatId === b.id)?.reasonZh ?? `${had.kind} 已找到，排版没有位置`;
        return gb;
      });

    const spend = src.spend as { media: { tikhubRequests?: number }; vision: { costMicros: number } };
    const input: GradeInput & { brief: string } = {
      label: path.basename(OUT),
      mp4: rendered.mp4,
      width: W,
      height: H,
      fps: 30,
      cuts: cut.pieces.map((p) => ({ file: RAW, inMs: p.inMs, outMs: p.outMs })),
      cutaways,
      graphics,
      captions: d.captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words })),
      assFile: rendered.assFile,
      assets,
      credits: { line: design.credits.line, block: design.credits.block },
      beats,
      cutReport: cut.report,
      sourceWords: cut.words,
      sourceSilences: cut.fine,
      glossary: null,
      anchors: null,
      goldRetakes: null,
      timings: { ...timings, renderMs: rendered.renderMs, directorMs: (timings.transcribeMs ?? 0) + (timings.cutMs ?? 0) + (timings.designMs ?? 0) + (timings.sourceMs ?? 0) },
      spend: { usd: cost.modelMicros / 1e6, tikhubRequests: spend.media.tikhubRequests ?? 0, visionUsd: spend.vision.costMicros / 1e6 },
      lint: design.lint.map((v) => ({ rule: v.rule, atMs: v.atMs, textZh: v.detailZh })),
      audio: { voiceChain: true },
      brief: fixture.brief,
    };
    const inputFile = path.join(OUT, "grade-input.json");
    await writeJson(inputFile, input);
    const gradeOut = path.join(OUT, "grade");
    const cwd = process.cwd();
    log("grade: running grade.ts");
    const res = await run(
      process.execPath,
      ["--env-file=.env.local", "--dns-result-order=ipv4first", "--conditions=react-server", "--import", "tsx", "scripts/dv2/grade.ts", "--input", inputFile, "--out", gradeOut, "--gold", GOLD],
      { cwd, env: { ...process.env, TSX_TSCONFIG_PATH: path.join(cwd, "tsconfig.json") }, timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 },
    ).catch((err: { stdout?: string; stderr?: string; message?: string }) => ({ stdout: err.stdout ?? "", stderr: `${err.stderr ?? ""}\n${err.message ?? ""}` }));
    await writeFile(path.join(OUT, "grade.log"), `${res.stdout}\n${res.stderr}`, "utf8");
    log(`grade: ${String(res.stdout).split("\n").slice(-25).join("\n")}`);
    return gradeOut;
  });
}

/* ================================================================== main */

async function main() {
  const t0 = Date.now();
  await mkdir(OUT, { recursive: true });
  if (await exists(path.join(OUT, "timings.json"))) Object.assign(timings, await readJson<Record<string, number>>(path.join(OUT, "timings.json")));
  const fixture = await readJson<Fixture>(FIXTURE);
  log(`lab: ${fixture.project.title} → ${OUT} (from ${FROM})`);
  const tr = await stageTranscribe(fixture);
  const cut = await stageCut(fixture, tr);
  const d = await stageDesign(fixture, cut);
  const src = await stageSource(fixture, cut, d);
  const motion = await stageMotion(fixture, src);
  const rendered = await stageRender(fixture, cut, d, src, motion);
  await writeJson(path.join(OUT, "cost.json"), { modelUsd: cost.modelMicros / 1e6, calls: cost.calls, media: src.spend.media, visionUsd: src.spend.vision.costMicros / 1e6 });
  await stageGrade(fixture, tr, cut, d, src, motion, rendered);
  timings.totalMs = Date.now() - t0;
  await writeJson(path.join(OUT, "timings.json"), timings);
  /* The phone preview: 720 wide, small enough to send. */
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", rendered.mp4, "-vf", "scale=720:-2", "-c:v", "libx264", "-crf", "27", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", path.join(OUT, "preview.mp4")], { timeout: 600_000 }).catch((err) => log(`preview failed: ${err}`));
  log(`lab: done in ${sec(Date.now() - t0)} s`);
}

/* The model client and the media library import the database client, whose idle pool keeps the loop alive; the run is written, so leave. */
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
