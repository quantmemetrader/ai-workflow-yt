/**
 * The product, operated 0 → 1 by a browser, on record.
 *
 *   node scripts/walkthrough.mjs --clip scripts/.tmp/raw-chinese.mp4 --topic "..." --credit "..." [--out docs/walkthrough]
 *
 * Signs in as the owner, watches a topic in Research, writes the script from
 * it, opens the video project the script makes, uploads the raw clip, asks the
 * director for the whole video at the channel's pace, waits for the render,
 * exports, and looks at the file — taking a screenshot at every step and
 * recording the whole session as a video. The screenshots and the recording
 * are what the guide in docs/ is written from.
 *
 * Runs against the real database (the owner's studio), so everything it makes
 * is real and stays: a topic, a script, a project, a render. That is the
 * point — the guide shows real screens.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const BASE = process.env.BASE || "http://127.0.0.1:3300";
const EMAIL = process.env.OWNER_EMAIL || "rahulsinghhh2312@gmail.com";
const PASSWORD = process.env.OWNER_PASSWORD || "mB30peA98EFf";
const CLIP = path.resolve(arg("clip", "scripts/.tmp/raw-chinese.mp4"));
/* A second take (a side angle) goes in with the first; the director cuts to it. */
const CLIP2 = arg("clip2", "") ? path.resolve(arg("clip2", "")) : null;
const TOPIC = arg("topic", "人工智能");
const CREDIT = arg("credit", "");
const BRIEF = arg(
  "brief",
  "按频道格式做竖版短片：论断块钩子、片头题、水印脚注、双语字幕高亮关键词、姓名条；讲到的每个产品、公司、地名都配一张图或素材库空镜，说出的数字做大数字，关键句推近，结尾片尾卡。",
);
const OUT = path.resolve(arg("out", "docs/walkthrough"));
const SHOTS = path.join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

if (!existsSync(CLIP)) throw new Error(`no clip at ${CLIP}`);

