/**
 * The product, on film.
 *
 *   node scripts/demo-video.mjs [--out docs/demo] [--email …] [--password …]
 *
 * Drives the real site in a real browser and records the session, with a
 * caption burnt into each scene saying what is being shown. Nothing is faked:
 * the numbers are the studio's own, the AI employees answer for themselves,
 * and the button presses are the same ones a person makes.
 *
 * It signs in as a real person, so it writes one message into #制作 — the
 * hand-off it demonstrates. That is genuine work, not test data, and it is
 * left behind on purpose: the video shows the studio a thing that happened.
 *
 * Playwright writes .webm; ffmpeg on this box turns it into an .mp4 anybody
 * can open.
 */
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const EMAIL = arg("email", "catherine@tengya.media");
const PASSWORD = arg("password", "CJHz8k76Avix");
const OUT = path.resolve(arg("out", "docs/demo"));
const REC = path.join(OUT, "rec");

rmSync(REC, { recursive: true, force: true });
mkdirSync(REC, { recursive: true });

const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--force-device-scale-factor=1", "--hide-scrollbars"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
  recordVideo: { dir: REC, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

/**
 * The caption, drawn into the page so the recorder picks it up.
 *
 * Re-injected after every navigation, because a document swap takes it with
 * it. Two lines: what this is, in the studio's language, and one line of why
 * it matters — a silent screen recording with no words is a slideshow.
 */
async function caption(zh, en = "") {
  await page.evaluate(
    ([zh, en]) => {
      let bar = document.getElementById("__demo_caption");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "__demo_caption";
        bar.style.cssText = [
          "position:fixed",
          "left:0;right:0;bottom:0",
          "z-index:2147483647",
          "padding:18px 28px 20px",
          "background:linear-gradient(to top, rgba(10,10,12,0.94), rgba(10,10,12,0.82) 65%, rgba(10,10,12,0))",
          "color:#fff",
          "font-family:'Noto Sans SC','PingFang SC',system-ui,sans-serif",
          "pointer-events:none",
          "transition:opacity .25s ease",
        ].join(";");
        document.body.appendChild(bar);
      }
      bar.innerHTML =
        `<div style="font-size:21px;font-weight:600;letter-spacing:.01em;line-height:1.35">${zh}</div>` +
        (en ? `<div style="font-size:13.5px;opacity:.72;margin-top:5px;line-height:1.45">${en}</div>` : "");
      bar.style.opacity = "1";
    },
    [zh, en],
  );
}

/** A scene: caption it, let it breathe, and say so in the log. */
async function scene(zh, en, hold = 3200) {
  await caption(zh, en);
  log(`🎬 ${zh}`);
  await sleep(hold);
}

/** Scroll a container gently, so the eye can follow it. */
async function glide(selector, distance, steps = 26) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(
      ([sel, by]) => {
        const el = sel ? document.querySelector(sel) : null;
        const target =
          el ??
          [...document.querySelectorAll("div")].find(
            (d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY !== "visible",
          ) ??
          document.scrollingElement;
        target?.scrollBy({ top: by, behavior: "instant" });
      },
      [selector, distance / steps],
    );
    await sleep(45);
  }
}

const go = async (pathname, zh, en, hold = 3200) => {
  await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(900);
  await scene(zh, en, hold);
};

