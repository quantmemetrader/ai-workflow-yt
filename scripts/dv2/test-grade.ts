/**
 * The grader graded: every hard gate fed a clean synthetic reel (must
 * pass) and the same reel with one planted fault (must fail), plus the
 * "nothing was measured" cases that must come back undecided rather than
 * green. Pure — no network, no DB, no media — so it runs in a second:
 *
 *   cd /home/ubuntu/wt/dv2-W7 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json node --import tsx scripts/dv2/test-grade.ts
 *
 * Exit code 1 on any failed expectation. A gate that passes a planted
 * fault is the one bug a harness must not have: the lead would ship the
 * fault with a green report.
 */
import {
  evaluateAnchors,
  evaluateBoundaries,
  evaluateCadence,
  evaluateCaptions,
  evaluateCoverage,
  evaluateCredits,
  evaluateFace,
  evaluateHook,
  evaluateLayouts,
  evaluateMix,
  evaluateOverlaps,
  evaluatePauses,
  evaluateRelevance,
  evaluateRetakes,
  evaluateSound,
  evaluateStats,
  evaluateUniqueness,
  evaluateZones,
  findRepeats,
  parseAss,
  parseFontSelect,
  type CutawayScore,
  type FaceSample,
  type Gate,
  type GradeInput,
} from "./metrics";
import type { Word } from "../../lib/video/v2/types";

let failed = 0;
let passed = 0;
function expect(name: string, got: boolean | null, want: boolean | null, gate?: Gate) {
  if (got === want) {
    passed++;
    return;
  }
  failed++;
  console.log(`FAIL  ${name}: got ${got}, want ${want}${gate ? `  (${gate.value})` : ""}`);
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* Words at a steady 250 ms per character, no gaps. */
function wordsOf(text: string, startMs = 100): Word[] {
  return [...text].map((c, i) => ({ text: c, startMs: startMs + i * 250, endMs: startMs + (i + 1) * 250 }));
}

/* ------------------------------------------------------------ clean reel */

const W = 1080;
const H = 1920;
/* 30 s of output from two cuts; a cutaway every 7 s, 2.5 s each → ~36 % coverage. */
const clean: GradeInput = {
  label: "synthetic",
  mp4: "/dev/null",
  width: W,
  height: H,
  fps: 30,
  cuts: [
    { file: "raw.mp4", inMs: 0, outMs: 15_000 },
    { file: "raw.mp4", inMs: 16_000, outMs: 31_000 },
  ],
  cutaways: [
    { startMs: 2_000, endMs: 4_600, layout: "split", still: false, sourceInMs: 1200, assetIndex: 0 },
    { startMs: 9_500, endMs: 12_100, layout: "full", still: false, sourceInMs: 800, assetIndex: 1 },
    { startMs: 16_500, endMs: 19_100, layout: "split", still: false, sourceInMs: 400, assetIndex: 2 },
    { startMs: 24_000, endMs: 26_600, layout: "full", still: true, sourceInMs: 0, assetIndex: 3 },
  ],
  graphics: [
    { id: "g0", kind: "hook", startMs: 0, endMs: 2_000, text: "美国三大安全机构", box: [100, 240, 800, 360] },
    { id: "g1", kind: "counter", startMs: 5_000, endMs: 7_500, text: "154页", box: [120, 260, 700, 300] },
    { id: "g2", kind: "term", startMs: 13_000, endMs: 15_500, text: "蒸馏", box: [120, 260, 700, 300] },
    { id: "g3", kind: "chip", startMs: 20_000, endMs: 22_000, text: "Anthropic", box: [700, 240, 200, 80] },
    { id: "g4", kind: "counter", startMs: 21_000, endMs: 23_500, text: "1.51亿次", box: [120, 260, 700, 300] },
    { id: "end", kind: "end-card", startMs: 27_500, endMs: 30_000, text: "拒绝蒸馏", box: [0, 0, W, H], props: { creditsLine: "素材来源：YouTube @a · Bilibili @b" } },
  ],
  captions: [],
  assets: [
    { platform: "youtube", sourceId: "yt1", sourceUrl: "https://youtu.be/yt1", author: "chan-a" },
    { platform: "bilibili", sourceId: "BV1", sourceUrl: "https://b23.tv/BV1", author: "up-b" },
    { platform: "douyin", sourceId: "dy1", sourceUrl: "https://douyin.com/video/dy1", author: "dy-c" },
    { platform: "wikimedia", sourceId: "File:X.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:X.jpg", author: "someone" },
  ],
  credits: { line: "素材来源：YouTube @a · Bilibili @b", block: "素材来源 / Sources\n- a\n- b\n- c\n- d\n仅作评论引用，版权归原作者，如有异议请联系我们删除" },
};
const scoresClean: CutawayScore[] = clean.cutaways.map((c, i) => ({ index: i, score: 8, reason: "exactly this", scoredOn: "asset", line: "", dhash: ["0000000000000000", "ffffffffffffffff", "0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0"][i], source: c.layout === "split" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }, needsPerson: false }));

