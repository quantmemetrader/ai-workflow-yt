/**
 * Director v2, stage by stage: the one pipeline the lab and the product run.
 *
 * The lab (`scripts/dv2/lab.ts`) was where the approved round-3 cut was
 * made: transcribe → cut → design → source → motion → render. The product
 * (`lib/video/director.ts` behind the tenant flag, then `renderExport`)
 * must make the same video, so both call these functions and differ only
 * in what is around them:
 *
 *   - where the take comes from (a fixture path, or the clip's master in the
 *     store, downloaded once into the director's cache);
 *   - where the sourced files go (`into: "local"` under the run directory,
 *     or `into: "files"`: the very bytes the judge chose are imported into
 *     Files through the media library, with attribution and `file_meta`);
 *   - who pays (the lab's cost.json, or a ledger row per model call);
 *   - where the result lands (JSON files per stage, or rows).
 *
 * Nothing here reads or writes the database or the object store. Heavy
 * modules are imported inside each stage, as the lab always did, so a lab
 * run from `--from render` does not load the sourcing stack.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Viewer } from "@/lib/auth/types";
import type { Beat, CutPiece, CutReport, FaceTrack, GraphicSpecV2, MotionClip, Retake, Sentence, Silence, Sourced, Word } from "@/lib/video/v2/types";
import type { DesignResult, Outline, OutlineEntity } from "@/lib/video/v2/design";
import type { CutawaySpec, FramingSegment, LayoutPlan } from "@/lib/video/layout";
import type { RenderInput } from "@/lib/video/render";
import type { FaceTrackDetail } from "@/lib/video/face";
import type { MediaCtx } from "@/lib/video/v2/media-adapter";
import type { SourcingReport } from "@/lib/video/v2/sourcing";
import type { VisionOptions } from "@/lib/video/vision";
import { FURNITURE, toMotionSpecs, toRenderCutaways, toRenderCuts, wordsOnTimeline } from "@/lib/video/v2/render-plan";

const run = promisify(execFile);

/* ------------------------------------------------------------ constants */

/** The reel's frame: v2 is vertical only. */
export const V2_SIZE = { width: 1080, height: 1920 } as const;
/** The caption preset every v2 video is drawn in. */
export const V2_PRESET = "bilingual-reel";
/** The translation model, named so neither the lab nor the product asks the database which one the studio chose. */
export const V2_TRANSLATE_MODEL = "qwen/qwen3.8-flash";
/** Metered (TikHub) searches one video may spend (PLAN.md §4). */
export const V2_TIKHUB_BUDGET = 60;

/* ---------------------------------------------------------------- hooks */

export type ModelUsage = { model: string; provider?: string | null; promptTokens: number; completionTokens: number; costMicros: number; requestId?: string | null };

export type Hooks = {
  log: (line: string) => void;
  /** Every paid model call, as it returns: the lab adds it to cost.json, the product writes a ledger row. */
  usage?: (what: string, usage: ModelUsage) => void | Promise<void>;
  /** A progress line for the screen, with the director's step it belongs to. */
  step?: (step: "captions" | "design" | "pictures", text: string) => void | Promise<void>;
};

/** One take: the file the whole video is cut from, and what it is about. */
export type Take = { raw: string; clipId: string; durationMs: number; brief: string; title: string; cacheDir: string };

