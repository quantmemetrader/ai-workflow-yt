"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PageBody, bigButton, INK, MUTED, LINE } from "@/components/projects/kit";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { PlanTodayCard, type PlanToday } from "@/components/agents/PlanTodayCard";
import { notify } from "@/lib/client/notify";
import type { TopicRef } from "@/lib/projects/topic";

/**
 * 选题 · 推荐 — "今天拍什么？" answered in a few big cards.
 *
 * The researcher's picks for today (the morning brief's signals, then its
 * ideas, strongest first, then what colleagues added), each with why now,
 * one or two numbers that prove it, and one press: 用这个做一条视频, which
 * starts a project from it — 编剧 writes the first draft while you land on
 * the script — exactly as Home's 开项目 does. Under them, one box to look up
 * a topic of your own or start straight from it.
 *
 * It replaced a dashboard of 250 rows across eight platforms with beat
 * chips, sparklines and a watchlist beside it; that table is 热点榜 now.
 */
export type PickCard = {
  key: string;
  title: string;
  why: string | null;
  proof: { label: string; numbers: string; url: string | null }[];
  tag: "brief" | "idea" | "mine" | "plan";
  by?: string | null;
  ref: TopicRef;
  /** A 研究员 idea: 不感兴趣 puts it away for everybody. */
  ideaId?: string | null;
  /** Already started as a project. */
  projectId?: string | null;
};

const HIDE_KEY = "aura:picks:hidden";

function readHidden(day: string): string[] {
  try {
    const raw = window.localStorage.getItem(HIDE_KEY);
    const v = raw ? (JSON.parse(raw) as { day?: string; keys?: string[] }) : null;
    return v?.day === day && Array.isArray(v.keys) ? v.keys : [];
  } catch {
    return [];
  }
}

function writeHidden(day: string, keys: string[]) {
  try {
    window.localStorage.setItem(HIDE_KEY, JSON.stringify({ day, keys }));
  } catch {
    /* private window: hidden for this visit only */
  }
}


