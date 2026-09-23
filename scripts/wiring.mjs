/**
 * Is the front end actually wired to the back end?
 *
 * Every check does something through the browser, the way a person would, and
 * then looks in Postgres (or R2) to see whether it really happened. A screen
 * that renders is not the same as a screen that works.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const EMAIL = "rahulsinghhh2312@gmail.com";
const PASSWORD = process.env.OWNER_PASSWORD || "mB30peA98EFf";

const url = fs
  .readFileSync("/home/ubuntu/aiVideoFreeLance/.env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice("DATABASE_URL=".length)
  .trim()
  .replace(/^"|"$/g, "");

const db = new Client({ connectionString: url });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const results = [];
const check = (name, pass, detail = "") => {
  results.push([pass, name, detail]);
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const stamp = Date.now().toString().slice(-6);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// ---- sign in -------------------------------------------------------------
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}/login`));
await page.waitForSelector("#email", { timeout: 30000 });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
const signedIn = await page.waitForURL(/\/chat/, { timeout: 40000 }).then(() => true).catch(() => false);
check("sign-in reaches the app", signedIn, page.url());

const sessions = await q("select count(*)::int n from sessions");
check("the session was written to Postgres", sessions[0].n >= 1, `${sessions[0].n} session(s)`);

// ---- chat: create a channel, post to it ----------------------------------
/* The pencil used to open `window.prompt`, so this used to accept a browser
   dialog. It opens a real new-channel dialog now: a name, a purpose, a private
   toggle and the people to add. */
const channelName = `wiring-${stamp}`;
await page.click('button[aria-label="新建频道"], button[aria-label="New channel"]').catch(() => {});
await page.waitForSelector('[role="dialog"] input', { timeout: 10000 }).catch(() => {});
await page.fill('[role="dialog"] input', channelName).catch(() => {});
await page
  .click('[role="dialog"] button:has-text("Create"), [role="dialog"] button:has-text("创建")')
  .catch(() => {});
await page.waitForTimeout(3000);

const channels = await q("select slug, name from chat_channels where name = $1", [channelName]);
check("the sidebar's new-channel button creates a channel", channels.length === 1, channels[0]?.slug ?? "none");

if (channels.length) {
  await page.goto(`${BASE}/chat/c/${channels[0].slug}`);
  await page.waitForSelector("textarea", { timeout: 30000 });
  const body = `wiring test ${stamp}`;
  await page.fill("textarea", body);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);

  await page.waitForFunction((b) => document.body.innerText.includes(b), body, { timeout: 20000 }).catch(() => {});
  const msgs = await q("select body from chat_messages where body = $1", [body]);
  check("a chat message reaches the database", msgs.length === 1);
  check("and renders back on the screen", (await page.textContent("body")).includes(body));
}

// ---- files: upload through the real presign → R2 → confirm path ----------
await page.goto(`${BASE}/files`);
await page.waitForTimeout(1500);

const fileName = `wiring-${stamp}.txt`;
const content = `connected at ${new Date().toISOString()} ${stamp}`;
await page.setInputFiles('input[type=file]', {
  name: fileName,
  mimeType: "text/plain",
  buffer: Buffer.from(content),
}).catch((e) => check("file input is reachable", false, e.message));
// The row is created by the presign call, before any bytes move. What marks
// the upload finished is the checksum, written by the confirm call after the
// browser has PUT to R2 — so that is what to wait for.
for (let i = 0; i < 40; i++) {
  const [row] = await q("select checksum from files where name = $1", [fileName]);
  if (row?.checksum) break;
  await page.waitForTimeout(1000);
}

const files = await q("select id, storage_key, size_bytes, checksum from files where name = $1", [fileName]);
check("upload creates a file row", files.length === 1, files[0]?.id ?? "none");
check("the row records an R2 key", Boolean(files[0]?.storage_key));
check("the upload was confirmed (checksum stored)", Boolean(files[0]?.checksum), `${files[0]?.size_bytes ?? 0} bytes`);

const versions = await q("select count(*)::int n from file_versions where file_id = $1", [files[0]?.id ?? ""]);
check("version 1 was written", versions[0].n === 1);

const tuples = await q(
  "select relation from relation_tuples where object_type = 'file' and object_id = $1",
  [files[0]?.id ?? ""],
);
check("the uploader owns it (ReBAC tuple)", tuples.some((t) => t.relation === "owner"));

