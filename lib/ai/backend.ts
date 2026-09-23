import "server-only";
import { env } from "@/lib/env";
import { modelChoice } from "@/lib/ai/choice";

/**
 * Which service actually answers, and on what terms.
 *
 * The product was written against OpenRouter, which is the right long-term
 * shape: one account, every model, one bill. But that account has no credit,
 * so every call falls to a free endpoint — and a free endpoint here means a
 * reasoning model that writes a page of working before its answer. Measured,
 * not assumed: `Suggest angles` returned nothing because the model spent its
 * whole token budget thinking, and the auto-editor's first run timed out
 * entirely.
 *
 * DeepSeek's own API is OpenAI-compatible, the studio already has a key with
 * money on it, and `deepseek-chat` answers a JSON request with JSON and
 * nothing else. So when a DeepSeek key is present and OpenRouter has no
 * credit, calls go straight to DeepSeek.
 *
 * This is deliberately a *fallback*, not a replacement. The moment OpenRouter
 * has credit, `AI_PREFER_DEEPSEEK=false` (or simply removing the key) puts
 * everything back on one bill and the good models, with nothing else to
 * change.
 */
export type Backend = {
  key: "openrouter" | "deepseek";
  baseUrl: string;
  apiKey: string;
  /** The id this backend knows the model by. */
  model: string;
  /** Headers this backend wants beyond auth and content type. */
  headers: Record<string, string>;
  /**
   * Whether the response carries its own cost. OpenRouter does; DeepSeek
   * returns tokens only, so the ledger estimates from the rates below and the
   * Admin screens say which is which.
   */
  reportsCost: boolean;
};

/**
 * DeepSeek's published rates, per million tokens, for the ledger's estimate.
 *
 * Stated here rather than inferred, and stated as an estimate: the figure in
 * the token ledger is what the studio is billed by OpenRouter when OpenRouter
 * answers, and our own arithmetic when DeepSeek does. Conflating the two would
 * make the cost screen quietly wrong.
 */
export const DEEPSEEK_RATES = { inPerM: 0.28, outPerM: 0.42 } as const;

/**
 * Map an OpenRouter model id to DeepSeek's own.
 *
 * Everything collapses to `deepseek-chat`, which is honest: DeepSeek has one
 * general model, and pretending an id like `anthropic/claude-sonnet-5` still
 * means Claude while DeepSeek answers would make every usage row a lie.
 */
function deepseekModel(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-chat";
}

/**
 * Whether to route to DeepSeek at all.
 *
 * Default: yes, if a key exists and the configured model is a `:free` one —
 * which is the product's own signal that OpenRouter has no credit. An explicit
 * `AI_PREFER_DEEPSEEK` overrides in both directions.
 */
export function prefersDeepseek(model: string): boolean {
  if (!env.deepseek.configured) return false;
  /* The studio's own switch first: an administrator who picks Claude in Admin
     and still gets DeepSeek has been lied to by their own product. */
  const chosen = modelChoice().preferDeepseek;
  if (chosen === true) return true;
  if (chosen === false) return false;
  const flag = process.env.AI_PREFER_DEEPSEEK;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return model.endsWith(":free");
}

export function backendFor(model: string): Backend {
  if (prefersDeepseek(model)) {
    return {
      key: "deepseek",
      baseUrl: env.deepseek.baseUrl,
      apiKey: env.deepseek.apiKey,
      model: deepseekModel(),
      headers: {},
      reportsCost: false,
    };
  }

  return {
    key: "openrouter",
    baseUrl: env.openrouter.baseUrl,
    apiKey: env.openrouter.apiKey,
    model,
    headers: {
      "HTTP-Referer": env.appUrl,
      "X-Title": "Tengya Workspace",
    },
    reportsCost: true,
  };
}

/** Micros of a US dollar, from tokens, at the stated rates. */
export function estimateCostMicros(promptTokens: number, completionTokens: number): number {
  const usd =
    (promptTokens / 1_000_000) * DEEPSEEK_RATES.inPerM +
    (completionTokens / 1_000_000) * DEEPSEEK_RATES.outPerM;
  return Math.round(usd * 1_000_000);
}
