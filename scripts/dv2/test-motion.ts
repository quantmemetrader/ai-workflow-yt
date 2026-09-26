/**
 * Render every director v2 template with real 蒸馏 props over a raw frame,
 * and measure it against PLAN.md §2 W4's acceptance list.
 *
 *   cd /home/ubuntu/wt/dv2-W4 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-motion.ts [--out /tmp/dv2_lab/W4] [--raw /home/ubuntu/raw/zhengliu.mp4] [--at 5.2]
 *       [--count 45] [--cold] [--vision] [--concurrency 6] [--skip-render]
 *
 * What it does, in order:
 *   1. builds the shot list from the brief and the transcript — the hook
 *      block, the counters (3500多个账号, 1.51亿次, 近30万条, 十几倍), the
 *      compare bars (63.5 % vs 35.5 %, 便宜6到9成, the training-cost gap),
 *      the 2月→6月→9月 list, entity cards (Anthropic, DeepSeek, 月之暗面),
 *      chips, headline cards, term cards, the diagram, four stingers, the
 *      end card with a five-source credits line, and the v1 kinds that
 *      still have to render (lower third, statement, chapter, card, stat,
 *      title). `--count 45` pads it to the plan's forty-five with more of
 *      the brief's entities and numbers.
 *   2. renders them through `renderMotionClips` twice: cold (with `--cold`
 *      the clip cache is cleared first) and warm, timing both.
 *   3. composites every clip over the raw frame, one after another, into
 *      `showcase.mp4` the way the compositor will (VP9 alpha through
 *      libvpx-vp9, the hold PNG looped between `in` and `out`).
 *   4. writes contact sheets (each graphic at 0.1 / 0.3 / 1.0 s and
 *      end − 0.1 s), 15 fps motion strips of six key graphics, and two
 *      checkerboard composites.
 *   5. measures, from the clips' own alpha: `yuva420p` on decode, the
 *      entrance and exit in ms, every graphic's extent against the safe
 *      column (x 64–930, y 220–1440) and the face box of the raw frame,
 *      and each counter's landing frame against its `landMs`.
 *   6. with `--vision`, runs `checkFrame` on one composited frame per
 *      template (about a hundredth of a cent each).
 *
 * Writes `report.json`, `report.txt`, the sheets and strips under `--out`.
 * No database; nothing outside `--out` and the clip cache is touched.
 */
import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MOTION_SEGMENTS, renderMotionClips, segmentTimes } from "../../lib/video/motion";
import type { GraphicSpecV2 } from "../../lib/video/v2/types";
import { V2 } from "../../remotion/src/theme";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name: string) => argv.includes(name);

const OUT = arg("--out", "/tmp/dv2_lab/W4");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const AT = Number(arg("--at", "5.2"));
const COUNT = Number(arg("--count", "0"));
const COLD = flag("--cold");
const VISION = flag("--vision");
const SKIP_RENDER = flag("--skip-render");
const CONCURRENCY = Number(arg("--concurrency", process.env.DV2_CONCURRENCY || "6"));

const W = 1080;
const H = 1920;
const FPS = 30;
const ACCENT = "#d6e64f";
const GAP_S = 0.4;

/**
 * The face box of the raw frame at 1.00 framing, read off the frame at
 * 5.2 s by eye (hair top ≈ 540, chin ≈ 1060, x 360–700), plus the plan's
 * 40 px: Zone F, where no text may go. The compositor's own framing will
 * move it; the number here is for this test's report.
 */
const FACE = { x0: 320, y0: 500, x1: 740, y1: 1100 };
const SAFE = { x0: V2.side, x1: W - V2.rightUnsafe, y0: V2.zones.unsafeTop, y1: V2.zones.unsafeBottom };

/**
 * What each template's entrance and exit are designed to be, in ms, and
 * how they are measured. The default is the plan's 300 ms bezier in and
 * 180 ms out, measured as the frame where the clip's top alpha (the 99.5th
 * percentile of its alpha plane, i.e. the block's opacity, unaffected by a
 * counter or a bar still growing inside it) reaches 98.5 % of its settled
 * value. A bezier(.2,.8,.2,1) is at 98.5 % after about 70 % of its length,
 * so a 300 ms entrance measures ~233 ms at 30 fps: the window accepted is
 * design − 100 … design + 34 (one frame). Three kinds enter differently:
 *
 *   hook     each line pops 120 ms centred on its word; line one is full
 *            60 ms after `stepsMs[0]` (300 ms in this test), so ~360 ms
 *   stinger  the plate is opaque from frame 0 and wipes in over 150 ms,
 *            the title slides in 60–210 ms: measured by area, ~210 ms
 *   chip     a spring (damping 14, stiffness 180): measured as the frame
 *            where its width settles within 2 px; ≤ 450 ms
 */
const HOOK_FIRST_STEP_MS = 300;
const LIST_FIRST_STEP_MS = 200;
const ENTER_DESIGN: Record<string, { ms: number; lo: number; hi: number; how: "top" | "area" | "width" }> = {
  hook: { ms: HOOK_FIRST_STEP_MS + 60, lo: HOOK_FIRST_STEP_MS - 40, hi: HOOK_FIRST_STEP_MS + 100, how: "top" },
  stinger: { ms: 210, lo: 100, hi: 250, how: "area" },
  chip: { ms: 400, lo: 100, hi: 450, how: "width" },
  /* The headline slides up over 250 ms (§1), blur to sharp. */
  headline: { ms: V2.headlineMs, lo: V2.headlineMs - 100, hi: V2.headlineMs + 34, how: "top" },
  /* The list's first item fades 250 ms from its own step; the block's rise is under it. */
  list: { ms: LIST_FIRST_STEP_MS + 250, lo: LIST_FIRST_STEP_MS + 100, hi: LIST_FIRST_STEP_MS + 284, how: "top" },
};
const ENTER_DEFAULT = { ms: V2.enterMs, lo: V2.enterMs - 100, hi: V2.enterMs + 34, how: "top" as const };
const EXIT_DESIGN: Record<string, number> = { stinger: V2.stingerOutMs };
const exitWindow = (kind: string) => {
  const ms = EXIT_DESIGN[kind] ?? V2.exitMs;
  return { ms, lo: ms - 50, hi: ms + 34 };
};