/* ------------------------------------------------------------- the cut */

{
  const say = wordsOf("美国三大安全机构罕见联手点名中国AI蒸馏这场看似一边倒的捉贼大戏");
  expect("retakes clean", evaluateRetakes(say, clean.cuts, []).pass, true);
  const retake = [...wordsOf("而且这些账号不是正常注册的"), ...wordsOf("而且这些账号不是正常注册的阿里相关", 4_000)];
  expect("retakes planted restart", evaluateRetakes(retake, clean.cuts, []).pass, false);
  expect("retakes: no transcript, empty gold list → undecided", evaluateRetakes(null, clean.cuts, []).pass, null);
  expect("retakes: no transcript, gold span kept → fail", evaluateRetakes(null, clean.cuts, [{ name: "x", dropStartMs: 1_000, dropEndMs: 3_000 }]).pass, false);
  /* Latin names said twice are not a retake; a Latin-and-Han re-say is. */
  const names = [
    { text: "Anthropic", startMs: 0, endMs: 400 }, { text: "的", startMs: 500, endMs: 700 }, { text: "模型", startMs: 900, endMs: 1300 },
    { text: "Anthropic", startMs: 8000, endMs: 8400 }, { text: "的", startMs: 8500, endMs: 8700 }, { text: "东西", startMs: 8900, endMs: 9300 },
  ];
  expect("findRepeats: a name said twice is not a retake", findRepeats(names).some((c) => c.kind === "retake"), false);
  expect("findRepeats: 一轮比一轮 is only a suspect", findRepeats([...wordsOf("一轮比一轮官方"), ...wordsOf("一轮比一轮激进", 3_000)]).every((c) => c.kind === "suspect"), true);

  const anchors = { quotedPhrases: [{ text: "捉贼大戏" }], numbers: [{ text: "154页" }] };
  const once = wordsOf("这场捉贼大戏报告有154页");
  expect("anchors once", evaluateAnchors(once, anchors, null).pass, true);
  expect("anchors dropped", evaluateAnchors(wordsOf("报告有154页"), anchors, null).pass, false);
  expect("anchors said twice", evaluateAnchors(wordsOf("捉贼大戏捉贼大戏报告有154页"), anchors, null).pass, false);
  expect("anchors: none listed → undecided", evaluateAnchors(once, { quotedPhrases: [], numbers: [] }, null).pass, null);
  const heardWrong = wordsOf("这场捉贼的大戏报告有154页");
  expect("anchors: whisper variant, caption carries it", evaluateAnchors(heardWrong, anchors, null, [{ startMs: 0, endMs: 3000, text: "这场捉贼大戏" }]).pass, true);
  expect("anchors: whisper variant, caption dropped it too", evaluateAnchors(heardWrong, anchors, null, [{ startMs: 0, endMs: 3000, text: "这场" }]).pass, false);

  const talk = wordsOf("一二三四五六七八九十".repeat(10), 100);
  expect("pauses clean", evaluatePauses(talk, [], 30_000).pass, true);
  expect("pauses planted 0.6 s", evaluatePauses(talk, [{ startMs: 8_000, endMs: 8_600 }], 30_000).pass, false);
  expect("pauses: first word at 1.2 s", evaluatePauses(wordsOf("一二三四五", 1_200), [], 30_000).pass, false);

  const src: Word[] = [{ text: "蒸馏", startMs: 14_600, endMs: 15_400 }, { text: "核心", startMs: 16_050, endMs: 16_500 }];
  const bClean = evaluateBoundaries([{ inMs: 0, outMs: 15_500 }, { inMs: 16_000, outMs: 31_000 }], src, [{ startMs: 15_400, endMs: 16_050 }]);
  expect("boundaries clean", bClean.pass, true, bClean);
  expect("boundaries mid-word", evaluateBoundaries([{ inMs: 0, outMs: 15_000 }, { inMs: 16_000, outMs: 31_000 }], src, [{ startMs: 15_400, endMs: 16_050 }]).pass, false);
}

/* ------------------------------------------------------------- cutaways */

