/**
 * W2 lab: correct words, animated captions, on the 蒸馏 fixture (PLAN.md §2 W2).
 *
 *   cd /home/ubuntu/wt/dv2-W2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-captions.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] \
 *     [--gold /tmp/dv2_lab/fixture/zhengliu.gold.json] [--raw /home/ubuntu/raw/zhengliu.mp4] \
 *     [--out /tmp/dv2_lab/W2] [--window 228-258] [--chin-y 1150] [--preset bilingual-reel] \
 *     [--force-transcribe] [--no-model] [--no-render] [--no-check]
 *
 * What it does, in order, writing everything under `--out`:
 *
 *   1. terms and hotwords from the brief             glossary.json
 *   2. whisper on the raw take with the hotwords     whisper-hotwords.json  (cached; ~60 s)
 *   3. the glossary: Latin + sound-alike fixes,      glossary.json
 *      then the pooled model call (names, typos)
 *   4. reel lines                                    lines.json
 *   5. the checks the acceptance list asks for       report.json
 *   6. English for the render window (one call)      lines-en.json          (cached)
 *   7. the ASS, and the window rendered twice:       captions.ass, window-reel.mp4,
 *      the reel preset and v1's `bilingual`          window-bilingual.mp4
 *   8. the font check at debug log level             fontselect.txt
 *   9. frames: a contact sheet, a 15 fps pop strip,  sheet.jpg, strip.jpg, check.json
 *      and `checkFrame` on five frames
 *
 * Paid: the glossary calls (two models at once), the translation call,
 * five `checkFrame` calls;
 * about a cent in all. No database, nothing written outside `--out`.
 */
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { toAss, numberRanges, reelLayout, type AssCue } from "../../lib/video/ass";
import { toCaptionLines, type Transcript } from "../../lib/video/elevenlabs";
import { applyGlossary, applyGlossaryWithModel, extractTerms, hotwordsFrom, jsonCompletion } from "../../lib/video/glossary";
import { captionPreset } from "../../lib/video/presets";
import { transcribeLocal, whisperPrompt } from "../../lib/video/whisper";
import { toSimplified } from "../../lib/text/simplified";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(name);

const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const OUT = arg("--out", "/tmp/dv2_lab/W2");
const PRESET = arg("--preset", "bilingual-reel");
/** The translation model, named here so the lab never opens the database to ask which one the studio chose; the glossary has its own list. */
const MODEL = arg("--model", "qwen/qwen3.8-flash");
const [WIN_A, WIN_B] = arg("--window", "228-258").split("-").map(Number);
const CHIN_Y = Number(arg("--chin-y", "1150"));
const FONTS = path.join(process.cwd(), "remotion", "public", "fonts");

const exec = promisify(execFile);
const WIDTH = 1080;
const HEIGHT = 1920;

type Fixture = { brief: string; source: { path: string } };
type Gold = {
  glossary: { mustFix: { from_: string[]; to: string }[]; suspect: { from_: string; maybe: string }[] };
  anchors: { entities: { name: string; transcribedAs: string[]; mentions: unknown[] }[] };
};

