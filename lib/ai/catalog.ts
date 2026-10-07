import "server-only";
import "@/lib/keys/boot";
import { env } from "@/lib/env";
import type { ProviderModel } from "@/lib/ai/chat-models";

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

/* Claude, GPT and Gemini refuse the studio's OpenRouter account (7 Oct): listed only once a Claude key is saved, so nobody picks a model that cannot answer. */
const usable = (list: ProviderModel[]) =>
  env.openrouter.claudeKey
    ? list
    : list.filter((m) => (m.vendor === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : !/^(openai|google)$/.test(m.vendor)));

export async function providerModels(): Promise<ProviderModel[]> {
  return usable(await allProviderModels());
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