/* -------------------------------------------------------------- helpers */

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));
const readJson = async <T,>(p: string): Promise<T> => JSON.parse(await readFile(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => writeFile(p, JSON.stringify(v, null, 1), "utf8");
export const sec = (ms: number) => (ms / 1000).toFixed(2);

export async function pmap<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
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

export type TranscribeOut = { terms: string[]; hotwords: string[]; changes: unknown[]; words: Word[]; languageCode: string };

/** Whisper over the whole take with the brief's hotwords (cached per file and hotword list), then the glossary. */
export async function transcribeTake(take: Take, hooks: Hooks): Promise<TranscribeOut> {
  const { extractTerms, hotwordsFrom, applyGlossaryWithModel } = await import("@/lib/video/glossary");
  const { transcribeLocal } = await import("@/lib/video/whisper");
  const { toSimplified } = await import("@/lib/text/simplified");
  const log = hooks.log;
  const terms = extractTerms(take.brief);
  const hotwords = hotwordsFrom(terms);
  /* Whisper once per file and hotword list: ~60 s, and the same answer every run. */
  const info = await stat(take.raw);
  const key = createHash("sha1").update(`${path.resolve(take.raw)}|${info.size}|${Math.round(info.mtimeMs)}|${hotwords.join(",")}`).digest("hex").slice(0, 16);
  await mkdir(path.join(take.cacheDir, "whisper"), { recursive: true });
  const cached = path.join(take.cacheDir, "whisper", `${key}.json`);
  type Transcript = import("@/lib/video/elevenlabs").Transcript;
  let transcript: Transcript;
  if (await exists(cached)) {
    transcript = await readJson<Transcript>(cached);
    log(`transcribe: whisper cached (${transcript.words.length} words)`);
  } else {
    const audio = path.join(take.cacheDir, "whisper", `${key}.wav`);
    if (!(await exists(audio))) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", take.raw, "-vn", "-ac", "1", "-ar", "16000", audio], { timeout: 170_000 });
    const t0 = Date.now();
    transcript = await transcribeLocal(audio, "audio.wav", { hotwords });
    log(`transcribe: whisper ${transcript.words.length} words in ${sec(Date.now() - t0)} s`);
    await writeJson(cached, transcript);
  }
  transcript = { ...transcript, text: toSimplified(transcript.text), words: transcript.words.map((w) => ({ ...w, text: toSimplified(w.text) })) };
  const fixed = await applyGlossaryWithModel(transcript.words, terms, { log: (l) => log(`glossary: ${l}`), brief: take.brief });
  if (fixed.usage) await hooks.usage?.("glossary", fixed.usage);
  log(`transcribe: glossary ${fixed.changes.map((c) => `${c.from}→${c.to}×${c.count}`).join(", ") || "no changes"}`);
  const words: Word[] = (fixed.words as import("@/lib/video/elevenlabs").TranscriptWord[])
    .filter((w) => w.type === "word" && w.text.trim())
    .map((w) => ({ text: w.text, startMs: Math.round(w.start * 1000), endMs: Math.round(Math.max(w.start, w.end) * 1000) }));
  return { terms: terms.map((t) => t.text), hotwords, changes: fixed.changes, words, languageCode: transcript.languageCode };
}

/* =================================================================== cut */

export type CutOut = {
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
  refused: { id: string; anchors: string[]; whyZh: string }[];
  refusedRetakes: { dropStartMs: number; dropEndMs: number; text: string; whyZh: string }[];
  holes: unknown[];
};

/** Silences, whisper's holes, sentences, retakes, the model's plan, and W1's `planCut` over all of it. */
export async function cutTake(take: Take, tr: Pick<TranscribeOut, "words">, hooks: Hooks): Promise<CutOut> {
  const { planCut, planMessagesV2, parsePlanV2, holeTranscriber, EMPTY_PLAN_V2 } = await import("@/lib/video/autoedit");
  const { targetFromBrief } = await import("@/lib/video/length");
  const { briefPhrases, decideRetakes, fillHoles, findRetakes, toRetake } = await import("@/lib/video/retakes");
  const { alignWords, toSentences } = await import("@/lib/video/sentences");
  const { detectSilences } = await import("@/lib/video/silences");
  const { complete } = await import("@/lib/ai/openrouter");
  const { modelFor } = await import("@/lib/ai/models");
  const log = hooks.log;

  const clipId = take.clipId;
  const totalMs = take.durationMs;
  const brief = take.brief;
  const targetMs = targetFromBrief(brief);
  const fine = await detectSilences(take.raw, { db: -32, minMs: 80, cacheDir: take.cacheDir });
  const silences = fine.filter((s) => s.endMs - s.startMs >= 250);
  const filled = await fillHoles(tr.words, silences, holeTranscriber(take.raw, "zh"));
  const words = alignWords(filled.words, fine);
  const all = toSentences(words, [], { clipId, silences });
  const ask = (what: string, model: string, temperature: number, maxTokens: number) => async (messages: { role: "system" | "user"; content: string }[]) => {
    const out = await complete({ model, temperature, maxTokens, messages });
    await hooks.usage?.(what, { model: out.model, provider: out.provider, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    return out.text;
  };
  /*
   * A short (a Reel, a Short: 90 s or less asked of a longer take). The full
   * edit never drops a sentence to hit a length; a short is the opposite
   * job — the strongest whole sentences for the length, in their order: the
   * hook, the fact that proves it, the line to end on. Picked once by the
   * model, checked in code (real ids, in order, near the length); the rest
   * of the cut then runs on those sentences only.
   */
  let sentences = all;
  if (targetMs !== null && targetMs <= 90_000 && totalMs > targetMs * 1.8 && all.length > 3) {
    try {
      const picked = await pickHighlights(all, targetMs, brief, ask("highlights", modelFor.assistant(), 0.2, 800));
      if (picked.length) {
        sentences = picked;
        log(`cut: short of ${sec(targetMs)} s — ${picked.length} of ${all.length} sentences picked (${sec(picked.reduce((n, s) => n + (s.endMs - s.startMs), 0))} s)`);
      }
    } catch (err) {
      log(`cut: could not pick the short's sentences (${err instanceof Error ? err.message : err}); cutting the whole take`);
    }
  }
  const found = findRetakes(words, sentences, { briefPhrases: briefPhrases(brief), silences });
  const modelDecisions = await decideRetakes(found.ambiguous, ask("retakes", modelFor.utility(), 0, 600));
  const decisions = [...found.decisions, ...modelDecisions];
  const retakes = decisions.filter((d) => d.drop).map(toRetake);
  let plan = EMPTY_PLAN_V2;
  try {
    const raw = await ask("cut plan", modelFor.assistant(), 0.2, 2000)(planMessagesV2({ title: take.title, sentences, retakes, brief, targetMs, totalMs }));
    plan = parsePlanV2(raw, new Set(sentences.map((s) => s.id)));
  } catch (err) {
    log(`cut: plan call failed (${err instanceof Error ? err.message : err}); cutting without it`);
  }
  const planned = planCut({ sentences, silences, fineSilences: fine, words, brief, targetMs, retakes, plan, totalMs });
  /* A short keeps only its chosen sentences: the cut works over the take's
     speech, so its pieces are clipped to those sentences' spans (with a
     breath either side) — without this the "short" came out 5:28. */
  const clipped = sentences === all ? planned : clipToSentences(planned, sentences);
  const cut = sentences === all ? clipped : { ...clipped, report: { ...clipped.report, noteZh: `精华短视频：从 ${all.length} 句里选了 ${sentences.length} 句，成片约 ${Math.round(clipped.lengthMs / 1000)} 秒` } };
  log(`cut: ${cut.pieces.length} pieces, ${sec(cut.lengthMs)} s kept, ${sec(cut.removedMs)} s removed; ${cut.report.noteZh}`);
  return {
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
}

/** The cut report a person reads: what went and why, and what was kept against advice. */
export function cutReportText(title: string, cut: CutOut, totalMs: number): string {
  return [
    `${title} cut: ${cut.pieces.length} pieces, ${sec(cut.lengthMs)} s kept of ${sec(totalMs)} s (${sec(cut.removedMs)} s removed)`,
    cut.report.noteZh,
    "",
    "Removed:",
    ...cut.report.removed.map((r) => `  [${r.reason}] ${sec(r.ms)} s  ${r.sentenceIds.join(",")}  ${r.text}`),
    "",
    `Restored by the audit: ${cut.report.restored.join(", ") || "none"}`,
    `Over budget: ${sec(cut.report.overBudgetMs)} s`,
    "",
    "Retake decisions:",
    ...cut.decisions.map((d) => `  ${d.id} ${d.drop ? "DROP" : "keep"} (${d.decidedBy}) ${d.whyZh}`),
    ...cut.refusedRetakes.map((r) => `  kept, no quiet to cut at: ${sec(r.dropStartMs)}–${sec(r.dropEndMs)} ${r.text} — ${r.whyZh}`),
    "",
    "Model drops refused:",
    ...cut.refused.map((r) => `  ${r.id}: ${r.whyZh}`),
  ].join("\n");
}

/* ================================================================ design */

export type CaptionRow = { startMs: number; endMs: number; text: string; words: { start: number; end: number; text: string }[]; second: string | null; keywords: string[] };

export type DesignOut = {
  face: FaceTrackDetail;
  timelineSentences: Sentence[];
  timelinePieces: { inMs: number; outMs: number }[];
  totalMs: number;
  timelineWords: Word[];
  captions: CaptionRow[];
  outlineRaw: string;
  outline: Outline;
  chinY: number;
};

/** What the project and its studio put on every video. */
export type Channel = { accent: string; tenantName: string | null };

/**
 * The English line for every caption, in batches of 12, four at a time.
 *
 * The model is asked to echo each Chinese line beside its English, and an
 * answer is matched back by that echo, not by the index it gives: the
 * first integrated run numbered its answers its own way and every English
 * line after the first batch sat under the wrong Chinese one. A batch whose
 * echoes do not line up is asked once more; what still does not line up is
 * left without English rather than shown under the wrong words.
 */
export const TRANSLATE_SYSTEM = `You subtitle a Chinese business creator's vertical reel in English. You get a JSON array of Chinese caption lines. Answer with one JSON object and nothing else: {"lines":[{"zh":"the Chinese line copied exactly","en":"a short natural English subtitle, at most 8 words","kw":"at most one word copied verbatim from the Chinese line worth the accent colour (a name, a figure, the verb it turns on), or empty"}]}, exactly one entry per input line, in the same order. Keep names and figures exactly (Anthropic, Claude, DeepSeek, Kimi, MiniMax, ByteDance, Zhang Yiming, Alibaba, NSA, CISA, FBI). A caption line is often a fragment of a sentence: translate the fragment, do not complete it from its neighbours. Each "en" translates only the words of its own "zh" row: never carry words over from the row before or push them to the row after (r02's English ran two lines behind the Chinese for 20 s), and every "en" is whole English words (never "distillation su" on one row and "perior" on the next). A garbled or cut-off fragment still gets a short literal English of what is there, never an empty "en".`;

const bare = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, "");

export async function translateLines(zh: string[], call: (system: string, user: string) => Promise<string>, log: (line: string) => void = () => {}): Promise<{ second: string | null; keywords: string[] }[]> {
  const out: { second: string | null; keywords: string[] }[] = zh.map(() => ({ second: null, keywords: [] }));
  const batches: number[][] = [];
  for (let i = 0; i < zh.length; i += 12) batches.push(zh.map((_, k) => k).slice(i, i + 12));
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
    for (let i = 0; i < left.length; i += 6) again.push(left.slice(i, i + 6));
    const still = (await pmap(again, 4, attempt)).flat();
    if (still.length) log(`translate: ${still.length} lines left without English (echo did not match)`);
  }
  return out;
}

/** The input `planDesign` takes, the same for the outline pass and the sourcing pass. */
async function designInput(take: Take, cut: CutOut, d: Pick<DesignOut, "timelineSentences" | "timelinePieces" | "totalMs" | "captions">, face: FaceTrack, channel: Channel) {
  const { furnitureFromBrief } = await import("@/lib/video/v2/furniture");
  return {
    brief: take.brief,
    sentences: d.timelineSentences,
    pieces: d.timelinePieces,
    totalMs: d.totalMs,
    captions: d.captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })),
    face,
    pace: "channel" as const,
    accent: channel.accent,
    language: "zh-CN",
    furniture: furnitureFromBrief(take.brief, take.title, channel.tenantName),
    cut: cut.report,
    voice: null,
  };
}

