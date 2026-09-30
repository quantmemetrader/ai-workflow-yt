"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, INK, LINE, MUTED } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { decideProposalAction, reflectNowAction } from "@/app/(app)/train/learn-actions";
import type { FeedbackKind, LearningState } from "@/lib/agents/learning";

const KIND_ZH: Record<FeedbackKind, string> = { good: "有用", bad: "不好", redo: "要求再改", reject: "拒绝改法", sendback: "退回", taught: "教的规则" };
const KIND_EN: Record<FeedbackKind, string> = { good: "Helpful", bad: "Not good", redo: "Redo", reject: "Rejected edit", sendback: "Sent back", taught: "Taught" };

/** 它在学习: what colleagues' feedback says, and the rules the employee proposes from it (adopt or dismiss). */
export function AgentLearning({ agent, name, zh, state, canTrain }: { agent: string; name: string; zh: boolean; state: LearningState; canTrain: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const kinds = Object.keys(state.counts) as FeedbackKind[];
  const total = kinds.reduce((n, k) => n + state.counts[k], 0);
  const btn = (primary = false): React.CSSProperties => ({ height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${primary ? "#171717" : "#dcdbd6"}`, background: primary ? "#171717" : "#fff", color: primary ? "#fff" : "#262626", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" });
  return (
    <Card icon="spark" title={t("它在学习", "Learning")} sub={t(`从同事的反馈里总结${name}该怎么改进；你采纳之后才会生效。${state.adopted ? `已经采纳 ${state.adopted} 条。` : ""}`, `What colleagues' feedback says ${name} should change; nothing applies until you adopt it.`)}>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>
        {total
          ? t("最近 30 天：", "Last 30 days: ") + kinds.filter((k) => state.counts[k]).map((k) => `${zh ? KIND_ZH[k] : KIND_EN[k]} ${state.counts[k]}`).join(" · ")
          : t("还没有反馈。在聊天里点回复下面的「有用 / 不好」，或者在脚本里拒绝、再改改，都会记在这里。", "No feedback yet. Helpful / Not good under replies, rejected script edits and redos all land here.")}
      </div>

      {state.pending.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{t(`${name}建议加入这些规则`, `${name} proposes these rules`)}</div>
          {state.pending.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${LINE}`, borderRadius: 10, background: "#fafaf8" }}>
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.55 }}>{p.rule}</div>
                {p.why ? <div style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.5 }}>{t("依据：", "Why: ")}{p.why}</div> : null}
              </div>
              {canTrain ? (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" disabled={pending} style={btn(true)} onClick={() => start(async () => { const r = await decideProposalAction(agent, p.id, true); if (r.error) return notify(r.error); notify(t("已加进工作说明", "Added to the instructions"), "ok"); router.refresh(); })}>{t("采纳", "Adopt")}</button>
                  <button type="button" disabled={pending} style={btn()} onClick={() => start(async () => { const r = await decideProposalAction(agent, p.id, false); if (r.error) return notify(r.error); router.refresh(); })}>{t("忽略", "Dismiss")}</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {canTrain ? (
        <button
          type="button"
          disabled={pending || !total}
          style={{ ...btn(!state.pending.length && state.since > 0), opacity: !total ? 0.5 : 1 }}
          onClick={() =>
            start(async () => {
              const r = await reflectNowAction(agent);
              if (r.error) return notify(r.error);
              notify(r.added ? t(`总结出 ${r.added} 条新规则，看看要不要采纳`, `${r.added} new rules to review`) : t("这次没有新的规则要加", "Nothing new to add this time"), "ok");
              router.refresh();
            })
          }
        >
          {pending ? t("正在总结…", "Reviewing…") : t(`现在让${name}总结一次反馈${state.since ? `（${state.since} 条新反馈）` : ""}`, `Have ${name} review the feedback now`)}
        </button>
      ) : null}

      {state.recent.length ? (
        <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{t("最近的反馈", "Recent feedback")}</div>
          {state.recent.map((f, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "#454545", lineHeight: 1.5, overflowWrap: "anywhere" }}>
              <b style={{ fontWeight: 600 }}>{zh ? KIND_ZH[f.kind] : KIND_EN[f.kind]}</b>
              {f.text ? `：${f.text}` : ""}
              <span style={{ color: "#a3a3a3" }}> — {f.by}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
