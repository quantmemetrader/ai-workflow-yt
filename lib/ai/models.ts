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

export const MODELS: ModelSpec[] = [
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    use: "The assistant. Long context, strong Traditional and Simplified Chinese, reliable tool use.",
    inPerM: 2,
    outPerM: 10,
    contextTokens: 1_000_000,
    tier: "paid",
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    use: "Hard drafting and review — script rewrites, clause comparison.",
    inPerM: 5,
    outPerM: 25,
    contextTokens: 1_000_000,
    tier: "paid",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    use: "High-volume background work: titles, extraction, classification, comment triage.",
    inPerM: 0.25,
    outPerM: 1.5,
    contextTokens: 1_048_576,
    tier: "paid",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    use: "Cheapest capable option for bulk Chinese text work.",
    inPerM: 0.09,
    outPerM: 0.18,
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
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B (free)",
    use: "Second free fallback, used when the first is rate-limited.",
    inPerM: 0,
    outPerM: 0,
    contextTokens: 262_144,
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
export const modelFor = {
  assistant: () => modelChoice().assistant || process.env.AI_MODEL_ASSISTANT || "anthropic/claude-sonnet-5",
  drafting: () => modelChoice().drafting || process.env.AI_MODEL_DRAFTING || "anthropic/claude-opus-5",
  utility: () => modelChoice().utility || process.env.AI_MODEL_UTILITY || "google/gemini-3.1-flash-lite",
  /**
   * Tried in order when the account is out of credit or a provider is
   * rate-limiting. Free models share an upstream pool and refuse often, so one
   * fallback is not enough to keep the product answering — a chain is.
   */
  fallbacks: (): string[] =>
    (process.env.AI_MODEL_FALLBACKS || "nex-agi/nex-n2.5-mini:free,google/gemma-4-31b-it:free,nvidia/nemotron-3.5-lightning:free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
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
