/**
 * What the studio calls each AI employee (Ryan, 2 Oct: "can we rename our AI
 * employees ourselves?", and 文案 is to be called 文案). The catalog's labels
 * read through here, so one override changes the name on every screen, in
 * every @mention and in every prompt.
 *
 * Shared by the server and the browser: the server fills it from the
 * settings row (`lib/agents/names-store.ts`), the browser from the
 * `window.__agentNames` the app layout prints.
 */
import type { AgentKey } from "./catalog";

export type AgentNameOverride = {
  /** The name in Chinese, as it appears everywhere and after an @. */
  zh?: string;
  /** The name in English. */
  en?: string;
  /** One line on what to give them, in Chinese. */
  hint?: string;
  hintEn?: string;
};

export type AgentNameOverrides = Partial<Record<AgentKey, AgentNameOverride>>;

declare global {
  interface Window {
    __agentNames?: AgentNameOverrides;
  }
}

let overrides: AgentNameOverrides = {};

/** A name is one to twelve characters with nothing an @ could not carry. */
export function cleanAgentName(raw: unknown, max = 12): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[@\s#/\\<>"'`]+/g, "").trim().slice(0, max);
  return s || undefined;
}

export function cleanOverrides(raw: unknown, keys: readonly string[]): AgentNameOverrides {
  const out: AgentNameOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.includes(k) || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const entry: AgentNameOverride = {
      zh: cleanAgentName(o.zh),
      en: cleanAgentName(o.en, 24),
      hint: typeof o.hint === "string" ? o.hint.trim().slice(0, 80) || undefined : undefined,
      hintEn: typeof o.hintEn === "string" ? o.hintEn.trim().slice(0, 120) || undefined : undefined,
    };
    if (entry.zh || entry.en || entry.hint || entry.hintEn) out[k as AgentKey] = entry;
  }
  return out;
}

export function setAgentNameOverrides(next: AgentNameOverrides): void {
  overrides = next ?? {};
}

export function agentNameOverrides(): AgentNameOverrides {
  if (typeof window !== "undefined" && window.__agentNames) return window.__agentNames;
  return overrides;
}

export function agentOverride(key: AgentKey): AgentNameOverride {
  return agentNameOverrides()[key] ?? {};
}
