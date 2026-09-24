"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_LABELS, agentTag, type AgentKey } from "@/lib/agents/catalog";
import type { AgentState, Decision, Running } from "@/lib/home/service";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { ProjectChats, ProjectProgress } from "@/components/home/ProjectHub";
import { SuggestionCard, type TodaySuggestion } from "@/components/home/Suggestion";
import type { ProjectDetail } from "@/lib/projects/service";
import { startProjectAction } from "@/app/(app)/projects/actions";
import { Fold } from "@/components/ui/Fold";
import { SayToAgent } from "@/components/flow/SayToAgent";
import type { ThreadMessage } from "@/components/home/Echo";
import type { Pipeline } from "@/lib/home/pipeline";

/**
 * 首页 — where the day is driven from, not a page that sends you elsewhere.
 *
 * Built back over the earlier Home, with its pieces: the rounded task box
 * with each employee's own mark, the cards waiting on you, the team with a
 * line to give each work, and the assistant panel on the right (the page
 * passes it in). What is new is that the work happens here:
 *
 *   - the conversation in #制作 is on the page, answers and buttons included,
 *     so saying something and hearing back no longer means leaving;
 *   - today's video is drawn as the flow board draws it, two rows, and every
 *     step has a line to talk to whoever owns it;
 *   - the full flow is one big button, not a small link.
 */
