/**
 * Exercise the three vision calls once each, on real material.
 *
 *   cd /home/ubuntu/wt/dv2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-vision.ts [--thumbs /tmp/dv2_vis/thumbs] [--frames /tmp/dv2_vis] \
 *     [--pexels 28709421] [--out /tmp/dv2_lab/vision] [--only score,window,check]
 *
 * Four paid calls at most (about a tenth of a cent): one scoring call over
 * the seven credit-card thumbnails the vision report used — which include
 * the two clips v1 actually placed, both of which should score 0 — one
 * window pick over one-a-second frames of a Pexels clip from the fixture,
 * and the layout check on the "caption over the face" and the clean frame.
 * Nothing is written to the database; the ledger option is left off and
 * the spend is printed from `visionSpend()` instead.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "../../lib/env";
import { VISION, checkFrame, pickWindow, scoreCandidates, visionSpend } from "../../lib/video/vision";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const THUMBS = arg("--thumbs", "/tmp/dv2_vis/thumbs");
const FRAMES = arg("--frames", "/tmp/dv2_vis");
const PEXELS_ID = arg("--pexels", "28709421");
const OUT = arg("--out", "/tmp/dv2_lab/vision");
const ONLY = new Set(arg("--only", "score,window,check").split(","));

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));

/** The seven candidates of the report's production test, in its order. */
const CC_CANDIDATES = ["cc_3", "px_used_7230784", "cc_1", "cc_4", "cc_0", "px_used_28709421", "cc_2"];
const CC_LINE = "阿里相关的3500多个账号被认定是用盗刷信用卡、盗用凭证批量注册的欺诈账号";
const CC_CONTEXT =
  "Anthropic accuses Alibaba-linked accounts of registering in bulk with stolen credit cards and stolen credentials in order to distil Claude.";

