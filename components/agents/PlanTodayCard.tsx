"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { INK, LINE, MUTED, bigButton } from "@/components/projects/kit";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { notify } from "@/lib/client/notify";

/** 策划's plan for the day (posted at 08:05 in #研究日报): the topic it puts forward and each colleague's part. */
export type PlanToday = { date: string; topic: string | null; items: { owner: string; text: string; why: string | null }[]; href: string | null };

const isAgent = (k: string): k is AgentKey => (AGENT_KEYS as readonly string[]).includes(k);

/**
 * 策划今日提报, on 首页 and at the top of 选题 (Catherine, 29 Sep: "让策划每天
 * 提报选题也没有了" — it was there, below the fold, so it read as gone).
 */
export function PlanTodayCard({ plan, zh, canWrite }: { plan: PlanToday; zh: boolean; canWrite: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function make() {
    if (!plan.topic || busy) return;
    setBusy(true);
    try {
      const res = await startFromTopicAction({ kind: "own", text: plan.topic }, { write: canWrite });
      if ("error" in res && res.error) return notify(res.error);
      if ("existed" in res && res.existed) notify(t("这个选题已经有项目了，为你打开它", "This topic already has a project; opening it"), "info");
      if ("projectId" in res && res.projectId) router.push(res.writing ? `/projects/${res.projectId}/script` : `/projects/${res.projectId}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <AgentIcon agent="planning" size={30} radius={8} />
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 650, color: INK }}>{t("策划今日提报", "The planner's report today")}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{t(`${plan.date} · 每天早上 8 点自动提报`, `${plan.date} · every morning at 8`)}</div>
        </div>
        {plan.href ? (
          <Link href={plan.href} prefetch={false} style={{ fontSize: 13, color: "#1f5fbf", textDecoration: "none", whiteSpace: "nowrap" }}>
            {t("看完整计划 →", "Full plan →")}
          </Link>
        ) : null}
      </div>
      {plan.topic ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: "#f7f7f5" }}>
          <div style={{ minWidth: 0, flexGrow: 1, flexBasis: 280 }}>
            <div style={{ fontSize: 12, color: MUTED }}>{t("提报的选题", "Proposed topic")}</div>
            <div style={{ fontSize: 16, fontWeight: 650, color: INK, lineHeight: 1.45, overflowWrap: "anywhere" }}>{plan.topic}</div>
          </div>
          <button type="button" disabled={busy} onClick={() => void make()} style={bigButton("primary", busy)}>
            <Icon name="film" size={15} />
            {busy ? t("正在开始…", "Starting…") : t("用这个做一条视频", "Make this video")}
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