export function HomeScreen({
  agents,
  decisions,
  running,
  runningNames,
  zh,
  me,
  people,
  thread,
  projects,
  hub,
  suggestions,
}: {
  suggestions: TodaySuggestion[];
  /** The active projects, with their steps and latest messages. */
  hub: ProjectDetail[];
  /** Where a task can go: an existing project, or a new one. */
  projects: { id: string; title: string; channelSlug: string | null }[];
  pipeline: Pipeline;
  thread: ThreadMessage[];
  agents: AgentState[];
  decisions: Decision[];
  running: (Running & { label: string; owner?: AgentKey | null })[];
  teamChannel: { id: string; slug: string; name: string } | null;
  runningNames: Record<string, string>;
  zh: boolean;
  me: string;
  people: MentionPerson[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people, zh, draft, setDraft, box });
  const [giveTo, setGiveTo] = React.useState<AgentKey | null>(null);
  /* Which project the task box sends to: a new one unless one is chosen. */
  const [target, setTarget] = React.useState<string>("new");

  /* After something is said, the answer comes from a model call that ends
     after the request returns. Refresh every few seconds for a minute and a
     half, then stop. */
  const [watching, setWatching] = React.useState(false);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const answered = thread.some((m) => m.agent && sentAt !== null && m.at > sentAt);
  React.useEffect(() => {
    if (!watching || answered) return;
    const until = Date.now() + 90_000;
    const id = setInterval(() => {
      if (Date.now() >= until) {
        clearInterval(id);
        setWatching(false);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [watching, answered, router]);

  const t = (a: string, b: string) => (zh ? a : b);

  function press(channelSlug: string, messageId: string, actionId: string) {
    if (pressing) return;
    setError(null);
    setPressing(messageId + actionId);
    start(async () => {
      const res = await pressCardAction(channelSlug, messageId, actionId);
      setPressing(null);
      if (res?.error) setError(res.error);
      else {
        setSentAt(new Date().toISOString());
        setWatching(true);
        router.refresh();
      }
    });
  }

  /* The task box starts a project (or adds to one) and goes there: the work
     happens on the project's page, not here. */
  function startWork(body: string) {
    const text = body.trim();
    if (!text) return;
    setError(null);
    start(async () => {
      if (target === "new") {
        const r = await startProjectAction({ message: text });
        if ("error" in r && r.error) {
          setError(r.error);
          return;
        }
        setDraft("");
        if ("id" in r && r.id) router.push(`/projects/${r.id}`);
        return;
      }
      const p = projects.find((x) => x.id === target);
      if (!p?.channelSlug) return;
      const res = await sendChannelMessage(p.channelSlug, text);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDraft("");
      router.push(`/projects/${p.id}`);
    });
  }


  const subline =
    decisions.length > 0
      ? t(`有 ${decisions.length} 件事等你决定。`, `${decisions.length} thing${decisions.length > 1 ? "s" : ""} waiting on you.`)
      : running.length > 0
        ? t("没有要你决定的，同事还在做手上的活。", "Nothing waiting on you; the team is still working.")
        : t("今天没有待办。在下面说一句就能开工。", "Nothing on today. Say a word below and the team starts.");

  const composer = (
    <div style={{ position: "relative" }}>
      <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="down" />
      <div style={{ border: "1px solid #e2e2e2", borderRadius: 16, background: "#fff", padding: "12px 14px", boxShadow: "0 2px 10px rgba(0,0,0,0.04)" }}>
        <textarea
          ref={box}
          value={draft}
          rows={2}
          onChange={(e) => {
            setDraft(e.target.value);
            mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(180, e.target.scrollHeight)}px`;
          }}
          onBlur={mentions.close}
          onKeyDown={(e) => {
            if (mentions.onKeyDown(e)) return;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              startWork(draft);
            }
          }}
          placeholder={t("想做什么？例如：@编剧 把 RWA 这条写成 60 秒竖版", "What do you want made? e.g. @writer make the RWA piece a 60s vertical")}
          style={{ width: "100%", border: 0, outline: "none", resize: "none", fontSize: 14.5, lineHeight: 1.6, fontFamily: "inherit", letterSpacing: "inherit", color: "#171717", background: "transparent" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexGrow: 1, minWidth: 0 }}>
            {(["research", "planning", "script", "video", "article"] as AgentKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDraft((d) => (d.includes(agentTag(key)) ? d : `${agentTag(key)} ${d}`.trim()));
                  requestAnimationFrame(() => box.current?.focus());
                }}
                className="chip"
                style={{ height: 28, fontSize: 12, gap: 6, cursor: "pointer", borderColor: draft.includes(agentTag(key)) ? "#171717" : "#ededed", background: "#fff" }}
              >
                <AgentIcon agent={key} size={16} radius={5} />
                {zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].name}
              </button>
            ))}
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={t("交给哪个项目", "Which project")}
              style={{ height: 28, marginLeft: 4, padding: "0 8px", border: "1px solid #e2e2e2", borderRadius: 8, background: "#fafafa", fontFamily: "inherit", fontSize: 12, color: "#171717", maxWidth: 220 }}
            >
              <option value="new">{t("＋ 新项目", "+ New project")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("项目：", "Project: ")}
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={pending || !draft.trim()}
            onClick={() => startWork(draft)}
            style={{ height: 34, padding: "0 18px", borderRadius: 10, border: 0, background: draft.trim() ? "#171717" : "#ededed", color: draft.trim() ? "#fff" : "#999999", fontSize: 13, fontWeight: 500, fontFamily: "inherit", flexShrink: 0, cursor: draft.trim() ? "pointer" : "default" }}
          >
            {t("开工", "Start")}
          </button>
        </div>
      </div>
      {error ? <div style={{ fontSize: 12.5, color: "#e03636", marginTop: 6 }}>{error}</div> : null}
    </div>
  );

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...PAPER }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "22px 24px 48px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{t(`${greeting(zh)}，${me}`, `${greeting(zh)}, ${me}`)}</h1>
          <p style={{ margin: "5px 0 0", fontSize: 13.5, color: "#7c7c7c" }}>{subline}</p>
        </div>

        {/* ---- the box, the line of work and the team on the left; the
             conversation down the right ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 8fr) minmax(340px, 5fr)", gap: 14, alignItems: "start" }}>
          <div style={{ minWidth: 0, order: 2, display: "flex", flexDirection: "column", gap: 14 }}>
          <ProjectChats projects={hub} zh={zh} />
            <Fold id="home-team" title={t("同事", "The team")} height={300}>
              {agents.map((a, idx) => {
                const on = giveTo === a.key;
                return (
                  <div key={a.key} style={{ borderTop: idx ? "1px solid #f3f3f3" : "none", padding: "8px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AgentIcon agent={a.key} size={30} radius={8} />
                      <div style={{ minWidth: 0, flexGrow: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{zh ? a.nameLocal : a.name}</span>
                          <Status status={a.status} zh={zh} />
                        </div>
                        <div title={a.line ?? undefined} style={{ fontSize: 12, color: a.line ? "#525252" : "#c7c7c7", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {a.line ? trim(a.line, 90) : t("还没说过话", "Has not spoken yet")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGiveTo(on ? null : a.key)}
                        aria-expanded={on}
                        style={{ height: 26, padding: "0 10px", borderRadius: 8, border: `1px solid ${on ? "#171717" : "#e2e2e2"}`, background: "#fff", color: "#171717", fontFamily: "inherit", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
                      >
                        {on ? t("收起", "Close") : t("交代", "Give work")}
                      </button>
                    </div>
                    {on ? (
                      <div style={{ marginTop: 8 }}>
                        <SayToAgent
                          agent={a.key}
                          zh={zh}
                          onDone={() => {
                            setSentAt(new Date().toISOString());
                            setWatching(true);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Fold>

          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {/* ---- 1. the task box, the whole width ---- */}
          {composer}


          {/* ---- 2. today's video, straight under it ---- */}
          <SuggestionCard items={suggestions} zh={zh} />
          <ProjectProgress projects={hub} zh={zh} />

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {decisions.length > 0 ? (
              <Fold id="home-decisions" title={t("等你决定", "Waiting on you")} sub={String(decisions.length)} height={decisions.length > 2 ? 360 : undefined}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {decisions.map((d) => (
                    <article key={d.messageId} style={GRADIENT_CARD}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {d.agent ? <AgentIcon agent={d.agent} size={22} radius={6} /> : null}
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{d.author}</span>
                        <Link href={`/chat/c/${encodeURIComponent(d.channelSlug)}`} style={{ fontSize: 11.5, color: "#999999", textDecoration: "none" }}>
                          #{d.channelName}
                        </Link>
                        <span style={{ flexGrow: 1 }} />
                        <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>{ago(d.at, zh)}</span>
                      </div>
                      <p style={{ margin: "9px 0 0", fontSize: 13, lineHeight: 1.65, color: "#2b343d", whiteSpace: "pre-wrap" }}>{trim(d.body, 320)}</p>
                      <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                        {d.actions.map((a, i) =>
                          a.kind === "open" ? (
                            <Link key={a.id} href={a.href ?? "#"} style={{ ...btn(false), textDecoration: "none" }}>
                              {zh ? a.label : a.labelEn}
                            </Link>
                          ) : (
                            <button key={a.id} type="button" disabled={pending} onClick={() => press(d.channelSlug, d.messageId, a.id)} style={{ ...btn(i === 0), opacity: pressing === d.messageId + a.id ? 0.55 : 1 }}>
                              {zh ? a.label : a.labelEn}
                            </button>
                          ),
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </Fold>
            ) : null}


            {running.length > 0 ? <RunningPanel zh={zh} running={running} names={runningNames} /> : null}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the conversation */


/* ------------------------------------------------------------- running now */

/**
 * What the machines are doing, in the order a person cares about.
 *
 * Running jobs first, each with whose work it is, a bar (a real one when the
 * job reports progress, a moving one when it does not), and how long it has
 * been going. Queued jobs are one line that says how many and what, opened
 * on demand: seven rows of "queued" said nothing a count does not.
 */
function RunningPanel({ zh, running, names }: { zh: boolean; running: (Running & { label: string; owner?: AgentKey | null })[]; names: Record<string, string> }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [showQueue, setShowQueue] = React.useState(false);
  const now = running.filter((j) => j.status === "running");
  const queued = running.filter((j) => j.status === "queued");
  const name = (j: Running) => names[j.type] ?? j.type;
  const owner = (j: Running & { owner?: AgentKey | null }): AgentKey | null => j.owner ?? null;

  return (
    <Fold
      id="home-running"
      title={t("正在进行", "Running now")}
      sub={t(`${now.length} 个在跑${queued.length ? ` · ${queued.length} 个排队` : ""}`, `${now.length} running${queued.length ? ` · ${queued.length} queued` : ""}`)}
      icon={<span style={{ width: 8, height: 8, borderRadius: 4, background: now.length ? "#278f5e" : "#d9d9d9", boxShadow: now.length ? "0 0 0 3px rgba(39,143,94,0.15)" : "none", animation: now.length ? "auraPulse 1.6s ease-in-out infinite" : "none" }} />}
      resizable={false}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {now.length === 0 ? <div style={{ fontSize: 12.5, color: "#999999" }}>{t("现在没有在跑的，下面的在排队。", "Nothing running; the ones below are waiting their turn.")}</div> : null}
        {now.map((j) => {
          const o = owner(j);
          const pct = j.progress > 0 ? Math.round(j.progress * 100) : null;
          return (
            <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #eef2ef", borderRadius: 10, background: "#fbfdfc" }}>
              <AgentIcon agent={o} size={28} radius={8} />
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name(j)}</span>
                  <span style={{ fontSize: 11.5, color: "#999999", whiteSpace: "nowrap" }}>
                    {o ? (zh ? AGENT_LABELS[o].nameLocal : AGENT_LABELS[o].name) : ""}
                    {j.who ? ` · ${t("由", "for ")}${j.who}${t("发起", "")}` : ""} · {ago(j.at, zh)}
                  </span>
                  <span style={{ flexGrow: 1 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#278f5e", fontVariantNumeric: "tabular-nums" }}>{pct !== null ? `${pct}%` : ""}</span>
                </div>
                <div style={{ position: "relative", height: 4, borderRadius: 2, background: "#e6efe9", marginTop: 7, overflow: "hidden" }}>
                  {pct !== null ? (
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: "linear-gradient(90deg, #278f5e, #0f5bd5)", borderRadius: 2, transition: "width .4s ease" }} />
                  ) : (
                    <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", background: "linear-gradient(90deg, rgba(39,143,94,0), #278f5e, rgba(39,143,94,0))", animation: "homeSlide 1.4s ease-in-out infinite" }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {queued.length ? (
          <div style={{ border: "1px dashed #e2e2e2", borderRadius: 10 }}>
            <button
              type="button"
              onClick={() => setShowQueue((v) => !v)}
              aria-expanded={showQueue}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left", color: "#525252" }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#171717", whiteSpace: "nowrap" }}>{t(`排队中 ${queued.length}`, `${queued.length} queued`)}</span>
              <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
                {[...new Set(queued.map(name))].join(t("、", ", "))}
              </span>
              <span style={{ fontSize: 11.5, color: "#7c7c7c", whiteSpace: "nowrap" }}>{showQueue ? t("收起", "Hide") : t("展开", "Show")}</span>
            </button>
            {showQueue ? (
              <div style={{ padding: "0 10px 6px" }}>
                {queued.map((j) => (
                  <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #f3f3f3", fontSize: 12 }}>
                    <AgentIcon agent={owner(j)} size={18} radius={5} />
                    <span>{name(j)}</span>
                    {j.who ? <span style={{ color: "#999999" }}>· {j.who}</span> : null}
                    <span style={{ flexGrow: 1 }} />
                    <span style={{ color: "#b3b3b3" }}>{t("排队", "waiting")} {ago(j.at, zh)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <style>{`@keyframes homeSlide { 0% { left: -30%; } 100% { left: 100%; } } @media (prefers-reduced-motion: reduce) { [style*="homeSlide"] { animation: none !important; } }`}</style>
    </Fold>
  );
}

/* ------------------------------------------------------------- pieces */

function Status({ status, zh }: { status: AgentState["status"]; zh: boolean }) {
  const [label, color, bg] =
    status === "working" ? [zh ? "工作中" : "Working", "#0b7a63", "#e3f4ee"] : status === "waiting" ? [zh ? "等你" : "Waiting", "#a35f00", "#fbf0dc"] : [zh ? "空闲" : "Idle", "#999999", "#f3f3f3"];
  return <span style={{ fontSize: 10.5, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "1px 7px" }}>{label}</span>;
}

const PAPER: React.CSSProperties = {
  backgroundColor: "#f4f3f0",
  backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};


const GRADIENT_CARD: React.CSSProperties = {
  border: "1px solid transparent",
  borderRadius: 14,
  background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #dcdcdc, #cbd6f2 55%, #cfe6dd) border-box",
  padding: "14px 16px",
};

function btn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 30,
    padding: "0 13px",
    borderRadius: 9,
    border: primary ? "1px solid #171717" : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    letterSpacing: "inherit",
    fontSize: 12.5,
    fontWeight: primary ? 500 : 400,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function greeting(zh: boolean): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", hour12: false }).format(new Date()));
  if (zh) return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return hour < 11 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function ago(at: Date, zh: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (mins < 1) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}
