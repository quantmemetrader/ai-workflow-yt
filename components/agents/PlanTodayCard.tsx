"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { INK, LINE, MUTED, bigButton } from "@/components/projects/kit";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { refreshPlanAction } from "@/app/(app)/research/plan-actions";
import { notify } from "@/lib/client/notify";

/** 策划's plan for the day (posted at 08:05 in #研究日报): the topic it puts forward and each colleague's part. */
export type PlanToday = { date: string; topic: string | null; items: { owner: string; text: string; why: string | null }[]; href: string | null; /** 文案 already wrote the topic's first draft (how many beats). */ prepared?: { beats: number } | null };

const isAgent = (k: string): k is AgentKey => (AGENT_KEYS as readonly string[]).includes(k);

/**
 * 策划今日提报, on 首页 and at the top of 选题 (Catherine, 29 Sep: "让策划每天
 * 提报选题也没有了" — it was there, below the fold, so it read as gone).
 */
export function PlanTodayCard({
  plan,
  zh,
  canWrite,
  canRedo = true,
}: {
  plan: PlanToday;
  zh: boolean;
  canWrite: boolean;
  /** 换一份 replaces the plan for the whole studio: an owner's or admin's press (QA, 2 Oct). */
  canRedo?: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [redoing, setRedoing] = React.useState(false);
  async function redo() {
    if (redoing) return;
    setRedoing(true);
    try {
      const res = await refreshPlanAction();
      if (res.error) return notify(res.error);
      notify(res.topic ? t(`策划换了一个选题：《${res.topic}》`, `New topic: ${res.topic}`) : t("策划重新提报了", "The planner posted a new plan"), "ok");
      router.refresh();
    } finally {
      setRedoing(false);
    }
  }
  async function make() {
    if (!plan.topic || busy) return;
    setBusy(true);
    try {
      const res = await startFromTopicAction({ kind: "own", text: plan.topic }, { write: canWrite });
      if ("error" in res && res.error) return notify(res.error);
      if ("existed" in res && res.existed) notify(t("这个选题已经有项目了，为你打开它", "This topic already has a project; opening it"), "info");
      if ("projectId" in res && res.projectId) router.push(res.writing || ("ready" in res && res.ready) ? `/projects/${res.projectId}/script` : `/projects/${res.projectId}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, opacity: redoing ? 0.75 : 1, transition: "opacity .2s ease" }}>
      <style>{`@keyframes ptSpin{to{transform:rotate(360deg)}}.pt-spin{animation:ptSpin 1s linear infinite}@media (prefers-reduced-motion: reduce){.pt-spin{animation:none}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <AgentIcon agent="planning" size={30} radius={8} />
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 650, color: INK }}>{t("策划今日提报", "The planner's report today")}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{t(`${plan.date} · 每天早上 8 点自动提报`, `${plan.date} · every morning at 8`)}</div>
        </div>
        {canRedo ? (
        <button
          type="button"
          onClick={() => void redo()}
          disabled={redoing}
          title={t("不喜欢这个选题？让策划换一个，重新提报", "Ask the planner for a different topic")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: "#333", fontFamily: "inherit", fontSize: 12.5, cursor: redoing ? "default" : "pointer", whiteSpace: "nowrap" }}
        >
          <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={redoing ? "pt-spin" : undefined}>
            <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
            <path d="M4 3.5V8h4.5" />
            <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
            <path d="M20 20.5V16h-4.5" />
          </svg>
          {redoing ? t("策划正在重新想…（约半分钟）", "Thinking again…") : t("换一份", "Another one")}
        </button>
        ) : null}
        {plan.href ? (
          <Link href={plan.href} prefetch={false} style={{ fontSize: 13, color: "#1f5fbf", textDecoration: "none", whiteSpace: "nowrap" }}>
            {t("看完整计划 →", "Full plan →")}
          </Link>
        ) : null}
      </div>
      {plan.topic ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: "#f7f7f5" }}>
          <div style={{ minWidth: 0, flexGrow: 1, flexBasis: 280 }}>
            <div style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {t("提报的选题", "Proposed topic")}
              {plan.prepared ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#0b7a63", background: "#e3f4ee", borderRadius: 999, padding: "0 8px", lineHeight: "18px" }}>
                  <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                  {t(`文案已写好初稿（${plan.prepared.beats} 个分镜）`, `First draft ready (${plan.prepared.beats} beats)`)}
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: 16, fontWeight: 650, color: INK, lineHeight: 1.45, overflowWrap: "anywhere" }}>{plan.topic}</div>
          </div>
          <button type="button" disabled={busy} onClick={() => void make()} style={bigButton("primary", busy)}>
            <Icon name="film" size={15} />
            {busy ? t("正在开始…", "Starting…") : plan.prepared ? t("打开写好的稿子", "Open the draft") : t("用这个做一条视频", "Make this video")}
          </button>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {plan.items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
            {isAgent(it.owner) ? <AgentIcon agent={it.owner} size={22} radius={6} /> : <span style={{ width: 22, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.55, overflowWrap: "anywhere" }}>
                {isAgent(it.owner) ? <b style={{ fontWeight: 600 }}>{zh ? AGENT_LABELS[it.owner].nameLocal : AGENT_LABELS[it.owner].nameEn}：</b> : null}
                {it.text}
              </div>
              {it.why ? <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, marginTop: 1 }}>{it.why}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
