/**
 * W3 on the 蒸馏 fixture: source a hand-written beat list and measure it
 * against the workstream's acceptance list (PLAN.md §2 W3).
 *
 *   cd /home/ubuntu/wt/dv2-W3 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-sourcing.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] \
 *     [--silences /home/ubuntu/raw/zl_silences.txt] [--out /tmp/dv2_lab/W3/r01] [--cache /tmp/dv2_lab/cache] \
 *     [--limit 6] [--tikhub 60] [--only nsa,zhangyiming] [--no-sheets]
 *
 * Twenty-seven beats: the fourteen named entities of the brief, the one
 * person the transcript names (张一鸣 — it never names Anthropic's CEO), three
 * product demos, five scenes, four headlines. Everything is fetched with
 * `into: "local"`: nothing is written to the database or to R2, the
 * assets land under the run directory, and the searches and fetches are
 * cached under `--cache` so a second run costs no TikHub request.
 *
 * Outputs in the run directory: `sourced.json` (picks, traces, misses),
 * `report.json` (each acceptance item with its measured value),
 * `credits.txt`, `cost.json`, `sheets/chosen.jpg` (every chosen window with
 * its line and credit) and `sheets/cands-*.jpg` (what the judge saw, with
 * scores).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Beat, Silence, Sourced } from "@/lib/video/v2/types";
import { toSentences, sentenceAt } from "@/lib/video/sentences";
import { sourceBeatsReport, beatIdOf, type BeatTrace } from "@/lib/video/v2/sourcing";
import { placeCredits } from "@/lib/video/v2/credits";
import { hamming } from "@/lib/video/v2/diversity";
import { authorKey } from "@/lib/video/v2/rank";
import { sheet, type SheetCell } from "@/lib/video/contactsheet";
import { PLATFORM_LABEL, resetMediaSpend } from "@/lib/video/v2/media-adapter";
import { resetVisionSpend } from "@/lib/video/vision";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const SILENCES = arg("--silences", "/home/ubuntu/raw/zl_silences.txt");
const OUT = arg("--out", `/tmp/dv2_lab/W3/r${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")}`);
const CACHE = arg("--cache", "/tmp/dv2_lab/cache");
const LIMIT = Number(arg("--limit", "6")) || 6;
const TIKHUB = Number(arg("--tikhub", "60")) || 60;
const ONLY = arg("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const SHEETS = !argv.includes("--no-sheets");

type Fixture = { brief?: string; sourceWords?: { words: { text: string; start: number; end: number }[] } | null };

/** A test beat: the plan's `Beat` plus a name for the report and the source time it is said at, from the gold labels. */
type TestBeat = Omit<Beat, "sentenceId"> & { name: string; atMs: number };

const ent = (name: string, romanised: string, kind: NonNullable<Beat["entity"]>["kind"], descriptorZh: string, wikiTitleZh?: string, wikiTitleEn?: string, org?: string): Beat["entity"] => ({ name, romanised, kind, descriptorZh, wikiTitleZh, wikiTitleEn, org });

