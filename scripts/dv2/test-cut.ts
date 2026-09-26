/**
 * W1 on the 蒸馏 fixture: the clean cut, measured against the gold labels.
 *
 *   cd /home/ubuntu/wt/dv2-W1 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-cut.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] [--raw /home/ubuntu/raw/zhengliu.mp4] \
 *       [--gold /tmp/dv2_lab/fixture/zhengliu.gold.json] [--out /tmp/dv2_lab/W1] [--cache /tmp/dv2_lab/cache] \
 *       [--no-model] [--no-holes] [--no-audio]
 *
 * No database, nothing written outside `--out` and `--cache`. Two paid model
 * calls at most (the ambiguous retakes; the plan), none with `--no-model`.
 * Writes `cut.json` (pieces, retakes, decisions, plan, report), `report.json`
 * (every acceptance item with its measured value), `cut.txt` (the kept
 * transcript with a bar at every cut), `cut.m4a` (the cut's audio, to
 * listen to) and `boundaries/*.wav` (1.2 s around every cut: 0.6 s out,
 * 0.6 s in, so a person can hear each join on its own).
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { complete } from "../../lib/ai/openrouter";
import { modelFor } from "../../lib/ai/models";
import {
  briefAnchors,
  holeTranscriber,
  parsePlanV2,
  planCut,
  planMessagesV2,
  EMPTY_PLAN_V2,
  type PlanV2,
} from "../../lib/video/autoedit";
import { targetFromBrief } from "../../lib/video/length";
import { briefPhrases, decideRetakes, fillHoles, findRetakes, toRetake, type RetakeDecision } from "../../lib/video/retakes";
import { alignWords, joinWords, toSentences, toWords } from "../../lib/video/sentences";
import { detectSilences, parseSilenceLog } from "../../lib/video/silences";
import type { Retake, Word } from "../../lib/video/v2/types";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(name);
const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");
const OUT = arg("--out", "/tmp/dv2_lab/W1");
const CACHE = arg("--cache", "/tmp/dv2_lab/cache");
const NO_MODEL = flag("--no-model");
const NO_HOLES = flag("--no-holes");
const NO_AUDIO = flag("--no-audio");

type Fixture = {
  brief: string | null;
  source: { path: string; clipId: string; durationMs: number };
  sourceWords?: { words: { text: string; start: number; end: number }[] } | null;
};
type Gold = {
  retakes: {
    name: string;
    kind: string;
    dropStartMs: number;
    dropEndMs: number;
    silenceSnap: { startMs: number | null; endMs: number | null };
    acceptableDropStartsMs?: number[];
  }[];
  ambiguous: { name: string; first: { startMs: number }; second: { startMs: number }; expected: string }[];
  anchors: { quotedPhrases: { text: string; mentions: { asTranscribed: string }[]; note?: string }[] };
  totals: { expectedOutputMs: [number, number]; expectedCuts: [number, number] };
};

const norm = (s: string) => s.replace(/[\p{P}\p{S}\s]/gu, "").toLowerCase();
const sec = (ms: number) => (ms / 1000).toFixed(2);

async function main() {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, since: number) => (timings[name] = Date.now() - since);
  await mkdir(OUT, { recursive: true });

  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const gold = JSON.parse(await readFile(GOLD, "utf8").catch(() => "null")) as Gold | null;
  const raw = fixture.sourceWords?.words ?? [];
  if (!raw.length) throw new Error(`${FIXTURE} carries no sourceWords`);
  const brief = fixture.brief ?? null;
  const clipId = fixture.source.clipId;
  const totalMs = fixture.source.durationMs;
  const targetMs = targetFromBrief(brief);
  let words: Word[] = toWords(raw);

  /* ---- 1. silences ------------------------------------------------ */
  let t = Date.now();
  const fine = await detectSilences(RAW, { db: -32, minMs: 80, cacheDir: CACHE });
  const silences = fine.filter((s) => s.endMs - s.startMs >= 250);
  lap("silencesMs", t);
  console.log(`silences: ${silences.length} ≥ 250 ms, ${fine.length} ≥ 80 ms (${timings.silencesMs} ms)`);

  /* ---- 2. whisper's holes ----------------------------------------- */
  t = Date.now();
  let holes: { startMs: number; endMs: number; kind: string; text: string }[] = [];
  if (!NO_HOLES) {
    const filled = await fillHoles(words, silences, holeTranscriber(RAW, "zh"));
    words = filled.words;
    holes = filled.holes;
  }
  lap("holesMs", t);
  /* Whisper hangs pauses on the word after them; the silences say where the words really are. */
  words = alignWords(words, fine);
  console.log(`holes: ${holes.length} filled (${timings.holesMs} ms)${holes.map((h) => ` ${h.kind} ${sec(h.startMs)}–${sec(h.endMs)} → ${h.text}`).join(";")}`);

  /* ---- 3. sentences and retakes ----------------------------------- */
  t = Date.now();
  const sentences = toSentences(words, [], { clipId, silences });
  const phrases = briefPhrases(brief);
  const found = findRetakes(words, sentences, { briefPhrases: phrases, silences });
  lap("retakesMs", t);
  console.log(`sentences: ${sentences.length}; retake candidates: ${found.candidates.length} (${found.decisions.length} by rule, ${found.ambiguous.length} ambiguous) (${timings.retakesMs} ms)`);
  for (const c of found.candidates) {
    console.log(`  ${c.id} ${c.verdict.padEnd(9)} ${c.kind.padEnd(8)} ${sec(c.dropStartMs)}–${sec(c.dropEndMs)} cov ${c.coverage} lcs ${c.lcs} pause ${c.hasPause ? "y" : "n"} brief ${c.briefHit ? "y" : "n"} | ${c.firstText} ‖ ${c.secondText}`);
  }

  /* ---- 4. the model: ambiguous retakes, then the plan -------------- */
  let modelCalls = 0;
  const ask = (model: string, temperature: number, maxTokens: number) => async (messages: { role: "system" | "user"; content: string }[]) => {
    modelCalls++;
    const out = await complete({ model, temperature, maxTokens, messages });
    console.log(`  model ${out.model} ${out.promptTokens}+${out.completionTokens} tokens, $${(out.costMicros / 1e6).toFixed(5)}`);
    return out.text;
  };
  t = Date.now();
  const modelDecisions: RetakeDecision[] = NO_MODEL
    ? found.ambiguous.map((c) => ({ id: c.id, drop: false, decidedBy: "model", whyZh: "未询问模型（--no-model），保留", candidate: c }))
    : await decideRetakes(found.ambiguous, ask(modelFor.utility(), 0, 600));
  const decisions = [...found.decisions, ...modelDecisions];
  const retakes: Retake[] = decisions.filter((d) => d.drop).map(toRetake);
  lap("decideMs", t);
  for (const d of modelDecisions) console.log(`  ${d.id} model → ${d.drop ? "DROP" : "keep"}: ${d.whyZh}`);

  t = Date.now();
  let plan: PlanV2 = EMPTY_PLAN_V2;
  let planRaw = "";
  if (!NO_MODEL) {
    try {
      planRaw = await ask(modelFor.assistant(), 0.2, 2000)(planMessagesV2({ title: "蒸馏之战", sentences, retakes, brief, targetMs, totalMs }));
      plan = parsePlanV2(planRaw, new Set(sentences.map((s) => s.id)));
    } catch (err) {
      console.log(`  plan call failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  lap("planCallMs", t);
  console.log(`plan: coldOpen ${plan.coldOpen ?? "—"}, ${plan.chapters.length} chapters, ${plan.drop.length} drops${plan.drop.map((d) => ` ${d.id}/${d.reason}/p${d.priority}`).join("")} (${timings.planCallMs} ms)`);

  /* ---- 5. the cut ------------------------------------------------- */
  t = Date.now();
  const cut = planCut({ sentences, silences, fineSilences: fine, words, brief, targetMs, retakes, plan, totalMs });
  lap("planCutMs", t);
  console.log(`cut: ${cut.pieces.length} pieces, ${sec(cut.lengthMs)} s kept, ${sec(cut.removedMs)} s removed; ${cut.report.noteZh}`);
  for (const r of cut.refusedRetakes) console.log(`  kept (no quiet): ${sec(r.retake.dropStartMs)}–${sec(r.retake.dropEndMs)} ${r.text} — ${r.whyZh}`);
  for (const r of cut.refused) console.log(`  refused drop ${r.id}: ${r.whyZh}${r.anchors.length ? " [" + r.anchors.join(",") + "]" : ""}`);
  for (const d of cut.optionalDropped) console.log(`  dropped for length: ${d.id} ${d.reason} ${d.text}`);

  /* ---- 6. measurements -------------------------------------------- */
  const pieces = cut.cuts;
  const keptWords = words.filter((w) => pieces.some((p) => Math.min(p.endMs, w.endMs) - Math.max(p.startMs, w.startMs) >= Math.min(40, (w.endMs - w.startMs) / 2)));
  const keptText = joinWords(keptWords);

  /* Boundaries: every piece edge except the very first start and last end. */
  const edges: { ms: number; side: "out" | "in" }[] = [];
  pieces.forEach((p, i) => {
    if (i > 0) edges.push({ ms: p.startMs, side: "in" });
    if (i < pieces.length - 1) edges.push({ ms: p.endMs, side: "out" });
  });
  const boundaryChecks = edges.map((e) => {
    const inSilence = fine.some((s) => e.ms >= s.startMs && e.ms <= s.endMs);
    let onWord = false;
    let gapMs = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (Math.abs(w.startMs - e.ms) <= 20) {
        gapMs = i > 0 ? w.startMs - words[i - 1].endMs : Infinity;
        onWord = true;
        break;
      }
      if (Math.abs(w.endMs - e.ms) <= 20) {
        gapMs = i + 1 < words.length ? words[i + 1].startMs - w.endMs : Infinity;
        onWord = true;
        break;
      }
    }
    const ok = inSilence || (onWord && gapMs >= 40);
    return { ...e, inSilence, onWordBoundary: onWord && gapMs >= 40, ok };
  });
  const badBoundaries = boundaryChecks.filter((b) => !b.ok);

  /* Pauses left: measured silences ≥ 250 ms that survive whole inside a piece and are longer than 350 ms. */
  const pausesLeft = silences.filter((s) => s.endMs - s.startMs > 350 && pieces.some((p) => s.startMs >= p.startMs && s.endMs <= p.endMs));

  /* Gold retakes. An edge matches within 400 ms of the gold edge or its
     silence-snap edge (the gold's rule), or — since the gold edges are
     whisper word times on the far side of a pause the cut removes — when
     both lie in or against the same measured pause. Both scores are kept. */
  const tol = 400;
  const near = (a: number, b: number | null | undefined) => b !== null && b !== undefined && Math.abs(a - b) <= tol;
  const samePause = (a: number, b: number | null | undefined) =>
    b !== null && b !== undefined && silences.some((s) => a >= s.startMs - 60 && a <= s.endMs + 60 && b >= s.startMs - 100 && b <= s.endMs + 100);
  const predicted = cut.drops.filter((d) => d.reason === "retake");
  const matchGold = (relaxed: boolean) =>
    (gold?.retakes ?? []).map((g) => {
      const starts = [g.dropStartMs, g.silenceSnap.startMs, ...(g.acceptableDropStartsMs ?? [])];
      const ends = [g.dropEndMs, g.silenceSnap.endMs];
      const fits = (p: number, list: (number | null)[]) => list.some((x) => near(p, x) || (relaxed && samePause(p, x)));
      const hit = predicted.find((p) => fits(p.startMs, starts) && fits(p.endMs, ends));
      return { name: g.name, gold: [g.dropStartMs, g.dropEndMs], predicted: hit ? [hit.startMs, hit.endMs] : null, matched: Boolean(hit) };
    });
  const goldStrict = matchGold(false);
  const goldMatches = matchGold(true);
  const ambiguousNames = new Set((gold?.ambiguous ?? []).map((a) => a.first.startMs));
  const falsePositives = predicted.filter(
    (p) =>
      !goldMatches.some((g) => g.predicted && g.predicted[0] === p.startMs) &&
      ![...ambiguousNames].some((s) => Math.abs(p.startMs - s) <= tol),
  );
  const tp = goldMatches.filter((g) => g.matched).length;
  const tpStrict = goldStrict.filter((g) => g.matched).length;
  const precision = predicted.length ? tp / (tp + falsePositives.length) : 1;
  const recall = goldMatches.length ? tp / goldMatches.length : 1;
  const precisionStrict = predicted.length ? tpStrict / (tpStrict + (predicted.length - tpStrict - (predicted.length - tp - falsePositives.length))) : 1;
  const recallStrict = goldStrict.length ? tpStrict / goldStrict.length : 1;
  const ambiguousLogged = (gold?.ambiguous ?? []).map((a) => {
    /* A lookup, not a score: the candidate's start is the aligned word time, up to a pause away from the gold's whisper time. */
    const d = decisions.find((x) => Math.abs(x.candidate.dropStartMs - a.first.startMs) <= 800);
    const kept = d && cut.refusedRetakes.some((r) => r.retake.dropStartMs === d.candidate.dropStartMs);
    return { name: a.name, expected: a.expected, decision: d ? `${d.drop ? (kept ? "drop, but kept: no quiet at the edge" : "drop") : "keep"} (${d.decidedBy}: ${d.whyZh})` : "not found" };
  });

  /* Phrases exactly once. */
  const phraseCounts = ["这场看似一边倒的捉贼大戏", "有个细节值得关注", "核心就一个词", "阿里相关的3500多个账号", "要么你就得接受一定程度"].map((p) => ({
    phrase: p,
    count: norm(keptText).split(norm(p)).length - 1,
  }));
  const intactPhrase = "Anthrobic为什么这么急呢";
  const intactIdx = norm(keptText).indexOf(norm(intactPhrase));
  let intact = intactIdx >= 0;
  if (intact) {
    /* No cut boundary inside the phrase's words. */
    const seq = keptWords;
    let acc = "";
    let from = -1;
    let to = -1;
    for (let i = 0; i < seq.length; i++) {
      const before = acc.length;
      acc += norm(seq[i].text);
      if (from < 0 && before <= intactIdx && acc.length > intactIdx) from = i;
      if (from >= 0 && acc.length >= intactIdx + norm(intactPhrase).length) {
        to = i;
        break;
      }
    }
    if (from >= 0 && to >= from) {
      const a = seq[from].startMs;
      const b = seq[to].endMs;
      intact = !edges.some((e) => e.ms > a && e.ms < b);
    }
  }

  /* Sentences removed without a reason. */
  const keptIds = new Set(cut.keptSentenceIds);
  const reasoned = new Set(cut.drops.flatMap((d) => d.sentenceIds));
  const retakeIds = new Set(retakes.flatMap((r) => r.droppedSentenceIds));
  const unexplained = sentences.filter((s) => !keptIds.has(s.id) && !reasoned.has(s.id) && !retakeIds.has(s.id));

  const pureMs = timings.silencesMs + timings.retakesMs + timings.planCutMs;
  const wallMs = Date.now() - t0;

  /* ---- 7. audio: the cut, and every join ---------------------------- */
  let renderedPauses: number | null = null;
  if (!NO_AUDIO) {
    t = Date.now();
    const parts = pieces
      .map((p, i) => `[0:a]atrim=start=${sec(p.startMs)}:end=${sec(p.endMs)},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${((p.endMs - p.startMs) / 1000 - 0.012).toFixed(3)}:d=0.012[s${i}]`)
      .join(";");
    const concat = pieces.map((_, i) => `[s${i}]`).join("") + `concat=n=${pieces.length}:v=0:a=1[out]`;
    const wav = path.join(OUT, "cut.wav");
    await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", RAW, "-filter_complex", `${parts};${concat}`, "-map", "[out]", "-ac", "1", "-ar", "16000", wav], { timeout: 170_000, maxBuffer: 8 << 20 });
    await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", "96k", path.join(OUT, "cut.m4a")], { timeout: 120_000 });
    const probe = await run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", "-i", wav, "-af", "silencedetect=noise=-32dB:d=0.35", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 8 << 20 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
    const left = parseSilenceLog(String(probe.stderr)).filter((s) => s.endMs < cut.lengthMs - 400 && s.startMs > 100);
    renderedPauses = left.length;
    await writeFile(path.join(OUT, "pauses-left.json"), JSON.stringify(left, null, 1));

    const dir = path.join(OUT, "boundaries");
    await mkdir(dir, { recursive: true });
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i + 1 < pieces.length; i++) {
      const outMs = pieces[i].endMs;
      const inMs = pieces[i + 1].startMs;
      const file = path.join(dir, `b${String(i + 1).padStart(3, "0")}_${sec(outMs)}_${sec(inMs)}.wav`);
      jobs.push(
        run(
          "ffmpeg",
          [
            "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", sec(Math.max(0, outMs - 600)), "-t", "0.6", "-i", RAW,
            "-ss", sec(inMs), "-t", "0.6", "-i", RAW,
            "-filter_complex", "[0:a]afade=t=out:st=0.588:d=0.012[a];[1:a]afade=t=in:d=0.012[b];[a][b]concat=n=2:v=0:a=1[out]",
            "-map", "[out]", "-ac", "1", "-ar", "16000", file,
          ],
          { timeout: 60_000 },
        ),
      );
      if (jobs.length >= 6) {
        await Promise.all(jobs);
        jobs.length = 0;
      }
    }
    await Promise.all(jobs);
    lap("audioMs", t);
  }

  /* ---- 8. write it down ------------------------------------------- */
  const cutText = pieces
    .map((p) => joinWords(words.filter((w) => Math.min(p.endMs, w.endMs) - Math.max(p.startMs, w.startMs) >= Math.min(40, (w.endMs - w.startMs) / 2))))
    .join(" | ");
  await writeFile(path.join(OUT, "cut.txt"), cutText + "\n");
  await writeFile(
    path.join(OUT, "cut.json"),
    JSON.stringify(
      {
        fixture: FIXTURE,
        raw: RAW,
        targetMs,
        pieces: cut.pieces,
        lengthMs: cut.lengthMs,
        removedMs: cut.removedMs,
        report: cut.report,
        drops: cut.drops,
        pauses: cut.pauses,
        holes,
        decisions: decisions.map((d) => ({ id: d.id, drop: d.drop, decidedBy: d.decidedBy, whyZh: d.whyZh, kind: d.candidate.kind, dropStartMs: d.candidate.dropStartMs, dropEndMs: d.candidate.dropEndMs, coverage: d.candidate.coverage, lcs: d.candidate.lcs, hasPause: d.candidate.hasPause, briefHit: d.candidate.briefHit, first: d.candidate.firstText, second: d.candidate.secondText })),
        retakes,
        plan,
        planRaw: planRaw.slice(0, 4000),
        anchors: briefAnchors(brief),
        anchorIds: cut.anchorIds,
        refused: cut.refused,
        refusedRetakes: cut.refusedRetakes,
        sentences: sentences.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, text: s.text, kept: keptIds.has(s.id) })),
      },
      null,
      1,
    ),
  );

  const expectedLen = gold?.totals.expectedOutputMs ?? [260_000, 300_000];
  const acceptance = [
    { item: "3 known retakes removed (3500账号 re-say; doubled 要么你就得接受一定程度; 一轮比一轮 decision logged)", pass: goldMatches.filter((g) => /3500多个账号 ×2|要么/.test(g.name)).every((g) => g.matched) && ambiguousLogged.every((a) => a.decision !== "not found"), value: `${goldMatches.filter((g) => /3500多个账号 ×2|要么/.test(g.name)).map((g) => `${g.name}: ${g.matched ? "removed" : "MISSED"}`).join("; ")}; ${ambiguousLogged.map((a) => `${a.name}: ${a.decision}`).join("; ")}` },
    { item: "gold P/R ≥ 0.9", pass: precision >= 0.9 && recall >= 0.9, value: `pause-aware P ${precision.toFixed(2)} R ${recall.toFixed(2)} (${tp}/${goldMatches.length} gold matched, ${falsePositives.length} not in gold${falsePositives.length ? ": " + falsePositives.map((p) => `${sec(p.startMs)}–${sec(p.endMs)} ${p.text}`).join("; ") : ""}); strict ±400 ms P ${precisionStrict.toFixed(2)} R ${recallStrict.toFixed(2)} (${tpStrict}/${goldStrict.length})` },
    { item: "zero non-retake sentences removed without a reason", pass: unexplained.length === 0, value: `${unexplained.length} unexplained${unexplained.length ? ": " + unexplained.map((s) => s.id).join(",") : ""}; ${cut.report.restored.length} restored by the audit${cut.report.restored.length ? " (" + cut.report.restored.join(",") + ")" : ""}` },
    { item: "捉贼大戏 / 有个细节值得关注 / 核心就一个词 each exactly once", pass: phraseCounts.slice(0, 3).every((p) => p.count === 1), value: phraseCounts.map((p) => `${p.phrase} ×${p.count}`).join("; ") },
    { item: "Anthropic为什么急呢 intact", pass: intact, value: intact ? "present, no cut inside" : "missing or cut" },
    { item: "100% of boundaries inside a silence or on a word boundary with ≥ 40 ms gap", pass: badBoundaries.length === 0, value: `${boundaryChecks.length - badBoundaries.length}/${boundaryChecks.length} (${boundaryChecks.filter((b) => b.inSilence).length} in silence, ${boundaryChecks.filter((b) => !b.inSilence && b.onWordBoundary).length} on word boundary)${badBoundaries.length ? "; bad: " + badBoundaries.map((b) => sec(b.ms)).join(",") : ""}` },
    { item: "no pause > 0.35 s remains", pass: pausesLeft.length === 0 && (renderedPauses ?? 0) === 0, value: `${pausesLeft.length} by arithmetic; ${renderedPauses === null ? "audio not rendered" : `${renderedPauses} in the rendered cut (silencedetect d=0.35)`}` },
    { item: `total ${expectedLen[0] / 1000}–${expectedLen[1] / 1000} s`, pass: cut.lengthMs >= expectedLen[0] && cut.lengthMs <= expectedLen[1], value: `${sec(cut.lengthMs)} s, ${cut.pieces.length} pieces (expected ${gold?.totals.expectedCuts?.join("–") ?? "70–100"} cuts)` },
    { item: "≤ 20 s + one model call", pass: pureMs + (timings.holesMs ?? 0) <= 20_000 && modelCalls <= 2, value: `pure ${pureMs} ms (silences ${timings.silencesMs}, retakes ${timings.retakesMs}, planCut ${timings.planCutMs}) + holes ${timings.holesMs ?? 0} ms; ${modelCalls} model call(s) (${timings.decideMs} + ${timings.planCallMs} ms); wall ${wallMs} ms` },
  ];
  const report = { acceptance, goldMatches, goldStrict, ambiguousLogged, falsePositives: falsePositives.map((p) => ({ startMs: p.startMs, endMs: p.endMs, text: p.text })), phraseCounts, boundaries: boundaryChecks, pausesLeft, unexplained: unexplained.map((s) => s.id), timings, modelCalls, lengthMs: cut.lengthMs, pieces: cut.pieces.length, holes, restored: cut.report.restored, overBudgetMs: cut.report.overBudgetMs, noteZh: cut.report.noteZh };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));

  const lines = acceptance.map((a) => `${a.pass ? "PASS" : "FAIL"}  ${a.item}\n      ${a.value}`);
  const text = [`W1 acceptance on ${path.basename(FIXTURE)} (${new Date().toISOString()})`, ...lines, "", `note: ${cut.report.noteZh}`, `restored: ${cut.report.restored.join(", ") || "—"}`, "", "gold retakes:", ...goldMatches.map((g) => `  ${g.matched ? "ok  " : "MISS"} ${g.name} gold ${sec(g.gold[0])}–${sec(g.gold[1])} → ${g.predicted ? `${sec(g.predicted[0])}–${sec(g.predicted[1])}` : "—"}`), "", "removed:", ...cut.drops.map((d) => `  ${sec(d.startMs)}–${sec(d.endMs)} ${d.reason} ${d.why} | ${d.text}`)].join("\n");
  await writeFile(path.join(OUT, "report.txt"), text + "\n");
  console.log("\n" + text);
}

/* The database client that `autoedit.ts` imports keeps a pool open, and a
   pool keeps the event loop alive; nothing here ever queried it, so exit. */
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
