import { readerMarkdown } from "@/lib/text/reader";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { LookKey, Status } from "@/components/office/art";

/** One employee as the office draws it (built on the server from readHome). */
export type OfficeMember = {
  key: LookKey;
  status: Status;
  /** The running job, in the studio's words ("正在渲染"), when there is one. */
  task: string | null;
  /** What it last said, raw. */
  line: string | null;
  /** 0 to 100 while a job reports progress; null when nobody knows. */
  progress: number | null;
};

export function nameOf(key: LookKey, zh: boolean): string {
  if (key === "host") return zh ? "你的助理" : "Your assistant";
  return zh ? AGENT_LABELS[key as AgentKey].nameLocal : AGENT_LABELS[key as AgentKey].nameEn;
}

export function jobOf(key: LookKey, zh: boolean): string {
  if (key === "host") return zh ? "替你查资料、看进度、派活给同事" : "Looks things up, checks progress, hands work out";
  return zh ? AGENT_LABELS[key as AgentKey].hint : AGENT_LABELS[key as AgentKey].hintEn;
}

export function statusWord(s: Status, zh: boolean): string {
  return s === "working" ? (zh ? "工作中" : "Working") : s === "waiting" ? (zh ? "等你" : "Waiting on you") : zh ? "空闲" : "Free";
}

/** Chip colours, the same three TeamBoard uses. */
export const STATUS_TONE: Record<Status, { ink: string; bg: string; edge: string }> = {
  working: { ink: "#0b7a63", bg: "#e3f4ee", edge: "#1f8f6f" },
  waiting: { ink: "#a35f00", bg: "#fbf0dc", edge: "#c77d0a" },
  idle: { ink: "#8a8a8a", bg: "#f3f3f1", edge: "#bdb8b0" },
};

/**
 * One plain line from a chat message, as TeamBoard's `clean` makes it: links
 * down to their words, no raw Markdown, an opening 《「 kept.
 */
export function plainLine(line: string | null): string | null {
  if (!line) return null;
  const out = readerMarkdown(line)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}《「『（(“"【]+/u, "")
    .trim()
    .slice(0, 160);
  return out || null;
}

/** What a card or a tooltip says the employee is on right now. */
export function taskLine(m: OfficeMember, zh: boolean): string {
  const said = plainLine(m.line);
  if (m.status === "working") return m.task ?? said ?? (zh ? "正在处理" : "On it");
  if (m.status === "waiting") return said ?? (zh ? "有件事等你拍板" : "Something needs your call");
  if (m.key === "host") return zh ? "随时可以派活" : "Ready when you are";
  return said ?? (zh ? "还没开始干活" : "Nothing yet");
}