const medianFace = (t: FaceTrack): FaceTrack => ({ clipId: t.clipId, box: t.box, eyeY: t.eyeY, chinY: t.chinY, samples: t.samples });

/**
 * The face, the reel caption lines on the cut's clock, the English line per
 * caption, and the outline call (the layout it makes here is thrown away:
 * `sourceTake` lays out again with the real sourcing).
 */
export async function designTake(
  take: Take,
  cut: CutOut,
  opts: Channel & { face: () => Promise<FaceTrackDetail>; preset?: string; translateModel?: string },
  hooks: Hooks,
): Promise<DesignOut> {
  const { sentencesOnTimeline, faceBoxUnder, FRAMING } = await import("@/lib/video/layout");
  const { toCaptionLines } = await import("@/lib/video/elevenlabs");
  const { captionPreset } = await import("@/lib/video/presets");
  const { extractTerms, jsonCompletion } = await import("@/lib/video/glossary");
  const { planDesign } = await import("@/lib/video/v2/design");
  const { complete } = await import("@/lib/ai/openrouter");
  const { modelFor } = await import("@/lib/ai/models");
  const log = hooks.log;

  /* The face: YuNet over the raw take every 2 s, cached per file. */
  const track = await opts.face();
  const face = medianFace(track);
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
  await hooks.step?.("captions", "按短句断字幕行，翻译英文字幕");
  const preset = captionPreset(opts.preset ?? V2_PRESET);
  const reel = preset.style.reel;
  const terms = extractTerms(take.brief).map((t) => t.text);
  const transcript: import("@/lib/video/elevenlabs").Transcript = {
    text: captionWords.map((w) => w.text).join(""),
    languageCode: "zh",
    languageProbability: 1,
    durationSecs: mapped.totalMs / 1000,
    words: captionWords.map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000, type: "word" })),
  };
  const lines = toCaptionLines(transcript, reel ? { reel: { aimChars: reel.aimChars, maxChars: reel.maxChars, minChars: reel.minChars, minMs: reel.minMs, terms } } : {});
  log(`design: ${lines.length} caption lines`);

  /* English for each line, matched back by the Chinese it echoes (see `translateLines`). */
  const model = opts.translateModel ?? V2_TRANSLATE_MODEL;
  const english = await translateLines(
    lines.map((l) => l.text),
    async (system, user) => {
      const res = await jsonCompletion(model, [{ role: "system", content: system }, { role: "user", content: user }], AbortSignal.timeout(120_000), 6000);
      await hooks.usage?.("translate", res.usage);
      return res.text;
    },
    log,
  );
  log(`design: translated ${english.filter((e) => e.second).length}/${lines.length}`);
  const captions: CaptionRow[] = lines.map((l, i) => ({ ...l, second: english[i]?.second ?? null, keywords: english[i]?.keywords ?? [] }));

  /* The chin under the plain framing: the captions' top edge keeps 40 px under it. */
  const chinY = Math.round(faceBoxUnder(face, FRAMING.base, FRAMING.eyeY)?.chin ?? 1000);

  /* The outline: one call over the whole transcript (layout recomputed later with the real sourcing). */
  let outlineRaw = "";
  const partial = { timelineSentences: mapped.sentences, timelinePieces: mapped.pieces, totalMs: mapped.totalMs, captions };
  const design = await planDesign(await designInput(take, cut, partial, face, opts), {
    complete: async (req) => {
      const t0 = Date.now();
      const out = await complete({ model: modelFor.assistant(), temperature: req.temperature, maxTokens: req.maxTokens, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] });
      await hooks.usage?.("outline", { model: out.model, provider: out.provider, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
      log(`design: outline ${out.model} ${out.promptTokens}+${out.completionTokens} tokens $${(out.costMicros / 1e6).toFixed(4)} ${sec(Date.now() - t0)} s`);
      /* The outline call, then the footage call for the gaps it left (design.ts). */
      outlineRaw = outlineRaw ? `${outlineRaw}\n\n--- footage ---\n\n${out.text}` : out.text;
      return { text: out.text, costMicros: out.costMicros };
    },
    sourceBeats: null,
    say: async (t) => {
      log(`design: ${t}`);
      await hooks.step?.("design", t);
    },
  });
  return { face: track, timelineSentences: mapped.sentences, timelinePieces: mapped.pieces, totalMs: mapped.totalMs, timelineWords, captions, outlineRaw, outline: design.outline, chinY };
}