async function testScore() {
  const images = CC_CANDIDATES.map((c) => path.join(THUMBS, `${c}.jpg`));
  for (const p of images) if (!(await exists(p))) throw new Error(`missing thumbnail ${p}`);
  const started = Date.now();
  const r = await scoreCandidates(CC_LINE, CC_CONTEXT, images, {
    must: "credit cards, stolen credentials or bulk account registration, shown literally",
    mustNot: "an identifiable person portrayed as the fraudster; a frame too dark to read",
  });
  const rows = r.scores.map((s) => `${String(s.index + 1).padStart(2)} ${CC_CANDIDATES[s.index].padEnd(18)} ${String(s.score).padStart(2)}  ${s.reason}`);
  console.log(`\n[score] ${r.usage.model} via ${r.usage.provider ?? "?"} in ${r.usage.ms} ms (${Date.now() - started} ms wall), ${r.usage.promptTokens}+${r.usage.completionTokens} tokens, $${(r.usage.costMicros / 1e6).toFixed(5)}${r.usage.degraded ? " DEGRADED" : ""}`);
  console.log(rows.join("\n"));
  console.log(`best: ${r.best === null ? "null" : `#${r.best + 1} ${CC_CANDIDATES[r.best]}`}`);
  const placed = r.scores.filter((s) => CC_CANDIDATES[s.index].startsWith("px_used_"));
  console.log(`v1's own picks scored ${placed.map((s) => `${CC_CANDIDATES[s.index]}=${s.score}`).join(", ")} (expected 0–2)`);
  return { test: "score", line: CC_LINE, candidates: CC_CANDIDATES, ...r };
}

/**
 * One-a-second frames of a Pexels clip from the fixture.
 *
 * The clip is fetched through the API with the studio's key (free; the
 * same call `lib/video/stock.ts` makes) at its smallest rendition — this
 * is a look, not a render — and sampled with ffmpeg at one frame a second,
 * scaled to 480 wide so eight frames cost the model what one sheet does.
 */
async function pexelsFrames(dir: string): Promise<{ frames: string[]; url: string; user: string }> {
  if (!env.pexels.configured) throw new Error("PEXELS_API_KEY is not set");
  const res = await fetch(`https://api.pexels.com/videos/videos/${PEXELS_ID}`, {
    headers: { Authorization: env.pexels.apiKey, "user-agent": "Tengya/1.0 (studio video tool)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Pexels answered ${res.status}`);
  const v = (await res.json()) as {
    url: string;
    duration: number;
    user?: { name?: string };
    video_files?: { link: string; width?: number | null; height?: number | null; file_type?: string }[];
  };
  const files = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const pick = files.sort((a, b) => Math.min(a.width!, a.height!) - Math.min(b.width!, b.height!)).find((f) => Math.min(f.width!, f.height!) >= 360) ?? files[0];
  if (!pick) throw new Error("Pexels returned no mp4 rendition");

  const mp4 = path.join(dir, `pexels-${PEXELS_ID}.mp4`);
  if (!(await exists(mp4))) {
    const dl = await fetch(pick.link, { signal: AbortSignal.timeout(120_000), headers: { "user-agent": "Tengya/1.0 (studio video tool)" } });
    if (!dl.ok) throw new Error(`Pexels file answered ${dl.status}`);
    await writeFile(mp4, Buffer.from(await dl.arrayBuffer()));
  }
  const pattern = path.join(dir, `pexels-${PEXELS_ID}-%02d.jpg`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-t", "8", "-vf", "fps=1,scale=480:-2", "-q:v", "4", pattern], { timeout: 60_000 });
  const frames = (await readdir(dir))
    .filter((f) => f.startsWith(`pexels-${PEXELS_ID}-`) && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(dir, f));
  return { frames, url: v.url, user: v.user?.name ?? "" };
}

async function testWindow() {
  const { frames, url, user } = await pexelsFrames(OUT);
  if (!frames.length) throw new Error("no frames sampled");
  const line = "光是阿里一家5到7月可疑交互量就达到了1.51亿次";
  const started = Date.now();
  const r = await pickWindow(line, frames, {
    context: "Anthropic's report counts 151 million suspicious API interactions from Alibaba-linked accounts between May and July; the cutaway should read as API traffic or a terminal of requests.",
    mustNot: "burned-in captions or watermarks",
  });
  console.log(`\n[window] ${r.usage.model} via ${r.usage.provider ?? "?"} in ${r.usage.ms} ms (${Date.now() - started} ms wall), ${r.usage.promptTokens}+${r.usage.completionTokens} tokens, $${(r.usage.costMicros / 1e6).toFixed(5)}${r.usage.degraded ? " DEGRADED" : ""}`);
  console.log(`clip ${url} by ${user}, ${frames.length} frames at 1 fps`);
  console.log(r.scores.map((s) => `${String(s.index + 1).padStart(2)} t=${s.index}s ${String(s.score).padStart(2)}  ${s.reason}`).join("\n"));
  console.log(`best: ${r.best === null ? "null" : `#${r.best + 1} (sourceInMs ${r.best * 1000})`}, subjectX ${r.subjectX.toFixed(2)}, burnedText ${r.burnedText}`);
  return { test: "window", line, clip: url, frames, ...r };
}

async function testCheck() {
  const out: unknown[] = [];
  for (const [name, expect] of [
    ["L1_face", "not ok: face_occluded"],
    ["L3_good", "ok"],
  ] as const) {
    const p = path.join(FRAMES, `${name}.jpg`);
    if (!(await exists(p))) throw new Error(`missing frame ${p}`);
    const started = Date.now();
    const r = await checkFrame(p);
    console.log(`\n[check ${name}] ${r.usage.model} via ${r.usage.provider ?? "?"} in ${r.usage.ms} ms (${Date.now() - started} ms wall), ${r.usage.promptTokens}+${r.usage.completionTokens} tokens, $${(r.usage.costMicros / 1e6).toFixed(5)}${r.usage.degraded ? " DEGRADED" : ""}`);
    console.log(`ok ${r.ok} (expected ${expect}); issues ${JSON.stringify(r.issues)}; read 「${r.captionTextRead}」`);
    out.push({ test: `check:${name}`, frame: p, expected: expect, ...r });
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`models: score ${VISION.score} (fallback ${VISION.scoreFallback}), check ${VISION.check}; provider pin ${VISION.provider || "none"}`);
  const results: unknown[] = [];
  const failures: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    if (!ONLY.has(name)) return;
    try {
      const r = await fn();
      if (Array.isArray(r)) results.push(...r);
      else results.push(r);
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`\n[${name}] FAILED`, err);
    }
  };
  await step("score", testScore);
  await step("window", testWindow);
  await step("check", testCheck);

  const spend = visionSpend();
  const summary = { at: new Date().toISOString(), models: VISION, spend, failures, results };
  /* A partial run keeps its own file, so the full run's record survives it. */
  const file = path.join(OUT, ONLY.size === 3 ? "results.json" : `results-${[...ONLY].join("-")}.json`);
  await writeFile(file, JSON.stringify(summary, null, 2));
  console.log(`\nspend: ${spend.calls} calls, ${spend.promptTokens}+${spend.completionTokens} tokens, $${(spend.costMicros / 1e6).toFixed(5)}, ${spend.ms} ms model time`);
  console.log(`wrote ${file}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
