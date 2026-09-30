"use client";

import { ModelChip } from "@/components/chat/ModelChip";
import { ModelTiles, type ModelTile } from "@/components/chat/ModelTiles";
import { AUTO_MODEL, CHAT_MODELS } from "@/lib/ai/chat-models";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { chooseModelAction, type ModelOption } from "./model-actions";

/**
 * The studio's default AI model, for owners and admins, in plain words.
 * The same names and cards as the chat box's picker (the owner, 30 Sep:
 * "change this for our new ui"); any other model is one chip away.
 */
export const PLAIN: Record<string, { zh: string; en: string; noteZh: string; noteEn: string }> = Object.fromEntries(
  CHAT_MODELS.filter((m) => m.id !== AUTO_MODEL).map((m) => [m.id, { zh: m.zh, en: m.en, noteZh: m.lineZh, noteEn: m.lineEn }]),
);

/** The usual models as tiles, in the chat picker's words. */
export function usualTiles(zh: boolean): ModelTile[] {
  return CHAT_MODELS.filter((m) => m.id !== AUTO_MODEL).map((m) => ({ id: m.id, title: zh ? m.zh : m.en, model: m.real, note: zh ? m.lineZh : m.lineEn }));
}

export function ModelCard({ zh, options }: { zh: boolean; options: ModelOption[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [picked, setPicked] = useState(options.find((o) => o.current)?.id ?? null);
  const direct = options.find((o) => o.id === "deepseek:direct");
  const tiles: ModelTile[] = [
    ...usualTiles(zh),
    ...(direct ? [{ id: direct.id, title: zh ? "DeepSeek 自有账号" : "DeepSeek (own key)", model: "DeepSeek", note: zh ? "工作室自己的 DeepSeek 账号，最便宜" : "The studio's own DeepSeek key, cheapest", vendor: "deepseek" }] : []),
  ];
  const choose = (id: string) =>
    start(async () => {
      const before = picked;
      setPicked(id);
      const r = await chooseModelAction(id);
      if ("error" in r && r.error) {
        setPicked(before);
        notify(r.error);
        return;
      }
      notify(zh ? "已更换工作室默认模型" : "Studio default changed", "ok");
      router.refresh();
    });
  const other = picked && !tiles.some((m) => m.id === picked) ? picked : null;
  return (
    <section className="rounded-xl border border-outline-gray-1" style={{ padding: "18px 18px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650, color: "#171717" }}>{zh ? "默认 AI 模型" : "Default AI model"}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#7a7a76", lineHeight: 1.55 }}>
            {zh ? "全工作室默认用这个。每个 AI 同事可以在「AI 同事 › 训练」里单独设，每条消息也可以在输入框里临时换。" : "The whole studio's default. Each AI employee can have its own, and any message can pick another."}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12.5, color: "#7a7a76" }}>{zh ? "全部模型：" : "Every model:"}</span>
          <ModelChip
            value={other ?? AUTO_MODEL}
            zh={zh}
            placement="down"
            align="right"
            note={zh ? "全工作室默认用这个模型" : "The whole studio's default"}
            autoLabel={{ zh: "选一个", en: "Choose", lineZh: "下面的常用模型之外的", lineEn: "Beyond the usual ones below" }}
            onChange={(id) => (id === AUTO_MODEL ? undefined : choose(id))}
          />
        </div>
      </div>
      {other ? (
        <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "#1f5fbf" }}>{zh ? "现在用的是上面选的模型，不在下面的常用列表里。" : "Using the model chosen above, not one of the usual ones."}</p>
      ) : null}
      <ModelTiles tiles={tiles} value={picked} onPick={choose} disabled={busy} />
    </section>
  );
}