const BEATS: TestBeat[] = [
  /* The fourteen entities the brief lists (月之暗面 and Kimi are two beats, as the gold labels count them). */
  { name: "nsa", atMs: 5910, intent: "org", priority: 1, entity: ent("美国国安局", "NSA", "agency", "美国国家安全局", "美国国家安全局", "National Security Agency"), queries: { zh: ["美国国安局 总部大楼"], en: ["NSA headquarters Fort Meade building"] }, must: "the NSA itself: its Fort Meade headquarters building, its sign or seal", mustNot: "a generic office; a film still; a random hacker image" },
  { name: "cisa", atMs: 6830, intent: "org", priority: 1, entity: ent("网络安全局", "CISA", "agency", "美国网络安全和基础设施安全局", "网络安全和基础设施安全局", "Cybersecurity and Infrastructure Security Agency"), queries: { zh: ["美国网络安全局 CISA"], en: ["CISA cybersecurity agency headquarters logo"] }, must: "CISA itself: its logo, building or officials", mustNot: "a generic hacker or padlock picture" },
  { name: "fbi", atMs: 7850, intent: "org", priority: 1, entity: ent("FBI", "FBI", "agency", "美国联邦调查局", "联邦调查局", "Federal Bureau of Investigation"), queries: { zh: ["FBI 总部大楼"], en: ["FBI headquarters J. Edgar Hoover building"] }, must: "the FBI itself: its headquarters, its seal or agents in FBI jackets", mustNot: "a TV drama still; a generic police image" },
  { name: "anthropic", atMs: 17890, intent: "org", priority: 1, entity: ent("Anthropic", "Anthropic", "company", "Claude 的开发公司", "Anthropic", "Anthropic"), queries: { zh: ["Anthropic 公司"], en: ["Anthropic AI company logo office"] }, must: "Anthropic the AI company: its logo, office or leadership", mustNot: "a 2008 photo merely titled Anthropic; any other company" },
  { name: "claude", atMs: 143340, intent: "product", priority: 1, entity: ent("Claude", "Claude", "product", "Anthropic 的大模型", undefined, "Claude (language model)", "Anthropic"), queries: { zh: ["Claude 大模型"], en: ["Claude AI Anthropic app interface"] }, must: "the Claude product: its logo or its chat interface", mustNot: "a person named Claude; a cloud" },
  { name: "deepseek", atMs: 83400, intent: "org", priority: 1, entity: ent("DeepSeek", "DeepSeek", "company", "深度求索", "深度求索", "DeepSeek"), queries: { zh: ["DeepSeek 深度求索"], en: ["DeepSeek AI logo app"] }, must: "DeepSeek: its whale logo, its app or its company", mustNot: "an actual whale; generic AI artwork" },
  { name: "moonshot", atMs: 84080, intent: "org", priority: 1, entity: ent("月之暗面", "Moonshot AI", "company", "Kimi 的开发公司", "月之暗面", "Moonshot AI"), queries: { zh: ["月之暗面 Kimi 公司"], en: ["Moonshot AI Kimi company logo"] }, must: "Moonshot AI (月之暗面), the maker of Kimi: its logo or office", mustNot: "Pink Floyd's The Dark Side of the Moon; the moon itself" },
  { name: "kimi", atMs: 140980, intent: "product", priority: 1, entity: ent("Kimi", "Kimi", "product", "月之暗面的 AI 助手", undefined, "Kimi (chatbot)", "Moonshot AI"), queries: { zh: ["Kimi 智能助手"], en: ["Kimi Moonshot AI chatbot app"] }, must: "the Kimi AI assistant: its logo or app interface", mustNot: "a person named Kimi; Kimi Räikkönen" },
  { name: "minimax", atMs: 85220, intent: "org", priority: 1, entity: ent("MiniMax", "MiniMax", "company", "稀宇科技", "MiniMax (公司)", "MiniMax (company)"), queries: { zh: ["MiniMax 稀宇科技"], en: ["MiniMax AI company Shanghai logo"] }, must: "MiniMax, the Chinese AI company: its logo, office or products (Hailuo, Talkie)", mustNot: "the minimax algorithm; game trees" },
  { name: "alibaba", atMs: 89520, intent: "org", priority: 1, entity: ent("阿里巴巴", "Alibaba", "company", "阿里巴巴集团", "阿里巴巴集团", "Alibaba Group"), queries: { zh: ["阿里巴巴 总部"], en: ["Alibaba Group headquarters Hangzhou"] }, must: "Alibaba Group: its logo or its Hangzhou campus", mustNot: "the folk tale Ali Baba" },
  { name: "senate", atMs: 88040, intent: "org", priority: 1, entity: ent("美国参议院", "US Senate", "legislature", "美国国会参议院", "美国参议院", "United States Senate"), queries: { zh: ["美国参议院 听证会"], en: ["US Senate hearing chamber Capitol"] }, must: "the US Senate: its chamber, a hearing, or the Capitol", mustNot: "a courtroom drama" },
  { name: "mofcom", atMs: 167260, intent: "org", priority: 1, entity: ent("中国商务部", "Ministry of Commerce (China)", "agency", "中华人民共和国商务部", "中华人民共和国商务部", "Ministry of Commerce (China)"), queries: { zh: ["商务部 新闻发布会", "商务部 大楼"], en: ["China Ministry of Commerce press conference"] }, must: "China's Ministry of Commerce: its building, its sign, or a press briefing", mustNot: "a shopping mall; a supermarket" },
  { name: "bytedance", atMs: 280670, intent: "org", priority: 1, entity: ent("字节跳动", "ByteDance", "company", "字节跳动", "字节跳动", "ByteDance"), queries: { zh: ["字节跳动 总部"], en: ["ByteDance headquarters Beijing logo"] }, must: "ByteDance: its logo or its headquarters", mustNot: "TikTok dance videos" },
  { name: "nature", atMs: 320590, intent: "org", priority: 1, entity: ent("《自然》", "Nature", "publication", "《自然》杂志", "自然 (期刊)", "Nature (journal)"), queries: { zh: ["自然 杂志 封面"], en: ["Nature journal cover"] }, must: "Nature, the scientific journal: its cover or masthead", mustNot: "a nature landscape; the Creative Commons logo" },
  /* The one named person. */
  { name: "zhangyiming", atMs: 284290, intent: "person", priority: 1, entity: ent("张一鸣", "Zhang Yiming", "person", "字节跳动创始人", "张一鸣", "Zhang Yiming", "ByteDance"), queries: { zh: ["张一鸣 采访"], en: ["Zhang Yiming ByteDance interview"] }, must: "Zhang Yiming himself, the ByteDance founder, on camera or in a portrait", mustNot: "any other person; an actor; the Go player of the same name" },
  /* Product demos. */
  { name: "claude-demo", atMs: 17890, intent: "product", priority: 2, queries: { zh: ["Claude 演示"], en: ["Claude AI chat demo screen recording"] }, must: "the Claude chat interface in use", mustNot: "a talking head; burned-in creator captions; a blog page or article screenshot; a code editor; a document; a slide" },
  { name: "deepseek-app", atMs: 83400, intent: "product", priority: 2, queries: { zh: ["DeepSeek 使用 演示"], en: ["DeepSeek app demo screen recording"] }, must: "the DeepSeek app or web chat interface in use", mustNot: "a talking head; burned-in creator captions; a blog page or article screenshot; a code editor; a document; a slide" },
  { name: "kimi-app", atMs: 140980, intent: "product", priority: 2, queries: { zh: ["Kimi 使用 演示"], en: ["Kimi chat app demo"] }, must: "the Kimi chat interface in use", mustNot: "a talking head; burned-in creator captions; a blog page or article screenshot; a code editor; a document; a slide" },
  /* Scenes. */
  { name: "datacenter", atMs: 59860, intent: "scene", priority: 2, queries: { zh: ["数据中心 机房"], en: ["data center server racks aisle", "server room corridor blue light"] }, must: "a real data center: rows of server racks", mustNot: "people posing; text overlays" },
  { name: "code", atMs: 296330, intent: "scene", priority: 2, queries: { zh: ["代码 屏幕 编程"], en: ["code scrolling on a monitor close-up", "programmer screen terminal"] }, must: "source code or a terminal on a screen", mustNot: "a smiling stock actor at a laptop" },
  { name: "chip", atMs: 311650, intent: "scene", priority: 2, queries: { zh: ["芯片 特写"], en: ["semiconductor chip macro close-up circuit board", "GPU chip on a board"] }, must: "a chip or a wafer, close up", mustNot: "cartoon; text" },
  { name: "creditcard", atMs: 131180, intent: "scene", priority: 2, queries: { zh: ["信用卡 盗刷"], en: ["credit cards close-up hands typing card number", "stack of credit cards"] }, must: "credit cards shown literally, or a card being used online", mustNot: "an identifiable person portrayed as a fraudster; a mask; a gun; dancing" },
  { name: "api", atMs: 249470, intent: "scene", priority: 2, queries: { zh: ["API 调用 数据流"], en: ["API requests flowing terminal network data", "network traffic data flow visualisation"] }, must: "API traffic: a terminal of requests or a data-flow animation", mustNot: "a stock actor" },
  /* Headlines. */
  { name: "advisory", atMs: 9210, intent: "headline", priority: 1, headline: { outlet: "NSA · CISA · FBI", date: "9月8日", quoteZh: "美国三大安全机构联合公告：中国AI公司工业规模蒸馏" }, queries: { zh: ["NSA CISA FBI 联合公告 蒸馏"], en: ["NSA CISA FBI joint advisory AI model distillation China"] }, must: "the joint advisory: its document, the agencies' seals together, or a news report of it", mustNot: "unrelated cyber imagery" },
  { name: "feb", atMs: 82380, intent: "headline", priority: 2, headline: { outlet: "Anthropic", date: "2月", quoteZh: "Anthropic 指控 DeepSeek、月之暗面、MiniMax 蒸馏" }, queries: { zh: ["Anthropic 指控 DeepSeek 蒸馏"], en: ["Anthropic accuses DeepSeek Moonshot MiniMax distillation"] }, must: "a news article or report about Anthropic's accusation", mustNot: "generic AI artwork" },
  { name: "senate-letter", atMs: 86380, intent: "headline", priority: 2, headline: { outlet: "Anthropic", date: "6月", quoteZh: "Anthropic 致信美国参议院点名阿里" }, queries: { zh: ["Anthropic 致信 参议院 阿里"], en: ["Anthropic letter to US Senate Alibaba distillation"] }, must: "the letter or a report about it", mustNot: "generic artwork" },
  { name: "mofcom-statement", atMs: 167260, intent: "headline", priority: 1, headline: { outlet: "中国商务部", date: "9月", quoteZh: "商务部：美方指控于事无凭、于法无据" }, queries: { zh: ["商务部 回应 蒸馏 于法无据"], en: ["China Ministry of Commerce responds distillation accusation"] }, must: "the Ministry of Commerce briefing or a news report of its response", mustNot: "a shopping mall" },
];

