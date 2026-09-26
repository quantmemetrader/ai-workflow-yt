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
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Beat, CutPiece, CutReport, FaceTrack, GraphicSpecV2, MotionClip, Retake, Sentence, Silence, Sourced, Word } from "@/lib/video/v2/types";
import type { Transcript, TranscriptWord } from "@/lib/video/elevenlabs";
import type { DesignResult, Outline, OutlineEntity } from "@/lib/video/v2/design";
import type { GradeInput, GradeAsset, GradeBeat, GradeCutaway, GradeGraphic } from "./metrics";
import { toMotionSpecs, toRenderCuts, toRenderCutaways, wordsOnTimeline, FURNITURE } from "@/lib/video/v2/render-plan";

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

async function pmap<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/* ============================================================ transcribe */

type TranscribeOut = { terms: string[]; hotwords: string[]; changes: unknown[]; words: Word[]; languageCode: string };

async function stageTranscribe(fixture: Fixture): Promise<TranscribeOut> {
  const file = path.join(OUT, "transcribe.json");
  if (!runs("transcribe")) return readJson<TranscribeOut>(file);
  return timed("transcribe", async () => {
    const { extractTerms, hotwordsFrom, applyGlossaryWithModel } = await import("@/lib/video/glossary");
    const { transcribeLocal } = await import("@/lib/video/whisper");
    const { toSimplified } = await import("@/lib/text/simplified");
    const terms = extractTerms(fixture.brief);
    const hotwords = hotwordsFrom(terms);
    /* Whisper once per file and hotword list: ~60 s, and the same answer every run. */
    const info = await stat(RAW);
    const key = createHash("sha1").update(`${path.resolve(RAW)}|${info.size}|${Math.round(info.mtimeMs)}|${hotwords.join(",")}`).digest("hex").slice(0, 16);
    await mkdir(path.join(CACHE, "whisper"), { recursive: true });
    const cached = path.join(CACHE, "whisper", `${key}.json`);
    let transcript: Transcript;
    if (await exists(cached)) {
      transcript = await readJson<Transcript>(cached);
      log(`transcribe: whisper cached (${transcript.words.length} words)`);
    } else {
      const audio = path.join(CACHE, "whisper", `${key}.wav`);
      if (!(await exists(audio))) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", RAW, "-vn", "-ac", "1", "-ar", "16000", audio], { timeout: 170_000 });
      const t0 = Date.now();
      transcript = await transcribeLocal(audio, "audio.wav", { hotwords });
      log(`transcribe: whisper ${transcript.words.length} words in ${sec(Date.now() - t0)} s`);
      await writeJson(cached, transcript);
    }
    transcript = { ...transcript, text: toSimplified(transcript.text), words: transcript.words.map((w) => ({ ...w, text: toSimplified(w.text) })) };
    const fixed = await applyGlossaryWithModel(transcript.words, terms, { log: (l) => log(`glossary: ${l}`) });
    spent("glossary", fixed.usage?.costMicros);
    log(`transcribe: glossary ${fixed.changes.map((c) => `${c.from}→${c.to}×${c.count}`).join(", ") || "no changes"}`);
    const words: Word[] = (fixed.words as TranscriptWord[])
      .filter((w) => w.type === "word" && w.text.trim())
      .map((w) => ({ text: w.text, startMs: Math.round(w.start * 1000), endMs: Math.round(Math.max(w.start, w.end) * 1000) }));
    const out: TranscribeOut = { terms: terms.map((t) => t.text), hotwords, changes: fixed.changes, words, languageCode: transcript.languageCode };
    await writeJson(file, out);
    return out;
  });
}

/* =================================================================== cut */

type CutOut = {
  words: Word[];
  silences: Silence[];
  fine: Silence[];
  sentences: Sentence[];
  retakes: Retake[];
  decisions: { id: string; drop: boolean; decidedBy: string; whyZh: string }[];
  pieces: CutPiece[];
  report: CutReport;
  lengthMs: number;
  removedMs: number;
  coldOpenId: string | null;
  refused: unknown[];
  refusedRetakes: unknown[];
  holes: unknown[];
};

