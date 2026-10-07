import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings, users } from "@/lib/db/schema";

/**
 * API keys the studio changes itself, from 员工管理 › 渠道与凭据 (6 Oct: the
 * OpenRouter credit ran out and a new key had to be put in by hand on the
 * server). A key saved there is kept encrypted in `settings` and wins over
 * the one in .env.local; every process (the site, the worker, the scheduled
 * jobs) reads the saved keys at start and again every 30 seconds, so a
 * change needs no deploy. Keys are never shown again once saved, not even in
 * part (spec §8): the screen says whether one is set, where it comes from,
 * and whether the provider accepted it.
 */

export type KeyName =
  | "OPENROUTER_API_KEY"
  | "OPENROUTER_API_KEY_CLAUDE"
  | "DEEPSEEK_API_KEY"
  | "TIKHUB_TOKEN"
  | "ZERNIO_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "RESEND_API_KEY"
  | "YOUTUBE_API_KEY"
  | "PEXELS_API_KEY"
  | "UNSPLASH_ACCESS_KEY"
  | "FAL_KEY";

export const KEYS: { name: KeyName; zh: string; en: string; usesZh: string; uses: string; link: string }[] = [
  { name: "OPENROUTER_API_KEY", zh: "OpenRouter（AI 模型）", en: "OpenRouter (AI models)", usesZh: "所有 AI 同事、助理、写稿和改稿", uses: "Every AI colleague, the assistant, drafting and edits", link: "https://openrouter.ai/settings/keys" },
  { name: "OPENROUTER_API_KEY_CLAUDE", zh: "OpenRouter（Claude 专用，选填）", en: "OpenRouter for Claude (optional)", usesZh: "Claude、GPT、Gemini 只走这个密钥。它们不接受香港注册的 OpenRouter 账号，所以要用另一个（非香港注册）账号的密钥", uses: "Claude, GPT and Gemini only; they refuse Hong Kong-registered OpenRouter accounts, so this must come from another account", link: "https://openrouter.ai/settings/keys" },
  { name: "DEEPSEEK_API_KEY", zh: "DeepSeek（备用模型）", en: "DeepSeek (backup models)", usesZh: "直接调用 DeepSeek 的模型", uses: "Calling DeepSeek directly", link: "https://platform.deepseek.com/api_keys" },
  { name: "TIKHUB_TOKEN", zh: "TikHub（抖音、小红书等数据）", en: "TikHub (Douyin, Xiaohongshu data)", usesZh: "选题调研、别人的频道数据、视频号作品", uses: "Topic research and other channels' data", link: "https://user.tikhub.io/dashboard/api" },
  { name: "ZERNIO_API_KEY", zh: "Zernio（发布和自有频道）", en: "Zernio (publishing)", usesZh: "发布到各平台、评论收件箱、自有频道数据", uses: "Publishing, the comment inbox, own channel numbers", link: "https://zernio.com" },
  { name: "ELEVENLABS_API_KEY", zh: "ElevenLabs（配音音色库）", en: "ElevenLabs (voice library)", usesZh: "从 ElevenLabs 音色库选的配音", uses: "Voice-overs picked from the ElevenLabs library", link: "https://elevenlabs.io/app/settings/api-keys" },
  { name: "RESEND_API_KEY", zh: "Resend（邮件）", en: "Resend (email)", usesZh: "邀请邮件、登录验证邮件", uses: "Invitation and sign-in emails", link: "https://resend.com/api-keys" },
  { name: "YOUTUBE_API_KEY", zh: "YouTube 数据", en: "YouTube data", usesZh: "读取 YouTube 频道和视频数据", uses: "Reading YouTube channels and videos", link: "https://console.cloud.google.com/apis/credentials" },
  { name: "PEXELS_API_KEY", zh: "Pexels（素材）", en: "Pexels (stock)", usesZh: "剪辑时自动找的免费视频和图片素材", uses: "Free stock footage found while editing", link: "https://www.pexels.com/api/" },
  { name: "FAL_KEY", zh: "fal.ai（AI 生成视频）", en: "fal.ai (AI video)", usesZh: "「配音和生成」里的 AI 生成视频：可灵、海螺、即梦", uses: "AI video in Voice & video: Kling, Hailuo, Seedance", link: "https://fal.ai/dashboard/keys" },
  { name: "UNSPLASH_ACCESS_KEY", zh: "Unsplash（图片素材）", en: "Unsplash (photos)", usesZh: "剪辑时自动找的图片素材", uses: "Stock photos found while editing", link: "https://unsplash.com/oauth/applications" },
];

export const isKeyName = (v: unknown): v is KeyName => typeof v === "string" && KEYS.some((k) => k.name === v);

const PREFIX = "apikey:";
const ALIASES: Partial<Record<KeyName, string[]>> = { TIKHUB_TOKEN: ["TICKHUB_TOKEN"] };