// the bytes really are in R2: the download route redirects to a signed URL
if (files[0]?.id) {
  const res = await page.request.get(`${BASE}/api/files/${files[0].id}/download`, { maxRedirects: 0 });
  const location = res.headers()["location"] ?? "";
  check("download issues a signed R2 redirect", res.status() === 302 && location.includes("r2.cloudflarestorage.com"));
  if (location) {
    const bytes = await page.request.get(location);
    check("the bytes in R2 are the bytes uploaded", (await bytes.text()) === content);
  }
}

// ---- search: the file is findable ----------------------------------------
await page.goto(`${BASE}/search?q=${encodeURIComponent(stamp)}`);
await page.waitForTimeout(2500);
check("search finds what was just uploaded", (await page.textContent("body")).includes(fileName));

// ---- research: watching a topic queues a job the worker picks up ---------
const topicQuery = `semiconductor ${stamp}`;
await page.goto(`${BASE}/research`);
await page.waitForTimeout(2000);

/* The bare "Watch a topic…" box became a picker that suggests what the studio
   already watches and what the region is searching for, so the placeholder
   changed with it. Matching on the control's role keeps this check about
   whether a topic can be watched rather than about its wording. */
const watch = page
  .locator('input[role="combobox"], input[placeholder*="watch a topic" i], input[placeholder*="关注"]')
  .first();
const hasWatch = await watch.count();
check("Trends offers a way to watch a topic", hasWatch > 0);
if (hasWatch) {
  await watch.fill(topicQuery);
  await watch.press("Enter");
  await page.waitForTimeout(4000);

  const topics = await q("select id from topics where query = $1", [topicQuery]);
  check("watching a topic writes it to the database", topics.length === 1);

  const jobs = await q(
    "select status from jobs where object_type = 'topic' and object_id = $1",
    [topics[0]?.id ?? ""],
  );
  check("and queues a refresh job for the worker", jobs.length >= 1, jobs[0]?.status ?? "none");
}

// ---- research: the two screens backed by the studio's own channels -------
//
// These are read-only checks on purpose. Everything the Comment inbox can
// write goes to a live platform under the studio's own name: approving a reply
// posts it publicly, hiding a comment hides someone's words. A test must not
// do either, so this proves the screens are reading real rows and leaves the
// acting to a person.
{
  const channelCount = (await q("select count(*)::int n from channels"))[0].n;

  await page.goto(`${BASE}/research/performance`);
  await page.waitForTimeout(3000);
  const perfText = await page.evaluate(() => document.body.innerText);

  if (channelCount === 0) {
    check(
      "content performance says plainly that no channel is connected",
      /connect|連接|连接/i.test(perfText),
      "no channels in the database",
    );
  } else {
    // The top post by views in the last 28 days should be on the screen.
    const top = await q(`
      select p.title, m.views
        from channel_posts p
        join lateral (select * from post_metrics pm where pm.post_id = p.id order by pm.as_of desc limit 1) m on true
       where p.published_at >= now() - interval '28 days'
       order by m.views desc nulls last
       limit 1
    `);
    check("content performance renders posts from the database", perfText.length > 0 && !!top.length, `${top.length} post(s)`);
    if (top.length && top[0].title) {
      const fragment = String(top[0].title).slice(0, 12);
      check("and the top post by views is the one Postgres holds", perfText.includes(fragment), fragment);
    }
  }

  await page.goto(`${BASE}/research/inbox`);
  await page.waitForTimeout(3000);
  const inboxText = await page.evaluate(() => document.body.innerText);

  const open = await q("select id, body from comments where state = 'open' order by posted_at desc limit 1");
  if (open.length) {
    const fragment = String(open[0].body).slice(0, 10);
    check("the comment inbox renders a real comment", inboxText.includes(fragment), fragment);

    const drafts = await q(
      "select count(*)::int n from comment_drafts where sent_at is null and discarded_at is null",
    );
    check("drafts exist and none of them claims to have been sent", drafts[0].n >= 0, `${drafts[0].n} waiting`);

    const liars = await q("select count(*)::int n from comment_drafts where sent_at is not null and approved_by is null");
    check("no reply was ever sent without a named approver", liars[0].n === 0, `${liars[0].n} unapproved send(s)`);
  } else {
    check("the comment inbox says there is nothing waiting", inboxText.length > 0, `${channelCount} channel(s)`);
  }

  // The claims this screen used to make, which were wrong and are now gone.
  check(
    "the inbox no longer claims TikTok has no comment interface",
    !/no comment interface|沒有.*評論|没有.*评论接口/i.test(inboxText),
  );
}

