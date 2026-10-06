import "server-only";
import "@/lib/keys/boot";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiUsage, files } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { Viewer } from "@/lib/auth/dal";

/**
 * What is left on each paid service the studio runs on, read from the
 * services themselves, beside what our own ledger says we spent this month.
 *
 * Every figure is the provider's own answer to its balance endpoint (OpenRouter
 * `/credits`, TikHub `get_user_info`); R2 has no balance, so it is the bytes we hold and
 * what they cost past the free tier. Keys never leave this file: a row carries
 * numbers and a state, not a credential.
 *
 * Read at most every five minutes per studio — the finance page and 财务's
 * `api_balances` both come here, and a page load should not be four round
 * trips to four providers. TikHub's daily-usage endpoint is not used: that
 * call is billed.
 */
export type ProviderKey = "openrouter" | "tikhub" | "r2";

export type ProviderBalance = {
  key: ProviderKey;
  name: string;
  nameZh: string;
  /** What it pays for, in a few words. */
  what: string;
  whatZh: string;
  /** Dollars left, when the provider has a balance to read. */
  leftUsd: number | null;
  /** Everything ever put in, and used, when the provider says. */
  totalUsd: number | null;
  usedUsd: number | null;
  /** This month's spend by our own `ai_usage` ledger (model providers only). */
  monthUsd: number | null;
  /** One more line: today's use, characters, storage. */
  note: string | null;
  noteZh: string | null;
  /** ok · low (under $2 left) · empty · error (could not read) · off (no key on this deployment). */
  state: "ok" | "low" | "empty" | "error" | "off";
  error: string | null;
  /** Where to top it up. */
  topUp: string | null;
};

export type Balances = { at: string; rows: ProviderBalance[] };

export const LOW_BALANCE_USD = 2;
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;
const R2_FREE_GB = 10;
const R2_USD_PER_GB_MONTH = 0.015;

