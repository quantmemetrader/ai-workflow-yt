import "server-only";

/**
 * Where Claude, GPT and Gemini are bought (9 Oct).
 *
 * The studio's own OpenRouter account is refused by those providers, so
 * their models go through a second key (`OPENROUTER_API_KEY_CLAUDE`) that
 * may belong to OpenRouter or to another gateway that speaks the same
 * chat-completions format: Orbio, B.AI, Requesty, AIMLAPI, Vercel AI
 * Gateway, Poe. `CLAUDE_GATEWAY_URL` says which; unset means OpenRouter.
 *
 * Gateways name the same model differently (`anthropic/claude-sonnet-5.5`,
 * `anthropic/claude-sonnet-5-5`, `claude-sonnet-5.5`…), so the id is looked
 * up in the gateway's own model list rather than guessed.
 */
export const GATEWAYS: { id: string; name: string; base: string }[] = [
  { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1" },
  { id: "orbio", name: "Orbio", base: "https://www.orbio.so/api/v1" },
  { id: "bai", name: "B.AI", base: "https://api.b.ai/v1" },
  { id: "requesty", name: "Requesty", base: "https://router.requesty.ai/v1" },
  { id: "aimlapi", name: "AIMLAPI", base: "https://api.aimlapi.com/v1" },
  { id: "vercel", name: "Vercel AI Gateway", base: "https://ai-gateway.vercel.sh/v1" },
  { id: "poe", name: "Poe", base: "https://api.poe.com/v1" },
  { id: "aihubmix", name: "AiHubMix", base: "https://aihubmix.com/v1" },
  { id: "ohmygpt", name: "OhMyGPT", base: "https://api.ohmygpt.com/v1" },
  { id: "cometapi", name: "CometAPI", base: "https://api.cometapi.com/v1" },
  { id: "helicone", name: "Helicone", base: "https://ai-gateway.helicone.ai/v1" },
];

const OPENROUTER = GATEWAYS[0].base;

/** The gateway in use for Claude, GPT and Gemini. */
export function claudeGatewayBase(): string {
  const raw = (process.env.CLAUDE_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._/-]*)?$/.test(raw) ? raw : OPENROUTER;
}

/** OpenRouter and its relays take OpenRouter's own request extras (provider policy, cost in the usage block). */
export function speaksOpenRouter(base: string): boolean {
  return /(^|\.)openrouter\.ai\/|(^|\.)orbio\.so\//.test(base.replace(/^https:\/\//, "") + "/");
}

/** US$ per million tokens at list price, for gateways that report tokens but no cost. */
export function listRates(model: string): { inPerM: number; outPerM: number } {
  const m = model.toLowerCase();
  if (/fable|mythos/.test(m)) return { inPerM: 10, outPerM: 50 };
  if (/opus-?5[.-]5/.test(m)) return { inPerM: 4, outPerM: 20 };
  if (/opus/.test(m)) return { inPerM: 5, outPerM: 25 };
  if (/sonnet-?5/.test(m)) return { inPerM: 2, outPerM: 10 };
  if (/sonnet/.test(m)) return { inPerM: 3, outPerM: 15 };
  if (/haiku/.test(m)) return { inPerM: 1, outPerM: 5 };
  return { inPerM: 3, outPerM: 15 };
}

const norm = (id: string) => id.toLowerCase().replace(/^[a-z0-9-]+\//, "").replace(/[._]/g, "-").replace(/:.*$/, "");

const lists = new Map<string, { at: number; ids: string[] }>();

/** The gateway's model ids, read with the key (an hour's memory per process). */
async function gatewayIds(base: string, key: string): Promise<string[]> {
  const hit = lists.get(base);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.ids;
  try {
    const r = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}`, "user-agent": "Tengya/1.0" }, signal: AbortSignal.timeout(12_000) });
    const j = (await r.json().catch(() => null)) as { data?: { id?: unknown }[] } | { id?: unknown }[] | null;
    const rows = Array.isArray(j) ? j : (j?.data ?? []);
    const ids = rows.map((x) => (typeof x?.id === "string" ? x.id : "")).filter(Boolean);
    if (ids.length) lists.set(base, { at: Date.now(), ids });
    return ids;
  } catch {
    return hit?.ids ?? [];
  }
}

/** Our id for a model, as this gateway spells it. Falls back to our own spelling when the list cannot say. */
export async function gatewayModel(base: string, key: string, model: string): Promise<string> {
  if (speaksOpenRouter(base)) return model;
  const ids = await gatewayIds(base, key);
  if (ids.includes(model)) return model;
  const want = norm(model);
  const vendor = model.split("/")[0];
  const same = ids.filter((id) => norm(id) === want);
  return same.find((id) => id.startsWith(`${vendor}/`)) ?? same[0] ?? model;
}
