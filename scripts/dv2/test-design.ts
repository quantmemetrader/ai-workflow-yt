/**
 * W6 lab test: director v2's design step on the 蒸馏 fixture, with stub
 * resolvers, no database writes, outputs under /tmp/dv2_lab/W6.
 *
 *   cd /home/ubuntu/wt/dv2-W6 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-design.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] [--gold …gold.json] \
 *     [--silences /home/ubuntu/raw/zl_silences.txt] [--raw /home/ubuntu/raw/zhengliu.mp4] \
 *     [--out /tmp/dv2_lab/W6] [--cut v1|gold|both] [--cached] [--no-model] [--translate]
 *
 * What it does, in the order the worker will, once per cut:
 *   1. sentences from the fixture's source-time words + measured silences,
 *      mapped onto a cut: `v1`, the fixture's own timeline (what the v1
 *      director produced: 11 pieces, 23 s of the take dropped, so 154页
 *      and the 捉贼大戏 line are not in it), and `gold`, a stand-in for
 *      W1's output built from the same silences (every pause ≥ 0.3 s cut
 *      to 0.12 s) with the gold retake spans removed, which is the cut
 *      density the layout will see in production (~90 pieces). W1's
 *      `planCut` replaces the stand-in once merged;
 *   2. the outline call (one paid call per cut, ≈ 7k tokens in; cached by
 *      a hash of the prompt in <out>/<cut>/outline.json; `--cached` reuses
 *      the file whatever the hash, `--no-model` fails without one);
 *   3. a stub `sourceBeats` and a stub `entityVisual`: the fixture's own
 *      bin clips and pictures where they are honest (the v1 faults in the
 *      gold are never returned), plus synthetic platform picks marked
 *      `stub` in the shapes W3 will return (Douyin portrait, Bilibili
 *      720p, YouTube 1080p, Pexels 4K, a Bing image), one per footage beat
 *      with every eighth left unresolved, so every layout path (full /
 *      split / run, logo tile, headline image, designed-card fallback)
 *      runs at the asset supply the plan expects;
 *   4. `resolveLayout` + `lintPlan`;
 *   5. `toRows` (what `persistDesign` would write), the credits text, a
 *      shot list, a per-second strip, an SVG timeline, geometry sheets from
 *      the raw take (the host's framing under each kind of graphic, with
 *      the zones drawn; v1 cut only), and `report.json` with the
 *      acceptance table for each cut;
 *   6. `--translate`: the three parallel translation batches, timed, not
 *      written (three more paid calls, small).
 *
 * Nothing here touches the database except the model client's own cached
 * read of the model choice. The raw take is read only.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Beat, FaceTrack, Layout, Sentence, Silence, Sourced } from "../../lib/video/v2/types";
import { toSentences } from "../../lib/video/sentences";
import { FRAME, ZONES, faceBoxUnder, saidNear, sentencesOnTimeline, type LayoutPlan } from "../../lib/video/layout";
import { hookFromBrief, outlineMessages, parseOutline, planDesign, type DesignInput, type DesignResult, type Outline, type OutlineEntity } from "../../lib/video/v2/design";
import { toRows } from "../../lib/video/v2/persist";
import { furnitureFromBrief, parseTranslation } from "../../lib/video/director";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name: string) => argv.includes(name);

const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");
const SILENCES = arg("--silences", "/home/ubuntu/raw/zl_silences.txt");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const OUT = arg("--out", "/tmp/dv2_lab/W6");
const CUT = arg("--cut", "both") as "v1" | "gold" | "both";

type Fixture = {
  project: { id: string; title: string; tenantName: string | null; accent: string };
  brief: string;
  timeline: { clipId: string | null; inMs: number; outMs: number | null; kind: string }[];
  captions: Record<string, { startMs: number; endMs: number; text: string; keywords: string[]; ord: number; id: string }[]>;
  graphics: { kind: string; fileId: string | null; options: Record<string, unknown>; file: { name: string; mime: string; width: number | null; height: number | null } | null }[];
  clips: { id: string; fileId: string; label: string; durationMs: number | null }[];
  sourceWords: { words: { text: string; start: number; end: number }[] } | null;
};
type Gold = {
  retakes: { name: string; dropStartMs: number; dropEndMs: number }[];
  anchors: { entities: { name: string; romanised: string; kind: string }[]; scenes: { nameZh: string; en: string }[]; terms: { term: string }[]; numbers: { text: string; value: string }[] };
};

/* The face of the 蒸馏 take, measured on a frame at 60 s (frame 1080×1920
   after the rotation tag): eyes at 40 % of the height, chin at 53 %, the
   head from x 0.34 to 0.68 and y 0.275 to 0.53. W5's `faceTrack` replaces
   this; the units are fractions, which `layout.ts` accepts. */
const FACE_STUB: FaceTrack = { clipId: "src", box: [0.34, 0.275, 0.34, 0.255], eyeY: 0.4, chinY: 0.53, samples: 0 };

async function exists(p: string) {
  return Boolean(await stat(p).catch(() => null));
}

/* ------------------------------------------------------------- the cuts */

/** The fixture's own timeline: the v1 director's cut, in source time. */
function v1Cut(fixture: Fixture): { inMs: number; outMs: number }[] {
  return fixture.timeline.filter((t) => t.kind === "clip" && t.outMs !== null).map((t) => ({ inMs: t.inMs, outMs: t.outMs as number }));
}

/**
 * A stand-in for W1's cut: every measured silence of 300 ms or more cut
 * down to 120 ms (60 ms kept on each side), the gold's retake spans
 * removed, the rest kept. Not W1's algorithm — no filler detection, no
 * model call, no snap — but the same cut density, which is what the
 * layout's cadence depends on.
 */
function goldCut(words: { start: number; end: number }[], silences: Silence[], gold: Gold | null): { inMs: number; outMs: number }[] {
  const first = Math.max(0, Math.round(words[0].start * 1000) - 200);
  const last = Math.round(words[words.length - 1].end * 1000) + 300;
  const removed: [number, number][] = [];
  for (const s of silences) if (s.endMs - s.startMs >= 300) removed.push([s.startMs + 60, s.endMs - 60]);
  for (const r of gold?.retakes ?? []) removed.push([r.dropStartMs, r.dropEndMs]);
  removed.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of removed) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const pieces: { inMs: number; outMs: number }[] = [];
  let at = first;
  for (const [a, b] of merged) {
    if (a > at + 200) pieces.push({ inMs: at, outMs: Math.min(a, last) });
    at = Math.max(at, b);
  }
  if (last > at + 200) pieces.push({ inMs: at, outMs: last });
  return pieces;
}

/* --------------------------------------------------------- stub sourcing */

type Cand = Sourced["candidate"];
type StubPick = { match: (b: Beat) => boolean; kind: Sourced["kind"]; cand: Cand; fileId: string; width: number; height: number; durationMs?: number; score: number; reasonZh: string; stub: boolean; localPath?: string };

const PLATFORM_ZH: Record<string, string> = { douyin: "抖音", bilibili: "B站", youtube: "YouTube", openverse: "Wikimedia Commons", pexels: "Pexels", bing: "Bing", pinterest: "Pinterest", tiktok: "TikTok" };