/* The value .env.local gave each key, kept before any saved key replaces it, so 恢复 can put it back. */
const fromFile = new Map<string, string | undefined>();
const remember = (name: string) => {
  if (!fromFile.has(name)) fromFile.set(name, process.env[name]);
};

function cipherKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  return secret ? createHash("sha256").update(`tengya-api-keys:${secret}`).digest() : null;
}

function seal(value: string): string {
  const key = cipherKey();
  if (!key) throw new Error("服务器缺少 SESSION_SECRET，不能保存密钥");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

function open(sealed: string): string | null {
  const key = cipherKey();
  if (!key) return null;
  try {
    const raw = Buffer.from(sealed, "base64");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

type Stored = { v: string; at: string; by: string | null; ok?: string | null };

function setEnv(name: KeyName, value: string | undefined) {
  for (const n of [name, ...(ALIASES[name] ?? [])]) {
    remember(n);
    if (value === undefined) {
      const was = fromFile.get(n);
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    } else process.env[n] = value;
  }
}

let last = 0;
let running: Promise<void> | null = null;

/** Read the saved keys into this process. Cheap to call often: at most one database read per 30 seconds. */
export function ensureKeys(force = false): Promise<void> {
  if (!force && Date.now() - last < 30_000) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    try {
      const rows = await db.select({ key: settings.key, value: settings.value }).from(settings).where(like(settings.key, `${PREFIX}%`));
      const saved = new Map<KeyName, string>();
      for (const r of rows) {
        const name = r.key.slice(PREFIX.length);
        const v = open((r.value as Stored | null)?.v ?? "");
        if (isKeyName(name) && v) saved.set(name, v);
      }
      for (const k of KEYS) setEnv(k.name, saved.get(k.name));
      last = Date.now();
    } catch (err) {
      /* The database is the one thing a key cannot fix: keep what this process has. */
      console.error("[keys] could not read saved keys", err instanceof Error ? err.message : err);
      last = Date.now() - 20_000;
    } finally {
      running = null;
    }
  })();
  return running;
}

let started = false;
/** Keep this process's keys current: now, then every 30 seconds. */
export function startKeySync() {
  if (started) return;
  started = true;
  void ensureKeys(true);
  const t = setInterval(() => void ensureKeys(), 30_000);
  t.unref?.();
}

/** Ask the provider whether the key works, and what is left on it where it says. */
export async function testKey(name: KeyName, value: string): Promise<{ ok: boolean; note: string }> {
  const get = async (url: string, headers: Record<string, string>) => {
    const r = await fetch(url, { headers: { "user-agent": "Tengya/1.0", ...headers }, signal: AbortSignal.timeout(15_000) });
    return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  };
  try {
    switch (name) {
      case "OPENROUTER_API_KEY": {
        const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
        const k = await get(`${base}/key`, { authorization: `Bearer ${value}` });
        if (k.status !== 200) return { ok: false, note: "OpenRouter 不认这个密钥（可能抄错了，或已被删除）" };
        const c = await get(`${base}/credits`, { authorization: `Bearer ${value}` });
        const d = (c.body as { data?: { total_credits?: number; total_usage?: number } } | null)?.data;
        const left = d ? (d.total_credits ?? 0) - (d.total_usage ?? 0) : null;
        const cap = (k.body as { data?: { limit_remaining?: number | null } } | null)?.data?.limit_remaining;
        if (left !== null && left <= 0.05) return { ok: false, note: `密钥有效，但账户余额只剩 US$ ${left.toFixed(2)}，先去 OpenRouter 充值` };
        return { ok: true, note: `有效 · 账户余额 US$ ${left !== null ? left.toFixed(2) : "—"}${typeof cap === "number" ? ` · 这个密钥还能用 US$ ${cap.toFixed(2)}` : ""}` };
      }
      case "OPENROUTER_API_KEY_CLAUDE": {
        const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
        const r = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${value}`, "content-type": "application/json", "user-agent": "Tengya/1.0" },
          body: JSON.stringify({ model: "anthropic/claude-sonnet-5.5", max_tokens: 16, messages: [{ role: "user", content: "ok" }] }),
          signal: AbortSignal.timeout(30_000),
        });
        if (r.ok) return { ok: true, note: "有效 · Claude 可以用" };
        const t = await r.text().catch(() => "");
        if (r.status === 401) return { ok: false, note: "OpenRouter 不认这个密钥" };
        if (r.status === 402) return { ok: false, note: "这个账号余额不足，先充值" };
        if (r.status === 403) return { ok: false, note: "这个账号也被 Claude 拒绝（多半也是香港注册的），需要换一个账号的密钥" };
        return { ok: false, note: `没通过：${t.slice(0, 80)}` };
      }
      case "DEEPSEEK_API_KEY": {
        const r = await get("https://api.deepseek.com/user/balance", { authorization: `Bearer ${value}` });
        if (r.status !== 200) return { ok: false, note: "DeepSeek 不认这个密钥" };
        const b = (r.body as { balance_infos?: { total_balance?: string; currency?: string }[] } | null)?.balance_infos?.[0];
        return { ok: true, note: `有效${b ? ` · 余额 ${b.total_balance} ${b.currency}` : ""}` };
      }
      case "TIKHUB_TOKEN": {
        const base = process.env.TIKHUB_BASE_URL || "https://api.tikhub.io";
        const r = await get(`${base}/api/v1/tikhub/user/get_user_info`, { authorization: `Bearer ${value}` });
        if (r.status !== 200) return { ok: false, note: "TikHub 不认这个密钥" };
        const bal = (r.body as { user_data?: { balance?: number } } | null)?.user_data?.balance;
        return { ok: true, note: `有效${typeof bal === "number" ? ` · 余额 US$ ${bal.toFixed(2)}` : ""}` };
      }
      case "ZERNIO_API_KEY": {
        const base = process.env.ZERNIO_BASE_URL || "https://api.zernio.com/v1";
        const r = await get(`${base}/accounts`, { authorization: `Bearer ${value}` });
        return r.status === 200 ? { ok: true, note: "有效" } : { ok: false, note: "Zernio 不认这个密钥" };
      }
      case "RESEND_API_KEY": {
        const r = await get("https://api.resend.com/domains", { authorization: `Bearer ${value}` });
        return r.status === 200 ? { ok: true, note: "有效" } : { ok: false, note: "Resend 不认这个密钥" };
      }
      case "YOUTUBE_API_KEY": {
        const r = await get(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(value)}`, {});
        return r.status === 200 ? { ok: true, note: "有效" } : { ok: false, note: "YouTube 不认这个密钥" };
      }
      case "PEXELS_API_KEY": {
        const r = await get("https://api.pexels.com/v1/search?query=city&per_page=1", { authorization: value });
        return r.status === 200 ? { ok: true, note: "有效" } : { ok: false, note: "Pexels 不认这个密钥" };
      }
      case "UNSPLASH_ACCESS_KEY": {
        const r = await get("https://api.unsplash.com/photos?per_page=1", { authorization: `Client-ID ${value}` });
        return r.status === 200 ? { ok: true, note: "有效" } : { ok: false, note: "Unsplash 不认这个密钥" };
      }
      case "FAL_KEY": {
        /* A status read of a request that does not exist: 401/403 for a bad key, 404 for a good one. */
        const r = await fetch("https://queue.fal.run/fal-ai/kling-video/requests/00000000-0000-0000-0000-000000000000/status", { headers: { authorization: `Key ${value}` }, signal: AbortSignal.timeout(15_000) });
        return r.status === 401 || r.status === 403 ? { ok: false, note: "fal.ai 不认这个密钥" } : { ok: true, note: "有效" };
      }
      case "ELEVENLABS_API_KEY":
        /* ElevenLabs refuses this server's region, so its calls go through a tunnel and cannot be checked from here. */
        return { ok: true, note: "已保存（ElevenLabs 不能从服务器直接验证，下次用音色库配音时生效）" };
    }
  } catch {
    return { ok: false, note: "连不上这家服务，稍后再试" };
  }
  return { ok: false, note: "不认识的密钥" };
}

