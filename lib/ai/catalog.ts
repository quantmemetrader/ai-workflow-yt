import "server-only";
import "@/lib/keys/boot";
import { env } from "@/lib/env";
import type { ProviderModel } from "@/lib/ai/chat-models";
import { backendFor } from "@/lib/ai/backend";
import { anthropicKey, testAnthropicKey } from "@/lib/ai/anthropic";
import { gatewayModel } from "@/lib/ai/claude-gateway";

/**
 * Every model the studio's key can call, read live from the provider
 * (`/models` on the OpenRouter-compatible gateway, Orbio since 30 Sep), so
 * the pickers offer all of them — Claude, GPT, Gemini, Qwen, Kimi, GLM,
 * Jev … — instead of a hand-written short list (the owner, 30 Sep: "I want
 * all the available models to be there"). Text-answering models only; the
 * batch twins, embeddings, speech and image models are left out. Cached for
 * an hour; the last good list stands if a refresh fails.
 */
let cache: { at: number; list: ProviderModel[] } | null = null;

const VENDOR_ORDER = ["anthropic", "openai", "google", "qwen", "deepseek", "moonshotai", "z-ai", "x-ai", "meta-llama", "mistralai", "typesafe"];
const SKIP = /(embed|rerank|tts|transcri|whisper|speech|audio|image|vision-exp|moderation|guard|omni)/i;

type Row = { id?: unknown; name?: unknown; context_length?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; architecture?: { output_modalities?: unknown; modality?: unknown } };

function answersInText(m: Row): boolean {
  const out = m.architecture?.output_modalities;
  if (Array.isArray(out)) return out.includes("text");
  const mod = m.architecture?.modality;
  return typeof mod !== "string" || /->\s*text/.test(mod);
}

const perM = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : null;
};

/**
 * Claude, GPT and Gemini are offered only when a key the studio holds
 * actually answers for them (10 Oct: they were listed as soon as a key was
 * saved, and the key's account had run dry, so every pick failed). Once an
 * hour per key and vendor, one request for one token; a replaced key is
 * probed again at once. Claude on the studio's own Anthropic key is checked
 * with the free model lookup instead.
 */
const WESTERN = new Set(["anthropic", "openai", "google"]);
const probes = new Map<string, { at: number; ok: boolean }>();

async function vendorServed(vendor: string, sample: string): Promise<boolean> {
  const direct = vendor === "anthropic" && anthropicKey();
  const b = backendFor(sample);
  const apiKey = b.key === "openrouter" && env.openrouter.claudeKey ? env.openrouter.claudeKey : b.apiKey;
  const id = direct ? `anthropic:${anthropicKey().slice(-6)}` : `${vendor}:${b.baseUrl}:${(apiKey ?? "").slice(-6)}`;
  const hit = probes.get(id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.ok;
  let ok = false;
  try {
    if (direct) ok = (await testAnthropicKey(anthropicKey())).ok;
    else if (b.key === "deepseek" || !apiKey) ok = false;
    else {
      const model = b.key === "gateway" ? await gatewayModel(b.baseUrl, apiKey, sample) : b.model;
      const r = await fetch(`${b.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...b.headers },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        signal: AbortSignal.timeout(20_000),
      });
      ok = r.ok;
      if (!ok) console.warn(`[ai] ${vendor} not served on ${new URL(b.baseUrl).hostname}: ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    }
  } catch (err) {
    console.warn(`[ai] ${vendor} probe failed`, err instanceof Error ? err.message : err);
  }
  probes.set(id, { at: Date.now(), ok });
  return ok;
}

/** The cheapest-looking model of a vendor, for the probe. */
function sampleOf(list: ProviderModel[], vendor: string): string | null {
  const mine = list.filter((m) => m.vendor === vendor);
  const pick = mine.find((m) => /haiku|mini|nano|flash-lite|flash/i.test(m.id)) ?? mine[0];
  return pick?.id ?? null;
}

async function usable(list: ProviderModel[]): Promise<ProviderModel[]> {
  const vendors = [...new Set(list.map((m) => m.vendor))].filter((v) => WESTERN.has(v));
  const served = new Set<string>();
  await Promise.all(
    vendors.map(async (v) => {
      const sample = sampleOf(list, v);
      if (sample && (await vendorServed(v, sample))) served.add(v);
    }),
  );
  return list.filter((m) => !WESTERN.has(m.vendor) || served.has(m.vendor));
}

export async function providerModels(): Promise<ProviderModel[]> {
  return usable(await allProviderModels());
}

/** For the keys screen and tests: which of Claude, GPT and Gemini a key answers for right now. */
export async function servedVendors(): Promise<string[]> {
  const list = await providerModels();
  return [...new Set(list.map((m) => m.vendor))].filter((v) => WESTERN.has(v));
}

async function allProviderModels(): Promise<ProviderModel[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.list;
  try {
    const res = await fetch(`${env.openrouter.baseUrl}/models`, { headers: { Authorization: `Bearer ${env.openrouter.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const json = (await res.json()) as { data?: Row[] };
    const list: ProviderModel[] = (json.data ?? [])
      .filter((m): m is Row & { id: string } => typeof m.id === "string" && /^[a-z0-9-]+\/[a-z0-9.:_-]+$/i.test(m.id))
      .filter((m) => !m.id.endsWith(":batch") && !m.id.endsWith(":free") && !SKIP.test(m.id) && answersInText(m))
      .map((m) => ({
        id: m.id,
        name: typeof m.name === "string" && m.name.trim() ? m.name.replace(/^[^:]{1,30}:\s*/, "").trim() : m.id.split("/")[1],
        vendor: m.id.split("/")[0],
        context: typeof m.context_length === "number" ? m.context_length : null,
        inPerM: perM(m.pricing?.prompt),
        outPerM: perM(m.pricing?.completion),
      }))
      .sort((a, b) => {
        const va = VENDOR_ORDER.indexOf(a.vendor), vb = VENDOR_ORDER.indexOf(b.vendor);
        return (va < 0 ? 99 : va) - (vb < 0 ? 99 : vb) || a.vendor.localeCompare(b.vendor) || b.id.localeCompare(a.id);
      });
    if (list.length) cache = { at: Date.now(), list };
    return list.length ? list : (cache?.list ?? []);
  } catch (err) {
    console.error("[ai] model list", err);
    return cache?.list ?? [];
  }
}

/** A model the key can call right now (for the pickers' server-side checks). */
export async function isProviderModel(id: string): Promise<boolean> {
  return (await providerModels()).some((m) => m.id === id);
}