async function stageCut(fixture: Fixture, tr: TranscribeOut): Promise<CutOut> {
  const file = path.join(OUT, "cut.json");
  if (!runs("cut")) return readJson<CutOut>(file);
  return timed("cut", async () => {
    const { planCut, planMessagesV2, parsePlanV2, holeTranscriber, EMPTY_PLAN_V2 } = await import("@/lib/video/autoedit");
    const { targetFromBrief } = await import("@/lib/video/length");
    const { briefPhrases, decideRetakes, fillHoles, findRetakes, toRetake } = await import("@/lib/video/retakes");
    const { alignWords, toSentences } = await import("@/lib/video/sentences");
    const { detectSilences } = await import("@/lib/video/silences");
    const { complete } = await import("@/lib/ai/openrouter");
    const { modelFor } = await import("@/lib/ai/models");

    const clipId = fixture.source.clipId;
    const totalMs = fixture.source.durationMs;
    const brief = fixture.brief;
    const targetMs = targetFromBrief(brief);
    const fine = await detectSilences(RAW, { db: -32, minMs: 80, cacheDir: CACHE });
    const silences = fine.filter((s) => s.endMs - s.startMs >= 250);
    const filled = await fillHoles(tr.words, silences, holeTranscriber(RAW, "zh"));
    const words = alignWords(filled.words, fine);
    const sentences = toSentences(words, [], { clipId, silences });
    const found = findRetakes(words, sentences, { briefPhrases: briefPhrases(brief), silences });
    const ask = (what: string, model: string, temperature: number, maxTokens: number) => async (messages: { role: "system" | "user"; content: string }[]) => {
      const out = await complete({ model, temperature, maxTokens, messages });
      spent(what, out.costMicros);
      return out.text;
    };
    const modelDecisions = await decideRetakes(found.ambiguous, ask("retakes", modelFor.utility(), 0, 600));
    const decisions = [...found.decisions, ...modelDecisions];
    const retakes = decisions.filter((d) => d.drop).map(toRetake);
    let plan = EMPTY_PLAN_V2;
    try {
      const raw = await ask("cut plan", modelFor.assistant(), 0.2, 2000)(planMessagesV2({ title: fixture.project.title, sentences, retakes, brief, targetMs, totalMs }));
      plan = parsePlanV2(raw, new Set(sentences.map((s) => s.id)));
    } catch (err) {
      log(`cut: plan call failed (${err instanceof Error ? err.message : err}); cutting without it`);
    }
    const cut = planCut({ sentences, silences, fineSilences: fine, words, brief, targetMs, retakes, plan, totalMs });
    log(`cut: ${cut.pieces.length} pieces, ${sec(cut.lengthMs)} s kept, ${sec(cut.removedMs)} s removed; ${cut.report.noteZh}`);
    const out: CutOut = {
      words,
      silences,
      fine,
      sentences,
      retakes,
      decisions: decisions.map((d) => ({ id: d.id, drop: d.drop, decidedBy: d.decidedBy, whyZh: d.whyZh })),
      pieces: cut.pieces,
      report: cut.report,
      lengthMs: cut.lengthMs,
      removedMs: cut.removedMs,
      coldOpenId: cut.coldOpenId,
      refused: cut.refused,
      refusedRetakes: cut.refusedRetakes.map((r) => ({ ...r.retake, text: r.text, whyZh: r.whyZh })),
      holes: filled.holes,
    };
    await writeJson(file, out);
    /* The cut report a person reads: what went and why, and what was kept against advice. */
    const lines = [
      `蒸馏 cut: ${cut.pieces.length} pieces, ${sec(cut.lengthMs)} s kept of ${sec(totalMs)} s (${sec(cut.removedMs)} s removed)`,
      cut.report.noteZh,
      "",
      "Removed:",
      ...cut.report.removed.map((r) => `  [${r.reason}] ${sec(r.ms)} s  ${r.sentenceIds.join(",")}  ${r.text}`),
      "",
      `Restored by the audit: ${cut.report.restored.join(", ") || "none"}`,
      `Over budget: ${sec(cut.report.overBudgetMs)} s`,
      "",
      "Retake decisions:",
      ...decisions.map((d) => `  ${d.id} ${d.drop ? "DROP" : "keep"} (${d.decidedBy}) ${d.whyZh}`),
      ...cut.refusedRetakes.map((r) => `  kept, no quiet to cut at: ${sec(r.retake.dropStartMs)}–${sec(r.retake.dropEndMs)} ${r.text} — ${r.whyZh}`),
      "",
      "Model drops refused:",
      ...cut.refused.map((r) => `  ${r.id}: ${r.whyZh}`),
    ];
    await writeFile(path.join(OUT, "cut-report.txt"), lines.join("\n"), "utf8");
    return out;
  });
}