export async function saveKey(name: KeyName, value: string, userId: string) {
  const row: Stored = { v: seal(value), at: new Date().toISOString(), by: userId };
  await db
    .insert(settings)
    .values({ key: `${PREFIX}${name}`, value: row, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: row, updatedBy: userId, updatedAt: new Date() } });
  setEnv(name, value);
  last = Date.now();
}

export async function removeKey(name: KeyName) {
  await db.delete(settings).where(eq(settings.key, `${PREFIX}${name}`));
  setEnv(name, undefined);
  last = Date.now();
}

export type KeyStatus = { name: KeyName; zh: string; en: string; usesZh: string; uses: string; link: string; source: "site" | "server" | "none"; savedAt: string | null; savedBy: string | null };

/** For the screen: which keys are set and where from. Never a value. */
export async function keyStatus(zh: boolean): Promise<KeyStatus[]> {
  await ensureKeys(true);
  const rows = await db
    .select({ key: settings.key, at: settings.updatedAt, name: users.name, local: users.nameLocal })
    .from(settings)
    .leftJoin(users, eq(users.id, settings.updatedBy))
    .where(like(settings.key, `${PREFIX}%`));
  const saved = new Map(rows.map((r) => [r.key.slice(PREFIX.length), r]));
  return KEYS.map((k) => {
    const s = saved.get(k.name);
    const file = fromFile.has(k.name) ? fromFile.get(k.name) : process.env[k.name];
    const alias = (ALIASES[k.name] ?? []).some((a) => (fromFile.has(a) ? fromFile.get(a) : process.env[a]));
    return {
      ...k,
      source: s ? "site" : file || alias ? "server" : "none",
      savedAt: s ? s.at.toISOString() : null,
      savedBy: s ? ((zh && s.local) || s.name || null) : null,
    };
  });
}