const platformCand = (p: Cand["platform"], id: string, title: string, author: string, w: number, h: number, durationMs: number, kind: Cand["kind"] = "video", licence?: string): Cand => ({
  id: `${p}:${id}`,
  kind,
  platform: p,
  title,
  url: `https://example.invalid/${p}/${id}`,
  author: { name: author },
  thumb: "",
  durationMs: kind === "video" ? durationMs : undefined,
  width: w,
  height: h,
  orientation: w > h ? "landscape" : w < h ? "portrait" : "square",
  handle: kind === "video" ? { via: "yt-dlp", url: `https://example.invalid/${p}/${id}` } : { via: "image", url: `https://example.invalid/${p}/${id}` },
  licence,
  credit: `${PLATFORM_ZH[p] ?? p} @${author}`,
});

/**
 * The honest picks: the fixture's own bin clips and pictures where they fit
 * the line. The v1 faults named in the gold are never returned: 7230784
 * (the dancing gun), 5378125 (a stock actor as a fraudster), the 2008
 * "Anthropic" Flickr photo, the mall benches for 商务部, the CC logo for
 * 《自然》, the DING XIAOYI still for 张一鸣.
 */
function fixturePicks(fixture: Fixture): StubPick[] {
  const clip = (label: RegExp) => fixture.clips.find((c) => label.test(c.label));
  const image = (credit: RegExp) => fixture.graphics.find((g) => g.kind === "image" && credit.test(String(g.options.credit ?? "")));
  const has = (b: Beat, ...keys: string[]) => {
    const hay = [b.entity?.name, b.entity?.romanised, b.must, ...(b.queries?.zh ?? []), ...(b.queries?.en ?? [])].filter(Boolean).join(" ").toLowerCase();
    return keys.some((k) => hay.includes(k.toLowerCase()));
  };
  const pexels = (id: string, title: string, author: string, w: number, h: number, durationMs: number): Cand => ({
    ...platformCand("pexels", id, title, author, w, h, durationMs, "video", "Pexels License"),
    url: `https://www.pexels.com/video/${id}/`,
    author: { name: author, url: `https://www.pexels.com/@${author.toLowerCase().replace(/\s+/g, "-")}` },
    handle: { via: "direct", url: `https://www.pexels.com/video/${id}/` },
  });
  const picks: StubPick[] = [];
  const dc = clip(/data center server racks\.mp4$/);
  if (dc) picks.push({ match: (b) => b.intent === "scene" && has(b, "数据中心", "data center", "server", "机房"), kind: "video", cand: pexels("28709421", "Digital data display on screen", "Kuiyibo Campos", 3840, 2160, dc.durationMs ?? 21067), fileId: dc.fileId, width: 3840, height: 2160, durationMs: dc.durationMs ?? 21067, score: 8, reasonZh: "机房机架，蓝光", stub: false });
  const chip = clip(/chip close-up/);
  if (chip) picks.push({ match: (b) => b.intent === "scene" && has(b, "芯片", "chip", "semiconductor", "gpu"), kind: "video", cand: pexels("6755168", "Close-up shot of an electronic motherboard", "Tima Miroshnichenko", 1920, 1080, chip.durationMs ?? 23920), fileId: chip.fileId, width: 1920, height: 1080, durationMs: chip.durationMs ?? 23920, score: 7, reasonZh: "电路板特写", stub: false });
  const api = clip(/AI API usage dashboard/);
  if (api) picks.push({ match: (b) => b.intent === "scene" && has(b, "api", "调用", "dashboard", "接口"), kind: "video", cand: pexels("38992894", "Analyzing business growth on digital tablet", "Jakub Zerdzicki", 1920, 1080, api.durationMs ?? 12760), fileId: api.fileId, width: 1920, height: 1080, durationMs: api.durationMs ?? 12760, score: 7, reasonZh: "数据面板上升曲线", stub: false });
  const bytedance = image(/字节跳动厦门总部/);
  if (bytedance?.fileId) picks.push({ match: (b) => b.intent === "org" && has(b, "字节跳动", "bytedance"), kind: "image", cand: { ...platformCand("openverse", "196568130", "字节跳动厦门总部大楼", "向史公哲曰", bytedance.file?.width ?? 1600, bytedance.file?.height ?? 1200, 0, "image", "CC BY-SA 4.0"), url: "https://commons.wikimedia.org/w/index.php?curid=196568130" }, fileId: bytedance.fileId, width: bytedance.file?.width ?? 1600, height: bytedance.file?.height ?? 1200, score: 8, reasonZh: "字节跳动总部大楼", stub: false });
  const alibaba = image(/阿里巴巴/);
  if (alibaba?.fileId) picks.push({ match: (b) => b.intent === "org" && has(b, "阿里巴巴", "alibaba", "阿里"), kind: "image", cand: { ...platformCand("openverse", "6345869633", "阿里巴巴", "Le Zenits", alibaba.file?.width ?? 1024, alibaba.file?.height ?? 768, 0, "image", "CC BY 2.0"), url: "https://www.flickr.com/photos/67703314@N07/6345869633" }, fileId: alibaba.fileId, width: alibaba.file?.width ?? 1024, height: alibaba.file?.height ?? 768, score: 7, reasonZh: "阿里巴巴园区标识", stub: false });
  return picks;
}

/**
 * The synthetic picks, in the shapes W3 returns from the platforms (its
 * routing table in PLAN.md W3): an interview clip for a person, a news
 * clip or a building for an org, a screen recording for a product, an
 * article image for a headline, dark tech b-roll for a scene. Shapes cycle
 * so every layout is exercised: Douyin 1080×1920 (`full`), Bilibili
 * 1280×720 and YouTube 1920×1080 (`split`), Pexels 3840×2160 (`full`,
 * cropped on the subject), Bilibili 960×540 (`run`), a Bing image
 * (a still). Ids never repeat; authors come from a pool so the cap of two
 * per author bites now and then.
 */