/* ================================================================ design */

type CaptionRow = { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[]; second: string | null; keywords: string[] };
type DesignOut = {
  face: FaceTrack & { series?: unknown[] };
  timelineSentences: Sentence[];
  timelinePieces: { inMs: number; outMs: number }[];
  totalMs: number;
  timelineWords: Word[];
  captions: CaptionRow[];
  outlineRaw: string;
  outline: Outline;
  chinY: number;
};

/**
 * The English line for every caption, in batches of 20, four at a time.
 *
 * The model is asked to echo each Chinese line beside its English, and an
 * answer is matched back by that echo, not by the index it gives: the
 * first integrated run numbered its answers its own way and every English
 * line after the first batch sat under the wrong Chinese one. A batch whose
 * echoes do not line up is asked once more; what still does not line up is
 * left without English rather than shown under the wrong words.
 */
const TRANSLATE_SYSTEM = `You subtitle a Chinese business creator's vertical reel in English. You get a JSON array of Chinese caption lines. Answer with one JSON object and nothing else: {"lines":[{"zh":"the Chinese line copied exactly","en":"a short natural English subtitle, at most 8 words","kw":"at most one word copied verbatim from the Chinese line worth the accent colour (a name, a figure, the verb it turns on), or empty"}]}, exactly one entry per input line, in the same order. Keep names and figures exactly (Anthropic, Claude, DeepSeek, Kimi, MiniMax, ByteDance, Zhang Yiming, Alibaba, NSA, CISA, FBI). A caption line is often a fragment of a sentence: translate the fragment, do not complete it from its neighbours.`;

const bare = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, "");

async function translateLines(zh: string[], call: (system: string, user: string) => Promise<string>): Promise<{ second: string | null; keywords: string[] }[]> {
  const out: { second: string | null; keywords: string[] }[] = zh.map(() => ({ second: null, keywords: [] }));
  const batches: number[][] = [];
  for (let i = 0; i < zh.length; i += 20) batches.push(zh.map((_, k) => k).slice(i, i + 20));
  const attempt = async (idx: number[]): Promise<number[]> => {
    let text = "";
    try {
      text = await call(TRANSLATE_SYSTEM, JSON.stringify(idx.map((i) => zh[i])));
    } catch (err) {
      log(`translate: batch failed (${err instanceof Error ? err.message : err})`);
      return idx;
    }
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    let rows: { zh?: unknown; en?: unknown; kw?: unknown }[] = [];
    try {
      rows = (JSON.parse(text.slice(a, b + 1)) as { lines?: typeof rows }).lines ?? [];
    } catch {
      return idx;
    }
    const missing: number[] = [];
    let cursor = 0;
    for (const i of idx) {
      /* The echo of this line, searched forward from the last match so a skipped row does not shift the rest. */
      const want = bare(zh[i]);
      let hit = -1;
      for (let k = cursor; k < rows.length; k++) if (bare(String(rows[k].zh ?? "")) === want) { hit = k; break; }
      if (hit < 0) { missing.push(i); continue; }
      cursor = hit + 1;
      const en = String(rows[hit].en ?? "").trim();
      const kw = String(rows[hit].kw ?? "").trim();
      out[i] = { second: en || null, keywords: kw && zh[i].includes(kw) ? [kw] : [] };
    }
    return missing;
  };
  const left = (await pmap(batches, 4, attempt)).flat();
  if (left.length) {
    const again: number[][] = [];
    for (let i = 0; i < left.length; i += 20) again.push(left.slice(i, i + 20));
    const still = (await pmap(again, 4, attempt)).flat();
    if (still.length) log(`translate: ${still.length} lines left without English (echo did not match)`);
  }
  return out;
}

