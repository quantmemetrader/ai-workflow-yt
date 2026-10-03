import { AGENT_LABELS } from "@/lib/agents/catalog";
import type { TrainKey } from "@/lib/agents/train-keys";

/** The name and one-line job of whoever is being trained, 你的助理 included. */
export function trainName(key: TrainKey, zh: boolean): string {
  if (key === "assistant") return zh ? "你的助理" : "Your assistant";
  return zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].nameEn;
}

export function trainHint(key: TrainKey, zh: boolean): string {
  if (key === "assistant") return zh ? "每个同事的 AI 助理（全工作室共用这一套设置）：查资料、派活、回答问题" : "Everyone's assistant (one shared setup for the studio): looks things up, hands out work, answers";
  return zh ? AGENT_LABELS[key].hint : AGENT_LABELS[key].hintEn;
}

/* "3 分钟前" and the like are drawn by `components/ui/Ago.tsx`, which keeps
   the server's and the browser's renders from disagreeing; there is no
   `ago()` string helper here any more. */