const dbUrl = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length)
  .replace(/^"|"$/g, "");
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s]`, ...a);
let shot = 0;
const steps = [];
const snap = async (page, slug, caption) => {
  shot++;
  const file = `${String(shot).padStart(2, "0")}-${slug}.png`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
  steps.push({ file, caption, at: Math.round((Date.now() - started) / 1000) });
  log(`📸 ${file} — ${caption}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, { every = 5000, limit = 20 * 60_000 } = {}) => {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > limit) throw new Error(`gave up waiting for ${what}`);
    await sleep(every);
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: path.join(OUT, "rec"), size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  /* ---- 1. sign in --------------------------------------------------- */
  await page.goto(`${BASE}/login`);
  await snap(page, "login", "登录 · Sign in");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

  /* ---- 2. research: watch the topic ---------------------------------- */
  await page.goto(`${BASE}/research`, { waitUntil: "networkidle" });
  await snap(page, "research-board", "选题研究看板 · The Research board, with the creator's channel as memory");
  const watch = page.locator('input[role="combobox"], input[placeholder*="关注"], input[placeholder*="watch a topic" i]').first();
  await watch.fill(TOPIC);
  await snap(page, "research-watch", `输入要关注的选题「${TOPIC}」· Typing the topic to watch`);
  await watch.press("Enter");
  const topic = await until("the topic row", async () => (await q("select id from topics where query = $1 order by created_at desc limit 1", [TOPIC]))[0], { every: 2000, limit: 60_000 });
  log("topic", topic.id);
  // The worker collects it: the card fills with heat and sources.
  await until("the topic's first collection", async () => {
    const rows = await q("select status from jobs where object_type = 'topic' and object_id = $1 order by created_at desc limit 1", [topic.id]);
    return rows[0] && rows[0].status !== "queued" && rows[0].status !== "running";
  }, { every: 5000, limit: 6 * 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(1500);
  await snap(page, "research-topic", `选题已收集 · The topic collected, with its sources and heat`);

  /* ---- 3. write the script from the topic ---------------------------- */
  // The board opens on the top-ranked topic; the decision buttons belong to
  // whichever topic is selected, so the watched one is picked from the
  // watchlist first and the detail is checked to be about it.
  // The watchlist row is a plain div; the hero title is a 19px div.
  await page.locator(".nmw", { hasText: TOPIC }).first().click();
  await until("the topic detail", async () => {
    return page.evaluate((topic) => {
      return [...document.querySelectorAll("div")].some(
        (d) => d.childElementCount === 0 && d.textContent.trim() === topic && parseFloat(getComputedStyle(d).fontSize) >= 18,
      );
    }, TOPIC);
  }, { every: 1000, limit: 30_000 });
  await sleep(1500);
  await snap(page, "research-topic-open", `打开选题「${TOPIC}」：来源、走势、建议角度 · The topic open: sources, trend, angles`);
  await page.locator("text=/写剧本 →|Write the script →/").first().click();
  await page.waitForSelector("text=/写剧本|Write the script/", { timeout: 15000 });
  await sleep(2500);
  await snap(page, "script-sheet", "写剧本表单：角度、时长、语言 · The script sheet: angle, length, language");
  await page.click('button:has-text("开始写"), button:has-text("Write it")');
  await page.waitForURL((u) => /^\/script\/scr_/.test(u.pathname), { timeout: 4 * 60_000 });
  const scriptId = page.url().split("/script/")[1].split("?")[0];
  log("script", scriptId);
  await sleep(2500);
  await snap(page, "script-written", "剧本已写好并进入剧本库 · The script, written and in the Script module");

  /* ---- 4. make the video project from the script --------------------- */
  await page.click("text=/去剪辑 →|Make the video →/");
  await page.waitForURL((u) => u.pathname === "/video" && u.searchParams.get("project"), { timeout: 60_000 });
  const projectId = new URL(page.url()).searchParams.get("project");
  log("project", projectId);
  await sleep(2500);
  await snap(page, "video-empty", "剪辑页打开，剧本已关联，素材为空 · The editor, script linked, bin empty");

  /* ---- 5. upload the raw clip from the editor ------------------------ */
  await page.locator('input[type="file"]').first().setInputFiles(CLIP2 ? [CLIP, CLIP2] : [CLIP]);
  await until("the clip on the timeline", async () => (await q("select id from timeline_items where project_id = $1 limit 1", [projectId]))[0], { every: 3000, limit: 5 * 60_000 });
  await until("the clips measured", async () => {
    const rows = await q("select c.duration_ms from video_clips c where c.project_id = $1", [projectId]);
    return rows.length >= (CLIP2 ? 2 : 1) && rows.every((r) => r.duration_ms);
  }, { every: 3000, limit: 15 * 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(2500);
  await snap(page, "video-uploaded", "原片上传后直接落在时间线上 · The raw clip, uploaded, on the timeline");

  /* ---- 6. the director ----------------------------------------------- */
  const brief = page.locator("textarea").first();
  await brief.fill(BRIEF);
  await page.click('button:has-text("9:16")').catch(() => {});
  await page.click('button:has-text("频道"), button:has-text("Channel")').catch(() => {});
  await snap(page, "director-brief", "一句话说清想要的片子，选竖版和频道节奏 · The brief, 9:16, the channel's pace");
  // The strip's header toggle carries the same words as the action button;
  // the action is the last one in the strip.
  await page.locator('button:has-text("开始制作"), button:has-text("Make the video")').last().click();
  await until("the director job", async () => (await q("select id from jobs where type = 'video.direct' and payload->>'projectId' = $1", [projectId]))[0], { every: 2000, limit: 60_000 });
  await sleep(4000);
  await snap(page, "director-running", "导演开始工作：读素材、转写、剪、设计、渲染 · The director at work");
  let lastStep = "";
  await until("the director to finish", async () => {
    const [row] = await q("select director from video_projects where id = $1", [projectId]);
    const d = row?.director ?? {};
    if (d.step && d.step !== lastStep) {
      lastStep = d.step;
      await sleep(1500);
      await snap(page, `director-${d.step}`, `${d.note ?? d.step}`);
    }
    if (d.state === "failed") throw new Error(`director failed: ${d.error}`);
    return d.state === "done" ? d : null;
  }, { every: 8000, limit: 30 * 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await sleep(3000);
  await snap(page, "director-done", "成片完成：片段、图形、推近、空镜都在时间线上 · Done: cuts, graphics, punch-ins and cutaways on the timeline");

  /* ---- 7. a change by prompt ----------------------------------------- */
  try {
    const ask = page.locator('textarea[placeholder*="要改什么"], textarea[placeholder*="What should change"]').first();
    await ask.fill("把片头题改成更短的一句，并在第 15 秒加一个推近");
    await snap(page, "assistant-ask", "用一句话让助理改片 · Asking the assistant for a change");
    await ask.press("Enter");
    await sleep(25_000);
    await snap(page, "assistant-done", "助理调用工具改了时间线 · The assistant edited the timeline with its tools");
  } catch (e) {
    log("assistant step skipped:", e.message);
  }

  /* ---- 8. export and the file ---------------------------------------- */
  await page.click('button:has-text("导出"), button:has-text("Export")');
  await sleep(2000);
  await snap(page, "exports", "导出页：已渲染的成片和再次渲染 · Exports: the rendered video, and rendering again");
  const [exp] = await q("select file_id from video_exports where project_id = $1 and state = 'done' order by created_at desc limit 1", [projectId]);
  if (exp?.file_id) {
    await page.goto(`${BASE}/files/${exp.file_id}`, { waitUntil: "networkidle" });
    await sleep(3000);
    await snap(page, "file", "成片在文件里，可播放、可下载、可分享 · The file: play, download, share");
  }
  await page.goto(`${BASE}/files`, { waitUntil: "networkidle" });
  await sleep(2000);
  await snap(page, "files", "文件模块，缩略图齐全 · Files, every thumbnail present");

  const [proj] = await q("select title, director from video_projects where id = $1", [projectId]);
  const summary = {
    topic: TOPIC,
    topicId: topic.id,
    scriptId,
    projectId,
    title: proj?.title,
    result: proj?.director?.result ?? null,
    clip: path.basename(CLIP),
    credit: CREDIT,
    steps,
    errors,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  const fs = await import("node:fs/promises");
  await fs.writeFile(path.join(OUT, "run.json"), JSON.stringify(summary, null, 2));
  log("done", JSON.stringify({ scriptId, projectId, seconds: summary.seconds, errors: errors.length }));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await db.end();
  // The recording lands under a random name; give it the guide's name and an mp4 copy.
  const recDir = path.join(OUT, "rec");
  const files = existsSync(recDir) ? (await import("node:fs")).readdirSync(recDir).filter((f) => f.endsWith(".webm")) : [];
  if (files[0]) {
    const webm = path.join(OUT, "walkthrough.webm");
    renameSync(path.join(recDir, files[0]), webm);
    spawnSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(OUT, "walkthrough.mp4")], { stdio: "ignore" });
    log("recording", webm);
  }
}
