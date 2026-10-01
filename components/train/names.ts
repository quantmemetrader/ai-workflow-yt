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

export function ago(iso: string, zh: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return zh ? "刚刚" : "just now";
  if (s < 3600) return zh ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return zh ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return zh ? `${Math.round(s / 86400)} 天前` : `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(zh ? "zh-CN" : "en");
}
