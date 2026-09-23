/**
 * Two-step verification, end to end.
 *
 *   node scripts/twofa-e2e.mjs            (against http://127.0.0.1:3300)
 *   BASE=https://yt.okbro.xyz node scripts/twofa-e2e.mjs
 *
 * It enrols the owner's real account, signs in with real codes, and turns it
 * off again — so it leaves the account exactly as it found it, with 2FA off.
 * Run it after anything that touches sign-in: enrol in Settings, sign out, sign in
 * with a real TOTP code, and prove a wrong code, a replayed code and a
 * recovery code all behave.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import fs from "node:fs";
import { createHmac } from "node:crypto";

const BASE = process.env.BASE || "http://127.0.0.1:3300";
const EMAIL = "rahulsinghhh2312@gmail.com";
const PASSWORD = process.env.OWNER_PASSWORD || "mB30peA98EFf";

const url = fs.readFileSync("/home/ubuntu/aiVideoFreeLance/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^"|"$/g, "");
const db = new Client({ connectionString: url });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32d(t) {
  let bits = 0, value = 0; const out = [];
  for (const c of t.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(c); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function code(secret, step) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", b32d(secret)).update(c).digest();
  const o = mac[mac.length - 1] & 15;
  const n = ((mac[o] & 127) << 24) | ((mac[o+1] & 255) << 16) | ((mac[o+2] & 255) << 8) | (mac[o+3] & 255);
  return String(n % 1e6).padStart(6, "0");
}
const step = () => Math.floor(Date.now() / 30000);

const results = [];
const check = (name, pass, detail = "") => { results.push([pass, name, detail]); console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function signInPassword(p = page) {
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.fill("#email", EMAIL);
  await p.fill("#password", PASSWORD);
  await p.click('button[type=submit]');
}

try {
  // ---- start clean
  await q("update users set totp_secret=null, totp_confirmed_at=null, totp_last_step=null, totp_recovery=null where email=$1", [EMAIL]);
  await q("delete from trusted_devices where user_id = (select id from users where email=$1)", [EMAIL]);

  await signInPassword();
  await page.waitForURL(/\/chat/, { timeout: 30000 });
  check("password sign-in still works with 2FA off", true);

  // ---- enrol
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Set this up|开始设置/ }).click();
  await page.waitForSelector("svg[viewBox]", { timeout: 20000 });
  const secret = (await page.locator("code").first().innerText()).trim();
  check("QR + typed key shown", /^[A-Z2-7]{32}$/.test(secret), secret.slice(0, 8) + "…");

  const [before] = await q("select totp_confirmed_at from users where email=$1", [EMAIL]);
  check("account not protected until a code is typed", before.totp_confirmed_at === null);

  await page.fill('input[name=code]', "000000");
  await page.getByRole("button", { name: /Turn it on|开启/ }).click();
  await page.waitForSelector("[role=alert]", { timeout: 15000 });
  check("a wrong code is refused at enrolment", true, (await page.locator("[role=alert]").first().innerText()).slice(0, 60));

  await page.fill('input[name=code]', code(secret, step()));
  await page.getByRole("button", { name: /Turn it on|开启/ }).click();
  await page.waitForSelector("li:has-text('-')", { timeout: 20000 });
  const codes = await page.locator("ul.grid li").allInnerTexts();
  check("ten recovery codes shown once", codes.length === 10, codes[0]);

  const [after] = await q("select totp_confirmed_at, totp_secret, totp_recovery from users where email=$1", [EMAIL]);
  check("2FA on in the database", Boolean(after.totp_confirmed_at));
  check("secret stored sealed, not base32", after.totp_secret.startsWith("v1.") && !after.totp_secret.includes(secret));
  check("recovery codes stored hashed", Array.isArray(after.totp_recovery) && after.totp_recovery.length === 10 && !after.totp_recovery.includes(codes[0]));

  // ---- sign out, then sign in with the second factor
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Sign out|退出登录|登出/ }).first().click().catch(() => {});
  await page.context().clearCookies();

  await signInPassword();
  await page.waitForURL(/\/login\/verify/, { timeout: 30000 });
  check("password alone now stops at the code screen", true);

  // a wrong code
  await page.fill('input[name=code]', "123456");
  await page.getByRole("button", { name: /^Verify$|^验证$/ }).click();
  await page.waitForSelector("[role=alert]", { timeout: 20000 });
  check("a wrong code is refused at sign-in", page.url().includes("/login/verify"));

  // the real one, with "trust this browser" left on
  /* The code used to confirm enrolment is spent, so a sign-in inside the same
     30-second step legitimately has nothing valid to type. Wait for the step
     to turn over — which is also what the screen's countdown is telling a
     person to do. */
  const first = step();
  while (step() === first) await page.waitForTimeout(500);
  const used = code(secret, step());
  await page.fill('input[name=code]', used);
  await page.waitForURL(/\/chat/, { timeout: 30000 });
  check("the right code signs in (auto-submits on the 6th digit)", true);

  const trusted = await q("select label, ip from trusted_devices where user_id=(select id from users where email=$1)", [EMAIL]);
  check("browser remembered for 30 days", trusted.length === 1, trusted[0]?.label ?? "");

  // ---- replay the same code in a different browser
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInPassword(page2);
  await page2.waitForURL(/\/login\/verify/, { timeout: 30000 });
  check("a second browser is not trusted", true);
  await page2.fill('input[name=code]', used);
  await page2.waitForTimeout(3500);
  check("a code cannot be used twice", page2.url().includes("/login/verify"), page2.url());

  // ---- recovery code works there
  await page2.getByRole("button", { name: /Use a recovery code|使用恢复码/ }).click();
  await page2.fill('input[name=code]', codes[0]);
  await page2.getByRole("button", { name: /^Verify$|^验证$/ }).click();
  await page2.waitForURL(/\/chat/, { timeout: 30000 });
  check("a recovery code signs in", true, codes[0]);

  const [left] = await q("select totp_recovery from users where email=$1", [EMAIL]);
  check("the used recovery code is spent", left.totp_recovery.length === 9);
  const trusted2 = await q("select count(*)::int n from trusted_devices where user_id=(select id from users where email=$1)", [EMAIL]);
  check("a recovery sign-in does not trust the browser", trusted2[0].n === 1);

  // ---- the trusted browser skips the code
  await page.context().clearCookies({ name: "af_session" });
  await signInPassword();
  await page.waitForURL(/\/chat/, { timeout: 30000 });
  check("the trusted browser skips the code", true);

  // ---- turn it off again
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Turn two-step verification off|关闭两步验证/ }).click();
  await page.fill('input[name=password]', "wrong-password-here");
  await page.getByRole("button", { name: /^Turn off$|^关闭$/ }).click();
  await page.waitForSelector("[role=alert]", { timeout: 15000 });
  const [still] = await q("select totp_confirmed_at from users where email=$1", [EMAIL]);
  check("turning it off needs the real password", Boolean(still.totp_confirmed_at));

  /* The card clears the field when the password was wrong, and the clear can
     land after a fill — so type it until React has really got it. */
  const offButton = page.getByRole("button", { name: /^Turn off$|^关闭$/ });
  for (let i = 0; i < 10; i++) {
    await page.fill('input[name=password]', PASSWORD);
    await page.waitForTimeout(300);
    if (await offButton.isEnabled()) break;
  }
  await offButton.click();
  await page.waitForTimeout(3000);
  const [gone] = await q("select totp_confirmed_at, totp_secret, totp_recovery from users where email=$1", [EMAIL]);
  const devs = await q("select count(*)::int n from trusted_devices where user_id=(select id from users where email=$1)", [EMAIL]);
  check("off clears the seed, the codes and every trusted browser",
    !gone.totp_confirmed_at && !gone.totp_secret && !gone.totp_recovery && devs[0].n === 0);

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (err) {
  check("ran to the end", false, String(err).slice(0, 300));
  await page.screenshot({ path: "/tmp/claude-1003/twofa-fail.png" }).catch(() => {});
  console.log("url:", page.url());
}

await browser.close();
await db.end();
const bad = results.filter(([p]) => !p).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