/* ================================================================ source */

/**
 * The media cache stores a fetched picture as `img0.bin`; the motion
 * renderer inlines a logo only by a picture extension. A copy with the
 * extension the bytes say (the mime from the fetch, else the magic) sits
 * beside it, so the entity card shows the logo instead of a monogram.
 */
export async function withImageExt(file: string, mime?: string): Promise<string> {
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(file)) return file;
  const head = await readFile(file).then((b) => b.subarray(0, 64), () => Buffer.alloc(0));
  const sniff = head[0] === 0x89 && head[1] === 0x50 ? "png" : head[0] === 0xff && head[1] === 0xd8 ? "jpg" : head.subarray(8, 12).toString() === "WEBP" ? "webp" : head.subarray(0, 3).toString() === "GIF" ? "gif" : /<svg|<\?xml/i.test(head.toString()) ? "svg" : null;
  const ext = sniff ?? (mime?.includes("png") ? "png" : mime?.includes("jpeg") ? "jpg" : mime?.includes("webp") ? "webp" : mime?.includes("svg") ? "svg" : null);
  if (!ext) return file;
  const out = `${file}.${ext}`;
  if (!(await exists(out))) await copyFile(file, out);
  return out;
}

export type SourceOut = { design: DesignResult; traces: unknown[]; misses: unknown[]; spend: { media: unknown; vision: { costMicros: number } }; sourcingMs: number; traceLines: string[] };

