import { AGENT_COLORS, AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import type { Look, LookKey } from "@/components/office/art";

/**
 * How each employee looks in the office: skin, hair, and a shirt in the
 * colour that follows them everywhere else (AGENT_COLORS). Hair matches the
 * pixel faces in lib/agents/pixel.ts so the two read as the same people.
 */
export const LOOKS: Record<LookKey, Look> = {
  research: { key: "research", skin: ["#f6cfae", "#e2a882"], hair: "#3a2a22", shirt: AGENT_COLORS.research },
  planning: { key: "planning", skin: ["#f1c39c", "#d9a27a"], hair: "#2a2340", shirt: AGENT_COLORS.planning },
  script: { key: "script", skin: ["#e6b086", "#c98e62"], hair: "#5a2c14", shirt: AGENT_COLORS.script },
  video: { key: "video", skin: ["#c98d63", "#a86f4a"], hair: "#1b1b1b", shirt: AGENT_COLORS.video },
  article: { key: "article", skin: ["#f8d5b8", "#e6b08c"], hair: "#4a2433", shirt: AGENT_COLORS.article },
  legal: { key: "legal", skin: ["#eab88f", "#cf9870"], hair: "#2b2b33", shirt: AGENT_COLORS.legal },
  finance: { key: "finance", skin: ["#b97c55", "#98603e"], hair: "#3b2a1a", shirt: AGENT_COLORS.finance },
  host: { key: "host", skin: ["#f4f4f7", "#d8dae2"], hair: "#171717", shirt: "#6d5bd0" },
};

/** The desks, in the picker's order, and the assistant at the last one. */
export const OFFICE_KEYS: LookKey[] = [...(AGENT_KEYS as readonly AgentKey[]), "host"];