/* ------------------------------------------------------------------ specs */

type Logos = { anthropic?: string; deepseek?: string; testImage?: string };

/**
 * The shot list, in the brief's own words and numbers (nothing invented:
 * every figure and name is one she says or the brief gives). Timing props
 * are relative to each graphic's start, as the director will set them
 * from the word timings.
 */
function realSpecs(logos: Logos): { kind: string; zone: GraphicSpecV2["zone"]; seconds: number; props: Record<string, unknown> }[] {
  const t = (kind: string, seconds: number, props: Record<string, unknown>, zone: GraphicSpecV2["zone"] = "T") => ({ kind, zone, seconds, props });
  return [
    t("hook", 4.5, { text: "美国三大安全机构 | 罕见联手 | 点名中国AI【蒸馏】", stepsMs: [HOOK_FIRST_STEP_MS, 1560, 2400] }),
    t("counter", 3, { text: "3500多个账号", value: "3500", unit: "多个账号", labelZh: "被认定的欺诈账号", landMs: 1200 }),
    t("counter", 3, { text: "1.51亿次", value: "1.51", unit: "亿次", labelZh: "阿里一家 5 到 7 月可疑交互量", landMs: 1000 }),
    t("counter", 3, { text: "近30万条", value: "近30万", unit: "条", labelZh: "Kimi 用户提问转发给 Claude", landMs: 900 }),
    t("counter", 2.5, { text: "十几倍", value: "十几倍", labelZh: "整体数据相比 2 月初期" }),
    t("compare", 4, {
      text: "7月末 模型调用量",
      bars: [
        { label: "中国AI模型", value: 63.5, display: "63.5%" },
        { label: "美国模型", value: 35.5, display: "35.5%" },
      ],
      stepsMs: [300, 800],
    }),
    t("compare", 4, {
      text: "价格",
      bars: [
        { label: "美国旗舰模型", value: 100, display: "100%", negative: true },
        { label: "中国模型", value: 25, display: "便宜6到9成" },
      ],
    }),
    t("compare", 4.5, {
      text: "训练成本",
      bars: [
        { label: "从零训练前沿基座模型", value: 100, display: "几千万–几亿美金", negative: true },
        { label: "蒸馏", value: 6, display: "几千–几十万美金" },
      ],
    }),
    t("list", 4.5, {
      items: [
        { head: "2月", text: "指控 DeepSeek、月之暗面、MiniMax" },
        { head: "6月", text: "致信美国参议院，点名阿里" },
        { head: "9月", text: "名单扩大到好几家" },
      ],
      stepsMs: [LIST_FIRST_STEP_MS, 1400, 2600],
    }),
    t("entity", 2.2, { text: "Anthropic", sub: "美国 AI 公司，Claude 的开发者", logo: logos.anthropic }),
    t("entity", 2.2, { text: "DeepSeek", sub: "中国 AI 公司，2 月被点名的三家之一", logo: logos.deepseek }),
    t("entity", 2.2, { text: "月之暗面", sub: "Kimi 的开发者" }),
    t("chip", 2.5, { text: "Anthropic", logo: logos.anthropic }, "corner"),
    t("chip", 2.5, { text: "阿里巴巴" }, "corner"),
    t("headline", 3.5, { text: "美国三大安全机构联合公告，点名中国 AI 蒸馏", outlet: "NSA · CISA · FBI", date: "9月8日" }),
    t("headline", 3.5, { text: "Anthropic 发布 154 页报告", outlet: "Anthropic", date: "9月10日", image: logos.testImage, imageCredit: "测试图（testsrc2）" }),
    t("term", 3, { text: "蒸馏", sub: "小模型学大模型的「暗知识」", en: "Distillation" }),
    t("term", 3, { text: "技术套利", sub: "利用训练成本和推理成本之间的落差，把别人的推理结果变成自己的训练数据", en: "Technical arbitrage" }),
    t("diagram", 4.5, { stepsMs: [0, 900, 1800] }),
    t("stinger", 0.7, { text: "什么是蒸馏", index: 1 }),
    t("stinger", 0.7, { text: "指控升级", index: 2 }),
    t("stinger", 0.7, { text: "中方回应", index: 3 }),
    t("stinger", 0.7, { text: "第三条路", index: 4 }),
    t(
      "end-card",
      3,
      {
        text: "谢亚芳 · 创变派",
        sub: "拒绝蒸馏，是长期主义还是理想主义？",
        creditsLine: "素材来源：抖音 @xxx · B站 @xxx · YouTube @Anthropic · Pinterest @xxx · Wikimedia Commons (CC BY-SA 4.0)",
      },
      "full",
    ),
    /* v1 kinds through the motion path: the ones the v2 director still places. */
    t("lower-third", 3, { text: "谢亚芳", sub: "你的新经济摆渡人", zone: "lower" }, "lower"),
    t("statement", 3, { text: "单方观测 | 不等于【侵权实锤】" }),
    t("chapter", 3, { text: "中方回应" }),
    t("card", 3, { text: "严禁蒸馏 | 用API检测反向追查" }, "lower"),
    t("stat", 3, { text: "154页", sub: "报告页数" }, "full"),
    t("title", 2, { text: "蒸馏之战" }, "full"),
  ];
}