const ENTITY_BEATS = new Set(["nsa", "cisa", "fbi", "anthropic", "claude", "deepseek", "moonshot", "kimi", "minimax", "alibaba", "senate", "mofcom", "bytedance", "nature"]);
const STOCK = new Set(["pexels", "unsplash", "openverse"]);
/* v1's wrong picks (gold `v1Faults`): none of them may come back. */
const V1_BANNED = [/7230784/, /28709421/, /5378125/, /creative.?commons/i, /丁笑宜|ding xiaoyi/i, /pink floyd|dark side of the moon/i, /karl barth/i];

type Check = { item: string; pass: boolean; value: string; manual?: boolean };

function checks(beats: TestBeat[], sourced: Sourced[], traces: BeatTrace[], ms: number, spend: { tikhub: number; visionUsd: number }): Check[] {
  const byId = new Map(sourced.map((s) => [s.beatId, s]));
  const nameOf = (beatId: string) => beats[Number(beatId.slice(1, 3))]?.name ?? beatId;
  const out: Check[] = [];

  const ids = sourced.map((s) => s.candidate.id);
  const urls = sourced.map((s) => s.candidate.url);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i).length + urls.filter((u, i) => urls.indexOf(u) !== i).length;
  let minHam = 64;
  let nearPair = "";
  for (let i = 0; i < sourced.length; i++)
    for (let j = i + 1; j < sourced.length; j++) {
      const d = hamming(sourced[i].dhash, sourced[j].dhash);
      if (d < minHam) {
        minHam = d;
        nearPair = `${nameOf(sourced[i].beatId)}↔${nameOf(sourced[j].beatId)}`;
      }
    }
  out.push({ item: "No provider id or permalink twice", pass: dupIds === 0, value: `${dupIds} duplicates among ${sourced.length} picks` });
  out.push({ item: "No dHash-near frame twice (Hamming ≤ 10)", pass: minHam > 10, value: `min distance ${minHam}${nearPair ? ` (${nearPair})` : ""}` });

  /* The two diversity rules the picks themselves must show (PLAN.md §1 relevance gate, §2 W3 diversity.ts). */
  const perAuthor = new Map<string, number>();
  for (const s of sourced) perAuthor.set(authorKey(s.candidate), (perAuthor.get(authorKey(s.candidate)) ?? 0) + 1);
  const overCap = Array.from(perAuthor).filter(([, n]) => n > 2);
  out.push({ item: "≤ 2 assets per author or channel", pass: overCap.length === 0, value: overCap.length ? overCap.map(([k, n]) => `${k} ×${n}`).join(", ") : `max ${Math.max(0, ...perAuthor.values())} per author over ${perAuthor.size} authors` });
  const perPlatform = new Map<string, number>();
  for (const s of sourced) perPlatform.set(s.candidate.platform, (perPlatform.get(s.candidate.platform) ?? 0) + 1);
  const top = Array.from(perPlatform).sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
  const share = sourced.length ? top[1] / sourced.length : 0;
  out.push({ item: "≤ 40 % of cutaways from one platform", pass: share <= 0.4, value: `${top[0]} ${top[1]}/${sourced.length} = ${Math.round(share * 100)}% (the reservation bound is ${Math.ceil(0.4 * beats.length)} of ${beats.length} beats)` });

  const gateFails = sourced.filter((s) => s.score < (beats[Number(s.beatId.slice(1, 3))]?.intent === "person" ? 8 : 7));
  out.push({ item: "Every chosen asset ≥ 7 (people ≥ 8)", pass: gateFails.length === 0, value: gateFails.length ? gateFails.map((s) => `${nameOf(s.beatId)}=${s.score}`).join(", ") : `scores ${sourced.map((s) => s.score).join(" ")}` });

  const epp = beats.map((b, i) => ({ b, i })).filter(({ b }) => b.intent === "org" || b.intent === "person" || b.intent === "product");
  const eppResolved = epp.filter(({ b, i }) => {
    const s = byId.get(beatIdOf({ ...b, sentenceId: traces[i]?.sentenceId ?? "" }, i));
    return s && !STOCK.has(s.candidate.platform);
  });
  out.push({ item: "≥ 60 % of entity/person/product beats from a platform/web asset", pass: eppResolved.length / epp.length >= 0.6, value: `${eppResolved.length}/${epp.length} = ${Math.round((100 * eppResolved.length) / epp.length)}%` });

  const banned = sourced.filter((s) => V1_BANNED.some((re) => re.test(`${s.candidate.id} ${s.candidate.url} ${s.candidate.title} ${s.asset.credit}`)));
  out.push({ item: "v1 picks never return (7230784, 28709421, 5378125, CC logo, 丁笑宜, 2008 'Anthropic', Pink Floyd)", pass: banned.length === 0, value: banned.length ? banned.map((s) => `${nameOf(s.beatId)}: ${s.candidate.title}`).join("; ") : "none present" });
  const moon = sourced.find((s) => nameOf(s.beatId) === "moonshot");
  out.push({ item: "月之暗面 is Moonshot AI, not Pink Floyd", pass: !moon || !/pink floyd|dark side/i.test(`${moon.candidate.title} ${moon.candidate.description ?? ""}`), value: moon ? `${moon.candidate.platform}: ${moon.candidate.title}` : "unresolved (designed card)" });

  const entityRows = beats.map((b, i) => ({ b, i })).filter(({ b }) => ENTITY_BEATS.has(b.name));
  const entityResolved = entityRows.filter(({ b, i }) => byId.has(beatIdOf({ ...b, sentenceId: traces[i]?.sentenceId ?? "" }, i)));
  const withLicence = entityResolved.filter(({ b, i }) => {
    const s = byId.get(beatIdOf({ ...b, sentenceId: traces[i]?.sentenceId ?? "" }, i))!;
    return Boolean(s.candidate.licence) && Boolean(s.asset.credit);
  });
  out.push({ item: "≥ 12/14 entities resolved with licence and credit recorded", pass: entityResolved.length >= 12, value: `${entityResolved.length}/14 resolved (${withLicence.length} with an explicit licence, the rest platform-quoted with credit); missing: ${entityRows.filter(({ b, i }) => !byId.has(beatIdOf({ ...b, sentenceId: traces[i]?.sentenceId ?? "" }, i))).map(({ b }) => b.name).join(", ") || "none"}` });

  const incomplete = sourced.filter((s) => !(s.candidate.platform && s.candidate.id && s.candidate.url && s.candidate.author?.name && s.candidate.title && s.asset.credit));
  out.push({ item: "Every Sourced has a complete Asset (platform, id, url, author, title, credit)", pass: incomplete.length === 0, value: incomplete.length ? incomplete.map((s) => nameOf(s.beatId)).join(", ") : `${sourced.length}/${sourced.length} complete` });

  const longClips = sourced.filter((s) => s.kind === "video" && (s.candidate.durationMs ?? 0) > (traces.find((t) => t.beatId === s.beatId)?.needMs ?? 0) + 2_000);
  const zeroStart = longClips.filter((s) => s.windowMs[0] <= 0);
  out.push({ item: "sourceInMs > 0 whenever the clip is longer than need + 2 s", pass: zeroStart.length === 0, value: `${longClips.length - zeroStart.length}/${longClips.length} clips start after 0 s${zeroStart.length ? ` (at 0: ${zeroStart.map((s) => nameOf(s.beatId)).join(", ")})` : ""}` });

  out.push({ item: "Whole run ≤ 3 min at limiter 6", pass: ms <= 180_000, value: `${(ms / 1000).toFixed(1)} s for ${beats.length} beats` });
  out.push({ item: "TikHub ≤ 60 requests", pass: spend.tikhub <= 60, value: `${spend.tikhub} metered requests this process` });
  out.push({ item: "Vision ≤ $0.05", pass: spend.visionUsd <= 0.05, value: `$${spend.visionUsd.toFixed(4)}` });
  out.push({ item: "Lead's blind review of sheets/chosen.jpg: ≥ 85 % 'shows the specific thing', 0 banned picks", pass: false, value: "for the lead", manual: true });
  return out;
}