/** What the lab keeps between runs so a layout change does not re-judge every candidate; the product keeps nothing. */
export type SourceMemo = {
  answers?: { get: (beats: Beat[]) => Promise<{ sourced: Sourced[]; traces: unknown[]; misses: unknown[] } | null>; put: (beats: Beat[], kept: { sourced: Sourced[]; traces: unknown[]; misses: unknown[] }) => Promise<void> };
  logos?: { get: (name: string) => Promise<Sourced | null | undefined>; put: (name: string, found: Sourced | null) => Promise<void> };
  /** Each fresh sourcing report as it lands (the lab draws its contact sheet from it). */
  onReport?: (report: SourcingReport, beats: Beat[]) => Promise<void>;
};

export type SourceOpts = Channel & {
  /** `local`: every file stays under `workDir` (the lab). `files`: the chosen bytes are imported into Files (the product). */
  into: "local" | "files";
  viewer?: Viewer;
  workDir: string;
  media: MediaCtx;
  vision?: VisionOptions;
  memo?: SourceMemo;
};

/**
 * W3 sourcing for every footage beat, the entity logos, and the layout
 * (W6 `planDesign`) with what was found: the plan, the credits.
 */
export async function sourceTake(take: Take, cut: CutOut, d: DesignOut, opts: SourceOpts, hooks: Hooks): Promise<SourceOut> {
  const { planDesign } = await import("@/lib/video/v2/design");
  const { sourceBeatsReport } = await import("@/lib/video/v2/sourcing");
  const { entityVisual } = await import("@/lib/video/v2/entities");
  const { fetchIntoFiles, fetchLocal, localAsset, resetMediaSpend, mediaSpend } = await import("@/lib/video/v2/media-adapter");
  const { placeCredits } = await import("@/lib/video/v2/credits");
  const { resetVisionSpend, visionSpend } = await import("@/lib/video/vision");
  const log = hooks.log;
  if (opts.into === "files" && !opts.viewer) throw new Error("sourceTake: into \"files\" needs a viewer");

  resetMediaSpend();
  resetVisionSpend();
  const media = opts.media;
  const workDir = opts.workDir;
  await mkdir(workDir, { recursive: true });
  const traces: unknown[] = [];
  const misses: unknown[] = [];
  let sourcingMs = 0;
  const contextEn = `A Chinese business-explainer reel titled 「${d.outline.titleZh}」. ${take.brief.replace(/\s+/g, " ").slice(0, 260)}`;
  const say = async (t: string) => {
    log(`source: ${t}`);
    await hooks.step?.("pictures", t);
  };

  const sourceBeats = async (beats: Beat[]): Promise<Sourced[]> => {
    const t0 = Date.now();
    const kept = await opts.memo?.answers?.get(beats);
    if (kept) {
      traces.push(...kept.traces);
      misses.push(...kept.misses);
      log(`source: ${kept.sourced.length}/${beats.length} beats from the kept answer`);
      return kept.sourced;
    }
    const report = await sourceBeatsReport(beats, {
      sentences: d.timelineSentences,
      into: opts.into,
      viewer: opts.viewer,
      media,
      workDir,
      sheets: opts.into === "local",
      limiter: 6,
      contextEn,
      /* Long enough for the longest cutaway the layout may place (4.5 s): the window comes back cut to its own file. */
      needMs: (b) => (b.intent === "person" || b.intent === "headline" ? 4500 : 4000),
      onProgress: (m) => log(`source: ${m}`),
      vision: opts.vision,
    });
    sourcingMs += Date.now() - t0;
    await opts.memo?.answers?.put(beats, { sourced: report.sourced, traces: report.traces, misses: report.misses });
    traces.push(...report.traces);
    misses.push(...report.misses);
    log(`source: ${report.sourced.length}/${beats.length} beats sourced in ${sec(report.ms)} s; ${report.misses.length} misses`);
    await opts.memo?.onReport?.(report, beats);
    return report.sourced;
  };

  /* One logo per entity for its card: the resolver's first mark, fetched to this box (and, in the product, into Files). */
  const logoFor = async (e: OutlineEntity): Promise<Sourced | null> => {
    const kept = await opts.memo?.logos?.get(e.name);
    if (kept !== undefined) return kept;
    const found = await logoFresh(e);
    await opts.memo?.logos?.put(e.name, found);
    return found;
  };
  async function logoFresh(e: OutlineEntity): Promise<Sourced | null> {
    try {
      const visuals = await entityVisual(e, { cacheDir: media.cacheDir, timeoutMs: 20_000 });
      const pick = visuals.find((v) => v.isMark) ?? (e.kind === "person" ? visuals[0] : null);
      if (!pick) return null;
      const local = await fetchLocal(pick.candidate, { signal: AbortSignal.timeout(60_000) }, media);
      if (!local.file) return null;
      const file = await withImageExt(local.file, local.mime);
      const asset =
        opts.into === "files" && opts.viewer
          ? { ...(await fetchIntoFiles(opts.viewer, pick.candidate, { localFile: file, forLine: `${e.name} 标志` })), localPath: file }
          : localAsset(pick.candidate, { file, width: local.width, height: local.height });
      return { beatId: e.firstSentenceId ?? "s000", asset, candidate: pick.candidate, kind: "logo", score: 9, reasonZh: `${e.name} 标志（${pick.via}）`, windowMs: [0, 0], subjectX: 0.5, dhash: pick.candidate.id, layout: "full", alternatives: [] };
    } catch (err) {
      log(`source: logo ${e.name} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  const traceLines: string[] = [];
  const design = await planDesign(await designInput(take, cut, d, medianFace(d.face), opts), {
    complete: null,
    outline: d.outline,
    sourceBeats,
    entityVisual: logoFor,
    placeCredits: (s) => placeCredits(s),
    say,
    trace: (l) => traceLines.push(l),
  });
  const spend = { media: mediaSpend(), vision: visionSpend() };
  log(`source: plan ${design.plan.cutaways.length} cutaways, ${design.plan.graphics.length} graphics, lint ${design.lint.length}; coverage ${(design.plan.stats.coverage * 100).toFixed(1)} %`);
  return { design, traces, misses, spend, sourcingMs, traceLines };
}

/* ================================================================ motion */

export type MotionOut = { specs: GraphicSpecV2[]; clips: MotionClip[] };

/** W4 Remotion alpha clips for every graphic but the furniture. */
export async function motionTake(graphicsIn: readonly GraphicSpecV2[], opts: { accent: string; dir: string }, hooks: Hooks): Promise<MotionOut> {
  const { renderMotionClips } = await import("@/lib/video/motion");
  /* Pictures on cards (logos, a headline's article image) named so the renderer will inline them. */
  const graphics: GraphicSpecV2[] = JSON.parse(JSON.stringify(graphicsIn)) as GraphicSpecV2[];
  for (const g of graphics) {
    const refs = [g.props.logo, g.props.image, ...(Array.isArray(g.props.group) ? (g.props.group as { logo?: unknown }[]).map((m) => m.logo) : [])];
    for (const ref of refs) {
      const asset = (ref as { asset?: { localPath?: string } } | null | undefined)?.asset;
      if (asset?.localPath) asset.localPath = await withImageExt(asset.localPath);
    }
  }
  const specs = toMotionSpecs(graphics);
  const clips = await renderMotionClips(specs, { width: V2_SIZE.width, height: V2_SIZE.height, accent: opts.accent, dir: opts.dir, log: (l) => hooks.log(`motion: ${l}`) });
  hooks.log(`motion: ${clips.length}/${specs.length} clips`);
  return { specs, clips };
}

/* ================================================================ render */

/** Where the channel's furniture sits (the placements the v1 director writes and the lab's fixture carries). */
export const CHANNEL_FURNITURE: Record<string, { placement: string; scale: number }> = {
  header: { placement: "top-left", scale: 30 },
  watermark: { placement: "bottom-center", scale: 30 },
  footnote: { placement: "bottom-center", scale: 30 },
};

/** Header, watermark and footnote as one merged transparent still under everything. */
export async function furnitureStill(
  graphics: readonly GraphicSpecV2[],
  opts: { accent: string; dir: string; placement?: (kind: string) => { placement: string | null; scale: number | null } | undefined },
): Promise<string | null> {
  const { renderGraphics } = await import("@/lib/video/graphics");
  const { width: W, height: H } = V2_SIZE;
  const rows = graphics.filter((g) => FURNITURE.has(g.kind) && String(g.props.text ?? "").trim());
  if (!rows.length) return null;
  const channel = (kind: string) => opts.placement?.(kind) ?? CHANNEL_FURNITURE[kind];
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
  const work = path.join(opts.dir, "furniture");
  await mkdir(work, { recursive: true });
  const files = await renderGraphics(specs, { width: W, height: H, accent: opts.accent, dir: work });
  const out = path.join(opts.dir, "furniture.png");
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

/** The captions as ASS in the reel preset, the top edge kept clear of the chin. */
export async function captionsAss(captions: readonly import("@/lib/video/ass").AssCue[], opts: { accent: string; chinY: number; preset?: string }): Promise<string> {
  const { toAss } = await import("@/lib/video/ass");
  return toAss(
    captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words, keywords: c.keywords, second: c.second })),
    { presetKey: opts.preset ?? V2_PRESET, width: V2_SIZE.width, height: V2_SIZE.height, accent: opts.accent, chinY: opts.chinY },
  );
}

/**
 * W5's `renderTimeline` plan for a v2 video: the take's pieces framed on the
 * face per stretch, the layout's cutaways, the motion clips, the furniture,
 * the captions, the voice chain.
 */
export async function v2RenderPlan(input: {
  raw: string;
  pieces: readonly CutPiece[];
  cutZooms: readonly FramingSegment[];
  renderHints: LayoutPlan["renderHints"];
  cutaways: readonly CutawaySpec[];
  face: FaceTrackDetail;
  motion: MotionClip[];
  furniture: string | null;
  assFile: string | undefined;
  accent: string;
  workDir: string;
}): Promise<{ plan: RenderInput; skipped: { id: string; reason: string }[] }> {
  const { faceTrackFor, faceAnchor } = await import("@/lib/video/face");
  const face = medianFace(input.face);
  const cuts = toRenderCuts(input.pieces, input.cutZooms, {
    file: input.raw,
    face,
    faceAt: (inMs, outMs) => {
      const local = faceTrackFor(input.face, inMs, outMs);
      return { anchor: faceAnchor(local), faceHeight: local.box[3] };
    },
  });
  const { cutaways, skipped } = toRenderCutaways(input.cutaways, input.renderHints, face);
  const plan: RenderInput = {
    width: V2_SIZE.width,
    height: V2_SIZE.height,
    fps: 30 as const,
    mode: "v2" as const,
    accent: input.accent,
    workDir: input.workDir,
    cuts,
    cutaways,
    motion: input.motion,
    furniture: input.furniture ?? undefined,
    assFile: input.assFile,
    audio: { voiceChain: true, cutFadeMs: 12 as const },
  };
  return { plan, skipped };
}

/** The strongest whole sentences for a short, in their order (see `cutTake`). */
async function pickHighlights<T extends { id: string; startMs: number; endMs: number; text: string }>(
  sentences: T[],
  targetMs: number,
  brief: string,
  ask: (messages: { role: "system" | "user"; content: string }[]) => Promise<string>,
): Promise<T[]> {
  const list = sentences.map((s) => `${s.id} | ${((s.endMs - s.startMs) / 1000).toFixed(1)}s | ${s.text}`).join("\n");
  const raw = await ask([
    {
      role: "system",
      content:
        "You cut short vertical videos (Instagram Reels, YouTube Shorts) from a talking-head take. From the numbered sentences, choose the few that make the strongest short of the target length: open on the most gripping claim (the hook), keep one concrete fact or number that proves it, and end on a line that lands (a punchline or a question). Whole sentences only, never retakes of the same line, in their original order, total between 85% and 110% of the target (add a supporting sentence rather than come in short). Answer JSON only: {\"ids\": [\"s003\", …]}.",
    },
    { role: "user", content: `Target: ${Math.round(targetMs / 1000)} seconds.\nBrief: ${brief.slice(0, 1200)}\n\nSentences (id | length | text):\n${list}` },
  ]);
  const m = raw.match(/\{[\s\S]*\}/);
  const ids = new Set<string>(m ? ((JSON.parse(m[0]) as { ids?: unknown }).ids as string[] | undefined)?.filter((x) => typeof x === "string") ?? [] : []);
  const chosen = sentences.filter((s) => ids.has(s.id));
  /* Short of the length (models pick sparingly): add the sentence just
     before a chosen one — usually its setup ("调用量6月就已经超过美国了"
     before "7月末达到了63.5%"; "蒸馏能够压缩现有的知识" before "但是创造不了
     新的能力") — until the short is near its length. */
  let total = chosen.reduce((n, s) => n + (s.endMs - s.startMs), 0);
  for (let round = 0; round < 3 && total < targetMs * 0.8; round++) {
    for (const c of [...chosen].reverse()) {
      if (total >= targetMs * 0.8) break;
      const i = sentences.indexOf(c);
      const prev = i > 0 ? sentences[i - 1] : null;
      if (!prev || ids.has(prev.id) || total + (prev.endMs - prev.startMs) > targetMs * 1.1) continue;
      ids.add(prev.id);
      total += prev.endMs - prev.startMs;
    }
    chosen.splice(0, chosen.length, ...sentences.filter((s) => ids.has(s.id)));
  }
  /* Near the length: trim from the end if the model went over. */
  while (chosen.length > 1 && total > targetMs * 1.2) {
    const last = chosen.splice(chosen.length - 2, 1)[0];
    total -= last.endMs - last.startMs;
  }
  return chosen.length >= 2 ? chosen : [];
}

/** The cut's pieces, kept only inside the chosen sentences (a short). */
function clipToSentences<C extends { pieces: { clipId: string; inMs: number; outMs: number }[]; lengthMs: number; removedMs: number }>(cut: C, sentences: { startMs: number; endMs: number }[]): C {
  const spans = sentences.map((s) => ({ a: s.startMs - 120, b: s.endMs + 160 })).sort((x, y) => x.a - y.a);
  const pieces: C["pieces"] = [];
  for (const p of cut.pieces) {
    for (const sp of spans) {
      const inMs = Math.max(p.inMs, sp.a);
      const outMs = Math.min(p.outMs, sp.b);
      if (outMs - inMs >= 120) pieces.push({ ...p, inMs, outMs });
    }
  }
  pieces.sort((x, y) => x.inMs - y.inMs);
  const lengthMs = pieces.reduce((n, p) => n + (p.outMs - p.inMs), 0);
  return { ...cut, pieces, removedMs: cut.removedMs + (cut.lengthMs - lengthMs), lengthMs };
}
