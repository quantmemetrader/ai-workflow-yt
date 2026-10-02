/**
 * Model ids that have moved on. Orbio stopped serving Claude Sonnet 5 on and
 * off from 1 Oct ("No provider is currently serving this model"), which is how
 * a client's first draft failed; Sonnet 5.5 is served and costs the same. A
 * choice saved anywhere (an employee's own model, a tab's pick, a cron's
 * setting) under the old id answers with the new one.
 */
const ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-5": "anthropic/claude-sonnet-5.5",
};

export function aliasModel<T extends string | null | undefined>(id: T): T {
  if (!id) return id;
  return (ALIASES[id] ?? id) as T;
}
