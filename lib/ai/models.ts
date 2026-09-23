import "server-only";
import { modelChoice } from "@/lib/ai/choice";

/**
 * The model catalogue. Ids are OpenRouter ids; prices are per million tokens
 * and exist only so the Admin screens can explain a number — the *charged*
 * figure always comes back from OpenRouter with the response and is what the
 * ledger stores.
 */
export type ModelSpec = {
  id: string;
  label: string;
  /** What this model is for, in the words an admin would use. */
  use: string;
  inPerM: number;
  outPerM: number;
  contextTokens: number;
  tier: "paid" | "free";
};

/*
 * What this deployment can actually call.
 *
 * The catalogue used to open with Claude and Gemini. Neither answers here:
 * OpenRouter returns 403 "prohibited due to a violation of provider Terms Of
 * Service" for every `anthropic/*` and `google/*` id on this organisation's
 * key, from any network — an account-level flag, not a network or a balance.
 * So the picker offered a studio four models it could not have and hid the
 * three it was actually paying for, which is the same fault this screen was
 * built to end: a product telling its owner something that is not true.
 *
 * Everything below was called with this deployment's own key before it was
 * written down, and the prices are OpenRouter's as quoted on the same day.
 * They exist so Admin can explain a number; the charged figure always comes
 * back with the response and is what the ledger stores.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "qwen/qwen3-max",
    label: "Qwen3 Max",
    use: "The assistant. Strong Simplified and Traditional Chinese, reliable tool use, and the one this studio has been running on.",
    inPerM: 0.78,
    outPerM: 3.9,
    contextTokens: 262_144,
    tier: "paid",
  },
  {
    id: "qwen/qwen3.7-max",
    label: "Qwen3.7 Max",
    use: "The newest and strongest of the family: a million tokens of context, best at a long take and a long brief. Twice the price of Qwen3 Max.",
    inPerM: 1.475,
    outPerM: 4.425,
    contextTokens: 1_000_000,
    tier: "paid",
  },
  {
    id: "qwen/qwen3.7-plus",
    label: "Qwen3.7 Plus",
    use: "The same generation at a third of the cost, a step down on hard reasoning. A good everyday assistant.",
    inPerM: 0.32,
    outPerM: 1.28,
    contextTokens: 1_000_000,
    tier: "paid",
  },
  {
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    use: "Hard drafting and review — script rewrites, clause comparison. The most natural Chinese prose of the paid options.",
    inPerM: 0.95,
    outPerM: 4,
    contextTokens: 262_144,
    tier: "paid",
  },
  {
    id: "z-ai/glm-5.3",
    label: "GLM 5.3",
    use: "A second opinion from a different house, with the longest context here. Useful when Qwen and Kimi agree and you want a third read.",
    inPerM: 0.84,
    outPerM: 2.64,
    contextTokens: 1_310_720,
    tier: "paid",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    use: "High-volume background work: titles, extraction, classification, comment triage. Cheapest capable option for bulk Chinese text.",
    inPerM: 0.078,
    outPerM: 0.156,
    contextTokens: 1_048_576,
    tier: "paid",
  },
  {
    id: "nex-agi/nex-n2.5-mini:free",
    label: "Nex N2.5 Mini (free)",
    use: "Fallback while the OpenRouter account has no credit. Rate-limited and weaker, but keeps the product usable.",
    inPerM: 0,
    outPerM: 0,
    contextTokens: 262_144,
    tier: "free",
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    label: "Nemotron 3.5 Lightning (free)",
    use: "Second free fallback, used when the first is rate-limited. Weak Chinese; a last resort, not a choice.",
    inPerM: 0,
    outPerM: 0,
    contextTokens: 1_000_000,
    tier: "free",
  },
];

export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

/**
 * Roles the product asks for, resolved to ids.
 *
 * Three layers, in order: what the studio chose in Admin, then the
 * deployment's environment, then a sensible default. The studio's own choice
 * wins because it is the studio's money — the environment stays as the way to
 * pin a model for a deployment that has no administrator to ask.
 */
/**
 * A model id this deployment is willing to send.
 *
 * Ids arrive from three places and two of them can go stale: a running
 * process keeps the `AI_MODEL_*` it started with, so an edit to `.env.local`
 * that has not been reloaded leaves a value nothing answers to. One such
 * leftover — `deepseek-flash`, DeepSeek's own name for a model OpenRouter
 * calls `deepseek/deepseek-v4.1-flash` — reached OpenRouter and took the
 * editor's assistant down with a 400. A value that is neither a routed id
 * nor one of DeepSeek's own is treated as the mistake it is.
 */
function usable(id: string | null | undefined): string | null {
  const s = (id ?? "").trim();
  if (!s || s.length > 120) return null;
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(s)) return s;
  // DeepSeek's own two ids are bare, and `backendFor` routes them there.
  return /^deepseek-(flash|v4-pro|chat|reasoner)$/.test(s) ? s : null;
}

export const modelFor = {
  assistant: () =>
    usable(modelChoice().assistant) ?? usable(process.env.AI_MODEL_ASSISTANT) ?? "qwen/qwen3-max",
  drafting: () =>
    usable(modelChoice().drafting) ?? usable(process.env.AI_MODEL_DRAFTING) ?? "moonshotai/kimi-k2.6",
  utility: () =>
    usable(modelChoice().utility) ?? usable(process.env.AI_MODEL_UTILITY) ?? "deepseek/deepseek-v4-flash",
  /**
   * Tried in order when the account is out of credit or a provider is
   * rate-limiting. Free models share an upstream pool and refuse often, so one
   * fallback is not enough to keep the product answering — a chain is.
   */
  fallbacks: (): string[] =>
    (process.env.AI_MODEL_FALLBACKS || "deepseek/deepseek-v4-flash,nex-agi/nex-n2.5-mini:free,nvidia/nemotron-3.5-lightning:free")
      .split(",")
      .map((s) => usable(s))
      .filter((s): s is string => Boolean(s)),
};

export function labelFor(id: string): string {
  return MODEL_BY_ID.get(id)?.label ?? id;
}

/**
 * The model that will actually answer, for the composer's caption.
 *
 * The panel printed whatever `AI_MODEL_ASSISTANT` said, which stopped being
 * true the moment calls started going to DeepSeek instead — so the product
 * told people a free Nemotron was answering while DeepSeek was. A label that
 * is wrong about the thing it names is worse than no label.
 */
export function answeringModel(): string {
  if (!process.env.DEEPSEEK_API_KEY) return modelFor.assistant();
  const configured = modelFor.assistant();
  const chosen = modelChoice().preferDeepseek;
  const flag = process.env.AI_PREFER_DEEPSEEK;
  const deepseek =
    chosen === true ||
    (chosen !== false && (flag === "true" || (flag !== "false" && configured.endsWith(":free"))));
  return deepseek ? (process.env.DEEPSEEK_MODEL || "deepseek-chat") : configured;
}