async function stageDesign(fixture: Fixture, cut: CutOut): Promise<DesignOut> {
  const file = path.join(OUT, "design.json");
  if (!runs("design")) return readJson<DesignOut>(file);
  return timed("design", async () => {
    const { faceTrackCached } = await import("@/lib/video/face");
    const { sentencesOnTimeline, faceBoxUnder, FRAMING } = await import("@/lib/video/layout");
    const { toCaptionLines } = await import("@/lib/video/elevenlabs");
    const { captionPreset } = await import("@/lib/video/presets");
    const { extractTerms, jsonCompletion } = await import("@/lib/video/glossary");
    const { furnitureFromBrief } = await import("@/lib/video/director");
    const { planDesign } = await import("@/lib/video/v2/design");
    const { complete } = await import("@/lib/ai/openrouter");
    const { modelFor } = await import("@/lib/ai/models");

    /* The face: YuNet over the raw take every 2 s, cached per file. */
    const track = await faceTrackCached(RAW, { cacheDir: CACHE, clipId: fixture.source.clipId });
    const face: FaceTrack = { clipId: track.clipId, box: track.box, eyeY: track.eyeY, chinY: track.chinY, samples: track.samples };
    log(`design: face ${track.samples} samples, eye ${track.eyeY.toFixed(3)}, chin ${track.chinY.toFixed(3)}`);

    const mapped = sentencesOnTimeline(cut.sentences, cut.pieces);
    const timelineWords = wordsOnTimeline(cut.words, cut.pieces);
    /*
     * The cut's sentence ends, marked on the words the caption breaker reads.
     * Whisper's punctuation does not survive every cut (a retake removed, two
     * takes joined), so r01 had lines running across sentences:
     * 「你的新经济摆渡人你」「标准那么Anthropic」. A full stop on each sentence's
     * last word lets the breaker end the line there (it already avoids
     * reading across one).
     */
    const lastWord = new Set<number>();
    for (const s of mapped.sentences) {
      let k = -1;
      timelineWords.forEach((w, i) => {
        if (w.startMs >= s.startMs - 30 && w.endMs <= s.endMs + 30) k = i;
      });
      if (k >= 0) lastWord.add(k);
    }
    const captionWords = timelineWords.map((w, i) => (lastWord.has(i) && !/[，。、！？；：,.!?;:…]$/.test(w.text.trim()) ? { ...w, text: `${w.text}。` } : w));

    /* Reel caption lines on the cut's clock. */
    const preset = captionPreset(PRESET);
    const reel = preset.style.reel;
    const terms = extractTerms(fixture.brief).map((t) => t.text);
    const transcript: Transcript = {
      text: captionWords.map((w) => w.text).join(""),
      languageCode: "zh",
      languageProbability: 1,
      durationSecs: mapped.totalMs / 1000,
      words: captionWords.map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000, type: "word" })),
    };
    const lines = toCaptionLines(transcript, reel ? { reel: { aimChars: reel.aimChars, maxChars: reel.maxChars, minChars: reel.minChars, minMs: reel.minMs, terms } } : {});
    log(`design: ${lines.length} caption lines`);

    /* English for each line, matched back by the Chinese it echoes (see `translateLines`). */
    const english = await translateLines(lines.map((l) => l.text), async (system, user) => {
      const res = await jsonCompletion(TRANSLATE_MODEL, [{ role: "system", content: system }, { role: "user", content: user }], AbortSignal.timeout(120_000), 6000);
      spent("translate", res.usage.costMicros);
      return res.text;
    });
    log(`design: translated ${english.filter((e) => e.second).length}/${lines.length}`);
    const captions: CaptionRow[] = lines.map((l, i) => ({ ...l, second: english[i]?.second ?? null, keywords: english[i]?.keywords ?? [] }));

    /* The chin under the plain framing: the captions' top edge keeps 40 px under it. */
    const chinY = Math.round(faceBoxUnder(face, FRAMING.base, FRAMING.eyeY)?.chin ?? 1000);

    /* The outline: one call over the whole transcript (layout recomputed later with the real sourcing). */
    let outlineRaw = "";
    const design = await planDesign(
      {
        brief: fixture.brief,
        sentences: mapped.sentences,
        pieces: mapped.pieces,
        totalMs: mapped.totalMs,
        captions: captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })),
        face,
        pace: "channel",
        accent: fixture.project.accent,
        language: "zh-CN",
        furniture: furnitureFromBrief(fixture.brief, fixture.project.title, fixture.project.tenantName),
        cut: cut.report,
        voice: null,
      },
      {
        complete: async (req) => {
          const t0 = Date.now();
          const out = await complete({ model: modelFor.assistant(), temperature: req.temperature, maxTokens: req.maxTokens, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] });
          spent("outline", out.costMicros);
          log(`design: outline ${out.model} ${out.promptTokens}+${out.completionTokens} tokens $${(out.costMicros / 1e6).toFixed(4)} ${sec(Date.now() - t0)} s`);
          /* The outline call, then the footage call for the gaps it left (design.ts). */
          outlineRaw = outlineRaw ? `${outlineRaw}\n\n--- footage ---\n\n${out.text}` : out.text;
          return { text: out.text, costMicros: out.costMicros };
        },
        sourceBeats: null,
        say: (t) => log(`design: ${t}`),
      },
    );
    const out: DesignOut = { face: track, timelineSentences: mapped.sentences, timelinePieces: mapped.pieces, totalMs: mapped.totalMs, timelineWords, captions, outlineRaw, outline: design.outline, chinY };
    await writeJson(file, out);
    return out;
  });
}