export function PickBoard({ picks, zh, day, model, canWrite, plan = null }: { picks: PickCard[]; zh: boolean; day: string; model: string; canWrite: boolean; plan?: PlanToday | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [hidden, setHidden] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const agent = useInlineAgent({ module: "research" }, { key: "research" });
  React.useEffect(() => setHidden(readHidden(day)), [day]);

  const shown = picks.filter((p) => !hidden.includes(p.key)).slice(0, 5);

  async function start(key: string, ref: TopicRef) {
    if (busy) return;
    setBusy(key);
    try {
      const res = await startFromTopicAction(ref, { write: canWrite });
      if ("error" in res && res.error) {
        notify(res.error);
        return;
      }
      if ("projectId" in res && res.projectId) {
        if ("note" in res && res.note) notify(res.note, "info");
        router.push(res.writing ? `/projects/${res.projectId}/script` : `/projects/${res.projectId}`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(p: PickCard) {
    const next = [...hidden, p.key];
    setHidden(next);
    writeHidden(day, next);
    if (p.ideaId) {
      const r = await fetch(`/api/ideas/${p.ideaId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "dismissed" }) }).catch(() => null);
      if (!r?.ok) notify(t("没收起来，再试一次。", "Could not put it away; try again."));
    }
  }

  const TAG: Record<PickCard["tag"], string> = {
    brief: t("今早晨报", "This morning's brief"),
    idea: t("研究员挑的", "Picked by the researcher"),
    mine: t("同事加的", "Added by a colleague"),
    plan: t("今日计划", "Today's plan"),
  };

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      <PageBody width={1040}>
        {plan ? <PlanTodayCard plan={plan} zh={zh} canWrite={canWrite} /> : null}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, color: INK }}>{t("今天推荐拍这几个", "Worth making today")}</h2>
          <span style={{ fontSize: 12.5, color: MUTED }}>{t("研究员每天早上更新", "Updated every morning")}</span>
        </div>

        {shown.length === 0 ? (
          <div style={{ padding: "36px 20px", textAlign: "center", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, color: MUTED, fontSize: 14 }}>
            {t("今天的推荐还没出来。先看看各平台现在什么最热：", "Today's picks are not in yet. See what is hot on each platform:")}{" "}
            <Link href="/research/hot" prefetch={false} style={{ color: INK, fontWeight: 600 }}>
              {t("热点榜 →", "Hot now →")}
            </Link>
          </div>
        ) : (
          shown.map((p) => (
            <article key={p.key} className="pk-card" style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 2px rgba(0,0,0,.03)" }}>
              <span style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 600, color: "#5f5f5f", background: "#f3f3f1", borderRadius: 99, padding: "0 9px", lineHeight: "20px" }}>
                {p.tag === "mine" && p.by ? t(`${p.by} 加的`, `Added by ${p.by}`) : TAG[p.tag]}
              </span>
              <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.45, fontWeight: 650, color: INK }}>{p.title}</h3>
              {p.why ? (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#454545", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.why}</p>
              ) : null}
              {p.proof.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {p.proof.slice(0, 2).map((e, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#5f5f5f", minWidth: 0 }}>
                      <span style={{ width: 4, height: 4, borderRadius: 2, background: "#b8b8b4", flexShrink: 0 }} />
                      <span style={{ color: "#8a8a8a", flexShrink: 0 }}>{e.label}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{e.numbers}</span>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: "#8a8a8a", display: "inline-flex", flexShrink: 0 }} title={t("看原帖", "Open the post")}>
                          <Icon name="external" size={12} />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                {p.projectId ? (
                  <Link href={`/projects/${p.projectId}`} prefetch={false} style={bigButton("secondary")}>
                    <Icon name="check" size={15} /> {t("已经在做了 · 打开", "Already started · open")}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void start(p.key, p.ref)} disabled={busy !== null} style={bigButton("primary", busy !== null && busy !== p.key)}>
                    <Icon name="film" size={15} />
                    {busy === p.key ? t("正在开始…", "Starting…") : t("用这个做一条视频", "Make a video from this")}
                  </button>
                )}
                {!p.projectId ? (
                  <button type="button" onClick={() => void dismiss(p)} className="pk-quiet">
                    {t("不感兴趣", "Not for us")}
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}

        <section style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: INK }}>{t("自己查一个话题", "Look up your own topic")}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = q.trim();
              if (v) router.push(`/research/compare?q=${encodeURIComponent(v.slice(0, 60))}`);
            }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("输入一个词，看各平台热不热", "Type a word to see how hot it is")}
              style={{ flex: "1 1 280px", minWidth: 0, height: 40, padding: "0 14px", border: "1px solid #d6d5d0", borderRadius: 10, fontSize: 14, fontFamily: "inherit", outline: "none" }}
            />
            <button type="submit" disabled={!q.trim()} style={bigButton("secondary", !q.trim())}>
              <Icon name="eye" size={15} /> {t("查热度", "Check")}
            </button>
            <button type="button" disabled={!q.trim() || busy !== null} onClick={() => void start(`own:${q}`, { kind: "own", text: q.trim().slice(0, 200) })} style={bigButton("primary", !q.trim() || busy !== null)}>
              <Icon name="film" size={15} /> {busy === `own:${q}` ? t("正在开始…", "Starting…") : t("直接做成视频", "Make it now")}
            </button>
          </form>
        </section>
        <style>{`.pk-quiet{border:0;background:none;padding:0 4px;font:inherit;font-size:13px;color:#8a8a8a;cursor:pointer}.pk-quiet:hover{color:#171717}`}</style>
      </PageBody>
      <ResearchAgentPanel
        accent="#007be0"
        zh={zh}
        scope={t("今天的推荐", "Today's picks")}
        note={t("问研究员：哪个最值得拍，或者某个话题为什么火。", "Ask the researcher which one is worth making, or why a topic is hot.")}
        placeholder={t("问研究员…", "Ask the researcher…")}
        model={model}
        attach
          onAsk={(prompt, files) => void agent.send(prompt, files)}
        tools={<AgentHistory zh={zh} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
        thread={<InlineAgentThread messages={agent.messages} notice={agent.notice} conversationId={agent.conversationId} zh={zh} />}
      />
    </div>
  );
}