{
  expect("unique clean", evaluateUniqueness(clean, scoresClean).pass, true, evaluateUniqueness(clean, scoresClean));
  const dup = clone(clean);
  dup.cutaways[3].assetIndex = 0;
  expect("unique: same id twice", evaluateUniqueness(dup, scoresClean).pass, false);
  const author = clone(clean);
  author.assets.forEach((a) => ((a.platform = "youtube"), (a.author = "same")));
  expect("unique: one author ×4", evaluateUniqueness(author, scoresClean).pass, false);
  const near = scoresClean.map((s) => ({ ...s, dhash: "0000000000000000" }));
  expect("unique: near-identical frames under different ids", evaluateUniqueness(clean, near).pass, false);

  expect("mix clean", evaluateMix(clean).pass, true);
  const stock = clone(clean);
  stock.assets.forEach((a) => (a.platform = "pexels"));
  expect("mix: all pexels", evaluateMix(stock).pass, false);

  const cov = evaluateCoverage(clean);
  expect("coverage clean", cov.pass, true, cov);
  const thin = clone(clean);
  thin.cutaways = thin.cutaways.slice(0, 2);
  expect("coverage 17 %", evaluateCoverage(thin).pass, false);

  expect("layout clean", evaluateLayouts(clean, scoresClean).pass, true, evaluateLayouts(clean, scoresClean));
  const pip = clone(clean);
  pip.cutaways[0].layout = "pip";
  expect("layout: the v1 window", evaluateLayouts(pip, scoresClean).pass, false);
  const wrong = clone(clean);
  wrong.cutaways[0].layout = "full";
  expect("layout: landscape 1920×1080 shown full", evaluateLayouts(wrong, scoresClean).pass, false);

  expect("relevance clean", evaluateRelevance(clean, scoresClean).pass, true);
  expect("relevance: one at 5", evaluateRelevance(clean, scoresClean.map((s, i) => (i === 2 ? { ...s, score: 5 } : s))).pass, false);
  expect("relevance: a person at 7", evaluateRelevance(clean, scoresClean.map((s, i) => (i === 1 ? { ...s, score: 7, needsPerson: true } : s))).pass, false);
  expect("relevance: 3 of 4 unscored → undecided", evaluateRelevance(clean, scoresClean.map((s, i) => (i ? { ...s, score: null } : s))).pass, null);
}

/* --------------------------------------------------------------- layout */

{
  const ov = evaluateOverlaps(clean);
  expect("overlaps clean (the chip rides over the counter)", ov.pass, true, ov);
  const both = clone(clean);
  both.graphics[1].startMs = 3_000;
  expect("overlaps: counter over a cutaway", evaluateOverlaps(both).pass, false);

  const z = evaluateZones(clean);
  expect("zones clean", z.pass, true, z);
  const right = clone(clean);
  right.graphics[1].box = [300, 260, 700, 300];
  expect("zones: counter into the right-hand UI", evaluateZones(right).pass, false);
  const low = clone(clean);
  low.graphics[2].box = [120, 1300, 700, 300];
  expect("zones: term card into the bottom UI", evaluateZones(low).pass, false);

  const faces: FaceSample[] = [5, 7, 13, 15].map((t) => ({ t, box: [390, 700, 300, 380], eyeY: 0.4, chinY: 0.56, score: 0.9 }));
  expect("face clean", evaluateFace(clean, faces, null).pass, true);
  const onFace = clone(clean);
  onFace.graphics[1].box = [120, 600, 800, 400];
  expect("face: counter on the face", evaluateFace(onFace, faces, null).pass, false);
  const still = clone(clean);
  still.cutaways.push({ startMs: 12_500, endMs: 14_000, layout: "center", still: true, box: [200, 500, 680, 600] });
  expect("face: a centred picture on the face", evaluateFace(still, faces, null).pass, false);
  expect("face: detector ran, found nothing → undecided", evaluateFace(clean, faces.map((f) => ({ ...f, box: null })), null).pass, null);

  const cad = evaluateCadence(clean, null);
  expect("cadence: a 7 s static stretch fails", cad.pass, false, cad);
}

/* ------------------------------------------------------------- captions */

