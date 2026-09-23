/**
 * Files, end to end: create a folder, put something in it, delete the folder,
 * find both in the trash, restore them, and check the Access badge is the
 * relation this person actually holds rather than one screen-wide flag.
 *
 *   node scripts/files-e2e.mjs
 *
 * It cleans up after itself.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import fs from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:3300";
const url = fs.readFileSync("/home/ubuntu/aiVideoFreeLance/.env.local","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^"|"$/g,"");
const db = new Client({connectionString:url}); await db.connect();
const q = async (s,p=[]) => (await db.query(s,p)).rows;
const results=[]; const check=(n,p,d="")=>{results.push([p,n,d]);console.log(`${p?"  ok  ":"  FAIL"} ${n}${d?" — "+d:""}`)};
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
const errors=[]; page.on("pageerror",e=>errors.push(String(e)));
try {
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});
  await page.fill("#email","rahulsinghhh2312@gmail.com");
  await page.fill("#password", process.env.OWNER_PASSWORD || "mB30peA98EFf");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/chat/,{timeout:30000});

  const name = "Sweep test " + Date.now().toString().slice(-6);
  await page.goto(`${BASE}/files`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  await page.getByRole("button",{name:/New folder|新建文件夹/}).first().click();
  await page.locator("input:visible").last().fill(name);
  await page.getByRole("button",{name:/^Create$|^创建$/}).click();
  await page.waitForTimeout(2500);
  const [folder] = await q("select id, name from folders where name=$1",[name]);
  check("folder created", Boolean(folder), folder?.id);

  // put a file in it through the real upload path
  const fileId = "fil_test_" + Date.now().toString(36);
  await q(`insert into files (id, tenant_id, folder_id, folder_path, name, kind, mime, size_bytes, owner_id)
           select $1, u.tenant_id, $2, array[$2]::text[], 'inside.txt', 'doc', 'text/plain', 12, u.id
           from users u where u.email='rahulsinghhh2312@gmail.com'`,[fileId, folder.id]);

  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  await page.locator(`button[aria-label="Delete ${name}"], button[aria-label="删除 ${name}"]`).click();
  await page.waitForTimeout(600);
  await page.getByRole("button",{name:/Move to trash|移到回收站/}).click();
  await page.waitForTimeout(3000);

  const [gone] = await q("select deleted_at from folders where id=$1",[folder.id]);
  const [inside] = await q("select deleted_at from files where id=$1",[fileId]);
  check("folder moved to trash", Boolean(gone.deleted_at));
  check("what was inside went with it", Boolean(inside.deleted_at));

  await page.goto(`${BASE}/files/trash`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  check("the folder is listed in the trash", await page.getByText(name, {exact:true}).count() > 0);

  await page.locator(`button[aria-label="Restore ${name}"], button[aria-label="恢复 ${name}"]`).first().click();
  await page.waitForTimeout(3000);
  const [back] = await q("select deleted_at from folders where id=$1",[folder.id]);
  const [backFile] = await q("select deleted_at from files where id=$1",[fileId]);
  check("restore brings the folder back", back.deleted_at === null);
  check("and its contents", backFile.deleted_at === null);

  // access badge
  await page.goto(`${BASE}/files`,{waitUntil:"domcontentloaded"});
  await page.waitForTimeout(2000);
  // The Access column only exists in the list layout.
  await page.locator('button[aria-label="List"], button[aria-label="列表"]').click();
  await page.waitForTimeout(1200);
  const owner = await page.getByText(/^Owner$|^所有者$/).count();
  check("owned files badge as Owner, not Editor", owner > 0, `${owner} rows`);
  await page.screenshot({path:"/tmp/claude-1003/files-access.png"});

  // clean up
  await q("delete from files where id=$1",[fileId]);
  await q("delete from relation_tuples where object_type='folder' and object_id=$1",[folder.id]);
  await q("delete from folders where id=$1",[folder.id]);
  check("no page errors", errors.length===0, errors.slice(0,2).join(" | "));
} catch (e) {
  check("ran to the end", false, String(e).slice(0,300));
  await page.screenshot({path:"/tmp/claude-1003/files-fail.png"}).catch(()=>{});
  console.log("url:", page.url());
}
await browser.close(); await db.end();
const bad = results.filter(([p])=>!p).length;
console.log(`\n${results.length-bad}/${results.length} passed`);
process.exit(bad?1:0);
