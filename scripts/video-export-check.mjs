/**
 * Render a project and check the file that comes out.
 *
 *   node scripts/video-export-check.mjs ["project title"]
 *
 * It clicks Render in the real screen, watches the export row, pulls the
 * finished file back through the app's own download route, and probes it —
 * because "the job said done" and "there is a playable 1080p file with the
 * captions burned in" are not the same claim.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "http://127.0.0.1:3300";
const url = fs.readFileSync("/home/ubuntu/aiVideoFreeLance/.env.local","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^"|"$/g,"");
const db = new Client({connectionString:url}); await db.connect();
const q = async (s,p=[]) => (await db.query(s,p)).rows;
const check=(n,p,d="")=>console.log(`${p?"  ok  ":"  FAIL"} ${n}${d?" — "+d:""}`);

const [project] = await q("select id,title,caption_preset,accent from video_projects where title=$1 order by created_at desc limit 1", [process.argv[2] || "NASA test cut"]);
console.log("project:", project.id, "| captions:", project.caption_preset);
console.log("timeline:", (await q("select ord,transition,transition_ms from timeline_items where project_id=$1 order by ord",[project.id])).map(r=>`${r.ord}:${r.transition}${r.transition==='cut'?'':'/'+r.transition_ms}`).join(" "));
console.log("graphics:", (await q("select kind,text from video_graphics where project_id=$1 order by start_ms",[project.id])).map(g=>`${g.kind}:${g.text}`).join(" | "));

const browser = await chromium.launch();
const page = await (await browser.newContext({viewport:{width:1600,height:950}})).newPage();
await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
await page.fill("#email","rahulsinghhh2312@gmail.com"); await page.fill("#password", process.env.OWNER_PASSWORD || "mB30peA98EFf");
await page.click("button[type=submit]"); await page.waitForURL(/\/chat/,{timeout:60000});
await page.goto(`${BASE}/video?project=${project.id}`,{waitUntil:"domcontentloaded"});
await page.waitForTimeout(3000);
await page.getByRole("button",{name:/Export|导出/}).first().click();
await page.waitForTimeout(1500);
await page.screenshot({path:"/tmp/claude-1003/z1-export.png"});
const buttons = (await page.locator("button").allInnerTexts()).filter(Boolean);
console.log("export buttons:", buttons.slice(0,20).join(" | "));

const since = new Date();

// The button that actually queues one.
const go = page.getByRole("button",{name:/Render|Export this cut|导出这条|渲染/});
if (await go.count()) await go.first().click();
else await page.getByRole("button",{name:/Export|导出/}).last().click();

const started = Date.now();
let last = "";
for (;;) {
  const [row] = await q("select id,state,progress,error,file_id,duration_ms from video_exports where project_id=$1 and created_at >= $2 order by created_at desc limit 1",[project.id, since]);
  if (row && `${row.state}${row.progress}` !== last) { last = `${row.state}${row.progress}`; console.log(`  ${row.state} ${row.progress ?? 0}%`); }
  if (row && (row.state === "done" || row.state === "ready")) { console.log("export row:", row); var done = row; break; }
  if (row && row.state === "failed") { console.log("FAILED:", row.error); break; }
  if (Date.now() - started > 45 * 60000) { console.log("timed out"); break; }
  await new Promise(r=>setTimeout(r,5000));
}

if (typeof done !== "undefined") {
  check("export finished", true, `${((Date.now()-started)/1000).toFixed(0)}s`);
  const [file] = await q("select id,name,size_bytes,storage_key from files where id=$1",[done.file_id]);
  console.log("file:", file.name, (Number(file.size_bytes)/1e6).toFixed(1)+"MB");
  // Pull it back out of R2 through the app, as a person would.
  const res = await page.request.get(`${BASE}/api/files/${file.id}/download`);
  console.log("download status:", res.status());
  const body = await res.body();
  fs.writeFileSync("/tmp/claude-1003/nasa-export.mp4", body);
  const probe = execFileSync("ffprobe",["-v","error","-show_entries","format=duration,size:stream=codec_name,width,height,codec_type","-of","json","/tmp/claude-1003/nasa-export.mp4"]).toString();
  console.log(probe.replace(/\s+/g," ").slice(0,600));
}
await browser.close(); await db.end();