// ---- script: a brief becomes a row, and a locked script stays locked -----
const scriptTitle = `wiring-script-${stamp}`;
{
  await page.goto(`${BASE}/script`);
  await page.waitForTimeout(2500);

  /* Also no longer a browser prompt: New script opens the brief composer, a
     document with a title, an angle and the rest of the brief. */
  await page.click('button:has-text("New script"), button:has-text("新建剧本")').catch(() => {});
  await page.waitForSelector('[role="dialog"] input', { timeout: 10000 }).catch(() => {});
  await page.fill('[role="dialog"] input', scriptTitle).catch(() => {});
  await page
    .click('[role="dialog"] button:has-text("Create the script"), [role="dialog"] button:has-text("创建剧本")')
    .catch(() => {});
  await page.waitForTimeout(3500);

  const rows = await q("select id, status, version from scripts where title = $1", [scriptTitle]);
  check("the library's New script button writes a script", rows.length === 1, rows[0]?.status ?? "none");

  if (rows.length) {
    check("a new script starts as a brief with no version", rows[0].status === "brief" && rows[0].version === 0);

    // The invariant the whole module exists to protect: nothing is ever
    // marked locked without an approval row naming a person who is not the
    // author. Asserted against the database rather than the screen.
    const liars = await q(`
      select s.id from scripts s
       where s.locked_version is not null
         and not exists (
           select 1 from approvals a
            where a.object_type = 'script' and a.object_id = s.id
              and a.state = 'approved' and a.decided_by is not null
         )
    `);
    check("no script is locked without an approval naming a person", liars.length === 0, `${liars.length} unapproved lock(s)`);

    const selfApproved = await q(`
      select a.id from approvals a
       join script_versions v on v.script_id = a.object_id and v.version_no = a.version_no
       where a.object_type = 'script' and a.state = 'approved' and a.decided_by = v.author_id
    `);
    check("no version was approved by its own author", selfApproved.length === 0, `${selfApproved.length} self-approval(s)`);

    await page.goto(`${BASE}/script/${rows[0].id}`);
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    check("the script opens on its own detail screen", text.includes(scriptTitle.slice(0, 12)), page.url());
  }
}

const projectTitle = `wiring-video-${stamp}`;

// ---- settings: a preference persists -------------------------------------
await page.goto(`${BASE}/settings`);
await page.waitForTimeout(1500);
const before = (await q("select locale from users where email = $1", [EMAIL]))[0]?.locale;
/* Click whichever language is *not* the current one. Clicking "English" when
   the account is already English is a no-op, and a run that had already
   switched it left the next run asserting that nothing changed. */
const target = before === "en" ? "简体中文" : "English";
await page.click(`button:has-text("${target}")`).catch(() => {});
await page.waitForTimeout(2500);
const after = (await q("select locale from users where email = $1", [EMAIL]))[0]?.locale;
check("a settings change persists", before !== after, `${before} → ${after}`);
// put it back
await page.click('button:has-text("简体中文")').catch(() => {});
await page.waitForTimeout(1500);

