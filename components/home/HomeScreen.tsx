"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentMark, MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_COLORS, AGENT_LABELS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import type { AgentState, Decision, Running } from "@/lib/home/service";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { PipelineStrip } from "@/components/home/PipelineStrip";
import { Echo, gist, type ThreadMessage } from "@/components/home/Echo";
import { startProposalAction } from "@/app/(app)/home/actions";
import type { Pipeline } from "@/lib/home/pipeline";

/**
 * 首页 — the studio's day, drawn as the approved board draws it.
 *
 * Dotted paper, hairline panels, square corners, one colour per employee.
 * Left: say what you want; where today's video is; what is waiting on you.
 * Right: the five colleagues and what each is on, with a line to give one
 * work; and what is happening in #制作, one line per thing.
 *
 * Everything is read from what the work already leaves behind
 * (`lib/home/service.ts`, `lib/home/pipeline.ts`), and every action goes
 * through the same server actions the chat screen uses.
 */
export function HomeScreen({
  agents,
  decisions,
  running,
  teamChannel,
  runningNames,
  zh,
  me,
  people,
  pipeline,
  thread,
}: {
  pipeline: Pipeline;
  /** The tail of the team channel, for "what is happening". */
  thread: ThreadMessage[];
  agents: AgentState[];
  decisions: Decision[];
  running: (Running & { label: string })[];
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

  /* After you say something, the answer comes from a model call that
     finishes after the request returns. Refresh every few seconds for a
     minute and a half, then stop. */
  const [watching, setWatching] = React.useState(false);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const answered = thread.some((m) => m.agent && sentAt !== null && m.at > sentAt);
  const waiting = watching && !answered;
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

  /* Giving one colleague work from its own row. */
  const [open, setOpen] = React.useState<AgentKey | null>(null);
  const [task, setTask] = React.useState("");
  const [giving, setGiving] = React.useState<AgentKey | null>(null);

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

  function say(body: string) {
    if (!teamChannel || !body.trim()) return;
    setError(null);
    start(async () => {
      const res = await sendChannelMessage(teamChannel.slug, body.trim());
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDraft("");
      if (parseAgentMentions(body).length) {
        setSentAt(new Date().toISOString());
        setWatching(true);
      }
      router.refresh();
    });
  }

  function give(key: AgentKey) {
    const text = task.trim();
    if (!text || giving) return;
    setGiving(key);
    setError(null);
    start(async () => {
      const res = await startProposalAction(key, text);
      setGiving(null);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setTask("");
      setOpen(null);
      setSentAt(new Date().toISOString());
      setWatching(true);
      router.refresh();
    });
  }

  const subline =
    decisions.length > 0
      ? t(`有 ${decisions.length} 件事等你决定。`, `${decisions.length} thing${decisions.length > 1 ? "s" : ""} waiting on you.`)
      : running.length > 0
        ? t("没有要你决定的，同事还在做手上的活。", "Nothing waiting on you; the team is still working.")
        : t("今天没有待办。说一句就能开工。", "Nothing on today. Say a word and the team starts.");

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto", ...PAPER }}>
      <div style={{ display: "flex", gap: 18, padding: "22px 26px 40px", maxWidth: 1240, margin: "0 auto", alignItems: "flex-start" }}>
        {/* ================= left ================= */}
        <section style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.005em" }}>{t(`${greeting(zh)}，${me}`, `${greeting(zh)}, ${me}`)}</div>
            <div style={{ fontSize: 13, color: "#525252", marginTop: 4 }}>{subline}</div>
          </div>

          {/* ---- say what you want -------------------------------------- */}
          <div style={{ position: "relative", background: "#ffffff", border: "1px solid #d9d9d9", padding: "10px 10px 8px 14px" }}>
            <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="down" />
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <label htmlFor="ask" style={{ fontSize: 12.5, color: "#999999", whiteSpace: "nowrap", paddingTop: 8 }}>
                {t("交代一件事", "Give the team a task")}
              </label>
              <textarea
                id="ask"
                ref={box}
                value={draft}
                rows={1}
                onChange={(e) => {
                  setDraft(e.target.value);
                  mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
                }}
                onBlur={mentions.close}
                onKeyDown={(e) => {
                  if (mentions.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    say(draft);
                  }
                }}
                placeholder={t("@编剧 把 RWA 这条写成 60 秒竖版，结尾留一个问题给观众", "@writer make the RWA piece a 60s vertical, end on a question for the viewer")}
                style={{ flexGrow: 1, minWidth: 0, minHeight: 32, padding: "7px 0", border: 0, outline: "none", resize: "none", fontFamily: "inherit", letterSpacing: "inherit", fontSize: 13, lineHeight: 1.5, background: "transparent", color: "#171717" }}
              />
              <button type="button" disabled={pending || !draft.trim() || !teamChannel} onClick={() => say(draft)} style={{ ...BLACK, opacity: draft.trim() ? 1 : 0.45 }}>
                {t("开工", "Start")}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {(["research", "planning", "script", "video", "article"] as AgentKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDraft((d) => (d.includes(agentTag(key)) ? d : `${agentTag(key)} ${d}`.trim()));
                    requestAnimationFrame(() => box.current?.focus());
                  }}
                  style={{ ...CHIP, gap: 6 }}
                >
                  <span style={{ width: 8, height: 8, background: AGENT_COLORS[key] }} />
                  {zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].name}
                </button>
              ))}
              <span style={{ flexGrow: 1 }} />
              <span style={{ fontSize: 11.5, color: "#b3b3b3", whiteSpace: "nowrap" }}>
                {teamChannel ? t(`发到 #${teamChannel.name} · Enter 发送`, `Posts to #${teamChannel.name} · Enter to send`) : t("还没有团队频道", "No team channel yet")}
              </span>
            </div>
          </div>

          {error ? <div style={{ fontSize: 12.5, color: "#e03636" }}>{error}</div> : null}

          {teamChannel ? <Echo zh={zh} channelName={teamChannel.name} channelSlug={teamChannel.slug} messages={thread} sentAt={sentAt} waiting={waiting} /> : null}

          <PipelineStrip pipeline={pipeline} zh={zh} />

          {/* ---- waiting on you ------------------------------------------ */}
          {decisions.length > 0 ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("等你决定", "Waiting on you")}</span>
                <span style={{ fontSize: 12, color: "#999999" }}>{decisions.length}</span>
              </div>
              {decisions.map((d) => (
                <article key={d.messageId} style={GRADIENT_CARD}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    {d.agent ? <span style={{ width: 8, height: 8, background: AGENT_COLORS[d.agent], flexShrink: 0 }} /> : null}
                    <span style={{ fontWeight: 600 }}>{d.author}</span>
                    <Link href={`/chat/c/${encodeURIComponent(d.channelSlug)}`} style={{ color: "#999999", textDecoration: "none" }}>
                      #{d.channelName} · {ago(d.at, zh)}
                    </Link>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{trim(d.body, 420)}</p>
                  <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                    {d.actions.map((a, i) =>
                      a.kind === "open" ? (
                        <Link key={a.id} href={a.href ?? "#"} style={{ ...WHITE, textDecoration: "none" }}>
                          {zh ? a.label : a.labelEn}
                        </Link>
                      ) : (
                        <button
                          key={a.id}
                          type="button"
                          disabled={pending}
                          onClick={() => press(d.channelSlug, d.messageId, a.id)}
                          style={{ ...(i === 0 ? BLACK : WHITE), opacity: pressing === d.messageId + a.id ? 0.55 : 1 }}
                        >
                          {zh ? a.label : a.labelEn}
                        </button>
                      ),
                    )}
                  </div>
                </article>
              ))}
            </>
          ) : null}

          {/* ---- the machine's own queue --------------------------------- */}
          {running.length > 0 ? (
            <div style={PANEL}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("正在进行", "Running now")}</span>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e" }} />
              </div>
              {running.map((j) => (
                <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #f0f0f0", fontSize: 12.5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: j.status === "running" ? "#278f5e" : "#d9d9d9", flexShrink: 0 }} />
                  <span>{runningNames[j.type] ?? j.type}</span>
                  {j.who ? <span style={{ color: "#999999" }}>· {j.who}</span> : null}
                  <span style={{ flexGrow: 1 }} />
                  <span style={{ color: "#999999", fontVariantNumeric: "tabular-nums" }}>
                    {j.status === "running" ? (j.progress > 0 ? `${Math.round(j.progress * 100)}%` : t("进行中", "running")) : t("排队中", "queued")}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {/* ================= right ================= */}
        <aside style={{ width: 330, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...PANEL, padding: "12px 16px 6px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t("同事", "The team")}</div>
            {agents.map((a) => {
              const on = open === a.key;
              return (
                <div key={a.key} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 0" }}>
                    <span style={{ width: 8, height: 8, background: AGENT_COLORS[a.key], flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, width: 64, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {zh ? a.nameLocal : a.name}
                    </span>
                    <span style={{ fontSize: 12, color: "#525252", flexGrow: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.line ?? undefined}>
                      {a.line ? gist(a.line, 60) : t("还没说过话", "Has not spoken yet")}
                    </span>
                    <span style={{ fontSize: 11.5, color: a.status === "working" ? "#0b7a63" : a.status === "waiting" ? "#a35f00" : "#999999", fontWeight: a.status === "idle" ? 400 : 500, whiteSpace: "nowrap" }}>
                      {a.status === "working" ? t("工作中", "Working") : a.status === "waiting" ? t("等你", "Waiting") : t("空闲", "Idle")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(on ? null : a.key);
                        setTask("");
                      }}
                      title={t("交代它一件事", "Give it work")}
                      aria-expanded={on}
                      style={{ ...CHIP, height: 22, padding: "0 7px", fontSize: 11, color: on ? "#171717" : "#525252", borderColor: on ? "#171717" : "#d9d9d9" }}
                    >
                      {t("交代", "Task")}
                    </button>
                  </div>
                  {on ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        give(a.key);
                      }}
                      style={{ display: "flex", gap: 6, padding: "0 0 10px 17px" }}
                    >
                      <input
                        autoFocus
                        type="text"
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        placeholder={t(`交给${a.nameLocal}…`, `For ${a.name}…`)}
                        style={{ flexGrow: 1, minWidth: 0, height: 28, padding: "0 9px", border: "1px solid #d9d9d9", background: "#fff", fontFamily: "inherit", fontSize: 12, letterSpacing: "inherit", outline: "none" }}
                      />
                      <button type="submit" disabled={giving !== null || !task.trim()} style={{ ...BLACK, height: 28, padding: "0 10px", fontSize: 12, opacity: task.trim() ? (giving === a.key ? 0.55 : 1) : 0.45 }}>
                        {t("开工", "Go")}
                      </button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ ...PANEL, padding: "12px 16px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("正在发生", "Happening")}</span>
              {running.length ? <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e" }} /> : null}
              <span style={{ flexGrow: 1 }} />
              {teamChannel ? (
                <Link href={`/chat/c/${encodeURIComponent(teamChannel.slug)}`} style={{ fontSize: 11.5, color: "#525252", textDecoration: "none" }}>
                  #{teamChannel.name} →
                </Link>
              ) : null}
            </div>
            {thread.length === 0 ? (
              <div style={{ fontSize: 12, color: "#999999", padding: "8px 0" }}>{t("还没有动静。", "Nothing yet.")}</div>
            ) : (
              [...thread].reverse().slice(0, 5).map((m) => (
                <div key={m.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid #f0f0f0" }}>
                  <div style={{ width: 2, background: m.agent ? AGENT_COLORS[m.agent] : "#d9d9d9", flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                      <span style={{ fontWeight: 600 }}>{m.author}</span> {gist(m.body, 64)}
                    </div>
                    <div style={{ fontSize: 11, color: "#999999", marginTop: 2 }}>{ago(new Date(m.at), zh)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the board's own metrics */

const PAPER: React.CSSProperties = {
  backgroundColor: "#f4f3f0",
  backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};

const PANEL: React.CSSProperties = { background: "#ffffff", border: "1px solid #e2e2e2", padding: "12px 16px" };

const GRADIENT_CARD: React.CSSProperties = {
  border: "1px solid transparent",
  background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #dcdcdc, #cbd6f2 55%, #cfe6dd) border-box",
  padding: "14px 16px",
};

const BLACK: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 30,
  padding: "0 13px",
  border: "1px solid #171717",
  background: "linear-gradient(180deg, #2b2b2b, #171717)",
  color: "#fff",
  fontFamily: "inherit",
  letterSpacing: "inherit",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  boxShadow: "0 1px 1px rgba(0,0,0,0.12)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const WHITE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 30,
  padding: "0 12px",
  border: "1px solid #d9d9d9",
  background: "#fff",
  color: "#171717",
  fontFamily: "inherit",
  letterSpacing: "inherit",
  fontSize: 12.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 24,
  padding: "0 9px",
  border: "1px solid #d9d9d9",
  background: "#fff",
  color: "#525252",
  fontFamily: "inherit",
  letterSpacing: "inherit",
  fontSize: 11.5,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

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

/* AgentMark is still imported by other screens through MentionMenu; the home
   board draws colour squares instead. */
void AgentMark;
