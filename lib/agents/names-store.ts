import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { AGENT_KEYS } from "./catalog";
import { cleanOverrides, setAgentNameOverrides, type AgentNameOverrides } from "./names";

/**
 * The studio's names for its AI employees, kept in the database and read the
 * way the model choice is (`lib/ai/choice.ts`): cached in the process,
 * refreshed in the background, never blocking. A rename reaches every
 * server and worker within `TTL_MS`.
 */
export const NAMES_KEY = "agents.names";
const TTL_MS = 30_000;

let cached: AgentNameOverrides = {};
let readAt = 0;
let refreshing: Promise<void> | null = null;

function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, NAMES_KEY))
    .limit(1)
    .then((rows) => {
      cached = cleanOverrides(rows[0]?.value, AGENT_KEYS);
      setAgentNameOverrides(cached);
      readAt = Date.now();
    })
    .catch(() => {
      readAt = Date.now();
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** The names as this process last saw them. Never blocks. */
export function agentNamesChoice(): AgentNameOverrides {
  if (Date.now() - readAt > TTL_MS) void refresh();
  return cached;
}

/** The names, read now (the layout and the training page want the truth, not the cache). */
export async function agentNamesNow(): Promise<AgentNameOverrides> {
  await refresh();
  return cached;
}

/** Write them, and make this process act on them immediately. */
export async function setAgentNames(next: AgentNameOverrides, byUserId: string): Promise<void> {
  const clean = cleanOverrides(next, AGENT_KEYS);
  await db
    .insert(settings)
    .values({ key: NAMES_KEY, value: clean, updatedBy: byUserId })
    .onConflictDoUpdate({ target: settings.key, set: { value: clean, updatedBy: byUserId, updatedAt: new Date() } });
  cached = clean;
  setAgentNameOverrides(clean);
  readAt = Date.now();
}