function syntheticPick(b: Beat, n: number): StubPick | null {
  const name = b.entity?.name ?? b.queries?.zh[0] ?? b.intent;
  const rom = b.entity?.romanised ?? b.queries?.en[0] ?? b.intent;
  const id = `stub_${b.sentenceId}_${n}`;
  const author = (pool: string[]) => pool[n % pool.length];
  const S = (platform: Cand["platform"], w: number, h: number, dur: number, title: string, who: string, kind: Cand["kind"] = "video", licence?: string): StubPick => ({
    match: () => true,
    kind: kind === "image" ? "image" : "video",
    cand: platformCand(platform, id, title, who, w, h, dur, kind, licence),
    fileId: `fil_${id}`,
    width: w,
    height: h,
    durationMs: kind === "video" ? dur : undefined,
    score: 7 + (n % 3),
    reasonZh: `${title}（stub）`,
    stub: true,
  });
  switch (b.intent) {
    case "person":
      return n % 2 ? S("youtube", 1920, 1080, 720000, `${rom} interview`, author(["Bloomberg", "CNBC", "TED"])) : S("bilibili", 1280, 720, 180000, `${name} 采访`, author(["商业访谈录", "极客公园", "晚点LatePost"]));
    case "org":
      return [
        () => S("douyin", 1080, 1920, 45000, `${name} 新闻`, author(["央视新闻", "第一财经", "澎湃新闻", "新华社"])),
        () => S("youtube", 1920, 1080, 300000, `${rom} headquarters`, author(["Reuters", "AP Archive", "Bloomberg"])),
        () => S("bing", 1600, 900, 0, `${rom} building`, author(["Wikimedia Commons", "Flickr user", "press kit"]), "image", "CC BY-SA 4.0"),
      ][n % 3]();
    case "product":
      return n % 2 ? S("bilibili", 1280, 720, 300000, `${name} 上手演示`, author(["AI工具箱", "量子位", "机器之心"])) : S("youtube", 1920, 1080, 95000, `${rom} demo`, author(["official channel", "Fireship", "Matt Wolfe"]));
    case "headline":
      return S("bing", 1600, 900, 0, `${b.headline?.outlet ?? "news"}: ${b.headline?.quoteZh ?? name}`, author(["news site", "official site", "press"]), "image");
    case "scene":
      return [
        () => S("pexels", 3840, 2160, 20000, `${rom} 4K b-roll`, author(["Kuiyibo Campos", "Tima Miroshnichenko", "cottonbro studio", "Pressmaster"]), "video", "Pexels License"),
        () => S("douyin", 1080, 1920, 30000, `${name} 竖屏`, author(["科技美学", "数字生活", "极客湾"])),
        () => S("bilibili", 960, 540, 120000, `${name} 空镜`, author(["影视飓风", "老师好我叫何同学", "硬核的半佛仙人"])),
        () => S("pexels", 1080, 1920, 18000, `${rom} portrait`, author(["Mikhail Nilov", "Yan Krukau", "Ron Lach"]), "video", "Pexels License"),
      ][n % 4]();
    case "metaphor":
      return S("pexels", 1920, 1080, 25000, `${rom} b-roll`, author(["Pavel Danilyuk", "Anna Shvets", "Kindel Media"]), "video", "Pexels License");
    case "concept":
      return S("bilibili", 1280, 720, 400000, `${name} 动画讲解`, author(["3Blue1Brown 官方", "李永乐老师", "回形针PaperClip"]));
    default:
      return null;
  }
}

function layoutFor(width: number, height: number, kind: Sourced["kind"]): Layout {
  if (kind !== "video") return "full";
  if (height >= width) return width >= 1080 ? "full" : "run";
  if (width >= 3840) return "full";
  if (width >= 1280) return "split";
  return "run";
}

function toSourced(b: Beat, pick: StubPick, n: number): Sourced {
  const need = 2500 + (n % 4) * 500; // 2.5–4 s windows, as W3's `pickWindow` returns
  const inMs = pick.durationMs && pick.durationMs > need + 2000 ? Math.min(Math.max(1000, Math.round(pick.durationMs * 0.2)), pick.durationMs - need - 1000) : 0;
  const window: [number, number] = [inMs, inMs + (pick.kind === "video" ? need : 0)];
  return {
    beatId: b.sentenceId,
    asset: { fileId: pick.fileId, candidate: pick.cand, localPath: pick.localPath, credit: pick.cand.credit, fetchedAt: new Date().toISOString(), durationMs: pick.durationMs, width: pick.width, height: pick.height, window: { start: window[0], end: window[1] } },
    candidate: pick.cand,
    kind: pick.kind,
    score: pick.score,
    reasonZh: pick.reasonZh + (pick.stub && !pick.reasonZh.includes("stub") ? "（stub）" : ""),
    windowMs: window,
    subjectX: 0.5,
    dhash: pick.cand.id,
    layout: layoutFor(pick.width, pick.height, pick.kind),
    alternatives: [],
  };
}

function makeStubSourcer(fixture: Fixture, log: string[]) {
  const honest = fixturePicks(fixture);
  const usedIds = new Set<string>();
  const perAuthor = new Map<string, number>();
  let n = 0;
  return async (beats: Beat[]): Promise<Sourced[]> => {
    const out: Sourced[] = [];
    for (const b of beats) {
      n++;
      const ok = (p: StubPick) => !usedIds.has(p.cand.id) && (perAuthor.get(p.cand.author.name) ?? 0) < 2;
      let pick = honest.find((p) => ok(p) && p.match(b)) ?? null;
      if (!pick && n % 8 !== 0) {
        const synth = syntheticPick(b, n);
        if (synth && ok(synth)) pick = synth;
      }
      if (!pick) {
        log.push(`  – ${b.sentenceId} ${b.intent} ${b.entity?.name ?? b.queries?.zh[0] ?? ""}: nothing scored ≥ 7 (stub miss) → designed card / host`);
        continue;
      }
      usedIds.add(pick.cand.id);
      perAuthor.set(pick.cand.author.name, (perAuthor.get(pick.cand.author.name) ?? 0) + 1);
      const s = toSourced(b, pick, n);
      out.push(s);
      log.push(`  ✓ ${b.sentenceId} ${b.intent} ${b.entity?.name ?? b.queries?.zh[0] ?? ""} → ${pick.cand.id} ${pick.width}×${pick.height} ${s.layout} ${(s.windowMs[1] - s.windowMs[0]) / 1000}s${pick.stub ? " [stub]" : ""}`);
    }
    return out;
  };
}

/**
 * The entity resolver stub, in the shape W3's `entities.ts:entityVisual`
 * returns: a logo from Wikidata P154 via Commons for the companies and
 * products; nothing for the US agencies, the legislature, the ministry
 * and the person (the plan prefers the designed card or an HQ / interview
 * clip to a seal or a headshot).
 */