try {
  /* ---------------------------------------------------------- 1. sign in */
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await scene("腾亚创变 · 工作台", "The studio's workspace. Simplified Chinese throughout, in a font the site ships itself.", 2600);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await sleep(700);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1200);

  /* ------------------------------------------------------------ 2. 首页 */
  await scene(
    "首页：今天要你决定的事",
    "Home is the work, not a dashboard. Everything an AI employee has put up that nobody has answered, oldest first.",
    4200,
  );
  await glide(null, 520);
  await scene("五位 AI 员工，各自在忙什么", "The five of them, in the order the work goes, with what each is on right now.", 4200);
  await glide(null, 520);
  await sleep(1200);

  /* --------------------------------------------- 3. the @ picker works */
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  await sleep(800);
  await caption("@ 一下就能叫人", "Type @ and the picker finds a colleague by any name they answer to — Chinese, English, or the handle they sign in with.");
  const box = page.locator("textarea").first();
  await box.click();
  for (const ch of "@r") {
    await box.type(ch, { delay: 260 });
  }
  await sleep(2600);
  await box.fill("");
  await sleep(400);

  /* --------------------------------------------------- 4. 研究日报 */
  await go(
    "/chat/c/" + encodeURIComponent("研究日报"),
    "早上 8 点，研究员发晨报",
    "08:00 Hong Kong, unprompted. Built on this channel's own numbers — its like rates, its viewers' questions — not on generic news.",
    4600,
  );
  await glide(null, 700);
  await scene(
    "每个数字都是这个频道自己的",
    "Its own best performer, a competitor's video, and a viewer's question quoted word for word.",
    4600,
  );
  await glide(null, 800);
  await scene("紧接着，策划发当天的待办", "Five minutes later the planning agent turns that into today's to-dos, one button per colleague.", 4600);
  await glide(null, 800);
  await sleep(1500);

  /* --------------------------------------------------------- 5. 制作 */
  await go(
    "/chat/c/" + encodeURIComponent("制作"),
    "上传素材后，策划自己看完并提建议",
    "Footage lands, transcribes itself, and the planning agent reads it: what the tape is, the moments worth cutting, with timecodes.",
    5000,
  );
  await glide(null, 500);
  await scene("按一下，就交给下一位同事", "One press hands it on — and it posts as the person who pressed it, through the same checks as typing it.", 3600);

  const hand = page.locator("button", { hasText: "交给编剧" }).first();
  if (await hand.count()) {
    await hand.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(600);
    await hand.click().catch(() => {});
    await sleep(2500);
    await scene("编剧收到了，正在写", "The script agent picks it up under its own name and its own permissions.", 3000);
  }

  /* ---------------------------------------------------- 6. 市场调研 */
  await go("/research", "市场调研：自己的频道和对标账号", "The studio's own channel next to the channels it watches — which the research agent went and found itself.", 4600);
  await glide(null, 620);
  await sleep(1200);

  /* ------------------------------------------------------ 7. 脚本 */
  await go("/script", "脚本", "Scripts, versions and approvals. The reading text is a reading size now.", 3800);
  const firstScript = page.locator("a[href^='/script/']").first();
  if (await firstScript.count()) {
    await firstScript.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1400);
    await caption("脚本正文", "Bigger type: a 14px Han character is about as legible as 11px Latin.");
    await glide(null, 620);
    await sleep(1600);
  }

  /* ------------------------------------------------------ 8. 视频剪辑 */
  await go("/video", "视频剪辑", "Four tabs, not eight. The specialist screens are behind 高级 — one press away, and out of the way.", 4200);
  const project = page.locator("a[href*='project='], [data-project-card]").first();
  if (await project.count()) {
    await project.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(2200);
    await caption("一个项目：时间线、字幕、图形、导出", "Subtitles with no holes in them, lines sized to the aspect, and a first pass that knows how long the brief asked for.");
    await sleep(3600);
  }

  /* --------------------------------------------------------- 9. 文章 */
  await go("/article", "文章", "Long-form and publishing logs, separate from the video page, driven by the writing agent.", 3400);

  /* ---------------------------------------------------- 10. 自动化 */
  await go("/settings", "自动化：这些事没人吩咐也会发生", "Every standing job has a switch, a Hong Kong time, and the colleague who signs it.", 2600);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => x.textContent?.includes("自动化"));
    h?.closest("section")?.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await sleep(1000);
  await scene(
    "开关、时间、由谁来做",
    "An employee that acts by itself and cannot be told to stop is not an employee.",
    5000,
  );

  /* -------------------------------------------- 11. back to the reply */
  await go(
    "/chat/c/" + encodeURIComponent("制作"),
    "回来看看，编剧已经把稿子写好了",
    "Back in the channel: the script agent answered while we were elsewhere, under its own name.",
    2000,
  );
  await glide(null, 1400);
  await scene("AI 员工之间自己交接", "They tag each other and hand the work on, which is the whole point.", 5200);

  await go("/home", "回到首页，等你决定的事少了一件", "And the decision leaves the list.", 5200);

  log("done");
} catch (err) {
  console.error("demo failed:", err);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

/* ------------------------------------------------------------- encode */

const raw = readdirSync(REC).filter((f) => f.endsWith(".webm"));
if (!raw.length) {
  console.error("no recording was written");
  process.exit(1);
}
const webm = path.join(REC, raw[0]);
const mp4 = path.join(OUT, "tengya-demo.mp4");
log(`encoding ${raw[0]} -> ${path.basename(mp4)}`);

const ff = spawnSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", webm,
    // Constant frame rate and yuv420p, or half the players in the world
    // refuse it. faststart so it begins before it has finished downloading.
    "-r", "30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    mp4,
  ],
  { stdio: "inherit" },
);
if (ff.status !== 0) {
  console.error("ffmpeg failed");
  process.exit(1);
}
if (existsSync(webm)) renameSync(webm, path.join(REC, "session.webm"));
log(`✅ ${mp4}`);
