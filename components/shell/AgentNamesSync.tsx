"use client";

import type { AgentNameOverrides } from "@/lib/agents/names";

/**
 * Keeps `window.__agentNames` in step with the layout after the first load.
 *
 * The layout prints the names in an inline script, which runs once: a rename
 * on 训练 followed by `router.refresh()` or a client-side navigation left the
 * browser on the old names until a full reload (QA, 3 Oct: the toast said
 * every screen uses the new name, and none did). The layout's fresh names
 * arrive here as props on every refresh; they are written during render
 * because this sits above the page in the tree, so whatever renders after it
 * in the same pass already reads the new names.
 */
export function AgentNamesSync({ names }: { names: AgentNameOverrides }) {
  if (typeof window !== "undefined") Object.assign(window, { __agentNames: names });
  return null;
}