/* ================================================================ source */

/**
 * The media cache stores a fetched picture as `img0.bin`; the motion
 * renderer inlines a logo only by a picture extension. A copy with the
 * extension the bytes say (the mime from the fetch, else the magic) sits
 * beside it, so the entity card shows the logo instead of a monogram.
 */
async function withImageExt(file: string, mime?: string): Promise<string> {
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) return file;
  const head = await readFile(file).then((b) => b.subarray(0, 64), () => Buffer.alloc(0));
  const sniff = head[0] === 0x89 && head[1] === 0x50 ? "png" : head[0] === 0xff && head[1] === 0xd8 ? "jpg" : head.subarray(8, 12).toString() === "WEBP" ? "webp" : head.subarray(0, 3).toString() === "GIF" ? "gif" : /<svg|<\?xml/i.test(head.toString()) ? "svg" : null;
  const ext = sniff ?? (mime?.includes("png") ? "png" : mime?.includes("jpeg") ? "jpg" : mime?.includes("webp") ? "webp" : mime?.includes("svg") ? "svg" : null);
  if (!ext) return file;
  const out = `${file}.${ext}`;
  if (!(await exists(out))) await copyFile(file, out);
  return out;
}

type SourceOut = { design: DesignResult; traces: unknown[]; misses: unknown[]; spend: { media: unknown; vision: { costMicros: number } }; sourcingMs: number };