/** More of the brief's entities and numbers, to reach the plan's forty-five graphics for the timing test. */
function padSpecs(logos: Logos) {
  const t = (kind: string, seconds: number, props: Record<string, unknown>, zone: GraphicSpecV2["zone"] = "T") => ({ kind, zone, seconds, props });
  return [
    t("counter", 3, { text: "154页", value: "154", unit: "页", labelZh: "Anthropic 报告页数", landMs: 800 }),
    t("entity", 2.2, { text: "MiniMax", sub: "中国 AI 公司" }),
    t("entity", 2.2, { text: "阿里巴巴", sub: "被认定 3500 多个欺诈账号" }),
    t("entity", 2.2, { text: "字节跳动", sub: "走出第三条路" }),
    t("entity", 2.2, { text: "美国参议院", sub: "6 月收到 Anthropic 的信" }),
    t("entity", 2.2, { text: "中国商务部", sub: "指控于事无凭，于法无据" }),
    t("entity", 2.2, { text: "《自然》杂志", sub: "警示 AI 数据训 AI 的退化" }),
    t("chip", 2.5, { text: "DeepSeek", logo: logos.deepseek }, "corner"),
    t("chip", 2.5, { text: "Kimi" }, "corner"),
    t("chip", 2.5, { text: "Claude" }, "corner"),
    t("stinger", 0.7, { text: "Anthropic为什么急", index: 5 }),
    t("stinger", 0.7, { text: "技术套利", index: 6 }),
    t("term", 3, { text: "思维链", sub: "模型给出答案前的推理过程", en: "Chain of thought" }),
    t("term", 3, { text: "护城河", sub: "套利窗口收窄时，谁有能力自己来挖", en: "Moat" }),
    t("headline", 3.5, { text: "商务部：指控于事无凭，于法无据", outlet: "中国商务部", date: "9月" }),
    t("list", 4.5, {
      items: [
        { head: "美国国安局", text: "NSA" },
        { head: "网络安全局", text: "CISA" },
        { head: "FBI", text: "联邦调查局" },
      ],
      stepsMs: [200, 1000, 1800],
    }),
    t("compare", 4, {
      text: "一轮比一轮升级",
      bars: [
        { label: "2月 三家", value: 3, display: "3" },
        { label: "6月 点名阿里", value: 4, display: "4" },
        { label: "9月 好几家", value: 8, display: "8+" },
      ],
    }),
  ];
}

/* ---------------------------------------------------------------- helpers */

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));

async function ffmpeg(args: string[], timeoutMs = 170_000): Promise<string> {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return stderr;
}

/** ffmpeg's stdout as one Buffer (raw video). */
function ffmpegRaw(args: string[], timeoutMs = 170_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c) => {
      if (err.length < 2000) err += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

/** Fetch a small file with a deadline; false when it could not be had (the test then runs without it). */
async function fetchTo(url: string, file: string, headers: Record<string, string> = {}): Promise<boolean> {
  if (await exists(file)) return true;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 50 || bytes.length > 2_000_000) return false;
    await writeFile(file, bytes);
    return true;
  } catch {
    return false;
  }
}

type Box = { x0: number; y0: number; x1: number; y1: number };
type AlphaStats = { w: number; h: number; frames: number; sum: number[]; top: number[]; bbox: (Box | null)[] };

/**
 * Per-frame alpha of a clip part: the total (0–1 of a fully opaque frame,
 * i.e. the area), the top alpha (the 99.5th percentile of the non-zero
 * alpha values, 0–1: the opacity of the block's solid pixels, which is
 * what an entrance fade drives), and the extent of alpha > 96.
 */