{
  const head = "[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Reel,Noto Sans CJK SC Black,72,&H00FFFFFF,&H00FFFFFF,&H00100E0E,&H00000000,0,0,0,0,100,100,0,0,1,5,0,2,64,64,529,1\nStyle: ReelEn,Noto Sans CJK SC,52,&H40FFFFFF,&H40FFFFFF,&H00100E0E,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,64,64,486,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  const ev = (a: string, b: string, text: string, layer = 0, style = "Reel") => `Dialogue: ${layer},0:00:${a},0:00:${b},${style},,0,0,0,,${text}\n`;
  const good = parseAss(head + ev("01.00", "02.50", "{\\fscx0}交互量{\\fscx0}就达到了") + ev("02.50", "04.00", "1.51亿次被点名") + ev("01.00", "02.50", "the interactions", 1, "ReelEn") + ev("04.00", "05.50", "Anthropic指控"));
  const glossary = [{ from: ["Enterobic", "Anthrop"], to: "Anthropic" }];
  const terms = ["Anthropic", "美国参议院", "DeepSeek"];
  const spec = { size: 72, secondSize: 36, family: /Black/ };
  const [splits, gloss, typo] = evaluateCaptions(good, glossary, terms, spec);
  expect("captions: clean splits", splits.pass, true, splits);
  expect("captions: the correct Anthropic is not a miss of 'Anthrop'", gloss.pass, true, gloss);
  expect("captions: v2 second style (ReelEn 52 px) is read, not skipped", typo.issues.some((i) => /second line size 52/.test(i.text)), true, typo);
  const num = parseAss(head + ev("01.00", "02.50", "交互量就达到了1.") + ev("02.50", "04.00", "51亿次被点名"));
  expect("captions: number split 1.|51", evaluateCaptions(num, glossary, terms, spec)[0].pass, false);
  const term = parseAss(head + ev("01.00", "02.50", "又致信美国参") + ev("02.50", "04.00", "议院点名了"));
  expect("captions: name split 美国参|议院", evaluateCaptions(term, glossary, terms, spec)[0].pass, false);
  const miss = parseAss(head + ev("01.00", "02.50", "内enterobic第三轮"));
  expect("captions: lower-case misspelling burned in", evaluateCaptions(miss, glossary, terms, spec)[1].pass, false);

  const fell = parseFontSelect("[Parsed_subtitles_0 @ 0x1] fontselect: (Noto Sans CJK SC Black, 400, 0) -> /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc, 0, NotoSansCJKsc-Regular\n");
  expect("fontselect parses", fell.selections[0]?.face === "NotoSansCJKsc-Regular", true);
  expect("captions: Black named but Regular drawn", evaluateCaptions(good, glossary, terms, spec, fell)[2].issues.some((i) => /fell back/.test(i.text)), true);
  const black = parseFontSelect("fontselect: (Noto Sans CJK SC Black, 400, 0) -> /usr/local/share/fonts/NotoSansCJKsc-Black.otf, 0, NotoSansCJKsc-Black\nGlyph 0x1F600 not found, selecting one more font for (Noto Sans CJK SC Black, 400, 0)\n");
  expect("captions: a borrowed glyph counts", evaluateCaptions(good, glossary, terms, spec, black)[2].issues.some((i) => /borrowed|another font/.test(i.text)), true);
}

/* ------------------------------------------------------ sound, credits, design */

{
  expect("loudness −16", evaluateSound({ I: -16.1, LRA: 4, TP: -1.4 }, { worst: 0.1, typical: 0.1, over: [] }, true)[0].pass, true);
  expect("loudness −14.9", evaluateSound({ I: -14.9, LRA: 4, TP: -1.4 }, null, true)[0].pass, false);
  expect("loudness TP −0.5", evaluateSound({ I: -16, LRA: 4, TP: -0.5 }, null, true)[0].pass, false);
  expect("clicks", evaluateSound(null, { worst: 0.4, typical: 0.1, over: [15_000] }, true)[1].pass, false);

  const [rec, card, block] = evaluateCredits(clean);
  expect("credits clean: record", rec.pass, true, rec);
  expect("credits clean: end card", card.pass, true, card);
  expect("credits clean: block", block.pass, true, block);
  const noAuthor = clone(clean);
  noAuthor.assets[2].author = null;
  expect("credits: an asset without author", evaluateCredits(noAuthor)[0].pass, false);
  const noCard = clone(clean);
  noCard.graphics = noCard.graphics.filter((g) => g.kind !== "end-card");
  expect("credits: no end card", evaluateCredits(noCard)[1].pass, false);
  const noBlock = clone(clean);
  noBlock.credits = { line: noBlock.credits!.line, block: "- a\n- b" };
  expect("credits: block without heading or takedown line", evaluateCredits(noBlock)[2].pass, false);

  expect("hook clean", evaluateHook(clean, ["美国三大安全机构"], 110).pass, true);
  const title = clone(clean);
  title.graphics[0].kind = "title";
  expect("hook: a topic title with no hookBlock in the gold", evaluateHook(title, undefined, 110).pass, false);
  expect("hook: first word at 0.6 s", evaluateHook(clean, ["美国三大安全机构"], 600).pass, false);

  const spoken = [...wordsOf("报告一共154页", 4_000), ...wordsOf("达到了1.51亿次", 20_500)];
  expect("stats clean", evaluateStats(clean, spoken).pass, true, evaluateStats(clean, spoken));
  const twice = clone(clean);
  twice.graphics[4].text = "154页";
  expect("stats: the same figure twice", evaluateStats(twice, spoken).pass, false);
  expect("stats: shown while something else is said", evaluateStats(clean, wordsOf("完全不相关的话", 4_000)).pass, false);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
