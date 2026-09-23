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
 * The two id spaces, and why keeping them apart is not pedantry.
 *
 * OpenRouter names a model `vendor/model`; DeepSeek's own API names its two
 * models `deepseek-flash` (V4.1 Flash) and `deepseek-v4-pro`, with no vendor
 * in front. Both ids are real and neither service knows the other's. The
 * editor's assistant died on `The request was rejected by the provider:
 * deepseek-flash is not a valid model ID` — a perfectly good DeepSeek id sent
 * to OpenRouter, from an `AI_MODEL_*` value left behind in a running process
 * after the file on disk had moved on.
 *
 * So the shape of an id decides where it can go, and nothing is passed to a
 * service that cannot possibly know it.
 */
const DEEPSEEK_IDS = new Set(["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]);

/** True for an OpenRouter id: `vendor/model`, optionally `:free`. */
export function isRoutedId(model: string): boolean {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(model.trim());
}

/**
 * Map a model id to DeepSeek's own.
 *
 * A bare id is already one of theirs and is passed through; anything with a
 * vendor in front collapses to their flash model, which is honest — DeepSeek
 * has two models, and pretending an id like `qwen/qwen3-max` still means Qwen
 * while DeepSeek answers would make every usage row a lie.
 */
function deepseekModel(model?: string): string {
  if (model && !isRoutedId(model) && DEEPSEEK_IDS.has(model.trim())) return model.trim();
  const pinned = process.env.DEEPSEEK_MODEL?.trim();
  return pinned && DEEPSEEK_IDS.has(pinned) ? pinned : "deepseek-flash";
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
  /* A bare id is one of DeepSeek's own and OpenRouter would refuse it. */
  if (!isRoutedId(model)) return true;
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
      model: deepseekModel(model),
      headers: {},
      reportsCost: false,
    };
  }

  return {
    key: "openrouter",
    baseUrl: env.openrouter.baseUrl,
    apiKey: env.openrouter.apiKey,
    /* Only ever an id OpenRouter can resolve. A bare one reaching here with
       no DeepSeek key to catch it would come back 400 with the whole turn
       lost; the catalogue's own assistant is a better answer than none. */
    model: isRoutedId(model) ? model : "qwen/qwen3-max",
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