/** One command with a deadline; argv, never a shell string. */
async function run(cmd: string, args: string[], timeoutMs = 170_000): Promise<{ stdout: string; stderr: string; ms: number }> {
  const started = Date.now();
  const { stdout, stderr } = await exec(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { stdout: String(stdout), stderr: String(stderr), ms: Date.now() - started };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
const hanCount = (s: string) => (s.match(HAN) ?? []).length;
/** A Han character is 1, a Latin letter or digit half: what a line takes up. */
const widthOf = (s: string) => Array.from(s).reduce((n, ch) => n + (/[㐀-䶿一-鿿豈-﫿]/.test(ch) ? 1 : ch === " " ? 0 : 0.5), 0);

async function main() {
  await mkdir(OUT, { recursive: true });
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const gold = JSON.parse(await readFile(GOLD, "utf8")) as Gold;
  const raw = (await exists(RAW)) ? RAW : fixture.source.path;
  const report: Record<string, unknown> = { fixture: FIXTURE, raw, preset: PRESET, window: [WIN_A, WIN_B], chinY: CHIN_Y, startedAt: new Date().toISOString() };
  const timings: Record<string, number> = {};

  /* ---- 1. terms ---- */
  const terms = extractTerms(fixture.brief);
  const hotwords = hotwordsFrom(terms);
  const prompt = whisperPrompt(hotwords);
  console.log(`terms (${terms.length}): ${terms.map((t) => `${t.text}/${t.weight}`).join(" ")}`);
  console.log(`hotwords (${hotwords.length}, ${hotwords.join("、").length} chars): ${hotwords.join("、")}`);
  console.log(`prompt (${Array.from(prompt).length} chars): ${prompt}`);

  /* ---- 2. whisper ---- */
  const audio = path.join(OUT, "audio.wav");
  if (!(await exists(audio))) {
    console.log("extracting 16 kHz mono audio…");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-vn", "-ac", "1", "-ar", "16000", audio]);
  }
  const whisperPath = path.join(OUT, "whisper-hotwords.json");
  let transcript: Transcript;
  if (!flag("--force-transcribe") && (await exists(whisperPath))) {
    transcript = JSON.parse(await readFile(whisperPath, "utf8")) as Transcript;
    console.log(`whisper: cached ${whisperPath} (${transcript.words.length} words)`);
  } else {
    console.log("whisper: transcribing with hotwords…");
    const started = Date.now();
    transcript = await transcribeLocal(audio, "audio.wav", { hotwords });
    timings.whisperMs = Date.now() - started;
    await writeFile(whisperPath, JSON.stringify(transcript, null, 1), "utf8");
    console.log(`whisper: ${transcript.words.length} words, ${transcript.languageCode} p=${transcript.languageProbability}, ${(timings.whisperMs / 1000).toFixed(1)} s`);
  }
  /* As transcribe.ts does: Simplified before anything reads the words. */
  transcript = { ...transcript, text: toSimplified(transcript.text), words: transcript.words.map((w) => ({ ...w, text: toSimplified(w.text) })) };

  /* ---- 3. glossary ---- */
  const started3 = Date.now();
  const fixed = flag("--no-model")
    ? { ...applyGlossary(transcript.words, terms), usage: null, proposals: [], raw: "" }
    : await applyGlossaryWithModel(transcript.words, terms, { log: (l) => console.log(l) });
  timings.glossaryMs = Date.now() - started3;
  console.log(`glossary: ${fixed.changes.map((c) => `${c.from}→${c.to}×${c.count}(${c.by})`).join(", ") || "no changes"}`);
  if (fixed.rejected.length) console.log(`glossary refused: ${fixed.rejected.map((r) => `${r.from}→${r.to}（${r.why}）`).join("; ")}`);
  if (fixed.raw) console.log(`glossary raw answer: ${fixed.raw.slice(0, 600)}`);
  await writeFile(
    path.join(OUT, "glossary.json"),
    JSON.stringify({ terms, hotwords, prompt, changes: fixed.changes, rejected: fixed.rejected, proposals: fixed.proposals, usage: fixed.usage, raw: fixed.raw }, null, 1),
    "utf8",
  );
  const corrected: Transcript = { ...transcript, words: fixed.words, text: fixed.text };
  await writeFile(path.join(OUT, "words-corrected.json"), JSON.stringify(corrected, null, 1), "utf8");

  /* ---- 4. lines ---- */
  const preset = captionPreset(PRESET);
  const reel = preset.style.reel;
  if (!reel) throw new Error(`${PRESET} is not a reel preset`);
  const started4 = Date.now();
  const lines = toCaptionLines(corrected, {
    reel: { aimChars: reel.aimChars, maxChars: reel.maxChars, minChars: reel.minChars, minMs: reel.minMs, terms: terms.map((t) => t.text) },
  });
  timings.linesMs = Date.now() - started4;
  await writeFile(path.join(OUT, "lines.json"), JSON.stringify(lines, null, 1), "utf8");
  console.log(`lines: ${lines.length} in ${timings.linesMs} ms`);

  /* ---- 5. checks ---- */
  const joined = lines.map((l) => l.text).join("");
  const forbidden = [
    ...new Set([
      "帧流",
      "蒸瘤",
      "Enterobic",
      "Anthrobic",
      "西雅芳",
      "百度人",
      ...gold.glossary.mustFix.flatMap((m) => m.from_),
    ]),
  ];
  const forbiddenHits = forbidden
    .map((f) => ({ spelling: f, count: (joined.match(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length }))
    .filter((h) => h.count > 0);

  /* Every proper noun on the brief's spelling line, and every gold entity,
     must appear as the brief spells it — or as a short form of it she
     actually says (阿里 for 阿里巴巴, 商务部 for 中国商务部), never as a
     mishearing (the gold's `mustFix` forms, counted above as forbidden). */
  const count = (s: string) => (joined.match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
  const properNouns = terms.filter((t) => t.weight === 3).map((t) => t.text);
  const nounCounts = properNouns.map((n) => ({ term: n, count: count(n) }));
  const strip = (s: string) => s.replace(/[《》]/g, "");
  const entityChecks = gold.anchors.entities.map((e) => {
    const name = strip(e.name);
    const shortForms = e.transcribedAs.filter((t) => t !== e.name && name.includes(strip(t)));
    const found = count(name) > 0 ? name : shortForms.find((t) => count(strip(t)) > 0) ?? null;
    return { name: e.name, found, count: found ? count(strip(found)) : 0 };
  });
  const properNounFailures = [
    ...nounCounts.filter((c) => c.count === 0 && !/^《/.test(c.term) && !entityChecks.some((e) => strip(e.name).includes(c.term) && e.found)).map((c) => `${c.term} absent`),
    ...entityChecks.filter((e) => !e.found).map((e) => `${e.name} absent`),
  ];

  /* Breaks: each line end must be a segmenter boundary of the whole text and
     never inside a figure; no line may carry a comma or a full stop. */
  let full = "";
  const lineEnds: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && /[A-Za-z]$/.test(full) && /^[A-Za-z]/.test(lines[i].text)) full += " ";
    full += lines[i].text;
    lineEnds.push(full.length);
  }
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const bounds = new Set<number>([0, full.length]);
  for (const s of seg.segment(full)) bounds.add(s.index);
  const numbers = numberRanges(full).map(([a, b]) => {
    /* code points → UTF-16 for this string (all BMP in practice) */
    const cps = Array.from(full);
    return [cps.slice(0, a).join("").length, cps.slice(0, b).join("").length] as [number, number];
  });
  const breakFailures: string[] = [];
  lineEnds.slice(0, -1).forEach((end, i) => {
    const prevEnd = i > 0 ? lineEnds[i - 1] : 0;
    const around = `${full.slice(Math.max(prevEnd, end - 6), end)}|${full.slice(end, end + 6)}`;
    if (!bounds.has(end)) breakFailures.push(`not a segmenter boundary: ${around}`);
    if (numbers.some(([a, b]) => end > a && end < b)) breakFailures.push(`inside a figure: ${around}`);
  });
  const punctLines = lines.filter((l) => /[，。]/.test(l.text)).map((l) => l.text);
  /* Names and terms up to eight characters are never split; a longer quoted sentence is not a name. */
  const termSplits = terms
    .map((t) => t.text.replace(/^《(.*)》$/, "$1"))
    .filter((t) => Array.from(t).length >= 2 && Array.from(t).length <= 8)
    .flatMap((t) => {
      const out: string[] = [];
      let at = full.indexOf(t);
      while (at !== -1) {
        if (lineEnds.some((e) => e > at && e < at + t.length)) out.push(t);
        at = full.indexOf(t, at + 1);
      }
      return out;
    });

  const widths = lines.map((l) => widthOf(l.text));
  const hanCounts = lines.map((l) => hanCount(l.text));
  const in6to11 = widths.filter((w) => w >= 6 && w <= 11).length;
  const durations = lines.map((l) => l.endMs - l.startMs);
  const short = lines.filter((l) => l.endMs - l.startMs < 500);
  const histogram: Record<string, number> = {};
  for (const w of widths) histogram[String(Math.round(w))] = (histogram[String(Math.round(w))] ?? 0) + 1;

  /* ---- 6. English for the window ---- */
  const inWindow = lines.filter((l) => l.endMs > WIN_A * 1000 && l.startMs < WIN_B * 1000);
  const enPath = path.join(OUT, "lines-en.json");
  let en: Record<string, string> = {};
  if (await exists(enPath)) en = JSON.parse(await readFile(enPath, "utf8")) as Record<string, string>;
  const missing = inWindow.filter((l) => !en[String(l.startMs)]);
  if (missing.length && !flag("--no-model") && preset.style.second) {
    console.log(`translating ${missing.length} lines for the window…`);
    const started = Date.now();
    try {
      const res = await jsonCompletion(
        MODEL,
        [
          {
            role: "system",
            content:
              "You subtitle a Chinese business creator's vertical reels in English. For each Chinese caption line, write one concise natural English line of at most 60 characters. Keep names as given (Anthropic, Claude, DeepSeek, Kimi, MiniMax, ByteDance, Zhang Yiming, Alibaba). Output JSON only: {\"lines\":[\"...\"]} with exactly one English line per input line, in order.",
          },
          { role: "user", content: JSON.stringify({ lines: missing.map((l) => l.text) }) },
        ],
        undefined,
        2000,
      );
      timings.translateMs = Date.now() - started;
      const a = res.text.indexOf("{");
      const b = res.text.lastIndexOf("}");
      const parsed = JSON.parse(res.text.slice(a, b + 1)) as { lines?: unknown };
      const got = Array.isArray(parsed.lines) ? parsed.lines.map(String) : [];
      missing.forEach((l, i) => {
        en[String(l.startMs)] = got[i] ?? "";
      });
      await writeFile(enPath, JSON.stringify(en, null, 1), "utf8");
      report.translation = { model: res.usage.model, provider: res.usage.provider, costMicros: res.usage.costMicros, ms: timings.translateMs, lines: got.length };
    } catch (err) {
      console.warn(`translation failed, the window renders without English: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /* ---- 7. ASS + render ---- */
  const layout = reelLayout(preset, { width: WIDTH, height: HEIGHT, chinY: CHIN_Y });
  report.layout = layout;
  console.log(`layout: ${JSON.stringify(layout)}`);
  const shift = WIN_A * 1000;
  const cues: AssCue[] = inWindow.map((l) => ({
    startMs: l.startMs - shift,
    endMs: l.endMs - shift,
    text: l.text,
    words: l.words.map((w) => ({ start: w.start - WIN_A, end: w.end - WIN_A, text: w.text })),
    keywords: [],
    second: en[String(l.startMs)] ?? null,
  }));
  const accent = "#d6e64f";
  const assReel = toAss(cues, { presetKey: PRESET, width: WIDTH, height: HEIGHT, accent, chinY: CHIN_Y });
  const assPath = path.join(OUT, "captions.ass");
  await writeFile(assPath, assReel, "utf8");
  const assV1 = toAss(cues, { presetKey: "bilingual", width: WIDTH, height: HEIGHT, accent });
  const assV1Path = path.join(OUT, "captions-bilingual.ass");
  await writeFile(assV1Path, assV1, "utf8");

  const escapeFilter = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
  const encode = async (ass: string, out: string) => {
    const r = await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", String(WIN_A), "-t", String(WIN_B - WIN_A), "-i", raw,
        "-vf", `ass=${escapeFilter(ass)}:fontsdir=${escapeFilter(FONTS)}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        out,
      ],
      600_000,
    );
    return r.ms;
  };
  const reelMp4 = path.join(OUT, "window-reel.mp4");
  const v1Mp4 = path.join(OUT, "window-bilingual.mp4");
  if (!flag("--no-render")) {
    console.log("rendering the window with the reel preset…");
    const reelRuns = [await encode(assPath, reelMp4)];
    console.log(`  ${reelRuns[0]} ms`);
    console.log("rendering the window with v1's bilingual preset…");
    const v1Runs = [await encode(assV1Path, v1Mp4)];
    console.log(`  ${v1Runs[0]} ms`);
    /* Two more passes each, the smallest of the three counts: the box is shared. */
    for (let k = 0; k < 2; k++) {
      reelRuns.push(await encode(assPath, reelMp4));
      v1Runs.push(await encode(assV1Path, v1Mp4));
    }
    timings.encodeReelMs = Math.min(...reelRuns);
    timings.encodeBilingualMs = Math.min(...v1Runs);
    const probe = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames", "-of", "csv=p=0", reelMp4]);
    report.rendered = { file: reelMp4, probe: probe.stdout.trim(), runs: { reel: reelRuns, bilingual: v1Runs } };

    /* ---- 8. fonts ---- */
    const fontProbe = path.join(OUT, "fontprobe.mp4");
    const dbg = await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "debug", "-y",
        "-ss", String(WIN_A), "-t", "1", "-i", raw,
        "-vf", `ass=${escapeFilter(assPath)}:fontsdir=${escapeFilter(FONTS)}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-an", fontProbe,
      ],
      170_000,
    );
    const fontLines = [...new Set(dbg.stderr.split("\n").filter((l) => /fontselect/.test(l)).map((l) => l.replace(/^\[.*?\]\s*/, "").trim()))];
    await writeFile(path.join(OUT, "fontselect.txt"), fontLines.join("\n") + "\n", "utf8");
    report.fonts = { lines: fontLines, black: fontLines.some((l) => /NotoSansCJKsc-Black/.test(l)), dejavu: fontLines.some((l) => /DejaVu/i.test(l)) };
    console.log(`fonts: ${fontLines.join(" | ")}`);

    /* ---- 9. frames ---- */
    const frames = path.join(OUT, "frames");
    await mkdir(frames, { recursive: true });
    /* Twelve frames every 2.5 s from 1 s in, tiled 4×3 at 270×480. */
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", reelMp4, "-vf", "fps=1/2.5,scale=270:480,tile=4x3", "-frames:v", "1", "-q:v", "3", path.join(OUT, "sheet.jpg")]);
    /* The pop, at 15 fps, from the start of the first line that begins at least 2 s into the window. */
    const first = cues.find((c) => c.startMs >= 2000) ?? cues[0];
    const stripAt = Math.max(0, (first.startMs - 66) / 1000);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", stripAt.toFixed(3), "-i", reelMp4, "-vf", "fps=15,crop=1080:400:0:1180,scale=270:100,tile=8x1", "-frames:v", "1", "-q:v", "3", path.join(OUT, "strip.jpg")]);
    /* A closer look: the line's crop at 4 moments, 540 px wide. */
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", ((first.startMs + 400) / 1000).toFixed(3), "-i", reelMp4, "-vf", "fps=2,crop=1080:300:0:1230,scale=540:150,tile=1x4", "-frames:v", "1", "-q:v", "3", path.join(OUT, "closeup.jpg")]);
    report.strip = { at: stripAt, line: first.text };

    if (!flag("--no-check")) {
      const { checkFrame, visionSpend } = await import("../../lib/video/vision");
      const at = [3, 9, 15, 21, 27];
      const checks: unknown[] = [];
      for (const s of at) {
        const f = path.join(frames, `f${s}.jpg`);
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(s), "-i", reelMp4, "-vf", "scale=720:1280", "-frames:v", "1", "-q:v", "3", f]);
        try {
          const r = await checkFrame(f);
          const line = cues.find((c) => c.startMs <= s * 1000 && c.endMs >= s * 1000)?.text ?? "";
          checks.push({ at: s, file: f, ok: r.ok, issues: r.issues, read: r.captionTextRead, line, ms: r.usage.ms, model: r.usage.model });
          console.log(`checkFrame ${s}s: ok=${r.ok} ${r.issues.map((i) => `${i.type}/${i.severity}: ${i.detail}`).join("; ")} read=「${r.captionTextRead}」 line=「${line}」`);
        } catch (err) {
          checks.push({ at: s, file: f, error: err instanceof Error ? err.message : String(err) });
        }
      }
      await writeFile(path.join(OUT, "check.json"), JSON.stringify(checks, null, 1), "utf8");
      report.check = { frames: checks, spend: visionSpend() };
    }
  }

  /* ---- report ---- */
  const acceptance = {
    forbiddenSpellings: { pass: forbiddenHits.length === 0, hits: forbiddenHits },
    properNouns: { pass: properNounFailures.length === 0, failures: properNounFailures, counts: nounCounts, entities: entityChecks },
    breaks: { pass: breakFailures.length === 0 && punctLines.length === 0 && termSplits.length === 0, failures: breakFailures, punctuationLines: punctLines, termSplits },
    length: { pass: in6to11 / lines.length >= 0.95, share6to11: in6to11 / lines.length, lines: lines.length, histogram, meanWidth: widths.reduce((a, b) => a + b, 0) / widths.length, meanHan: hanCounts.reduce((a, b) => a + b, 0) / hanCounts.length, min: Math.min(...widths), max: Math.max(...widths) },
    duration: { pass: short.length === 0, under500: short.map((l) => ({ text: l.text, ms: l.endMs - l.startMs })), minMs: Math.min(...durations), meanMs: durations.reduce((a, b) => a + b, 0) / durations.length },
    fonts: report.fonts ? { pass: (report.fonts as { black: boolean; dejavu: boolean }).black && !(report.fonts as { dejavu: boolean }).dejavu } : { pass: null },
    checkFrame: report.check
      ? { pass: (report.check as { frames: { ok?: boolean }[] }).frames.every((f) => f.ok === true), ok: (report.check as { frames: { ok?: boolean }[] }).frames.filter((f) => f.ok === true).length, of: (report.check as { frames: unknown[] }).frames.length }
      : { pass: null },
    encode:
      timings.encodeReelMs && timings.encodeBilingualMs
        ? { pass: timings.encodeReelMs <= timings.encodeBilingualMs * 1.1, reelMs: timings.encodeReelMs, bilingualMs: timings.encodeBilingualMs, ratio: timings.encodeReelMs / timings.encodeBilingualMs }
        : { pass: null },
    chinClear: { pass: layout?.chinClear ?? null, layout },
  };
  report.acceptance = acceptance;
  report.timings = timings;
  report.glossary = { changes: fixed.changes, rejected: fixed.rejected, usage: fixed.usage };
  report.lines = { count: lines.length, inWindow: inWindow.length };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1), "utf8");

  console.log("\nacceptance");
  for (const [k, v] of Object.entries(acceptance)) {
    const { pass, ...rest } = v as { pass: boolean | null } & Record<string, unknown>;
    const detail = JSON.stringify(rest);
    console.log(`  ${pass === null ? "skip" : pass ? "PASS" : "FAIL"}  ${k}  ${detail.length > 300 ? detail.slice(0, 300) + "…" : detail}`);
  }
  console.log(`\nwrote ${path.join(OUT, "report.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