async function stageSource(fixture: Fixture, cut: CutOut, d: DesignOut): Promise<SourceOut> {
  const file = path.join(OUT, "source.json");
  if (!runs("source")) return readJson<SourceOut>(file);
  return timed("source", async () => {
    const { planDesign } = await import("@/lib/video/v2/design");
    const { furnitureFromBrief } = await import("@/lib/video/director");
    const { sourceBeatsReport } = await import("@/lib/video/v2/sourcing");
    const { entityVisual } = await import("@/lib/video/v2/entities");
    const { fetchLocal, localAsset, resetMediaSpend, mediaSpend } = await import("@/lib/video/v2/media-adapter");
    const { placeCredits } = await import("@/lib/video/v2/credits");
    const { resetVisionSpend, visionSpend } = await import("@/lib/video/vision");
    const { sheet } = await import("@/lib/video/contactsheet");

    resetMediaSpend();
    resetVisionSpend();
    const media = { cacheDir: CACHE, tikhubBudget: TIKHUB };
    const workDir = path.join(OUT, "source");
    await mkdir(workDir, { recursive: true });
    const traces: unknown[] = [];
    const misses: unknown[] = [];
    let sourcingMs = 0;
    const contextEn = `A Chinese business-explainer reel titled 「${d.outline.titleZh}」. ${fixture.brief.replace(/\s+/g, " ").slice(0, 260)}`;

    /*
     * The sourcing answer is kept per beat list in the run directory, so a
     * layout change re-runs from `source` in seconds instead of re-judging
     * every candidate; `--resource` asks again.
     */
    const answerFile = (beats: Beat[]) => path.join(workDir, `answer-${createHash("sha1").update(JSON.stringify(beats)).digest("hex").slice(0, 12)}.json`);
    const sourceBeats = async (beats: Beat[]): Promise<Sourced[]> => {
      const t0 = Date.now();
      const kept = answerFile(beats);
      if (!flag("--resource") && (await exists(kept))) {
        const again = await readJson<{ sourced: Sourced[]; traces: unknown[]; misses: unknown[] }>(kept);
        traces.push(...again.traces);
        misses.push(...again.misses);
        log(`source: ${again.sourced.length}/${beats.length} beats from the kept answer ${path.basename(kept)}`);
        return again.sourced;
      }
      const report = await sourceBeatsReport(beats, {
        sentences: d.timelineSentences,
        into: "local",
        media,
        workDir,
        sheets: true,
        limiter: 6,
        contextEn,
        /* Long enough for the longest cutaway the layout may place (4.5 s): the window comes back cut to its own file. */
        needMs: (b) => (b.intent === "person" || b.intent === "headline" ? 4500 : 4000),
        onProgress: (m) => log(`source: ${m}`),
      });
      sourcingMs += Date.now() - t0;
      await writeJson(kept, { sourced: report.sourced, traces: report.traces, misses: report.misses });
      traces.push(...report.traces);
      misses.push(...report.misses);
      log(`source: ${report.sourced.length}/${beats.length} beats sourced in ${sec(report.ms)} s; ${report.misses.length} misses`);
      /* The chosen-windows sheet: every pick with its line and credit. */
      const cells = report.sourced.map((s) => {
        const t = report.traces.find((x) => x.beatId === s.beatId);
        return { image: t?.chosenImage ?? null, label: `${s.beatId} ${t?.line.slice(0, 26) ?? ""}\n${s.asset.credit.slice(0, 44)}\n${s.score}/10 · ${s.kind} · ${s.layout}\n${s.candidate.licence ?? "平台引用（署名）"}` };
      });
      if (cells.length) await sheet(cells, path.join(OUT, "sheets", "sourced.jpg"), { cols: 5, cellW: 300, cellH: 300, labelLines: 4, title: `${fixture.project.title} · sourced ${report.sourced.length}/${beats.length}` }).catch((err) => log(`source: sheet failed ${err}`));
      return report.sourced;
    };

    /* One logo per entity for its card: the resolver's first mark, fetched to this box. */
    const logoFile = path.join(workDir, "logos.json");
    const logosKept: Record<string, Sourced | null> = !flag("--resource") && (await exists(logoFile)) ? await readJson<Record<string, Sourced | null>>(logoFile) : {};
    const logoFor = async (e: OutlineEntity): Promise<Sourced | null> => {
      if (e.name in logosKept) return logosKept[e.name];
      const found = await logoFresh(e);
      logosKept[e.name] = found;
      await writeJson(logoFile, logosKept);
      return found;
    };
    async function logoFresh(e: OutlineEntity): Promise<Sourced | null> {
      try {
        const visuals = await entityVisual(e, { cacheDir: CACHE, timeoutMs: 20_000 });
        const pick = visuals.find((v) => v.isMark) ?? (e.kind === "person" ? visuals[0] : null);
        if (!pick) return null;
        const local = await fetchLocal(pick.candidate, { signal: AbortSignal.timeout(60_000) }, media);
        if (!local.file) return null;
        const file = await withImageExt(local.file, local.mime);
        const asset = localAsset(pick.candidate, { file, width: local.width, height: local.height });
        return { beatId: e.firstSentenceId ?? "s000", asset, candidate: pick.candidate, kind: "logo", score: 9, reasonZh: `${e.name} 标志（${pick.via}）`, windowMs: [0, 0], subjectX: 0.5, dhash: pick.candidate.id, layout: "full", alternatives: [] };
      } catch (err) {
        log(`source: logo ${e.name} failed: ${err instanceof Error ? err.message : err}`);
        return null;
      }
    }

    const traceLines: string[] = [];
    const design = await planDesign(
      {
        brief: fixture.brief,
        sentences: d.timelineSentences,
        pieces: d.timelinePieces,
        totalMs: d.totalMs,
        captions: d.captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })),
        face: { clipId: d.face.clipId, box: d.face.box, eyeY: d.face.eyeY, chinY: d.face.chinY, samples: d.face.samples },
        pace: "channel",
        accent: fixture.project.accent,
        language: "zh-CN",
        furniture: furnitureFromBrief(fixture.brief, fixture.project.title, fixture.project.tenantName),
        cut: cut.report,
        voice: null,
      },
      { complete: null, outline: d.outline, sourceBeats, entityVisual: logoFor, placeCredits: (s) => placeCredits(s), say: (t) => log(`source: ${t}`), trace: (l) => traceLines.push(l) },
    );
    await writeFile(path.join(OUT, "trace.txt"), traceLines.join("\n"), "utf8");
    const spend = { media: mediaSpend(), vision: visionSpend() };
    spent("vision (sourcing)", spend.vision.costMicros);
    log(`source: plan ${design.plan.cutaways.length} cutaways, ${design.plan.graphics.length} graphics, lint ${design.lint.length}; coverage ${(design.plan.stats.coverage * 100).toFixed(1)} %`);
    const out: SourceOut = { design, traces, misses, spend, sourcingMs };
    await writeJson(file, out);
    await writeJson(path.join(OUT, "plan.json"), design.plan);
    await writeFile(path.join(OUT, "credits.txt"), `${design.credits.line}\n\n${design.credits.block}\n`, "utf8");
    return out;
  });
}