async function main() {
  const t0 = Date.now();
  await mkdir(path.join(OUT, "sheets"), { recursive: true });
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const words = fixture.sourceWords?.words ?? [];
  if (!words.length) throw new Error(`${FIXTURE} carries no sourceWords`);
  const silences: Silence[] = (await readFile(SILENCES, "utf8").catch(() => ""))
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([a, b]) => ({ startMs: Math.round(a * 1000), endMs: Math.round(b * 1000) }));
  const sentences = toSentences(words, [], { clipId: "src", silences });

  const selected = ONLY.length ? BEATS.filter((b) => ONLY.includes(b.name)) : BEATS;
  const beats: Beat[] = selected.map((b) => {
    const { name, atMs, ...rest } = b;
    const s = sentenceAt(sentences, atMs);
    if (!s) throw new Error(`no sentence at ${atMs} ms for ${name}`);
    return { ...rest, sentenceId: s.id };
  });
  console.log(`${sentences.length} sentences; ${beats.length} beats (${selected.map((b) => b.name).join(", ")})`);

  resetMediaSpend();
  resetVisionSpend();
  const report = await sourceBeatsReport(beats, {
    sentences,
    into: "local",
    media: { cacheDir: CACHE, tikhubBudget: TIKHUB },
    workDir: OUT,
    sheets: SHEETS,
    limiter: LIMIT,
    contextEn: "A Chinese business-explainer reel about the 'distillation war': US agencies (NSA, CISA, FBI) and Anthropic accuse Chinese AI labs (DeepSeek, Moonshot AI / Kimi, MiniMax, Alibaba) of distilling Claude; China's Ministry of Commerce rejects the charge; ByteDance takes a different path.",
    onProgress: (m) => console.log(`  · ${m}`),
  });

  const nameOf = (beatId: string) => selected[Number(beatId.slice(1, 3))]?.name ?? beatId;
  const rows = report.traces.map((t) => {
    const s = report.sourced.find((x) => x.beatId === t.beatId);
    const who = nameOf(t.beatId).padEnd(17);
    if (s) return `${who} ${String(s.score).padStart(2)}  ${s.kind.padEnd(5)} ${s.layout.padEnd(5)} ${PLATFORM_LABEL[s.candidate.platform].padEnd(8)} ${(s.windowMs[0] / 1000).toFixed(1).padStart(6)}s  ${s.candidate.title.slice(0, 44)}  ← ${s.asset.credit}`;
    return `${who} --  ${t.skipped ? "skip " : "MISS "} ${t.missReasonZh ?? ""}`;
  });
  console.log(`\n${rows.join("\n")}`);

  const credits = placeCredits(report.sourced);
  const spend = { tikhub: report.spend.media.tikhubRequests, visionUsd: report.spend.vision.costMicros / 1e6 };
  const table = checks(selected, report.sourced, report.traces, report.ms, spend);
  console.log(`\n${table.map((c) => `${c.manual ? "LEAD" : c.pass ? "PASS" : "FAIL"}  ${c.item}\n      ${c.value}`).join("\n")}`);
  console.log(`\n${credits.line}\n\n${credits.block}`);
  console.log(`\nmedia: ${JSON.stringify(report.spend.media)}\nvision: ${JSON.stringify(report.spend.vision)}\nrun ${(report.ms / 1000).toFixed(1)} s, ${report.misses.length} misses`);

  /* The chosen-windows sheet: every pick with its line, credit, score and layout. */
  if (SHEETS && report.sourced.length) {
    const cells: SheetCell[] = report.sourced.map((s) => {
      const t = report.traces.find((x) => x.beatId === s.beatId)!;
      return { image: t.chosenImage ?? null, label: `${nameOf(s.beatId)} [${t.intent}] ${t.line.slice(0, 28)}\n${s.asset.credit.slice(0, 44)}\n${s.score}/10 · ${s.kind} · ${s.layout} · 起点 ${(s.windowMs[0] / 1000).toFixed(1)}s\n${s.candidate.licence ?? "平台引用（署名）"}` };
    });
    await sheet(cells, path.join(OUT, "sheets", "chosen.jpg"), { cols: 5, cellW: 300, cellH: 300, labelLines: 4, title: `蒸馏之战 · W3 chosen windows · ${report.sourced.length}/${beats.length} beats · ${new Date().toISOString()}` }).catch((err) => console.error("chosen sheet failed", err));
  }

  await writeFile(path.join(OUT, "sourced.json"), JSON.stringify({ at: new Date().toISOString(), beats: selected.map((b, i) => ({ ...b, sentenceId: beats[i].sentenceId })), sourced: report.sourced, traces: report.traces, misses: report.misses }, null, 2));
  await writeFile(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), ms: report.ms, wallMs: Date.now() - t0, checks: table, spend: report.spend }, null, 2));
  await writeFile(path.join(OUT, "credits.txt"), `${credits.line}\n\n${credits.block}\n`);
  await writeFile(path.join(OUT, "cost.json"), JSON.stringify({ media: report.spend.media, vision: report.spend.vision, ms: report.ms }, null, 2));
  console.log(`\nwrote ${OUT}`);
  if (report.misses.length) console.log(`misses: ${report.misses.map((m) => `${nameOf(m.beatId)}: ${m.reasonZh}`).join(" | ")}`);
}

/* The media library's fetcher imports the database client, whose idle pool keeps the event loop alive; the run is written, so leave. */
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
