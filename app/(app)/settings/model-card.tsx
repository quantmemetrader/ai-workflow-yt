"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseModelAction, type ModelOption } from "./model-actions";

/**
 * The studio's default AI model, for owners and admins, in plain words.
 *
 * It lived as a picker under every chat box and every side panel, showing a
 * model id ("qwen/qwen3-max") to people who do not know what one is. Each
 * message can still pick its own in the chat box; this is the default.
 */
export const PLAIN: Record<string, { zh: string; en: string; noteZh: string; noteEn: string }> = {
  "qwen/qwen3-max": { zh: "标准", en: "Standard", noteZh: "中文好、最稳，推荐", noteEn: "Good Chinese, reliable — recommended" },
  "qwen/qwen3.7-max": { zh: "最强", en: "Strongest", noteZh: "长资料、长文章最好，价格约两倍", noteEn: "Best with long material, about twice the price" },
  "qwen/qwen3.7-plus": { zh: "省钱", en: "Economy", noteZh: "日常够用，便宜三分之二", noteEn: "Fine for everyday work, a third of the price" },
  "moonshotai/kimi-k2.6": { zh: "写作", en: "Writing", noteZh: "中文最自然，适合改稿", noteEn: "The most natural Chinese, good for rewrites" },
  "z-ai/glm-5.3": { zh: "第二意见", en: "Second opinion", noteZh: "另一家的模型，想多听一个意见时用", noteEn: "A different house, for a second read" },
  "deepseek/deepseek-v4-flash": { zh: "最便宜", en: "Cheapest", noteZh: "批量小活：标题、分类", noteEn: "Bulk small jobs: titles, sorting" },
  "deepseek:direct": { zh: "DeepSeek 自有账号", en: "DeepSeek (own key)", noteZh: "工作室自己的 DeepSeek，最便宜", noteEn: "The studio's own DeepSeek key, cheapest" },
};

export function ModelCard({ zh, options }: { zh: boolean; options: ModelOption[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [picked, setPicked] = useState(options.find((o) => o.current)?.id ?? null);
  const shown = options.filter((o) => o.tier !== "free");
  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="text-sm font-semibold text-ink-gray-9">{zh ? "默认 AI 模型" : "Default AI model"}</h2>
      <p className="mb-3 mt-1 text-xs text-ink-gray-5">{zh ? "每次对话也可以在输入框里单独选。" : "Each message can still pick its own in the chat box."}</p>
      <div className="flex flex-col gap-1.5">
        {shown.map((o) => {
          const p = PLAIN[o.id];
          const on = picked === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await chooseModelAction(o.id);
                  if (!("error" in r && r.error)) setPicked(o.id);
                  router.refresh();
                })
              }
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: `1px solid ${on ? "#171717" : "#e7e6e2"}`, background: on ? "#fafaf8" : "#fff", textAlign: "left", fontFamily: "inherit", cursor: busy ? "default" : "pointer" }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 99, border: `1.5px solid ${on ? "#171717" : "#c9c8c2"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {on ? <span style={{ width: 6, height: 6, borderRadius: 99, background: "#171717" }} /> : null}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "#171717", minWidth: 72 }}>{p ? (zh ? p.zh : p.en) : o.label}</span>
              <span style={{ fontSize: 12.5, color: "#6b6b6b", flexGrow: 1 }}>{p ? (zh ? p.noteZh : p.noteEn) : o.use}</span>
              <span style={{ fontSize: 11, color: "#b0b0ab" }}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