function makeStubEntityVisual(log: string[]) {
  const LOGOS: Record<string, { licence: string; w: number; h: number }> = {
    Anthropic: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    Claude: { licence: "Public domain (text logo)", w: 800, h: 800 },
    DeepSeek: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    月之暗面: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    Kimi: { licence: "Public domain (text logo)", w: 800, h: 800 },
    MiniMax: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    阿里巴巴: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    字节跳动: { licence: "Public domain (text logo)", w: 1200, h: 400 },
    FBI: { licence: "Public domain (US federal government)", w: 800, h: 800 },
    "《自然》杂志": { licence: "Public domain (text logo)", w: 1200, h: 400 },
  };
  return async (e: OutlineEntity): Promise<Sourced | null> => {
    const l = LOGOS[e.name];
    if (!l) {
      log.push(`  – logo ${e.name}: none by policy (stub) → card without logo`);
      return null;
    }
    const cand: Cand = { ...platformCand("openverse", `logo_${e.wikiTitleEn ?? e.name}`, `${e.romanised ?? e.name} logo`, `${e.romanised ?? e.name} (Wikimedia Commons)`, l.w, l.h, 0, "image", l.licence), url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(`${e.romanised ?? e.name}_logo.svg`)}` };
    log.push(`  ✓ logo ${e.name} → ${cand.id} ${l.w}×${l.h} [stub]`);
    return {
      beatId: e.firstSentenceId ?? "s000",
      asset: { fileId: `fil_stub_logo_${(e.romanised ?? e.name).replace(/\W+/g, "_")}`, candidate: cand, credit: cand.credit, fetchedAt: new Date().toISOString(), width: l.w, height: l.h },
      candidate: cand,
      kind: "logo",
      score: 9,
      reasonZh: `${e.name} 标志（stub）`,
      windowMs: [0, 0],
      subjectX: 0.5,
      dhash: cand.id,
      layout: "full",
      alternatives: [],
    };
  };
}

/* --------------------------------------------------------------- outputs */

const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${(Math.floor(ms / 100) / 10 - Math.floor(ms / 60000) * 60).toFixed(1).padStart(4, "0")}`;

function shotList(plan: LayoutPlan, sentences: Sentence[]): string {
  type Shot = { startMs: number; endMs: number; kind: string; what: string; where: string; credit: string };
  const shots: Shot[] = [];
  for (const g of plan.graphics) {
    if (["header", "watermark", "footnote"].includes(g.kind)) continue;
    const p = g.props;
    const logo = p.logo as { credit?: string } | null | undefined;
    const image = p.image as { credit?: string } | null | undefined;
    const what = Array.isArray(p.lines) ? (p.lines as string[]).join(" | ") : [p.text, p.unit, p.sub].filter(Boolean).join(" · ");
    shots.push({ startMs: g.startMs, endMs: g.endMs, kind: g.kind, what: String(what).slice(0, 60), where: g.zone, credit: logo?.credit ?? image?.credit ?? "" });
  }
  for (const c of plan.cutaways) shots.push({ startMs: c.startMs, endMs: c.endMs, kind: `cutaway:${c.kind}`, what: `${c.label} · ${c.reasonZh}`.slice(0, 60), where: `${c.layout}${c.runId ? ` (${c.runId})` : ""}`, credit: c.credit });
  for (const p of plan.pushes) shots.push({ startMs: p.startMs, endMs: p.endMs, kind: "snap push", what: sentences.find((s) => s.id === p.sentenceId)?.text.slice(0, 30) ?? p.sentenceId, where: `→${p.to}`, credit: "" });
  shots.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const lines = shots.map((s) => `${mmss(s.startMs)}–${mmss(s.endMs)}  ${s.kind.padEnd(14)}  ${s.where.padEnd(12)}  ${s.what}${s.credit ? `  [${s.credit}]` : ""}`);
  const kinds = new Map<string, number>();
  for (const s of shots) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
  return [`${shots.length} shots: ${Array.from(kinds).map(([k, n]) => `${k} ${n}`).join(", ")}`, "", ...lines].join("\n");
}

function strip(plan: LayoutPlan, sentences: Sentence[], totalMs: number): string {
  const lines = ["sec  | host framing        | cutaway                      | graphic                        | push | said"];
  for (let t = 0; t < totalMs; t += 1000) {
    const seg = plan.cutZooms.find((s) => s.inMs <= t && t < s.outMs);
    const cut = plan.cutaways.find((c) => c.startMs <= t && t < c.endMs);
    const g = plan.graphics.filter((x) => !["header", "watermark", "footnote"].includes(x.kind)).find((x) => x.startMs <= t && t < x.endMs);
    const push = plan.pushes.find((p) => p.startMs <= t && t < p.endMs);
    const s = sentences.find((x) => x.startMs <= t && t < x.endMs);
    const fr = seg ? `${seg.zoom.toFixed(2)} eye ${seg.anchor[1].toFixed(2)} ${seg.why}${seg.push ? ` →${seg.push.to}` : ""}` : "";
    const cu = cut ? `${cut.layout} ${cut.label.slice(0, 14)} ${cut.kind}` : "";
    const gr = g ? `${g.kind} ${String(g.props.text ?? (g.props.lines as string[])?.join("|") ?? "").slice(0, 18)}` : "";
    lines.push(`${String(t / 1000).padStart(4)} | ${fr.padEnd(19).slice(0, 19)} | ${cu.padEnd(28).slice(0, 28)} | ${gr.padEnd(30).slice(0, 30)} | ${push ? "snap" : "    "} | ${s ? s.text.slice(0, 26) : ""}`);
  }
  return lines.join("\n");
}

function svgTimeline(plan: LayoutPlan, totalMs: number, chapters: { titleZh: string; sentenceId: string }[], sentences: Sentence[], pieces: { inMs: number; outMs: number }[]): string {
  const W = 2400;
  const left = 110;
  const px = (ms: number) => left + ((W - left - 20) * ms) / totalMs;
  const lanes = ["cuts", "framing", "cutaway", "T-zone graphic", "other graphic", "push", "chapter"];
  const laneY = (i: number) => 40 + i * 46;
  const rects: string[] = [];
  const colour: Record<string, string> = { full: "#4f81c7", split: "#8a5fd6", run: "#2fa39b", hook: "#e0b23a", counter: "#d6e64f", compare: "#d6e64f", list: "#d6e64f", entity: "#f08a4b", headline: "#f0c24b", term: "#7cc27a", diagram: "#7cc27a", chip: "#aaa", stinger: "#222", "lower-third": "#888", "end-card": "#222" };
  for (const p of pieces) rects.push(`<rect x="${px(p.inMs)}" y="${laneY(0)}" width="${Math.max(1, px(p.outMs) - px(p.inMs) - 1)}" height="32" fill="#e8e8e8" stroke="#999"/>`);
  for (const s of plan.cutZooms) rects.push(`<rect x="${px(s.inMs)}" y="${laneY(1)}" width="${Math.max(1, px(s.outMs) - px(s.inMs) - 1)}" height="32" fill="${s.why === "zone-T" ? "#ffd" : s.why === "split" ? "#eef" : s.why === "run" ? "#dfd" : s.zoom > 1.05 ? "#ddd" : "#f6f6f6"}" stroke="#bbb"/><text x="${px(s.inMs) + 3}" y="${laneY(1) + 20}" font-size="11">${s.zoom.toFixed(2)}${s.push ? `→${s.push.to}` : ""} ${s.anchor[1].toFixed(2)}</text>`);
  for (const c of plan.cutaways) rects.push(`<rect x="${px(c.startMs)}" y="${laneY(2)}" width="${Math.max(2, px(c.endMs) - px(c.startMs))}" height="32" fill="${colour[c.layout]}" opacity="0.85"/><text x="${px(c.startMs) + 2}" y="${laneY(2) + 20}" font-size="11" fill="#fff">${c.layout} ${c.label.slice(0, 8)}</text>`);
  for (const g of plan.graphics.filter((x) => !["header", "watermark", "footnote"].includes(x.kind))) {
    const lane = g.zone === "T" ? 3 : 4;
    rects.push(`<rect x="${px(g.startMs)}" y="${laneY(lane)}" width="${Math.max(2, px(g.endMs) - px(g.startMs))}" height="32" fill="${colour[g.kind] ?? "#999"}" opacity="0.9"/><text x="${px(g.startMs) + 2}" y="${laneY(lane) + 20}" font-size="11" fill="#000">${g.kind} ${String(g.props.text ?? "").slice(0, 10)}</text>`);
  }
  for (const p of plan.pushes) rects.push(`<rect x="${px(p.startMs)}" y="${laneY(5)}" width="${Math.max(2, px(p.endMs) - px(p.startMs))}" height="32" fill="#e35"/>`);
  for (const ch of chapters) {
    const s = sentences.find((x) => x.id === ch.sentenceId);
    if (s) rects.push(`<line x1="${px(s.startMs)}" y1="30" x2="${px(s.startMs)}" y2="${laneY(6) + 32}" stroke="#222" stroke-dasharray="3,3"/><text x="${px(s.startMs) + 3}" y="${laneY(6) + 20}" font-size="12">${ch.titleZh}</text>`);
  }
  const ticks: string[] = [];
  for (let t = 0; t <= totalMs; t += 10000) ticks.push(`<line x1="${px(t)}" y1="${laneY(6) + 36}" x2="${px(t)}" y2="${laneY(6) + 42}" stroke="#444"/><text x="${px(t) - 8}" y="${laneY(6) + 56}" font-size="11">${t / 1000}</text>`);
  const labels = lanes.map((l, i) => `<text x="6" y="${laneY(i) + 20}" font-size="12" fill="#333">${l}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${laneY(6) + 70}" font-family="Noto Sans CJK SC, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${labels.join("")}${rects.join("")}${ticks.join("")}</svg>`;
}

/** The raw frame at a timeline moment, framed as the plan says, with the zones drawn on it. */
async function geometrySheet(plan: LayoutPlan, moments: { label: string; ms: number }[], pieces: { inMs: number; outMs: number; srcIn: number }[], face: FaceTrack, out: string) {
  if (!(await exists(RAW))) return null;
  const toSource = (ms: number) => {
    const p = pieces.find((x) => x.inMs <= ms && ms < x.outMs) ?? pieces[pieces.length - 1];
    return p.srcIn + (ms - p.inMs);
  };
  const files: string[] = [];
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  for (const [i, m] of moments.entries()) {
    const seg = plan.cutZooms.find((s) => s.inMs <= m.ms && m.ms < s.outMs);
    const zoom = seg?.push && seg.push.toMs <= m.ms ? seg.push.to : (seg?.zoom ?? 1);
    const eyeY = seg?.anchor[1] ?? 0.33;
    const box = faceBoxUnder(face, zoom, eyeY)!;
    const s = box.scale;
    const eyeSrc = face.eyeY * FRAME.height;
    const offX = Math.max(0, Math.round((FRAME.width * s - FRAME.width) / 2));
    const offY = Math.max(0, Math.min(Math.round(FRAME.height * s - FRAME.height), Math.round(eyeSrc * s - eyeY * FRAME.height)));
    const g = plan.graphics.find((x) => x.zone === "T" && x.startMs <= m.ms && m.ms < x.endMs);
    const capTop = plan.renderHints.captionZhY - ZONES.caption.zhSize / 2;
    const draw = [
      `scale=iw*${s.toFixed(4)}:ih*${s.toFixed(4)}`,
      `crop=${FRAME.width}:${FRAME.height}:${offX}:${offY}`,
      `drawbox=x=${ZONES.T.x0}:y=${ZONES.T.y0}:w=${ZONES.T.x1 - ZONES.T.x0}:h=${ZONES.T.y1 - ZONES.T.y0}:color=yellow@0.9:t=5`,
      `drawbox=x=${Math.round(box.x0)}:y=${Math.round(box.y0)}:w=${Math.round(box.x1 - box.x0)}:h=${Math.round(box.y1 - box.y0)}:color=red@0.9:t=5`,
      `drawbox=x=64:y=${capTop}:w=952:h=${ZONES.caption.zhSize}:color=green@0.9:t=4`,
      `drawbox=x=0:y=${ZONES.unsafe.bottom}:w=${FRAME.width}:h=${FRAME.height - ZONES.unsafe.bottom}:color=black@0.35:t=fill`,
      `drawbox=x=0:y=0:w=${FRAME.width}:h=${ZONES.unsafe.top}:color=black@0.35:t=fill`,
      g ? `drawbox=x=${ZONES.T.x0}:y=${ZONES.T.y0}:w=${ZONES.T.x1 - ZONES.T.x0}:h=${ZONES.T.y1 - ZONES.T.y0}:color=white@0.25:t=fill` : null,
      seg?.why === "run" ? `drawbox=x=${Math.round(ZONES.run.cx * FRAME.width - (ZONES.run.diameter * FRAME.width) / 2)}:y=${Math.round(ZONES.run.cy * FRAME.height - (ZONES.run.diameter * FRAME.width) / 2)}:w=${Math.round(ZONES.run.diameter * FRAME.width)}:h=${Math.round(ZONES.run.diameter * FRAME.width)}:color=cyan@0.9:t=5` : null,
      `drawtext=fontfile=${font}:text='${m.label.replace(/[':]/g, " ")} ${(m.ms / 1000).toFixed(1)}s zoom ${zoom.toFixed(2)} eye ${eyeY.toFixed(2)} scale ${s.toFixed(2)}${g ? ` ${g.kind}` : ""}${seg?.why === "run" ? " run" : ""}':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.6:x=20:y=30`,
      "scale=360:640",
    ].filter(Boolean);
    const file = path.join(out, `geo_${i}.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", (toSource(m.ms) / 1000).toFixed(3), "-i", RAW, "-frames:v", "1", "-vf", draw.join(","), file], { timeout: 60_000 });
    files.push(file);
  }
  const sheet = path.join(out, "geometry-sheet.png");
  const cols = Math.min(3, files.length);
  await run("ffmpeg", ["-v", "error", "-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 360}_${Math.floor(i / cols) * 640}`).join("|")}:fill=black[v]`, "-map", "[v]", sheet], { timeout: 60_000 });
  return sheet;
}

/* --------------------------------------------------------------- one cut */

type Acceptance = { item: string; pass: boolean; value: string };

async function designCut(cut: "v1" | "gold", fixture: Fixture, gold: Gold | null, words: { text: string; start: number; end: number }[], silences: Silence[], outDir: string, spend: { cost: number }) {
  await mkdir(outDir, { recursive: true });

  /* 1. sentences: source clock → the cut's timeline clock */
  const sourceSentences = toSentences(words, [], { clipId: "src", silences });
  const cutPieces = cut === "v1" ? v1Cut(fixture) : goldCut(words, silences, gold);
  const mapped = sentencesOnTimeline(sourceSentences, cutPieces);
  const sentences = mapped.sentences;
  const totalMs = mapped.totalMs;
  const placed = mapped.pieces.map((p, i) => ({ ...p, srcIn: cutPieces[i].inMs }));
  console.log(`\n[${cut}] ${sourceSentences.length} source sentences → ${sentences.length} on the timeline (${(totalMs / 1000).toFixed(1)} s in ${cutPieces.length} pieces)`);

  /* Captions on this cut's clock: the fixture's own lines for the v1 cut (they were written on it); the sentences as lines for the stand-in cut. */
  const zh = fixture.captions["zh-CN"] ?? [];
  const captions = cut === "v1" ? zh.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })) : sentences.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }));

  const input: DesignInput = {
    brief: fixture.brief,
    sentences,
    pieces: mapped.pieces,
    totalMs,
    captions,
    face: FACE_STUB,
    pace: "channel",
    accent: fixture.project.accent,
    language: "zh-CN",
    furniture: furnitureFromBrief(fixture.brief, fixture.project.title, fixture.project.tenantName),
    voice: null,
  };

  /* 2. the outline: the model's raw answer cached by the prompt's hash and parsed afresh (so a parser fix applies to a cached answer), or one paid call */
  const cachePath = path.join(outDir, "outline.json");
  const rawPath = path.join(outDir, "outline.raw.txt");
  const msg = outlineMessages(input);
  const hash = createHash("sha1").update(msg.system).update(msg.user).digest("hex").slice(0, 10);
  let cached: Outline | null = null;
  const stored = JSON.parse(await readFile(cachePath, "utf8").catch(() => "null")) as { hash?: string; raw?: string; outline?: Outline } | null;
  if (stored && (stored.hash === hash || has("--cached") || has("--no-model"))) {
    const raw = stored.raw ?? (await readFile(rawPath, "utf8").catch(() => ""));
    cached = raw ? parseOutline(raw, sentences) : (stored.outline ?? null);
    if (cached) console.log(`outline from cache ${cachePath}${stored.hash === hash ? "" : " (prompt changed; --cached forces it)"}${raw ? "" : " (parsed copy; no raw answer stored)"}`);
  }
  if (!cached && has("--no-model")) throw new Error(`--no-model but no cached outline at ${cachePath}`);

  let rawAnswer = "";
  const modelCall = cached
    ? null
    : async (req: { system: string; user: string; maxTokens: number; temperature: number }) => {
        const [{ complete }, { modelFor }] = await Promise.all([import("../../lib/ai/openrouter"), import("../../lib/ai/models")]);
        const t = Date.now();
        const out = await complete({ model: modelFor.assistant(), temperature: req.temperature, maxTokens: req.maxTokens, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] });
        spend.cost += out.costMicros;
        console.log(`outline call: ${out.model} via ${out.provider} ${out.promptTokens}+${out.completionTokens} tokens, $${(out.costMicros / 1e6).toFixed(4)}, ${Date.now() - t} ms`);
        rawAnswer = out.text;
        await writeFile(rawPath, out.text);
        return { text: out.text, costMicros: out.costMicros };
      };

  /* 3–4. design with the stub sourcer and the stub entity resolver */
  const sourcingLog: string[] = [];
  const traceLines: string[] = [];
  const t0 = Date.now();
  const design: DesignResult = await planDesign(input, {
    complete: modelCall,
    outline: cached,
    sourceBeats: makeStubSourcer(fixture, sourcingLog),
    entityVisual: makeStubEntityVisual(sourcingLog),
    say: (text) => console.log(`  say: ${text}`),
    trace: (line) => traceLines.push(line),
  });
  const designMs = Date.now() - t0;
  if (!cached) await writeFile(cachePath, JSON.stringify({ hash, raw: rawAnswer, outline: design.outline }, null, 2));
  await writeFile(path.join(outDir, "trace.txt"), traceLines.join("\n"));

  const { plan, outline, lint, credits } = design;
  console.log(`design ${designMs} ms (outline ${design.timings.outlineMs}, sourcing ${design.timings.sourcingMs}, layout ${design.timings.layoutMs}); lint ${lint.length}; beats ${design.beats.length} (+${design.added.length} by audit)`);
  console.log(sourcingLog.join("\n"));

  /* 5. outputs */
  const rows = toRows(plan, fixture.project.id, new Map(design.sourced.filter((s) => s.kind === "video").map((s) => [s.asset.fileId, `shot_stub_${s.asset.fileId.slice(-6)}`])));
  await writeFile(path.join(outDir, "plan.json"), JSON.stringify({ ...plan, renderHints: { ...plan.renderHints, face: FACE_STUB } }, null, 2));
  await writeFile(path.join(outDir, "beats.json"), JSON.stringify({ beats: design.beats, added: design.added, dropped: design.dropped, entities: outline.entities, chapters: outline.chapters, logos: Object.keys(design.logos) }, null, 2));
  await writeFile(path.join(outDir, "sourced.json"), JSON.stringify({ sourced: design.sourced, logos: design.logos }, null, 2));
  await writeFile(path.join(outDir, "rows.json"), JSON.stringify(rows, null, 2));
  await writeFile(path.join(outDir, "lint.json"), JSON.stringify(lint, null, 2));
  await writeFile(path.join(outDir, "credits.txt"), `# STUB PICKS: the fixture's own assets plus synthetic platform picks marked (stub); not real sourcing.\n\n${credits.line}\n\n${credits.block}\n`);
  await writeFile(path.join(outDir, "shots.txt"), shotList(plan, sentences));
  await writeFile(path.join(outDir, "strip.txt"), strip(plan, sentences, totalMs));
  await writeFile(path.join(outDir, "timeline.svg"), svgTimeline(plan, totalMs, outline.chapters, sentences, mapped.pieces));
  await writeFile(path.join(outDir, "sentences.txt"), sentences.map((s) => `${s.id} ${(s.startMs / 1000).toFixed(2)}–${(s.endMs / 1000).toFixed(2)} ${s.text}`).join("\n"));
  await writeFile(path.join(outDir, "pieces.json"), JSON.stringify({ cut, source: cutPieces, timeline: mapped.pieces }, null, 2));

  /* the geometry sheet: the host under each kind of moment (the v1 cut, whose pieces map back to the raw take here) */
  const at = (kind: string) => plan.graphics.find((g) => g.kind === kind);
  let geo: string | null = null;
  if (cut === "v1") {
    const moments = [
      { label: "hook", ms: 1200 },
      at("counter") ? { label: "counter", ms: at("counter")!.startMs + 900 } : null,
      at("entity") ? { label: "entity card", ms: at("entity")!.startMs + 600 } : null,
      { label: "base", ms: plan.cutZooms.find((s) => s.why === "base" && s.outMs - s.inMs > 2000)?.inMs ?? 20000 },
      { label: "alternate", ms: (plan.cutZooms.find((s) => s.why === "alternate")?.inMs ?? 30000) + 500 },
      plan.runs[0] ? { label: "run circle", ms: plan.runs[0].startMs + 1000 } : plan.pushes[0] ? { label: "snap push", ms: plan.pushes[0].startMs + 600 } : null,
    ].filter((m): m is { label: string; ms: number } => m !== null);
    geo = await geometrySheet(plan, moments, placed, FACE_STUB, outDir).catch((err) => {
      console.warn("geometry sheet failed:", err instanceof Error ? err.message : err);
      return null;
    });
  }

  /* ------------------------------------------------------ acceptance */
  const hookLines = hookFromBrief(fixture.brief);
  const hook = at("hook");
  const chip = plan.graphics.find((g) => g.kind === "chip" && g.props.name === true);
  const lower = at("lower-third");
  const counters = plan.graphics.filter((g) => g.kind === "counter");
  const compares = plan.graphics.filter((g) => g.kind === "compare");
  const lists = plan.graphics.filter((g) => g.kind === "list");
  const statKeys = [...counters.map((g) => String(g.props.text)), ...compares.map((g) => ((g.props.bars as { display: string }[]) ?? []).map((b) => b.display).join("|"))];
  const statText = [...statKeys, ...lists.flatMap((g) => ((g.props.items as { text: string }[]) ?? []).map((i) => i.text))].join("|");
  const dupStats = statKeys.length - new Set(statKeys).size;
  const footageBeats = design.beats.filter((b) => ["person", "org", "product", "headline", "scene", "metaphor"].includes(b.intent) && b.priority < 3);
  const footageOk = footageBeats.filter((b) => b.queries && b.queries.zh.length && b.queries.en.length && b.must);
  const shownNames = new Set<string>();
  for (const g of plan.graphics) {
    if (g.kind === "entity" || g.kind === "chip") shownNames.add(String(g.props.text));
    /* A list's items name what they list (2月 DeepSeek·月之暗面·MiniMax): those names are on screen while the list is. */
    if (g.kind === "list") for (const it of (g.props.items as { text: string }[]) ?? []) shownNames.add(it.text);
  }
  for (const c of plan.cutaways) shownNames.add(c.label);
  const goldEntities = gold?.anchors.entities.map((e) => e.name) ?? [];
  const inTranscript = (n: string) => sentences.some((s) => s.text.includes(n) || s.text.toLowerCase().includes((gold?.anchors.entities.find((e) => e.name === n)?.romanised ?? "\u0000").toLowerCase()));
  const entityHits = goldEntities.filter((n) => Array.from(shownNames).some((x) => x.includes(n) || n.includes(x)));
  const goldNumbers = gold?.anchors.numbers ?? [];
  const numberHits = goldNumbers.filter((n) => saidNear(n.value, statText));
  const numbersInCut = goldNumbers.filter((n) => sentences.some((s) => saidNear(n.value, s.text)));
  const terms = plan.graphics.filter((g) => g.kind === "term" || g.kind === "diagram").map((g) => String(g.props.text));
  const goldTerms = gold?.anchors.terms.map((t) => t.term) ?? [];
  const termHits = goldTerms.filter((t) => terms.some((x) => x.includes(t)));
  const sceneBeats = design.beats.filter((b) => b.intent === "scene");
  const stingers = plan.graphics.filter((g) => g.kind === "stinger");
  const endCard = at("end-card");
  const used = credits.assets.length;
  const creditsOk = plan.cutaways.every((c) => c.credit) && (!plan.cutaways.length || Boolean(String(endCard?.props.creditsLine ?? "").trim()));
  const lintBy = (rule: string) => lint.filter((v) => v.rule === rule);
  const platformAssets = design.sourced.filter((s) => ["douyin", "bilibili", "youtube", "tiktok", "bing", "openverse", "pinterest"].includes(s.candidate.platform));

  const acceptance: Acceptance[] = [
    { item: "Zero lint violations", pass: lint.length === 0, value: `${lint.length} violations${lint.length ? `: ${lint.slice(0, 8).map((v) => `${v.rule}@${(v.atMs / 1000).toFixed(1)}s ${v.detailZh}`).join("; ")}` : ""}` },
    { item: "Hook is the brief's block at 0–2.5 s", pass: Boolean(hook && hook.startMs === 0 && hook.endMs >= 2500 && hookLines && JSON.stringify(hook.props.lines) === JSON.stringify(hookLines)), value: hook ? `${hook.startMs}–${hook.endMs} ms ${JSON.stringify(hook.props.lines)} landMs ${JSON.stringify(hook.props.landMs)}` : "no hook" },
    { item: "Lower third at 2–6 s (a chip; she says her name at the end) + the card where she says it", pass: Boolean(chip && chip.startMs >= 2000 && chip.startMs <= 6000) && Boolean(lower), value: `chip ${chip ? `${chip.startMs}–${chip.endMs}` : "none"}; lower-third ${lower ? `${(lower.startMs / 1000).toFixed(1)}–${(lower.endMs / 1000).toFixed(1)} s` : "none"}` },
    { item: "Zero duplicate stats; every stat spoken within ±1.5 s", pass: dupStats === 0 && !lintBy("stat").length && counters.length + compares.length > 0, value: `${counters.length} counters + ${compares.length} compares, ${dupStats} duplicates, ${lintBy("stat").length} unsaid; dropped by dedupe: ${design.dropped.filter((d) => /数字|对比/.test(d.reasonZh)).length}` },
    { item: "Every footage beat has zh + en queries and a must", pass: footageBeats.length > 0 && footageOk.length === footageBeats.length, value: `${footageOk.length}/${footageBeats.length}` },
    { item: "§1 shot list: hook block", pass: Boolean(hook), value: hook ? "yes" : "no" },
    { item: "§1 shot list: counters 154页 · 1.51亿次 · 3500多个账号 · 近30万条 · 十几倍 + the compares", pass: numberHits.length >= Math.min(7, numbersInCut.length), value: `${numberHits.length}/${goldNumbers.length} gold figures on screen (${numbersInCut.length} of them are said in this cut): ${statKeys.join(", ")}` },
    { item: "§1 shot list: list build 2月→6月→9月", pass: lists.length > 0, value: lists.map((g) => JSON.stringify((g.props.items as { text: string }[]).map((i) => i.text))).join(" ") || "none" },
    { item: "§1 shot list: diagram + term cards (蒸馏 思维链 技术套利 护城河)", pass: plan.graphics.some((g) => g.kind === "diagram") && termHits.length >= 3, value: `diagram ${plan.graphics.filter((g) => g.kind === "diagram").length}, terms ${terms.join("/")} (${termHits.length}/${goldTerms.length})` },
    { item: "§1 shot list: entity visuals for the 14 entities (card, chip or cutaway)", pass: entityHits.length >= 12, value: `${entityHits.length}/${goldEntities.length}: ${entityHits.join(" ")}; missing ${goldEntities.filter((n) => !entityHits.includes(n)).map((n) => `${n}${inTranscript(n) ? "" : " (not in this cut)"}`).join(" ") || "—"}; ${Object.keys(design.logos).length} logos on cards` },
    { item: "§1 shot list: scene beats 数据中心 代码屏幕 芯片 信用卡盗刷 API调用", pass: sceneBeats.length >= 4, value: `${sceneBeats.length} scene beats; ${plan.cutaways.filter((c) => c.kind === "video").length} video cutaways (${JSON.stringify(plan.stats.cutaways)}), ${plan.runs.length} runs` },
    { item: "§1 shot list: 4–6 chapter stingers", pass: stingers.length >= 4 && stingers.length <= 6, value: `${stingers.length}: ${stingers.map((g) => g.props.text).join(" | ")}` },
    { item: "§1 shot list: end card with the question and the credits line", pass: Boolean(endCard && String(endCard.props.sub).includes("蒸馏") && String(endCard.props.creditsLine).trim()), value: endCard ? `${(endCard.startMs / 1000).toFixed(1)}–${(endCard.endMs / 1000).toFixed(1)} s 「${endCard.props.sub}」 credits: ${String(endCard.props.creditsLine).slice(0, 100)}` : "none" },
    { item: "Every used asset has a credit; the end card carries the line", pass: creditsOk && used > 0, value: `${plan.cutaways.length} cutaways credited, ${used} assets in director.assets (${platformAssets.length} platform/web, ${design.sourced.length - platformAssets.length} stock)` },
    { item: "Cadence: mean change 2–4 s, max gap ≤ 5 s, none < 0.8 s", pass: !lintBy("cadence").length, value: `mean ${(plan.stats.meanChangeMs / 1000).toFixed(2)} s, max gap ${(plan.stats.maxGapMs / 1000).toFixed(1)} s, ${plan.stats.changes} changes, ${plan.stats.gapsOver5s.length} gaps > 5 s, ${lintBy("cadence").filter((v) => /800/.test(v.detailZh)).length} too close` },
    { item: "Cutaways 30–40 %, host visible ≥ 55 %, run ≤ 30 %", pass: !lintBy("coverage").length, value: `coverage ${(plan.stats.coverage * 100).toFixed(1)}%, host ${(plan.stats.hostVisible * 100).toFixed(1)}%, run ${(plan.stats.runShare * 100).toFixed(1)}%; supply: ${footageBeats.length} footage beats on ${new Set(footageBeats.map((b) => b.sentenceId)).size} sentences → ${design.sourced.length} sourced (one per sentence; stub misses every 8th) → ${plan.cutaways.length} cutaways, ${plan.stats.skipped.filter((s) => /素材没有位置/.test(s.reasonZh)).length} without room` },
    { item: "One layer at a time; nothing on the face; captions clear of the chin", pass: !lintBy("overlap").length && !lintBy("face").length && !lintBy("caption").length && !lintBy("zone").length, value: `overlap ${lintBy("overlap").length}, face ${lintBy("face").length}, caption ${lintBy("caption").length}, zone ${lintBy("zone").length}` },
    { item: "Director ≤ 5 min before render (design here)", pass: designMs < 300_000, value: `design ${(designMs / 1000).toFixed(1)} s (outline ${(design.timings.outlineMs / 1000).toFixed(1)} s, sourcing stub ${design.timings.sourcingMs} ms, layout ${design.timings.layoutMs} ms); model spend so far $${(spend.cost / 1e6).toFixed(4)}` },
  ];

  console.log(`\nACCEPTANCE [${cut} cut: ${cutPieces.length} pieces, ${(totalMs / 1000).toFixed(1)} s]`);
  for (const a of acceptance) console.log(`${a.pass ? "PASS" : "FAIL"}  ${a.item}\n      ${a.value}`);
  console.log(`\nnotes: ${design.notesZh}`);

  return {
    cut,
    pieces: cutPieces.length,
    totalMs,
    sentences: sentences.length,
    design: { ms: designMs, timings: design.timings, beats: design.beats.length, added: design.added.length, sourced: design.sourced.length, logos: Object.keys(design.logos).length },
    stats: plan.stats,
    renderHints: { ...plan.renderHints, face: FACE_STUB },
    lint,
    added: design.added,
    dropped: design.dropped,
    notesZh: design.notesZh,
    layoutNotesZh: plan.notesZh,
    acceptance,
    geometrySheet: geo,
    outline: { titleZh: outline.titleZh, subtitleZh: outline.subtitleZh, chapters: outline.chapters, entities: outline.entities.map((e) => e.name), lowerThird: outline.lowerThird, endCard: outline.endCard, notesZh: outline.notesZh },
  };
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(OUT, { recursive: true });
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const gold = JSON.parse(await readFile(GOLD, "utf8").catch(() => "null")) as Gold | null;
  const words = fixture.sourceWords?.words ?? [];
  if (!words.length) throw new Error(`${FIXTURE} carries no sourceWords`);
  const silences: Silence[] = (await readFile(SILENCES, "utf8").catch(() => ""))
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([a, b]) => ({ startMs: Math.round(a * 1000), endMs: Math.round(b * 1000) }));

  const spend = { cost: 0 };
  const cuts: ("v1" | "gold")[] = CUT === "both" ? ["v1", "gold"] : [CUT];
  const results = [];
  for (const cut of cuts) results.push(await designCut(cut, fixture, gold, words, silences, path.join(OUT, cut), spend));

  /* 6. translation, timed, not written */
  let translateMs: number | null = null;
  let translated = 0;
  const zh = fixture.captions["zh-CN"] ?? [];
  if (has("--translate") && zh.length) {
    const [{ complete }, { modelFor }] = await Promise.all([import("../../lib/ai/openrouter"), import("../../lib/ai/models")]);
    const TRANSLATE_PROMPT = `You subtitle a Chinese business creator's videos in two languages.\n\nYou are given numbered caption lines. Answer with a single JSON object and nothing else, the first character an opening brace:\n{ "lines": [ { "i": 0, "second": "the same line in the other language, short, natural, under 12 words", "keywords": ["one to three words from the ORIGINAL line worth the accent colour: a product, a number, the verb it turns on"] } ] }\n\nRules:\n - "keywords" must be copied verbatim from the original line, or be an empty list. Never rewrite them.\n - If the line is Chinese, "second" is English. If the line is English, "second" is Simplified Chinese.\n - Keep numbers and names exactly. No quotation marks around the line.`;
    const size = Math.ceil(zh.length / 3);
    const t = Date.now();
    const settled = await Promise.allSettled(
      [0, 1, 2].map(async (k) => {
        const batch = zh.slice(k * size, (k + 1) * size);
        const res = await complete({ model: modelFor.utility(), temperature: 0.2, maxTokens: 8000, messages: [{ role: "system", content: TRANSLATE_PROMPT }, { role: "user", content: batch.map((c, j) => `${k * size + j}. ${c.text}`).join("\n") }] });
        spend.cost += res.costMicros;
        return parseTranslation(res.text, zh);
      }),
    );
    translateMs = Date.now() - t;
    for (const r of settled) if (r.status === "fulfilled") translated += r.value.length;
    console.log(`\ntranslation: 3 batches in parallel, ${translateMs} ms, ${translated}/${zh.length} lines`);
  }

  const report = {
    at: new Date().toISOString(),
    fixture: FIXTURE,
    costMicros: spend.cost,
    translate: translateMs !== null ? { ms: translateMs, lines: translated, of: zh.length, note: "3 batches in parallel; the write (3 statements) is not run here" } : null,
    flagOff: "by construction: the v1 path in director.ts is untouched apart from the flag read and the branch (see git diff); not runnable without the DB",
    cuts: Object.fromEntries(results.map((r) => [r.cut, r])),
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\nmodel spend $${(spend.cost / 1e6).toFixed(4)}; outputs in ${OUT}/{${cuts.join(",")}}: plan.json beats.json sourced.json rows.json lint.json credits.txt shots.txt strip.txt timeline.svg sentences.txt; ${OUT}/report.json`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
