/**
 * Does permission filtering hold in the *interface*?
 *
 * `npm run smoke` proves the rules at the database. This proves what a person
 * actually sees: that the rail renders only the modules someone holds, that a
 * guest's file list contains only what was named to them, and that a module
 * they lack is not reachable by typing its address.
 *
 * It builds its own people, uses them, and deletes them — the studio's own
 * accounts and content are never touched.
 *
 *   node scripts/permissions-ui.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const PASSWORD = "scratch-permissions-ui-2026";
const stamp = Date.now().toString().slice(-6);

const MEMBER = `ui-member-${stamp}@example.invalid`;
const GUEST = `ui-guest-${stamp}@example.invalid`;

const url = fs
  .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
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

function addUser(email, name, modules, role = "member") {
  execFileSync("npm", ["run", "db:add-user"], {
    env: { ...process.env, EMAIL: email, NAME: name, ROLE: role, MODULES: modules, PASSWORD },
    stdio: "pipe",
  });
}

let browser;
try {
  addUser(MEMBER, "Scratch Member", "chat,files,research");
  addUser(GUEST, "Scratch Guest", "chat,files", "guest");

  // One document, owned by the member, shared with nobody.
  const [{ id: tenantId }] = await q("select id from tenants limit 1");
  const [{ id: memberId }] = await q("select id from users where email = $1", [MEMBER]);
  const fileId = `fil_uitest${stamp}`;
  await q(
    `insert into files (id, tenant_id, name, kind, mime, size_bytes, text, owner_id, folder_path)
     values ($1, $2, $3, 'doc', 'text/markdown', 20, $4, $5, '{}')`,
    [fileId, tenantId, `member-only-${stamp}.md`, `secret ${stamp}`, memberId],
  );
  await q(
    `insert into relation_tuples (id, object_type, object_id, relation, subject_type, subject_id)
     values ($1, 'file', $2, 'owner', 'user', $3)`,
    [`tup_uitest${stamp}`, fileId, memberId],
  );

  browser = await chromium.launch();

  async function session(email) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForSelector("#email", { timeout: 30000 });
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/chat/, { timeout: 40000 }).catch(() => {});
    return { ctx, page, errors };
  }

  /** Rendered text, with stylesheets and scripts out of it. */
  const visible = (page) =>
    page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("style,script").forEach((n) => n.remove());
      return clone.innerText;
    });

  // ---- the member -------------------------------------------------------
  {
    const { ctx, page, errors } = await session(MEMBER);
    check("a member signs in", page.url().includes("/chat"), page.url());

    const rail = await page.locator('nav[aria-label] a[aria-label]').count();
    // three modules plus the avatar link
    check("the rail shows only entitled modules", rail === 4, `${rail} links`);

    await page.goto(`${BASE}/files`);
    await page.waitForTimeout(2500);
    check("the member sees their own document", (await visible(page)).includes(`member-only-${stamp}`));

    await page.goto(`${BASE}/publish`);
    await page.waitForTimeout(1500);
    check(
      "a module they do not hold is not reachable by address",
      !page.url().includes("/publish"),
      page.url(),
    );

    // Script is live, so it is worth proving the same thing about a module
    // that has real screens behind it rather than only about a design one.
    await page.goto(`${BASE}/script`);
    await page.waitForTimeout(1500);
    check(
      "a live module they do not hold is not reachable either",
      !page.url().includes("/script"),
      page.url(),
    );

    check("no page errors for the member", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }

  // ---- the guest --------------------------------------------------------
  {
    const { ctx, page, errors } = await session(GUEST);
    check("a guest signs in", page.url().includes("/chat"), page.url());

    const rail = await page.locator('nav[aria-label] a[aria-label]').count();
    check("a guest's rail is their two modules", rail === 3, `${rail} links`);

    await page.goto(`${BASE}/files`);
    await page.waitForTimeout(2500);
    const text = await visible(page);
    check("the guest does not see the member's document", !text.includes(`member-only-${stamp}`));

    await page.goto(`${BASE}/search?q=${encodeURIComponent(stamp)}`);
    await page.waitForTimeout(2500);
    check("and cannot find it by searching either", !(await visible(page)).includes(`member-only-${stamp}`));

    check("no page errors for the guest", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }
} finally {
  if (browser) await browser.close();

  // Take the scratch people and their document away again.
  await q("delete from relation_tuples where id = $1", [`tup_uitest${stamp}`]);
  await q("delete from files where id = $1", [`fil_uitest${stamp}`]);
  await q("delete from sessions where user_id in (select id from users where email in ($1, $2))", [MEMBER, GUEST]);
  await q("delete from entitlements where user_id in (select id from users where email in ($1, $2))", [MEMBER, GUEST]);
  await q("delete from audit_log where actor_id in (select id from users where email in ($1, $2))", [MEMBER, GUEST]);
  await q("delete from users where email in ($1, $2)", [MEMBER, GUEST]);

  const [{ n }] = await q("select count(*)::int n from users where email in ($1, $2)", [MEMBER, GUEST]);
  check("the test removed its own people", n === 0, `${n} left`);
  await db.end();
}

const failed = results.filter((r) => !r[0]).length;
console.log(failed ? `\n${failed} of ${results.length} FAILED\n` : `\nAll ${results.length} interface permission checks passed.\n`);
process.exit(failed ? 1 : 0);