async function alphaStats(file: string, w: number, h: number): Promise<AlphaStats> {
  const webm = file.endsWith(".webm");
  const raw = await ffmpegRaw([...(webm ? ["-c:v", "libvpx-vp9"] : []), "-i", file, "-vf", "alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const frameBytes = w * h;
  const frames = Math.floor(raw.length / frameBytes);
  const sum: number[] = [];
  const top: number[] = [];
  const bbox: AlphaStats["bbox"] = [];
  const hist = new Uint32Array(256);
  for (let f = 0; f < frames; f++) {
    const base = f * frameBytes;
    hist.fill(0);
    let s = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = base + y * w;
      for (let x = 0; x < w; x++) {
        const a = raw[row + x];
        if (a) {
          s += a;
          hist[a]++;
          if (a > 96) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    }
    let nonzero = 0;
    for (let a = 1; a < 256; a++) nonzero += hist[a];
    let want = Math.max(40, Math.round(nonzero * 0.005));
    let t = 0;
    for (let a = 255; a >= 1 && want > 0; a--) {
      if (hist[a]) {
        t = a;
        want -= hist[a];
      }
    }
    sum.push(s / (255 * frameBytes));
    top.push(nonzero ? t / 255 : 0);
    bbox.push(x1 >= 0 ? { x0, y0, x1, y1 } : null);
  }
  return { w, h, frames, sum, top, bbox };
}

/** The first frame where `series` has reached `share` of its value at `refFrame`; −1 when the reference is empty. */
function settleFrame(series: number[], refFrame: number, share = 0.985): number {
  const ref = series[Math.min(refFrame, series.length - 1)] ?? 0;
  if (ref <= 0) return -1;
  for (let f = 0; f <= refFrame && f < series.length; f++) if (series[f] >= share * ref) return f;
  return refFrame;
}

/** The first frame whose extent width is within 2 px of the width at `refFrame` and stays so: a spring that has settled. */
function settleWidth(bbox: (Box | null)[], refFrame: number): number {
  const ref = bbox[Math.min(refFrame, bbox.length - 1)];
  if (!ref) return -1;
  const refW = ref.x1 - ref.x0;
  for (let f = 0; f <= refFrame; f++) {
    const ok = (g: number) => {
      const b = bbox[g];
      return Boolean(b) && Math.abs(b!.x1 - b!.x0 - refW) <= 2;
    };
    let steady = true;
    for (let g = f; g <= refFrame; g++) if (!ok(g)) steady = false;
    if (steady) return f;
  }
  return refFrame;
}

/** The last frame (scanning back from `to`) where `series` is still at `share` of `hold`. */
function lastFullFrame(series: number[], hold: number, to: number, share = 0.985): number {
  for (let f = to; f >= 0; f--) if (series[f] >= share * hold) return f;
  return -1;
}

/** The extent of the bright pixels of an opaque still (the end card's type on its #0E0E10 ground), plus the rows they occupy. */
async function lumaExtent(file: string, w: number, h: number): Promise<{ bbox: Box | null; rows: Uint8Array }> {
  const raw = await ffmpegRaw(["-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "-"]);
  const rows = new Uint8Array(h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (raw[row + x] > 72) {
        rows[y] = 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { bbox: x1 >= 0 ? { x0, y0, x1, y1 } : null, rows };
}

/**
 * Where a through-animated clip stops changing: the mean absolute
 * difference between consecutive frames of the premultiplied picture,
 * on a small copy. The last frame whose change is above two per cent of
 * the largest change (the entrance), before the exit begins, is the
 * landing frame: a digit ticking over is a few per cent of the entrance,
 * a static VP9 frame is exactly zero.
 */
async function landingFrame(file: string, w: number, h: number, frames: number, exitFrames: number): Promise<{ frame: number; diffs: number[] }> {
  const sw = 270;
  const sh = Math.round((h * sw) / w / 2) * 2;
  const raw = await ffmpegRaw(["-c:v", "libvpx-vp9", "-i", file, "-vf", `scale=${sw}:${sh}:flags=area,format=rgba`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
  const fb = sw * sh * 4;
  const n = Math.min(frames, Math.floor(raw.length / fb));
  const pre = (f: number, i: number) => {
    const o = f * fb + i * 4;
    const a = raw[o + 3] / 255;
    return (raw[o] + raw[o + 1] + raw[o + 2]) * a;
  };
  const diffs: number[] = [0];
  for (let f = 1; f < n; f++) {
    let d = 0;
    for (let i = 0; i < sw * sh; i++) d += Math.abs(pre(f, i) - pre(f - 1, i));
    diffs.push(d / (sw * sh));
  }
  const usable = diffs.slice(0, Math.max(1, n - exitFrames - 1));
  const max = Math.max(...usable, 1e-9);
  let land = 0;
  for (let f = 0; f < usable.length; f++) if (usable[f] > max * 0.02) land = f;
  return { frame: land, diffs: diffs.map((d) => Math.round(d * 1000) / 1000) };
}

/* ------------------------------------------------------------------- main */

type Row = {
  id: string;
  kind: string;
  mode: string;
  seconds: number;
  startS: number;
  box: { x: number; y: number; w: number; h: number };
  alpha: string;
  enterDesignMs: number;
  enterMs: number | null;
  enterOk: boolean | null;
  exitDesignMs: number;
  exitMs: number | null;
  exitOk: boolean | null;
  extent: Box | null;
  safeOk: boolean | null;
  faceOverlapPx: number | null;
  /** End card only: whether its type keeps out of the furniture's watermark and footnote bands. */
  bandsClear?: boolean;
  landing?: { landMs: number; expectFrame: number; gotFrame: number; ok: boolean };
  v1Kind: boolean;
  check?: { ok: boolean; issues: unknown[] };
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const assets = path.join(OUT, "assets");
  await mkdir(assets, { recursive: true });

  /* The background: the raw take at `--at`, autorotated to 1080×1920. */
  const bg = path.join(OUT, "bg.png");
  if (!(await exists(bg))) {
    if (!(await exists(RAW))) throw new Error(`raw take missing: ${RAW}`);
    await ffmpeg(["-ss", String(AT), "-i", RAW, "-frames:v", "1", "-vf", `scale=-2:${H},crop=${W}:${H}`, bg]);
  }

  /* Logos for the entity cards: Simple Icons (CC0 1.0), fetched once and
     credited in the report; without network the cards draw monograms. */
  const logos: Logos = {};
  const anthropic = path.join(assets, "anthropic.svg");
  const deepseek = path.join(assets, "deepseek.svg");
  if (await fetchTo("https://cdn.simpleicons.org/anthropic", anthropic)) logos.anthropic = anthropic;
  if (await fetchTo("https://cdn.simpleicons.org/deepseek", deepseek)) logos.deepseek = deepseek;
  const testImage = path.join(assets, "testsrc2.png");
  if (!(await exists(testImage))) await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=800x450", "-frames:v", "1", testImage]);
  logos.testImage = testImage;

  /* The shot list, laid one after another on a timeline. */
  const list = realSpecs(logos);
  if (COUNT > list.length) {
    const extra = padSpecs(logos);
    for (let i = 0; list.length < COUNT; i++) list.push(extra[i % extra.length]);
  }
  let cursor = 0.4;
  const specs: GraphicSpecV2[] = list.map((s, i) => {
    const startMs = Math.round(cursor * 1000);
    const endMs = Math.round((cursor + s.seconds) * 1000);
    cursor += s.seconds + GAP_S;
    return { id: `g${String(i).padStart(2, "0")}-${s.kind}`, kind: s.kind, startMs, endMs, zone: s.zone, props: s.props };
  });
  const totalS = cursor + 0.4;
  await writeFile(path.join(OUT, "specs.json"), JSON.stringify(specs, null, 2));
  console.log(`${specs.length} graphics over ${totalS.toFixed(1)} s (raw frame at ${AT} s)`);

  const cacheDir = path.join(process.cwd(), "remotion", ".clips");
  if (COLD) {
    await rm(cacheDir, { recursive: true, force: true });
    console.log("clip cache cleared (--cold)");
  }

  /* Render: cold, then warm. */
  const motionDir = path.join(OUT, "render");
  await rm(motionDir, { recursive: true, force: true });
  const t0 = Date.now();
  const clips = await renderMotionClips(specs, { width: W, height: H, accent: ACCENT, dir: motionDir, fps: FPS, concurrency: CONCURRENCY });
  const coldMs = Date.now() - t0;
  const t1 = Date.now();
  const again = await renderMotionClips(specs, { width: W, height: H, accent: ACCENT, dir: path.join(OUT, "render-warm"), fps: FPS, concurrency: CONCURRENCY });
  const warmMs = Date.now() - t1;
  console.log(`render: cold ${(coldMs / 1000).toFixed(1)} s (${clips.length} clips), warm ${(warmMs / 1000).toFixed(1)} s (${again.length} clips)`);
  await writeFile(path.join(OUT, "clips.json"), JSON.stringify(clips, null, 2));

  /* Composite over the raw frame, the compositor's way. */
  const showcase = path.join(OUT, "showcase.mp4");
  if (!SKIP_RENDER) {
    const inputs: string[] = ["-loop", "1", "-framerate", String(FPS), "-t", totalS.toFixed(3), "-i", bg];
    const filters: string[] = [];
    let chain = "[0:v]";
    let n = 1;
    let k = 0;
    const layer = (file: string, atMs: number, untilMs: number, still: boolean, x: number, y: number, seconds?: number) => {
      if (still) inputs.push("-loop", "1", "-framerate", String(FPS), "-t", (seconds ?? 1).toFixed(3), "-i", file);
      else inputs.push("-c:v", "libvpx-vp9", "-i", file);
      const s = (atMs / 1000).toFixed(3);
      const e = (untilMs / 1000).toFixed(3);
      filters.push(`[${n}:v]format=rgba,setpts=PTS-STARTPTS+${s}/TB[m${k}]`);
      filters.push(`${chain}[m${k}]overlay=x=${x}:y=${y}:format=auto:eof_action=pass:enable='between(t,${s},${e})'[c${k}]`);
      chain = `[c${k}]`;
      n++;
      k++;
    };
    for (const c of clips) {
      if (c.parts.full) layer(c.parts.full, c.startMs, c.endMs, false, c.x, c.y);
      else {
        const seg = segmentTimes(c.startMs, c.endMs, FPS);
        if (c.parts.in) layer(c.parts.in, c.startMs, seg.inEndMs, false, c.x, c.y);
        if (c.parts.hold) layer(c.parts.hold, c.parts.in ? seg.inEndMs : c.startMs, c.parts.out ? seg.outStartMs : c.endMs, true, c.x, c.y, (c.endMs - c.startMs) / 1000);
        if (c.parts.out) layer(c.parts.out, seg.outStartMs, c.endMs, false, c.x, c.y);
      }
    }
    const graph = filters.join(";").replace(/\[c\d+\]$/, "[vout]");
    await writeFile(path.join(OUT, "showcase.filter"), graph);
    await ffmpeg([...inputs, "-filter_complex_script", path.join(OUT, "showcase.filter"), "-map", "[vout]", "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-t", totalS.toFixed(3), showcase], 600_000);
    console.log(`showcase: ${showcase}`);
  }

  /* Contact sheets: one row per graphic (0.1 / 0.3 / 1.0 s / end − 0.1 s), six rows a sheet. */
  const sheetDir = path.join(OUT, "sheet");
  await rm(sheetDir, { recursive: true, force: true });
  await mkdir(sheetDir, { recursive: true });
  const fontfile = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
  const canLabel = await exists(fontfile);
  for (const [i, c] of clips.entries()) {
    const sec = (c.endMs - c.startMs) / 1000;
    const picks = [0.1, 0.3, Math.min(1.0, sec / 2), Math.max(0.05, sec - 0.1)].map((s) => Math.max(0, Math.min(Math.round(s * FPS), Math.round(sec * FPS) - 1)));
    const sel = picks.map((f) => `eq(n\\,${f})`).join("+");
    const label = canLabel ? `,drawtext=fontfile=${fontfile}:text='${c.id.replace(/[':\\]/g, "")}':fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6:x=8:y=8` : "";
    await ffmpeg(["-ss", (c.startMs / 1000).toFixed(3), "-t", sec.toFixed(3), "-i", showcase, "-vf", `select='${sel}',scale=270:480,tile=4x1${label}`, "-frames:v", "1", path.join(sheetDir, `row${String(i).padStart(2, "0")}.png`)]).catch(async (e) => {
      console.log(`sheet row ${c.id}: ${(e as Error).message.slice(0, 200)}`);
      await ffmpeg(["-ss", (c.startMs / 1000).toFixed(3), "-t", sec.toFixed(3), "-i", showcase, "-vf", `select='${sel}',scale=270:480,tile=4x1`, "-frames:v", "1", path.join(sheetDir, `row${String(i).padStart(2, "0")}.png`)]);
    });
  }
  const rows = (await readdir(sheetDir)).filter((f) => f.startsWith("row")).sort();
  const sheets: string[] = [];
  for (let s = 0; s * 6 < rows.length; s++) {
    const part = rows.slice(s * 6, s * 6 + 6);
    /* JPEG: a sheet is for looking at, and a 1080×2880 PNG is 1.5 MB a sheet. */
    const out = path.join(OUT, `sheet-${s + 1}.jpg`);
    const ins = part.flatMap((f) => ["-i", path.join(sheetDir, f)]);
    const graph = `${part.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${part.length}[v]`;
    if (part.length === 1) await ffmpeg(["-i", path.join(sheetDir, part[0]), "-q:v", "3", out]);
    else await ffmpeg([...ins, "-filter_complex", graph, "-map", "[v]", "-q:v", "3", out]);
    sheets.push(out);
  }

  /* Motion strips at 15 fps of six key graphics, cropped to the clip's box. */
  const stripKinds = ["hook", "counter", "compare", "stinger", "entity", "chip"];
  const strips: string[] = [];
  for (const kind of stripKinds) {
    const c = clips.find((x) => x.id.endsWith(`-${kind}`));
    if (!c) continue;
    const sec = Math.min((c.endMs - c.startMs) / 1000, 1.6);
    const out = path.join(OUT, `strip-${kind}.jpg`);
    const cols = 8;
    const frames = Math.round(sec * 15);
    await ffmpeg(["-ss", (c.startMs / 1000).toFixed(3), "-t", sec.toFixed(3), "-i", showcase, "-vf", `fps=15,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=360:-2,tile=${cols}x${Math.ceil(frames / cols)}:padding=2:color=black`, "-frames:v", "1", "-q:v", "3", out]);
    strips.push(out);
  }

  /* The end card at phone size (390 CSS px wide, an iPhone's portrait
     width) and its credits band at 1:1, for the "legible at phone size"
     check a person makes. */
  const endCard = clips.find((x) => x.id.endsWith("-end-card"));
  const phone: string[] = [];
  if (endCard?.parts.hold) {
    const p1 = path.join(OUT, "endcard-phone.png");
    const p2 = path.join(OUT, "endcard-credits.png");
    await ffmpeg(["-i", endCard.parts.hold, "-vf", "scale=390:-2", p1]);
    await ffmpeg(["-i", endCard.parts.hold, "-vf", `crop=${W}:${V2.zones.footnote.bottom - V2.zones.watermark.top + 40}:0:${V2.zones.watermark.top - 20}`, p2]);
    phone.push(p1, p2);
  }

  /* Checkerboard composites: the alpha test a viewer can see. */
  const checkers: string[] = [];
  for (const kind of ["entity", "counter"]) {
    const c = clips.find((x) => x.id.endsWith(`-${kind}`));
    if (!c) continue;
    const file = c.parts.hold ?? c.parts.full;
    if (!file) continue;
    const out = path.join(OUT, `checker-${kind}.png`);
    const still = file.endsWith(".png");
    await ffmpeg([
      "-f", "lavfi", "-i", `color=c=0x808080:s=${W}x${H},geq=lum='if(eq(mod(floor(X/60)+floor(Y/60)\\,2)\\,0)\\,190\\,110)':cb=128:cr=128`,
      ...(still ? [] : ["-c:v", "libvpx-vp9"]), "-i", file,
      /* `setpts` after the select, or the overlay pairs the board's first
         frame with no graphic frame and the checker comes out empty. */
      "-filter_complex", `[1:v]format=rgba${still ? "" : ",select='eq(n\\,20)',setpts=PTS-STARTPTS"}[g];[0:v][g]overlay=x=${c.x}:y=${c.y}:format=auto`,
      "-frames:v", "1", out,
    ]);
    checkers.push(out);
  }

  /* Measurements. */
  const rowsOut: Row[] = [];
  const byId = new Map(specs.map((s) => [s.id, s]));
  const v1Kinds = new Set(["lower-third", "statement", "chapter", "card", "stat", "title"]);
  for (const c of clips) {
    const spec = byId.get(c.id)!;
    const seconds = (c.endMs - c.startMs) / 1000;
    const mode = c.parts.full ? "full" : c.parts.in ? "segments" : "still";
    const enterDesign = ENTER_DESIGN[spec.kind] ?? ENTER_DEFAULT;
    const exitDesign = exitWindow(spec.kind);
    const row: Row = { id: c.id, kind: spec.kind, mode, seconds, startS: c.startMs / 1000, box: { x: c.x, y: c.y, w: c.w, h: c.h }, alpha: "", enterDesignMs: enterDesign.ms, enterMs: null, enterOk: null, exitDesignMs: exitDesign.ms, exitMs: null, exitOk: null, extent: null, safeOk: null, faceOverlapPx: null, v1Kind: v1Kinds.has(spec.kind) };

    /* Alpha on decode: ffmpeg with the libvpx decoder reports yuva420p. */
    const probeFile = c.parts.full ?? c.parts.in;
    if (probeFile) {
      const { stderr } = await run("ffmpeg", ["-hide_banner", "-c:v", "libvpx-vp9", "-i", probeFile, "-f", "null", "-"], { timeout: 60_000 }).catch((e) => ({ stderr: String(e.stderr ?? e) }));
      const m = String(stderr).match(/Video: vp9[^\n]*?(yuva420p|yuv420p)/);
      row.alpha = m ? m[1] : "unknown";
    } else row.alpha = c.parts.hold ? "png" : "none";

    const enterFile = c.parts.full ?? c.parts.in;
    if (enterFile) {
      const a = await alphaStats(enterFile, c.w, c.h);
      const ref = Math.min(MOTION_SEGMENTS.inFrames, a.frames - 1);
      const f = enterDesign.how === "area" ? settleFrame(a.sum, ref) : enterDesign.how === "width" ? settleWidth(a.bbox, ref) : settleFrame(a.top, ref);
      row.enterMs = f >= 0 ? Math.round((f / FPS) * 1000) : null;
      row.enterOk = row.enterMs === null ? null : row.enterMs >= enterDesign.lo && row.enterMs <= enterDesign.hi;
      /* The extent: the settled frame of a full clip at its midpoint, else the hold. */
      const midFrame = c.parts.full ? Math.min(a.frames - 1, Math.round((seconds / 2) * FPS)) : ref;
      const bb = a.bbox[midFrame];
      if (bb) row.extent = { x0: bb.x0 + c.x, y0: bb.y0 + c.y, x1: bb.x1 + c.x, y1: bb.y1 + c.y };
      if (c.parts.full) {
        /* Exit from the tail: the frames after the last one still at full opacity. */
        const last = lastFullFrame(a.top, a.top[midFrame] ?? 0, a.frames - 1);
        row.exitMs = last >= 0 ? Math.round(((a.frames - 1 - last) / FPS) * 1000) : null;
      }
    }
    if (c.parts.out) {
      const o = await alphaStats(c.parts.out, c.w, c.h);
      const last = lastFullFrame(o.top, o.top[0] ?? 0, o.frames - 1);
      row.exitMs = last >= 0 ? Math.round(((o.frames - 1 - last) / FPS) * 1000) : null;
    }
    if (c.parts.hold && !row.extent) {
      const hstats = await alphaStats(c.parts.hold, c.w, c.h);
      const bb = hstats.bbox[0];
      if (bb) row.extent = { x0: bb.x0 + c.x, y0: bb.y0 + c.y, x1: bb.x1 + c.x, y1: bb.y1 + c.y };
    }
    if (spec.kind === "end-card" && c.parts.hold) {
      /* The card is opaque, so its alpha says nothing: the extent is that of
         its type on the dark ground, and the bands the furniture occupies
         (watermark 1573–1613, footnote 1811–1834) must hold no type. */
      const lum = await lumaExtent(c.parts.hold, c.w, c.h);
      row.extent = lum.bbox ? { x0: lum.bbox.x0 + c.x, y0: lum.bbox.y0 + c.y, x1: lum.bbox.x1 + c.x, y1: lum.bbox.y1 + c.y } : null;
      const busy = (from: number, to: number) => {
        for (let y = from; y <= to; y++) if (lum.rows[y - c.y]) return true;
        return false;
      };
      row.bandsClear = !busy(V2.zones.watermark.top, V2.zones.watermark.bottom) && !busy(V2.zones.footnote.top, V2.zones.footnote.bottom);
    }
    if (row.exitMs !== null) row.exitOk = row.exitMs >= exitDesign.lo && row.exitMs <= exitDesign.hi;
    if (row.extent) {
      const e = row.extent;
      row.safeOk = spec.kind === "end-card" ? e.x0 >= SAFE.x0 && e.x1 <= SAFE.x1 && e.y0 >= SAFE.y0 && row.bandsClear === true : e.x0 >= SAFE.x0 && e.x1 <= SAFE.x1 && e.y0 >= SAFE.y0 && e.y1 <= SAFE.y1;
      const ox = Math.max(0, Math.min(e.x1, FACE.x1) - Math.max(e.x0, FACE.x0));
      const oy = Math.max(0, Math.min(e.y1, FACE.y1) - Math.max(e.y0, FACE.y0));
      row.faceOverlapPx = spec.kind === "end-card" ? 0 : ox * oy;
    }
    if (spec.kind === "counter" && c.parts.full && typeof spec.props.landMs === "number") {
      const land = await landingFrame(c.parts.full, c.w, c.h, Math.round(seconds * FPS), Math.round((V2.exitMs / 1000) * FPS) + 1);
      const expect = Math.round((spec.props.landMs / 1000) * FPS);
      row.landing = { landMs: spec.props.landMs, expectFrame: expect, gotFrame: land.frame, ok: Math.abs(land.frame - expect) <= 1 };
    }
    rowsOut.push(row);
  }

  /* Vision check on one composited frame per template (paid, tiny). */
  let visionCost = 0;
  if (VISION) {
    const { checkFrame, visionSpend, resetVisionSpend } = await import("../../lib/video/vision");
    resetVisionSpend();
    const seen = new Set<string>();
    for (const row of rowsOut) {
      if (seen.has(row.kind)) continue;
      seen.add(row.kind);
      const at = row.startS + Math.min(1.0, row.seconds / 2);
      const frame = path.join(OUT, `check-${row.kind}.jpg`);
      await ffmpeg(["-ss", at.toFixed(3), "-i", showcase, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", frame]);
      const r = await checkFrame(frame).catch((e) => ({ ok: false, issues: [{ type: "other", severity: "low", detail: `call failed: ${(e as Error).message.slice(0, 80)}` }] }));
      row.check = { ok: r.ok, issues: r.issues };
    }
    visionCost = visionSpend().costMicros / 1e6;
  }

  /* The report. */
  const v2rows = rowsOut.filter((r) => !r.v1Kind);
  const summary = {
    graphics: specs.length,
    rendered: clips.length,
    coldMs,
    warmMs,
    concurrency: CONCURRENCY,
    alphaAll: rowsOut.every((r) => r.alpha === "yuva420p" || r.alpha === "png"),
    enterOk: v2rows.filter((r) => r.enterOk === true).length,
    enterMeasured: v2rows.filter((r) => r.enterMs !== null).length,
    exitOk: v2rows.filter((r) => r.exitOk === true).length,
    exitMeasured: v2rows.filter((r) => r.exitMs !== null).length,
    safeOk: v2rows.filter((r) => r.safeOk === true).length,
    safeMeasured: v2rows.filter((r) => r.safeOk !== null).length,
    faceClear: v2rows.filter((r) => r.faceOverlapPx === 0).length,
    landings: rowsOut.filter((r) => r.landing).map((r) => ({ id: r.id, ...r.landing })),
    checkOk: VISION ? rowsOut.filter((r) => r.check?.ok).length : null,
    checkRun: VISION ? rowsOut.filter((r) => r.check).length : null,
    visionCostUsd: visionCost,
    logos: { anthropic: Boolean(logos.anthropic), deepseek: Boolean(logos.deepseek), credit: "Simple Icons (CC0 1.0), cdn.simpleicons.org" },
    face: FACE,
    safe: SAFE,
    sheets,
    strips,
    checkers,
    phone,
    showcase,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify({ summary, rows: rowsOut }, null, 2));

  /* What this test fetched from the internet, credited the way every asset is. */
  const creditsLine = String((specs.find((s) => s.kind === "end-card")?.props.creditsLine as string | undefined) ?? "");
  await writeFile(
    path.join(OUT, "credits.txt"),
    [
      "W4 motion test — assets used",
      logos.anthropic ? "Anthropic logo: Simple Icons (CC0 1.0), https://simpleicons.org/?q=anthropic — entity card + chip" : "Anthropic logo: not fetched (monogram drawn)",
      logos.deepseek ? "DeepSeek logo: Simple Icons (CC0 1.0), https://simpleicons.org/?q=deepseek — entity card + chip" : "DeepSeek logo: not fetched (monogram drawn)",
      "Headline article image: ffmpeg testsrc2 pattern (synthetic, no rights)",
      "Background frame: /home/ubuntu/raw/zhengliu.mp4 at 5.2 s (the project's own take)",
      "",
      "End-card creditsLine rendered (placeholder handles; the real line comes from lib/media credits.ts via W3/W6):",
      creditsLine,
      "",
    ].join("\n"),
  );

  const lines: string[] = [];
  lines.push(`W4 motion test — ${specs.length} graphics, cold ${(coldMs / 1000).toFixed(1)} s, warm ${(warmMs / 1000).toFixed(1)} s at concurrency ${CONCURRENCY}`);
  lines.push(`alpha on every clip: ${summary.alphaAll ? "yes" : "NO"}; enter in spec ${summary.enterOk}/${summary.enterMeasured}; exit in spec ${summary.exitOk}/${summary.exitMeasured}; inside safe column ${summary.safeOk}/${summary.safeMeasured}; clear of face box ${summary.faceClear}/${v2rows.length}`);
  lines.push("enter/exit: design ms → measured ms (frame where the block's top alpha reaches 98.5 % of settled, 33 ms steps; the bezier is at 98.5 % after ~70 % of its length)");
  for (const l of summary.landings) lines.push(`counter ${l.id}: landMs ${l.landMs} → expect frame ${l.expectFrame}, stopped changing at ${l.gotFrame} ${l.ok ? "ok" : "OFF"}`);
  if (VISION) lines.push(`checkFrame ok ${summary.checkOk}/${summary.checkRun}, $${visionCost.toFixed(5)}`);
  lines.push("");
  lines.push("id                    kind         mode      alpha     enter(design→ms)  exit(design→ms)  extent (x0,y0)-(x1,y1)       safe face  check");
  for (const r of rowsOut) {
    const ext = r.extent ? `(${r.extent.x0},${r.extent.y0})-(${r.extent.x1},${r.extent.y1})` : "—";
    const enter = `${r.enterDesignMs}→${r.enterMs ?? "—"}${r.enterOk === null ? "" : r.enterOk ? "" : "!"}`;
    const exit = `${r.exitDesignMs}→${r.exitMs ?? "—"}${r.exitOk === null ? "" : r.exitOk ? "" : "!"}`;
    lines.push(
      `${r.id.padEnd(22)}${r.kind.padEnd(13)}${r.mode.padEnd(10)}${r.alpha.padEnd(10)}${enter.padEnd(18)}${exit.padEnd(17)}${ext.padEnd(28)} ${r.safeOk === null ? " —  " : r.safeOk ? " ok " : "OUT "} ${String(r.faceOverlapPx ?? "—").padStart(6)} ${r.check ? (r.check.ok ? "ok" : `issues:${r.check.issues.length}`) : ""}${r.v1Kind ? "  (v1 kind)" : ""}`,
    );
  }
  const text = lines.join("\n");
  await writeFile(path.join(OUT, "report.txt"), text);
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
