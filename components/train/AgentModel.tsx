"use client";

import { ModelChip } from "@/components/chat/ModelChip";
import { ModelTiles } from "@/components/chat/ModelTiles";
import { AUTO_MODEL, chatModel } from "@/lib/ai/chat-models";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, MUTED } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { setAgentModelAction } from "@/app/(app)/train/model-actions";
import { usualTiles } from "@/app/(app)/settings/model-card";

export type AgentModelOption = { id: string; label: string };

/**
 * Which model this employee answers with: the studio's default, or one of
 * its own. Saved at once; a single message can still pick another in the
 * chat box.
 */
export function AgentModel({ agent, name, zh, current, fallback, options, canChoose }: { agent: string; name: string; zh: boolean; current: string | null; fallback: string; options: AgentModelOption[]; canChoose: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [picked, setPicked] = React.useState<string | null>(current);
  const [busy, start] = React.useTransition();
  const nameOf = (id: string) => {
    const m = chatModel(id);
    return m.id === AUTO_MODEL ? (options.find((o) => o.id === id)?.label ?? id) : m.real && m.real !== id ? `${zh ? m.zh : m.en} · ${m.real}` : (options.find((o) => o.id === id)?.label ?? m.zh);
  };
  const choose = (id: string | null) => {
    if (!canChoose || busy) return;
    const before = picked;
    setPicked(id);
    start(async () => {
      const r = await setAgentModelAction(agent, id);
      if (r.error) {
        setPicked(before);
        notify(r.error);
        return;
      }
      notify(t(`${name}以后用：${id ? nameOf(id) : "工作室默认"}`, `${name} now uses ${id ? nameOf(id) : "the studio default"}`), "ok");
      router.refresh();
    });
  };
  const tiles = [{ id: AUTO_MODEL, title: t("工作室默认", "Studio default"), model: nameOf(fallback), note: t("跟着设置里的默认模型走", "Follows the default in Settings"), auto: true }, ...usualTiles(zh)];
  const value = picked ?? AUTO_MODEL;
  const other = picked && !tiles.some((m) => m.id === picked) ? picked : null;
  return (
    <Card
      icon="spark"
      title={t("用哪个模型", "Which model")}
      sub={canChoose ? (agent === "assistant" ? t("全工作室的助理共用这一个设置，改了所有人的助理都会换。聊天框里每条消息也可以临时换。", "One setting for every colleague's assistant. Any message can still pick another in the chat box.") : t(`只改${name}，其他 AI 同事不受影响。聊天框里每条消息也可以临时换。`, `Only for ${name}; the others keep theirs. Any message can still pick another in the chat box.`)) : t("管理员可以在这里给它换模型。", "An admin can change its model here.")}
      right={
        canChoose ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap" }}>{t("全部模型：", "Every model:")}</span>
            <ModelChip
              value={other ?? AUTO_MODEL}
              zh={zh}
              placement="down"
              align="right"
              note={t(`只改${name}，其他同事不受影响`, `Only for ${name}`)}
              autoLabel={{ zh: "选一个", en: "Choose", lineZh: "包括 Claude、GPT、Gemini", lineEn: "Claude, GPT and Gemini included" }}
              onChange={(id) => (id === AUTO_MODEL ? undefined : choose(id))}
            />
          </span>
        ) : undefined
      }
    >
      {other ? <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "#1f5fbf" }}>{t(`${name}现在用：${nameOf(other)}`, `${name} uses ${nameOf(other)}`)}</p> : null}
      <ModelTiles tiles={tiles} value={value} onPick={(id) => choose(id === AUTO_MODEL ? null : id)} disabled={!canChoose || busy} />
    </Card>
  );
}