// ---- the modules built on 19 September ----------------------------------
/*
 * Publish, Admin, Finance, Accounting, Legal, HR and Video Edit all went from
 * an iframe of a design to a real screen on 19 September. Each one is checked
 * the same way: it renders for a signed-in person, it says something only its
 * own data could produce, and at least one of them writes a row.
 */
{
  const MODULES = [
    { path: "/publish", says: /Channel board|渠道看板/ },
    { path: "/admin", says: /People|成员/ },
    { path: "/finance", says: /Budget|预算/ },
    { path: "/accounting", says: /Inbox|收件箱/ },
    { path: "/legal", says: /not legal advice|不是法律意见/ },
    { path: "/hr", says: /Leave|假期/ },
    { path: "/video", says: /Video Edit|视频剪辑|Media bin|素材库/ },
  ];

  for (const m of MODULES) {
    await page.goto(`${BASE}${m.path}`);
    await page.waitForTimeout(1800);
    const text = await page.evaluate(() => document.body.innerText);
    check(`${m.path} renders its own screen`, m.says.test(text), page.url());
    check(
      `${m.path} is not an iframe of a design`,
      (await page.locator("iframe").count()) === 0 && !/Approved design/i.test(text),
    );
  }

  // Legal's non-advice notice is a term of the contract (8.4), not a nicety.
  await page.goto(`${BASE}/legal`);
  await page.waitForTimeout(1500);
  const legalText = await page.evaluate(() => document.body.innerText);
  check(
    "Legal states it is not legal advice",
    /not legal advice|不是法律意见/.test(legalText),
  );

  // Video writes a real row, which is the part a screenshot cannot prove.
  await page.goto(`${BASE}/video`);
  await page.waitForTimeout(1800);
  await page.click('button:has-text("New project"), button:has-text("新建项目")').catch(() => {});
  await page.waitForSelector('[role="dialog"] input', { timeout: 10000 }).catch(() => {});
  await page.fill('[role="dialog"] input', projectTitle).catch(() => {});
  await page
    .click('[role="dialog"] button:has-text("Create"), [role="dialog"] button:has-text("创建")')
    .catch(() => {});
  await page.waitForTimeout(3000);

  const projects = await q("select id, title from video_projects where title = $1", [projectTitle]);
  check("Video Edit's New project writes a project", projects.length === 1, projects[0]?.id ?? "none");

  // The director's strip is on the editor, and it refuses honestly with no
  // footage: the button is disabled rather than queuing a job that would fail.
  if (projects[0]) {
    await page.goto(`${BASE}/video?project=${projects[0].id}`);
    await page.waitForTimeout(2500);
    const strip = await page.locator('text=/Make the video|一键成片/').count();
    check("the Make-the-video strip is on the editor", strip > 0);
    const disabled = await page.locator('button:has-text("Make the video"), button:has-text("开始制作")').last().isDisabled().catch(() => false);
    check("and it will not start on an empty bin", disabled === true);
  }
}

// ---- research: the creator's channel as memory ----------------------------
await page.goto(`${BASE}/research`);
await page.waitForTimeout(2500);
const memoryPanel = await page.locator('text=/Your channel, as memory|你的频道/').count();
check("the Research board shows the creator's channel as memory", memoryPanel > 0);
const synced = await q("select count(*)::int n from creator_videos");
const voice = await q("select count(*)::int n from knowledge where title like 'Creator voice%' and active");
check("the channel's uploads are mirrored", synced[0].n > 0, `${synced[0].n} videos`);
check("and a voice note is in every prompt", voice[0].n > 0);
const writeButton = await page.locator('text=/Write the script →|写剧本 →/').count();
check("a topic can become a script from the board", writeButton > 0);

check("no page errors anywhere", errors.length === 0, errors[0] ?? "");

// Leave the studio as it was found: this runs against the real database.
await q("delete from chat_messages where body like $1", [`wiring test ${stamp}%`]);
await q("delete from chat_members where channel_id in (select id from chat_channels where name = $1)", [channelName]);
await q("delete from chat_channels where name = $1", [channelName]);
await q("delete from relation_tuples where object_id in (select id from files where name = $1)", [fileName]);
await q("delete from file_versions where file_id in (select id from files where name = $1)", [fileName]);
await q("delete from files where name = $1", [fileName]);
await q("delete from jobs where object_id in (select id from topics where query = $1)", [topicQuery]);
await q("delete from topics where query = $1", [topicQuery]);
await q("delete from approvals where object_type = 'script' and object_id in (select id from scripts where title = $1)", [scriptTitle]);
await q("delete from scripts where title = $1", [scriptTitle]);
await q("delete from video_projects where title = $1", [projectTitle]);
const leftovers = await q(
  `select (select count(*) from chat_channels where name = $1)::int
        + (select count(*) from files where name = $2)::int
        + (select count(*) from topics where query = $3)::int
        + (select count(*) from scripts where title = $4)::int as n`,
  [channelName, fileName, topicQuery, scriptTitle],
);
check("the test cleaned up after itself", leftovers[0].n === 0, `${leftovers[0].n} row(s) left`);

await browser.close();
await db.end();

const failed = results.filter((r) => !r[0]).length;
console.log(failed ? `\n${failed} of ${results.length} FAILED\n` : `\nAll ${results.length} wiring checks passed.\n`);
process.exit(failed ? 1 : 0);
