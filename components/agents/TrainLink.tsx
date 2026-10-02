import Link from "next/link";
import type { AgentKey } from "@/lib/agents/catalog";
import { AGENT_LABELS } from "@/lib/agents/catalog";

/**
 * A quiet 「训练文案 →」 link to that employee's AI 训练 page (`/train/[agent]`),
 * for any page where the person might think "it should write this differently
 * every time" — the script page's AI panel first. Server-safe.
 */
export function TrainLink({ agent, zh, label, style }: { agent: AgentKey | "assistant"; zh: boolean; label?: string; style?: React.CSSProperties }) {
  const name = agent === "assistant" ? (zh ? "你的助理" : "your assistant") : zh ? AGENT_LABELS[agent].nameLocal : AGENT_LABELS[agent].nameEn;
  return (
    <Link
      href={`/train/${agent}`}
      prefetch={false}
      title={zh ? `给${name}写长期说明、上传范例` : `Standing instructions and examples for ${name}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#1f5fbf", textDecoration: "none", whiteSpace: "nowrap", ...style }}
    >
      {label ?? (zh ? `训练${name} →` : `Train ${name} →`)}
    </Link>
  );
}