/* ================================================================ motion */

type MotionOut = { specs: GraphicSpecV2[]; clips: MotionClip[] };

async function stageMotion(fixture: Fixture, src: SourceOut): Promise<MotionOut> {
  const file = path.join(OUT, "motion.json");
  if (!runs("motion")) return readJson<MotionOut>(file);
  return timed("motion", async () => {
    const { renderMotionClips } = await import("@/lib/video/motion");
    /* Pictures on cards (logos, a headline's article image) named so the renderer will inline them. */
    const graphics: GraphicSpecV2[] = JSON.parse(JSON.stringify(src.design.plan.graphics)) as GraphicSpecV2[];
    for (const g of graphics) {
      const refs = [g.props.logo, g.props.image, ...(Array.isArray(g.props.group) ? (g.props.group as { logo?: unknown }[]).map((m) => m.logo) : [])];
      for (const ref of refs) {
        const asset = (ref as { asset?: { localPath?: string } } | null | undefined)?.asset;
        if (asset?.localPath) asset.localPath = await withImageExt(asset.localPath);
      }
    }
    const specs = toMotionSpecs(graphics);
    const clips = await renderMotionClips(specs, { width: W, height: H, accent: fixture.project.accent, dir: path.join(OUT, "motion"), log: (l) => log(`motion: ${l}`) });
    log(`motion: ${clips.length}/${specs.length} clips`);
    const out: MotionOut = { specs, clips };
    await writeJson(file, out);
    return out;
  });
}

/* ================================================================ render */

type RenderOut = { mp4: string; assFile: string; furniture: string | null; plan: unknown; skipped: unknown[]; durationMs: number; renderMs: number };

