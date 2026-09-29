"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, INK, LINE, MUTED } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { setAgentModelAction } from "@/app/(app)/train/model-actions";
import { PLAIN } from "@/app/(app)/settings/model-card";

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
  const plain = (id: string) => PLAIN[id];
  const labelOf = (id: string) => (plain(id) ? `${zh ? plain(id)!.zh : plain(id)!.en} · ${options.find((o) => o.id === id)?.label ?? id}` : (options.find((o) => o.id === id)?.label ?? id));
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
      notify(t(`${name}以后用：${id ? labelOf(id) : "工作室默认"}`, `${name} now uses ${id ? labelOf(id) : "the studio default"}`), "ok");
      router.refresh();
    });
  };
  const row = (id: string | null, title: string, note: string) => {
    const on = picked === id;
    return (
      <button
        key={id ?? "default"}
        type="button"
        disabled={!canChoose || busy}
        onClick={() => choose(id)}
        aria-pressed={on}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: `1px solid ${on ? "#171717" : LINE}`, background: on ? "#fafaf8" : "#fff", cursor: canChoose ? "pointer" : "default", fontFamily: "inherit" }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 99, border: `1.5px solid ${on ? "#171717" : "#c9c8c2"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {on ? <span style={{ width: 7, height: 7, borderRadius: 99, background: "#171717" }} /> : null}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ fontSize: 12.5, color: MUTED, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</span>
      </button>
    );
  };
  return (
    <Card icon="spark" title={t("用哪个模型", "Which model")} sub={canChoose ? t(`只改${name}，其他同事不受影响。聊天框里每条消息也可以临时换。`, `Only for ${name}; the others keep theirs. Any message can still pick another in the chat box.`) : t("管理员可以在这里给它换模型。", "An admin can change its model here.")}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
        {row(null, t("工作室默认", "Studio default"), labelOf(fallback))}
        {options
          .filter((o) => plain(o.id))
          .map((o) => row(o.id, zh ? plain(o.id)!.zh : plain(o.id)!.en, `${zh ? plain(o.id)!.noteZh : plain(o.id)!.noteEn} · ${o.label}`))}
      </div>
    </Card>
  );
}