const cache = new Map<string, { at: number; value: Balances }>();

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const text = await r.text();
    if (!r.ok) {
      /* A Cloudflare challenge page (ElevenLabs from this server) is HTML, not an answer. */
      return { ok: false, error: /<html/i.test(text) ? `HTTP ${r.status}: blocked before it reached the service` : `HTTP ${r.status}` };
    }
    return { ok: true, json: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached" };
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const stateOf = (left: number | null): ProviderBalance["state"] => (left === null ? "error" : left <= 0.005 ? "empty" : left < LOW_BALANCE_USD ? "low" : "ok");
/* (QA, 2 Oct) Same "US$ 1.00" style as /settings; rounded on whole cents so
   a float like 9.995 does not print differently from one load to the next. */
const usd = (n: number) => `US$ ${(Math.round(Math.round(n * 1_000_000) / 10_000) / 100).toFixed(2)}`;

function row(p: Omit<ProviderBalance, "state" | "error" | "note" | "noteZh" | "monthUsd" | "totalUsd" | "usedUsd" | "leftUsd"> & Partial<ProviderBalance>): ProviderBalance {
  return { leftUsd: null, totalUsd: null, usedUsd: null, monthUsd: null, note: null, noteZh: null, error: null, state: "ok", ...p };
}

async function openRouter(key: string, which: "openrouter", monthUsd: number | null): Promise<ProviderBalance> {
  /* The gateway is OpenRouter-compatible but may be another one (Orbio): name it after the host. */
  const orbio = /orbio\./i.test(env.openrouter.baseUrl);
  const base = {
    key: which,
    name: orbio ? "Orbio" : "OpenRouter",
    nameZh: orbio ? "Orbio" : "OpenRouter",
    what: "Every AI employee's and assistant's answers",
    whatZh: "所有 AI 员工和助理的回答",
    topUp: orbio ? "https://orbio.so" : "https://openrouter.ai/settings/credits",
  } as const;
  const [credits, info] = await Promise.all([
    getJson(`${env.openrouter.baseUrl}/credits`, { Authorization: `Bearer ${key}` }),
    getJson(`${env.openrouter.baseUrl}/key`, { Authorization: `Bearer ${key}` }),
  ]);
  if (!credits.ok) {
    /* No /credits (Orbio): /auth/key carries the key's limit, usage and what is left. */
    const auth = await getJson(`${env.openrouter.baseUrl}/auth/key`, { Authorization: `Bearer ${key}` });
    if (!auth.ok) return row({ ...base, state: "error", error: credits.error, monthUsd });
    const a = (auth.json as { data?: { limit?: unknown; usage?: unknown; limit_remaining?: unknown } }).data ?? {};
    const total = num(a.limit);
    const used = num(a.usage);
    const left = num(a.limit_remaining) ?? (total !== null && used !== null ? Math.max(0, total - used) : null);
    return row({ ...base, leftUsd: left, totalUsd: total, usedUsd: used, monthUsd, state: stateOf(left) });
  }
  const d = (credits.json as { data?: { total_credits?: unknown; total_usage?: unknown } }).data ?? {};
  const total = num(d.total_credits);
  const used = num(d.total_usage);
  const left = total !== null && used !== null ? Math.max(0, total - used) : null;
  const daily = info.ok ? num((info.json as { data?: { usage_daily?: unknown } }).data?.usage_daily) : null;
  return row({
    ...base,
    leftUsd: left,
    totalUsd: total,
    usedUsd: used,
    monthUsd,
    state: stateOf(left),
    note: daily !== null ? `Today ${usd(daily)}` : null,
    noteZh: daily !== null ? `今天 ${usd(daily)}` : null,
  });
}

async function tikHub(): Promise<ProviderBalance> {
  const base = { key: "tikhub", name: "TikHub", nameZh: "TikHub", what: "Douyin, TikTok, Xiaohongshu data for research", whatZh: "调研用的抖音、TikTok、小红书数据", topUp: "https://user.tikhub.io/" } as const;
  if (!env.tikhub.configured) return row({ ...base, state: "off" });
  const r = await getJson(`${env.tikhub.baseUrl}/api/v1/tikhub/user/get_user_info`, { Authorization: `Bearer ${env.tikhub.token}` });
  if (!r.ok) return row({ ...base, state: "error", error: r.error });
  const u = (r.json as { user_data?: { balance?: unknown; free_credit?: unknown } }).user_data ?? {};
  const bal = num(u.balance);
  const free = num(u.free_credit) ?? 0;
  const left = bal === null ? null : bal + free;
  return row({ ...base, leftUsd: left, state: stateOf(left), note: free ? `Includes ${usd(free)} free credit` : null, noteZh: free ? `含免费额度 ${usd(free)}` : null });
}

async function r2(tenantId: string): Promise<ProviderBalance> {
  const [t] = await db
    .select({ bytes: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` })
    .from(files)
    .where(and(eq(files.tenantId, tenantId), isNull(files.deletedAt)));
  const gb = Number(t?.bytes ?? 0) / 1024 ** 3;
  const monthly = Math.max(0, gb - R2_FREE_GB) * R2_USD_PER_GB_MONTH;
  return row({
    key: "r2",
    name: "Cloudflare R2",
    nameZh: "Cloudflare R2",
    what: "Where every clip, render and file is stored",
    whatZh: "所有素材、成片和文件的存储",
    topUp: "https://dash.cloudflare.com/",
    monthUsd: monthly,
    note: `${gb.toFixed(1)} GB stored · first ${R2_FREE_GB} GB free · about ${usd(monthly)}/month`,
    noteZh: `已存 ${gb.toFixed(1)} GB · 前 ${R2_FREE_GB} GB 免费 · 约 ${usd(monthly)}/月`,
  });
}

/** This month's spend through OpenRouter by our own ledger: every "vendor/model" call. */
async function ledgerMonth(tenantId: string): Promise<{ openrouter: number }> {
  const period = new Date().toISOString().slice(0, 7);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), sql`to_char(${aiUsage.createdAt}, 'YYYY-MM') = ${period}`, sql`position('/' in ${aiUsage.model}) > 0`));
  return { openrouter: Number(row?.total ?? 0) / 1e6 };
}

export async function apiBalances(viewer: Pick<Viewer, "tenantId">, opts: { fresh?: boolean } = {}): Promise<Balances> {
  const hit = cache.get(viewer.tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const month = await ledgerMonth(viewer.tenantId).catch(() => ({ openrouter: 0 }));
  /* The studio's own accounts only. DeepSeek and the backup OpenRouter key
     are not the studio accounts, and ElevenLabs is not used: none of them is the
     studio's money, so none is shown. */
  const rows = await Promise.all([
    openRouter(env.openrouter.apiKey, "openrouter", month.openrouter),
    tikHub(),
    r2(viewer.tenantId).catch(() => row({ key: "r2", name: "Cloudflare R2", nameZh: "Cloudflare R2", what: "Storage", whatZh: "存储", topUp: null, state: "error", error: "could not be read" })),
  ]);
  const value = { at: new Date().toISOString(), rows };
  cache.set(viewer.tenantId, { at: Date.now(), value });
  return value;
}

/** The balances as a few plain lines, for 财务's `api_balances` tool. */
export function balancesText(b: Balances, zh: boolean): string {
  const lines = b.rows.map((r) => {
    const name = zh ? r.nameZh : r.name;
    if (r.state === "off") return `- ${name}: ${zh ? "本部署没有配置" : "not set up on this deployment"}`;
    if (r.state === "error") return `- ${name}: ${zh ? "查不到" : "could not be read"} (${r.error ?? ""})`;
    const parts = [
      r.leftUsd !== null ? `${zh ? "剩余" : "left"} ${usd(r.leftUsd)}` : null,
      r.totalUsd !== null ? `${zh ? "共充值" : "put in"} ${usd(r.totalUsd)}` : null,
      r.monthUsd !== null && r.key !== "r2" ? `${zh ? "本月账本记录花费" : "this month by our ledger"} ${usd(r.monthUsd)}` : null,
      zh ? r.noteZh : r.note,
      r.state === "low" ? (zh ? "余额不足，需要充值" : "running low, top up") : r.state === "empty" ? (zh ? "已用完" : "empty") : null,
    ].filter(Boolean);
    return `- ${name}（${zh ? r.whatZh : r.what}）: ${parts.join("，")}`;
  });
  return `${zh ? "API 余额" : "API balances"} (${b.at.slice(0, 16).replace("T", " ")} UTC)\n${lines.join("\n")}`;
}
