import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

/**
 * Which model the studio has chosen, kept in the database rather than in the
 * deployment's environment.
 *
 * The models were `AI_MODEL_ASSISTANT` and friends — which meant changing one
 * was an operator editing a file on a box and redeploying, twice, and the
 * studio could not see what it was paying for or pick something else. A model
 * choice is a business decision (it is money per turn), so it belongs to the
 * people spending the money, in the product.
 *
 * Read synchronously, because `modelFor.assistant()` is called in thirty-odd
 * places that are not async and should not become async for a lookup that
 * changes once a month. The row is cached in the process and refreshed in the
 * background; a change therefore reaches every worker within `TTL_MS` rather
 * than instantly, and the screen says so rather than pretending otherwise.
 */
export type ModelChoice = {
  assistant?: string;
  drafting?: string;
  utility?: string;
  /**
   * Send everything to DeepSeek's own API regardless of the model chosen.
   * Kept because it is the switch that makes a choice of Claude do nothing,
   * and a hidden switch like that is how a product lies to its owner.
   */
  preferDeepseek?: boolean;
};

export const CHOICE_KEY = "ai.models";

const TTL_MS = 30_000;

let cached: ModelChoice = {};
let readAt = 0;
let refreshing: Promise<void> | null = null;

function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, CHOICE_KEY))
    .limit(1)
    .then((rows) => {
      const value = rows[0]?.value;
      cached = value && typeof value === "object" ? (value as ModelChoice) : {};
      readAt = Date.now();
    })
    .catch(() => {
      /* A database that cannot be reached must not take the assistant down:
         the last known choice stands, and the env defaults stand under it. */
      readAt = Date.now();
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** The choice as this process last saw it. Never blocks. */
export function modelChoice(): ModelChoice {
  if (Date.now() - readAt > TTL_MS) void refresh();
  return cached;
}

/** Write it, and make this process act on it immediately. */
export async function setModelChoice(next: ModelChoice, byUserId: string): Promise<void> {
  const clean: ModelChoice = {};
  for (const role of ["assistant", "drafting", "utility"] as const) {
    const id = next[role];
    if (typeof id === "string" && id.trim() && id.length < 120) clean[role] = id.trim();
  }
  if (typeof next.preferDeepseek === "boolean") clean.preferDeepseek = next.preferDeepseek;

  await db
    .insert(settings)
    .values({ key: CHOICE_KEY, value: clean, updatedBy: byUserId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: clean, updatedBy: byUserId, updatedAt: new Date() },
    });

  cached = clean;
  readAt = Date.now();
}
