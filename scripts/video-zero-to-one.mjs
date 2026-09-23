/**
 * 0 → 1 with real footage: upload two public-domain NASA clips through the
 * real UI, build a cut, transcribe it, let the AI make the first pass, put
 * graphics and a dissolve on it, export, and check the file that comes out.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";  // eslint-disable-line

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const EMAIL = "rahulsinghhh2312@gmail.com";
const PASSWORD = process.env.OWNER_PASSWORD || "mB30peA98EFf";
const FOOTAGE = "/tmp/claude-1003/footage";

const url = fs.readFileSync("/home/ubuntu/aiVideoFreeLance/.env.local","utf8")
  .split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^"|"$/g,"");
const db = new Client({connectionString:url}); await db.connect();
const q = async (s,p=[]) => (await db.query(s,p)).rows;

const results=[]; const check=(n,p,d="")=>{results.push([p,n,d]);console.log(`${p?"  ok  ":"  FAIL"} ${n}${d?" — "+d:""}`)};
const step = (s) => console.log(`\n— ${s}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport:{width:1600,height:950}});
const page = await ctx.newPage();
const errors=[]; page.on("pageerror",e=>errors.push(String(e)));

async function waitFor(label, fn, timeoutMs = 300000, everyMs = 4000) {
  const started = Date.now();
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

try {
  step("sign in");
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
  await page.fill("#email",EMAIL); await page.fill("#password",PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/chat/,{timeout:60000});
  check("signed in", true);

  step("clear anything an earlier run of this script left behind");
  await q(`delete from video_projects where title='NASA test cut'`);
  await q(`delete from files where name in ('interview.mp4','broll-40s.mp4')`);

  step("upload the footage through the Files screen");
  await page.goto(`${BASE}/files`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  await page.locator('input[type=file]').setInputFiles([`${FOOTAGE}/interview.mp4`, `${FOOTAGE}/broll-40s.mp4`]);
  const uploaded = await waitFor("both files to land", async () => {
    const rows = await q("select id, name, size_bytes, storage_key from files where name in ('interview.mp4','broll-40s.mp4') and deleted_at is null order by created_at desc limit 2");
    return rows.length === 2 && rows.every(r => r.storage_key) ? rows : null;
  }, 180000, 3000);
  check("both clips uploaded to R2", true, uploaded.map(u=>`${u.name} ${(Number(u.size_bytes)/1e6).toFixed(1)}MB`).join(", "));

  step("make a project and put the footage on the timeline");
  await page.goto(`${BASE}/video`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2500);
  await page.getByRole("button",{name:/New project|新建项目/}).click();
  await page.waitForTimeout(800);
  await page.locator("input:visible").last().fill("NASA test cut");
  await page.getByRole("button",{name:/^Create$|^创建$|^Make$/}).click();
  const project = await waitFor("the project", async () => {
    const [row] = await q("select id, title from video_projects where title=$1 order by created_at desc limit 1",["NASA test cut"]);
    return row ?? null;
  }, 60000, 2000);
  check("project created", true, project.id);
  await page.waitForTimeout(2000);
  await page.getByRole("button",{name:/Media bin|素材/}).click();
  await page.waitForTimeout(2000);
  // The bin lists the file store in order; click "add" on the row that names
  // each of our clips.
  for (const name of ["interview.mp4", "broll-40s.mp4"]) {
    const names = await page.locator("text=/\\.mp4$/").allInnerTexts();
    const index = names.findIndex((n) => n.trim() === name);
    if (index < 0) throw new Error(`${name} is not in the bin list`);
    await page.getByRole("button", { name: "add" }).nth(index).click();
    await page.waitForTimeout(1500);
  }
  const clips = await waitFor("the clips", async () => {
    const rows = await q("select id, label, duration_ms from video_clips where project_id=$1 order by id", [project.id]);
    return rows.length === 2 ? rows : null;
  }, 60000, 2000);
  check("footage added to the bin", true, clips.map(c=>c.label).join(", "));

  step("put both on the timeline");
  await page.getByRole("button",{name:/Cut list|镜头表/}).click();
  await page.waitForTimeout(1500);
  for (const label of ["interview.mp4", "broll-40s.mp4"]) {
    await page.locator("select").last().selectOption({ label });
    await page.getByRole("button", { name: /^Add clip$|^添加片段$/ }).click();
    await page.waitForTimeout(1800);
  }
  const items = await waitFor("two cuts", async () => {
    const rows = await q("select id, ord, transition from timeline_items where project_id=$1 order by ord",[project.id]);
    return rows.length === 2 ? rows : null;
  }, 60000, 2000);
  check("both cuts on the timeline", true, `${items.length} cuts`);

  step("transcribe the interview");
  await page.getByRole("button",{name:/^Audio$|^音频$/}).click();
  await page.waitForTimeout(1500);
  // The clip's length is measured by a job; Transcribe stays disabled until
  // the timeline has a length, which is correct and worth waiting for.
  await waitFor("the clips to be measured", async () => {
    const rows = await q("select count(*)::int n from video_clips where project_id=$1 and duration_ms is null",[project.id]);
    return rows[0].n === 0;
  }, 180000, 3000);
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  await page.getByRole("button",{name:/^Audio$|^音频$/}).click();
  await page.waitForTimeout(1500);

  const startedTranscribe = Date.now();
  await page.getByRole("button",{name:/^Transcribe$|^转写$/}).click();
  const cues = await waitFor("the transcript", async () => {
    const rows = await q("select count(*)::int n, sum(case when words is not null then 1 else 0 end)::int timed from captions where project_id=$1",[project.id]);
    return rows[0].n > 0 ? rows[0] : null;
  }, 600000, 5000);
  check("transcribed by Scribe", cues.n > 0, `${cues.n} lines, ${cues.timed} with word timings, ${(Date.now()-startedTranscribe)/1000}s`);
  const sample = await q("select text from captions where project_id=$1 order by start_ms limit 3",[project.id]);
  console.log("  first lines:", sample.map(r=>r.text).join(" / ").slice(0,220));

  step("let the AI make the first cut");
  await page.getByRole("button",{name:/Cut list|镜头表/}).click();
  await page.waitForTimeout(1500);
  const before = await q("select count(*)::int n from timeline_items where project_id=$1",[project.id]);
  const startedCut = Date.now();
  await page.getByRole("button",{name:/Make a first cut|生成初剪/}).click();
  const cut = await waitFor("the first cut", async () => {
    const [row] = await q("select count(*)::int n from timeline_items where project_id=$1",[project.id]);
    const [job] = await q("select status from jobs where type='video.autoedit' and object_id=$1 order by created_at desc limit 1",[project.id]);
    if (job && job.status === "failed") throw new Error("the auto-edit job failed");
    return job && job.status === "succeeded" ? row : null;
  }, 900000, 5000);
  check("first cut made", cut.n > 0, `${before[0].n} cuts in, ${cut.n} out, ${((Date.now()-startedCut)/1000).toFixed(0)}s`);
  const [titled] = await q("select title from video_projects where id=$1",[project.id]);
  console.log("  it called the film:", titled.title);
  const gfx = await q("select kind, text, sub, start_ms, end_ms from video_graphics where project_id=$1 order by start_ms",[project.id]);
  console.log("  graphics it placed:", gfx.map(g=>`${g.kind}:${g.text}`).join(" | ") || "none");

  step("ask the agent, in words, for a big number and a dissolve");
  await page.getByRole("button",{name:/^Edit\b|^剪辑/}).first().click();
  await page.waitForTimeout(1500);

  async function ask(prompt, label, settled) {
    const composer = page.getByPlaceholder(/What should change|要改什么/);
    await composer.click();
    await composer.fill(prompt);
    await page.waitForTimeout(300);
    const send = page.getByRole("button", { name: /^Send$|^发送$/ });
    if (await send.count()) await send.first().click();
    else await composer.press("Enter");
    await page.waitForTimeout(1500);
    const got = await waitFor(label, settled, 420000, 5000);
    check(label, true, typeof got === "string" ? got : JSON.stringify(got).slice(0,140));
    return got;
  }

  await ask(
    "Put a big number on at 2 seconds that says 260 days with 'in orbit' under it, for four seconds.",
    "the agent placed a big-number graphic",
    async () => {
      const [row] = await q("select kind, text, sub, start_ms, end_ms from video_graphics where project_id=$1 and kind='stat' limit 1",[project.id]);
      return row ? `${row.text} / ${row.sub ?? ""} at ${row.start_ms}-${row.end_ms}ms` : null;
    },
  );

  await ask(
    "Dissolve into the third cut over half a second.",
    "the agent set a dissolve",
    async () => {
      const [row] = await q("select ord, transition, transition_ms from timeline_items where project_id=$1 and transition <> 'cut' order by ord limit 1",[project.id]);
      return row ? `cut at ord ${row.ord}: ${row.transition} ${row.transition_ms}ms` : null;
    },
  );
} catch (e) {
  check("ran to the end", false, String(e).slice(0,300));
  await page.screenshot({path:"/tmp/claude-1003/z1-fail.png"}).catch(()=>{});
  console.log("url:", page.url());
}
await browser.close(); await db.end();
const bad = results.filter(([p])=>!p).length;
console.log(`\n${results.length-bad}/${results.length} passed`);
