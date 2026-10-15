"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { onBump } from "@/lib/client/live";
import { notifyRich } from "@/lib/client/notify";
import type { WorkItem } from "@/lib/work/tracker";

/**
 * Every task in flight, one press from any page (15 Oct: "a good-looking loading bar of how much is done and
 * how much time is left, for all the tasks — script, video, everything — with a small line about what it is
 * actually doing, for all agents").
 *
 * The top bar carries a pill — a ring for the overall progress and how many tasks are running — and opens a
 * panel with one card per task: who is doing it, what it is about, the step it is on, a bar, the percentage
 * and the time left. The numbers move every second between polls; the poll is quick while anything runs and
 * slow when nothing does. A task that finishes says so once, with a link to it.
 */
const ASSISTANT: AgentKey | null = null;
const agentOf = (a: string | null): AgentKey | null => (a && (AGENT_KEYS as readonly string[]).includes(a) ? (a as AgentKey) : ASSISTANT);

function left(ms: number | null, zh: boolean): string {
  if (ms == null) return zh ? "比平时久一些" : "longer than usual";
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return zh ? `约剩 ${s} 秒` : `~${s}s left`;
  const m = Math.round(s / 60);
  return zh ? `约剩 ${m} 分钟` : `~${m} min left`;
}
function ago(iso: string | null, now: number, zh: boolean): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return zh ? `${s} 秒` : `${s}s`;
  return zh ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TaskTracker({ zh }: { zh: boolean }) {
  const [items, setItems] = React.useState<WorkItem[]>([]);
  const [polledAt, setPolledAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [open, setOpen] = React.useState(false);
  const told = React.useRef<Set<string>>(new Set());
  const first = React.useRef(true);
  const btn = React.useRef<HTMLButtonElement | null>(null);

  const active = items.filter((i) => i.status === "running" || i.status === "queued");
  const busy = active.length > 0;

  const poll = React.useCallback(async () => {
    try {
      const r = await fetch("/api/work", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { items: WorkItem[] };
      const list = Array.isArray(data.items) ? data.items : [];
      /* Finished since the last look: said once, with a way to it. Not on the first poll (old news). */
      for (const w of list) {
        if ((w.status === "done" || w.status === "failed") && !told.current.has(w.id)) {
          told.current.add(w.id);
          if (!first.current && w.kind === "job")
            notifyRich({
              kind: w.status === "done" ? "ok" : "error",
              title: w.status === "done" ? (zh ? `${w.label}完成` : `${w.labelEn} done`) : zh ? `${w.label}没做成` : `${w.labelEn} failed`,
              text: w.status === "done" ? w.title : `${w.title}${w.error ? ` · ${w.error}` : ""}`,
              ...(w.href ? { actions: [{ label: zh ? "打开" : "Open", href: w.href }] } : {}),
            });
        }
      }
      first.current = false;
      setItems(list);
      setPolledAt(Date.now());
    } catch {
      /* the next poll runs */
    }
  }, [zh]);

  React.useEffect(() => {
    void poll();
    const off = onBump(() => void window.setTimeout(poll, 800));
    return off;
  }, [poll]);
  /* Something was just started (a server action, or a POST to our own API): look now instead of on the 15-second tick,
     so the task is in the panel by the time anyone opens it (15 Oct: 整条视频 started, panel still said 没有正在做的事). */
  React.useEffect(() => {
    const orig = window.fetch;
    let t = 0;
    const isAction = (h: HeadersInit | undefined) =>
      !!h && (h instanceof Headers ? h.has("next-action") : Array.isArray(h) ? h.some(([k]) => k.toLowerCase() === "next-action") : Object.keys(h).some((k) => k.toLowerCase() === "next-action"));
    const wrapped: typeof fetch = async (input, init) => {
      const res = await orig(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const post = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "POST";
      if (isAction(init?.headers) || (post && /^(https?:\/\/[^/]+)?\/api\//.test(url) && !url.includes("/api/work"))) {
        window.clearTimeout(t);
        t = window.setTimeout(() => void poll(), 700);
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      window.clearTimeout(t);
      if (window.fetch === wrapped) window.fetch = orig;
    };
  }, [poll]);
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") void poll();
      else setPolledAt(Date.now());
    }, busy || open ? 2500 : 15000);
    return () => window.clearTimeout(t);
  }, [polledAt, busy, open, poll]);
  React.useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [busy]);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  /* Between polls: estimated bars creep on and time left counts down, so nothing looks frozen. */
  const since = Math.max(0, now - polledAt);
  const live = (w: WorkItem) => {
    if (w.status !== "running") return { p: w.progress, eta: w.etaMs };
    const eta = w.etaMs == null ? null : Math.max(2000, w.etaMs - since);
    const total = w.typicalMs ?? 0;
    const p = w.estimated && total ? Math.min(0.96, w.progress + since / total) : eta != null && w.etaMs ? Math.min(0.97, w.progress + (1 - w.progress) * (1 - eta / w.etaMs)) : w.progress;
    return { p, eta };
  };
  const overall = active.length ? active.reduce((a, w) => a + live(w).p, 0) / active.length : 0;
  const running = active.filter((w) => w.status === "running").length;

  const R = 7;
  const C = 2 * Math.PI * R;
  return (
    <>
      <style>{CSS}</style>
      <button ref={btn} type="button" className={`tt-pill${busy ? " busy" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} title={zh ? "任务进度" : "Tasks"}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={R} fill="none" stroke="#e6e5e1" strokeWidth="2.4" />
          {busy ? <circle cx="9" cy="9" r={R} fill="none" stroke="#171717" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.04, overall))} transform="rotate(-90 9 9)" style={{ transition: "stroke-dashoffset .8s ease" }} /> : <path d="m5.6 9.2 2.2 2.2 4.4-4.6" fill="none" stroke="#8a8a8a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        <span className="tt-pill-t">{busy ? (zh ? `${running || active.length} 个任务进行中` : `${running || active.length} running`) : zh ? "任务" : "Tasks"}</span>
        {busy ? <span className="tt-pill-p">{Math.round(overall * 100)}%</span> : null}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="tt-veil" onClick={() => setOpen(false)} />
              <div className="tt-panel" role="dialog" aria-label={zh ? "任务进度" : "Tasks"}>
                <div className="tt-head">
                  <div>
                    <div className="tt-title">{zh ? "任务进度" : "Tasks"}</div>
                    <div className="tt-sub">{busy ? (zh ? `${active.length} 个进行中或排队 · 每秒更新` : `${active.length} running or queued · live`) : zh ? "现在没有正在做的事" : "Nothing running right now"}</div>
                  </div>
                  <button type="button" className="tt-x" onClick={() => setOpen(false)} aria-label={zh ? "关闭" : "Close"}>×</button>
                </div>
                <div className="tt-list">
                  {items.length === 0 ? (
                    <div className="tt-empty">
                      <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="#d6d5d0" strokeWidth="1.6" /><path d="m8 12.3 2.7 2.7L16.2 9.4" fill="none" stroke="#b5b5b5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <div>{zh ? "写稿、剪辑、渲染、配音、生成图片，以及 AI 同事在做的事，都会在这里显示进度和剩余时间。" : "Drafts, cuts, renders, voices, pictures and what the AI team is doing show here with progress and time left."}</div>
                    </div>
                  ) : null}
                  {items.map((w) => {
                    const { p, eta } = live(w);
                    const pct = Math.round(p * 100);
                    const body = (
                      <>
                        <div className="tt-row1">
                          <span className="tt-face"><AgentIcon agent={agentOf(w.agent)} size={26} radius={8} /></span>
                          <div className="tt-what">
                            <div className="tt-label">
                              {zh ? w.label : w.labelEn}
                              <span className={`tt-state s-${w.status}`}>{w.status === "running" ? (zh ? "进行中" : "Running") : w.status === "queued" ? (zh ? "排队" : "Queued") : w.status === "done" ? (zh ? "完成" : "Done") : zh ? "失败" : "Failed"}</span>
                            </div>
                            <div className="tt-name" title={w.title}>{w.title}</div>
                          </div>
                          {w.status === "running" ? <span className="tt-pct">{pct}%</span> : null}
                        </div>
                        {w.status === "running" || w.status === "queued" ? (
                          <div className={`tt-bar${w.estimated ? " est" : ""}${w.status === "queued" ? " q" : ""}`}><span style={{ width: `${w.status === "queued" ? 100 : Math.max(3, pct)}%` }} /></div>
                        ) : null}
                        <div className="tt-row3">
                          <span className="tt-stage">{w.status === "failed" && w.error ? w.error : w.stage}</span>
                          <span className="tt-time">
                            {w.status === "running" ? `${ago(w.startedAt, now, zh)} · ${left(eta, zh)}` : w.status === "queued" ? left(eta, zh).replace("约剩", "约") : w.finishedAt ? ago(w.finishedAt, now, zh) + (zh ? "前" : " ago") : ""}
                          </span>
                        </div>
                      </>
                    );
                    return w.href ? (
                      <Link key={w.id} href={w.href} prefetch={false} className={`tt-card c-${w.status}`} onClick={() => setOpen(false)}>
                        {body}
                      </Link>
                    ) : (
                      <div key={w.id} className={`tt-card c-${w.status}`}>
                        {body}
                      </div>
                    );
                  })}
                </div>
                <div className="tt-foot">{zh ? "进度和剩余时间按这类任务以往的用时估算；有实际进度的（渲染、生成图片、口播）按实际。" : "Time left is estimated from how long this kind of task took before; renders, pictures and talking hosts report real progress."}</div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

const CSS = `
.tt-pill { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 10px 0 6px; border-radius: 999px; border: 1px solid #ededed; background: #fff; color: #525252; font: inherit; font-size: 12px; cursor: pointer; flex-shrink: 0; transition: border-color .12s, box-shadow .12s; }
.tt-pill:hover { border-color: #d4d4d4; }
.tt-pill.busy { color: #171717; border-color: #e1e0db; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.tt-pill-t { white-space: nowrap; font-weight: 500; }
.tt-pill-p { font-variant-numeric: tabular-nums; color: #8a8a8a; font-size: 11.5px; }
.tt-veil { position: fixed; inset: 0; z-index: 900; }
.tt-panel { position: fixed; top: 44px; right: 14px; z-index: 901; width: 392px; max-width: calc(100vw - 20px); max-height: calc(100dvh - 60px); display: flex; flex-direction: column; background: #fff; border: 1px solid #e6e5e0; border-radius: 16px; box-shadow: 0 24px 60px -18px rgba(17,17,17,.28), 0 2px 8px rgba(17,17,17,.06); animation: tt-in .16s ease-out; }
@keyframes tt-in { from { opacity: 0; transform: translateY(-4px) scale(.99); } to { opacity: 1; transform: none; } }
.tt-head { display: flex; align-items: flex-start; padding: 14px 16px 10px; border-bottom: 1px solid #f0efeb; }
.tt-head > div { flex: 1; }
.tt-title { font-size: 14.5px; font-weight: 600; color: #171717; }
.tt-sub { font-size: 12px; color: #8a8a8a; margin-top: 2px; }
.tt-x { border: 0; background: transparent; font-size: 20px; line-height: 1; color: #8a8a8a; cursor: pointer; padding: 0 2px; }
.tt-list { overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.tt-card { display: block; text-decoration: none; color: inherit; border: 1px solid #efeee9; border-radius: 12px; padding: 10px 12px; background: #fff; transition: border-color .12s, box-shadow .12s; }
a.tt-card:hover { border-color: #d6d5d0; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
.tt-card.c-running { background: linear-gradient(180deg, #fff, #fbfbfa); }
.tt-card.c-done, .tt-card.c-failed { opacity: .82; }
.tt-row1 { display: flex; align-items: center; gap: 10px; }
.tt-face { flex-shrink: 0; display: inline-flex; }
.tt-what { min-width: 0; flex: 1; }
.tt-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6b6b6b; }
.tt-state { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; font-weight: 600; }
.tt-state.s-running { background: #e8f3ec; color: #2f7d4f; }
.tt-state.s-queued { background: #f2f1ed; color: #6b6b6b; }
.tt-state.s-done { background: #eef4fb; color: #2a5d8f; }
.tt-state.s-failed { background: #fbeaea; color: #b42323; }
.tt-name { font-size: 13.5px; font-weight: 600; color: #171717; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.tt-pct { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; color: #171717; }
.tt-bar { height: 6px; border-radius: 3px; background: #efeee9; overflow: hidden; margin: 9px 0 6px; }
.tt-bar span { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #262626, #555); position: relative; overflow: hidden; transition: width .9s ease; }
.tt-bar span::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.38), transparent); animation: tt-shine 1.5s linear infinite; }
.tt-bar.est span { background: repeating-linear-gradient(-45deg, #2b2b2b 0 8px, #474747 8px 16px); background-size: 22px 22px; animation: tt-stripe 1s linear infinite; }
.tt-bar.q span { background: repeating-linear-gradient(-45deg, #e3e2dd 0 8px, #ecebe7 8px 16px); animation: tt-stripe 1.6s linear infinite; }
.tt-bar.q span::after { display: none; }
@keyframes tt-shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes tt-stripe { from { background-position: 0 0; } to { background-position: 22px 0; } }
.tt-row3 { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12px; }
.tt-stage { color: #525252; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-failed .tt-stage { color: #b42323; white-space: normal; }
.tt-time { color: #8a8a8a; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tt-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; color: #8a8a8a; font-size: 12.5px; line-height: 1.6; padding: 26px 18px; }
.tt-foot { border-top: 1px solid #f0efeb; padding: 9px 16px 11px; font-size: 11px; color: #a3a3a3; line-height: 1.5; }
@media (max-width: 760px) { .tt-pill-t { display: none; } .tt-panel { top: 50px; right: 8px; left: 8px; width: auto; } }
`;