async function furnitureStill(fixture: Fixture, graphics: readonly GraphicSpecV2[], dir: string): Promise<string | null> {
  const { renderGraphics } = await import("@/lib/video/graphics");
  const rows = graphics.filter((g) => FURNITURE.has(g.kind) && String(g.props.text ?? "").trim());
  if (!rows.length) return null;
  const channel = (kind: string) => fixture.graphics.find((g) => g.kind === kind);
  type Spec = Parameters<typeof renderGraphics>[0][number];
  const specs: Spec[] = rows.map((g) => ({
    kind: g.kind as Spec["kind"],
    text: String(g.props.text ?? ""),
    sub: g.props.sub == null ? null : String(g.props.sub),
    startMs: 0,
    endMs: 3000,
    placement: channel(g.kind)?.placement ?? null,
    scale: channel(g.kind)?.scale ?? null,
    enter: "fade",
  }));
  const work = path.join(dir, "furniture");
  await mkdir(work, { recursive: true });
  const files = await renderGraphics(specs, { width: W, height: H, accent: fixture.project.accent, dir: work });
  const out = path.join(dir, "furniture.png");
  const args = ["-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H},format=rgba`];
  for (const f of files) args.push("-i", f);
  const graph: string[] = [];
  let label = "[0:v]";
  files.forEach((_, i) => {
    const next = i === files.length - 1 ? "[out]" : `[f${i}]`;
    if (rows[i].kind === "header") graph.push(`[${i + 1}:v]format=rgba,colorchannelmixer=aa=0.9[h${i}]`, `${label}[h${i}]overlay=0:0:format=auto${next}`);
    else graph.push(`${label}[${i + 1}:v]overlay=0:0:format=auto${next}`);
    label = next;
  });
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "-filter_complex", graph.join(";"), "-map", "[out]", "-frames:v", "1", out], { timeout: 120_000 });
  return out;
}

async function stageRender(fixture: Fixture, cut: CutOut, d: DesignOut, src: SourceOut, motion: MotionOut): Promise<RenderOut> {
  const file = path.join(OUT, "render.json");
  if (!runs("render")) return readJson<RenderOut>(file);
  return timed("render", async () => {
    const { renderTimeline } = await import("@/lib/video/render");
    const { toAss } = await import("@/lib/video/ass");
    const { faceTrackFor, faceAnchor } = await import("@/lib/video/face");
    const dir = path.join(OUT, "render");
    await mkdir(dir, { recursive: true });

    const assText = toAss(
      d.captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words, keywords: c.keywords, second: c.second })),
      { presetKey: PRESET, width: W, height: H, accent: fixture.project.accent, chinY: d.chinY },
    );
    const assFile = path.join(OUT, "captions.ass");
    await writeFile(assFile, assText, "utf8");
    const furniture = await furnitureStill(fixture, src.design.plan.graphics, dir);

    const face = { clipId: d.face.clipId, box: d.face.box, eyeY: d.face.eyeY, chinY: d.face.chinY, samples: d.face.samples };
    const track = d.face as Parameters<typeof faceTrackFor>[0];
    const cuts = toRenderCuts(cut.pieces, src.design.plan.cutZooms, {
      file: RAW,
      face,
      faceAt: (inMs, outMs) => {
        const local = faceTrackFor(track, inMs, outMs);
        return { anchor: faceAnchor(local), faceHeight: local.box[3] };
      },
    });
    const { cutaways, skipped } = toRenderCutaways(src.design.plan.cutaways, src.design.plan.renderHints, face);
    const plan = {
      width: W,
      height: H,
      fps: 30 as const,
      mode: "v2" as const,
      accent: fixture.project.accent,
      workDir: dir,
      cuts,
      cutaways,
      motion: motion.clips,
      furniture: furniture ?? undefined,
      assFile,
      audio: { voiceChain: true, cutFadeMs: 12 as const },
    };
    await writeJson(path.join(OUT, "render-plan.json"), plan);
    log(`render: ${cuts.length} cuts (${cuts.filter((c) => c.seam).length} seams), ${cutaways.length} cutaways (${skipped.length} skipped), ${motion.clips.length} motion clips`);
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
    const out: RenderOut = { mp4, assFile, furniture, plan: { cuts: cuts.length, cutaways: cutaways.length, motion: motion.clips.length }, skipped, durationMs: res.durationMs, renderMs };
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
