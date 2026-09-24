"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentMark, MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_LABELS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import type { AgentState, Decision, Running } from "@/lib/home/service";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { PipelineStrip } from "@/components/home/PipelineStrip";
import { TeamThread, type ThreadMessage } from "@/components/home/TeamThread";
import type { Pipeline } from "@/lib/home/pipeline";

/**
 * 首页 — the studio's day, as a line of work rather than a set of pages.
 *
 * The client did not ask for a dashboard. He asked to come in, see what each
 * AI employee is doing, say yes, and move on: *"user comes checks what agent
 * is doing okay perfect next then next"*. So this screen is three things in
 * the order you meet them —
 *
 *   1. **Say what you want.** One box. It posts into the team channel, and
 *      tagging a colleague there is what starts them, exactly as it does in
 *      chat. Nothing here is a second way of asking.
 *   2. **What is waiting on you.** Every card an employee has put up that
 *      nobody has answered, oldest first, with its own buttons. This is the
 *      "okay perfect, next" — one press moves the work along and the card
 *      leaves the list.
 *   3. **Who is doing what.** The five of them in the order the work goes,
 *      each with what it is on and the last thing it said.
 *
 * Everything on it is read from what the work already leaves behind
 * (`lib/home/service.ts`), and every action goes through the same server
 * actions the chat screen uses, with the same permission checks.
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
  /** Today's video, step by step. */
  pipeline: Pipeline;
  /** The tail of the team channel, so an answer shows up here. */
  thread: ThreadMessage[];
  agents: AgentState[];
  decisions: Decision[];
  running: (Running & { label: string })[];
  teamChannel: { id: string; slug: string; name: string } | null;
  runningNames: Record<string, string>;
  zh: boolean;
  me: string;
  /** Everyone the `@` picker can offer besides the five employees. */
  people: MentionPerson[];
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [pressing, setPressing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  /* The same `@` picker the chat composer has, from the same hook — two
     implementations of "where does a tag start" is two answers to "who did
     that reach". */
  const mentions = useMentions({ people, zh, draft, setDraft, box });

  /* After you say something, the answer comes from a model call that
     finishes after the request returns. Refresh every few seconds for a
     minute and a half, then stop: an answer that has not come by then is
     not coming, and a page that polls for ever is a page that never rests. */
  /* `sentAt` is state, not a ref: it is read during render to decide whether
     an answer has arrived since, and a ref read in render is the thing the
     rules of hooks forbid. */
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
      /* Only a message that tags a colleague has an answer to wait for. */
      if (parseAgentMentions(body).length) {
        setSentAt(new Date().toISOString());
        setWatching(true);
      }
      router.refresh();
    });
  }

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "30px 26px 60px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
          {t(`${greeting(zh)}，${me}`, `${greeting(zh)}, ${me}`)}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#7c7c7c", lineHeight: 1.6 }}>
          {decisions.length > 0
            ? t(`有 ${decisions.length} 件事等你决定。`, `${decisions.length} thing${decisions.length > 1 ? "s" : ""} waiting on you.`)
            : running.length > 0
              ? t("没有要你决定的，同事还在做手上的活。", "Nothing waiting on you; the team is still working.")
              : t("今天没有待办。说一句就能开工。", "Nothing on today. Say a word and the team starts.")}
        </p>

        {/* ---- 1. say what you want ------------------------------------- */}
        <div
          style={{
            position: "relative",
            marginTop: 20,
            border: "1px solid #ededed",
            borderRadius: 14,
            background: "#ffffff",
            padding: 14,
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <MentionMenu
            matches={mentions.matches}
            active={mentions.active}
            zh={zh}
            onPick={mentions.pick}
            onHover={mentions.setActive}
            placement="down"
          />

          <textarea
            ref={box}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onBlur={mentions.close}
            onKeyDown={(e) => {
              // The picker gets the arrows and Enter first, or choosing a
              // colleague would send the half-typed line instead.
              if (mentions.onKeyDown(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                say(draft);
              }
            }}
            rows={2}
            placeholder={t(
              "想做什么？例如：@研究员 看看这周香港有什么值得拍的",
              "What do you want made? For example: @research find something worth filming in Hong Kong this week",
            )}
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              resize: "none",
              fontSize: 14,
              lineHeight: 1.65,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
              background: "transparent",
            }}
          />
          {/* Two groups, not one wrapping row: the colleagues wrap among
              themselves and the send button stays on the right, instead of
              being pushed onto a line of its own at the first narrow window. */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", flexGrow: 1, minWidth: 0 }}>
            {(["research", "planning", "script", "video", "article"] as AgentKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDraft((d) => (d.includes(agentTag(key)) ? d : `${agentTag(key)} ${d}`.trim()));
                  requestAnimationFrame(() => box.current?.focus());
                }}
                className="chip"
                style={{ height: 26, fontSize: 11.5, gap: 5, cursor: "pointer", borderColor: "#ededed" }}
              >
                <AgentMark agent={key} size={12} radius={4} />
                {zh ? AGENT_LABELS[key].nameLocal : AGENT_LABELS[key].name}
              </button>
            ))}
            </div>
            <span style={{ fontSize: 11.5, color: "#c7c7c7", whiteSpace: "nowrap", flexShrink: 0 }}>
              {teamChannel ? t(`发到 #${teamChannel.name}`, `Posts to #${teamChannel.name}`) : t("还没有团队频道", "No team channel yet")}
            </span>
            <button
              type="button"
              disabled={pending || !draft.trim() || !teamChannel}
              onClick={() => say(draft)}
              style={{
                height: 30,
                padding: "0 14px",
                borderRadius: 9,
                border: 0,
                background: draft.trim() ? "#171717" : "#ededed",
                color: draft.trim() ? "#ffffff" : "#999999",
                fontSize: 12.5,
                fontWeight: 500,
                fontFamily: "inherit",
                flexShrink: 0,
                cursor: draft.trim() ? "pointer" : "default",
              }}
            >
              {t("开工", "Start")}
            </button>
          </div>
        </div>

        {error && (
          <p style={{ marginTop: 10, fontSize: 12.5, color: "#e03636" }}>{error}</p>
        )}

        {/* ---- where the answer shows up ------------------------------- */}
        {teamChannel ? (
          <div style={{ marginTop: 14 }}>
            <TeamThread
              zh={zh}
              channelName={teamChannel.name}
              channelSlug={teamChannel.slug}
              messages={thread}
              waiting={waiting}
              pressing={pressing}
              onPress={(messageId, actionId) => press(teamChannel.slug, messageId, actionId)}
            />
          </div>
        ) : null}

        {/* ---- today's video, step by step ------------------------------ */}
        <div style={{ marginTop: 14 }}>
          <PipelineStrip pipeline={pipeline} zh={zh} />
        </div>

        {/* ---- 2. waiting on you ---------------------------------------- */}
        {decisions.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <Heading text={t("等你决定", "Waiting on you")} count={decisions.length} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {decisions.map((d) => (
                <article
                  key={d.messageId}
                  style={{
                    border: "1px solid #ededed",
                    borderRadius: 14,
                    background: "#ffffff",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {d.agent ? <AgentMark agent={d.agent} size={20} radius={6} /> : null}
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.author}</span>
                    <Link
                      href={`/chat/c/${encodeURIComponent(d.channelSlug)}`}
                      style={{ fontSize: 11.5, color: "#999999", textDecoration: "none" }}
                    >
                      #{d.channelName}
                    </Link>
                    <span style={{ flexGrow: 1 }} />
                    <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>{ago(d.at, zh)}</span>
                  </div>

                  <p
                    style={{
                      margin: "9px 0 0",
                      fontSize: 13.5,
                      lineHeight: 1.7,
                      color: "#2b343d",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {trim(d.body, 420)}
                  </p>

                  <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                    {d.actions.map((a, i) =>
                      a.kind === "open" ? (
                        <Link key={a.id} href={a.href ?? "#"} style={buttonStyle(false)}>
                          {zh ? a.label : a.labelEn}
                        </Link>
                      ) : (
                        <button
                          key={a.id}
                          type="button"
                          disabled={pending}
                          onClick={() => press(d.channelSlug, d.messageId, a.id)}
                          style={{
                            ...buttonStyle(i === 0),
                            opacity: pressing === d.messageId + a.id ? 0.55 : 1,
                            cursor: "pointer",
                          }}
                        >
                          {zh ? a.label : a.labelEn}
                        </button>
                      ),
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ---- 3. who is doing what ------------------------------------- */}
        <section style={{ marginTop: 28 }}>
          <Heading text={t("同事", "The team")} count={null} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {agents.map((a) => (
              <article
                key={a.key}
                style={{
                  border: "1px solid #ededed",
                  borderRadius: 14,
                  background: "#ffffff",
                  padding: "13px 15px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 108,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <AgentMark agent={a.key} size={26} radius={8} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{zh ? a.nameLocal : a.name}</div>
                    <div style={{ fontSize: 11, color: "#999999" }}>{a.title}</div>
                  </div>
                  <span style={{ flexGrow: 1 }} />
                  <Status status={a.status} zh={zh} />
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: a.line ? "#525252" : "#c7c7c7",
                    flexGrow: 1,
                  }}
                >
                  {a.line ? trim(a.line, 110) : t("还没说过话。", "Has not spoken yet.")}
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => (d.includes(agentTag(a.key)) ? d : `${agentTag(a.key)} ${d}`.trim()))}
                    style={{ ...buttonStyle(false), height: 25, fontSize: 11.5, cursor: "pointer" }}
                  >
                    {t("交给它", "Give it work")}
                  </button>
                  {a.channelSlug && (
                    <Link
                      href={`/chat/c/${encodeURIComponent(a.channelSlug)}`}
                      style={{ fontSize: 11.5, color: "#999999", textDecoration: "none" }}
                    >
                      {t("看对话", "Open the thread")}
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---- and what the machine is chewing on ----------------------- */}
        {running.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <Heading text={t("正在进行", "Running now")} count={running.length} />
            <div style={{ border: "1px solid #ededed", borderRadius: 14, background: "#ffffff" }}>
              {running.map((j, i) => (
                <div
                  key={j.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px 15px",
                    borderTop: i === 0 ? 0 : "1px solid #f3f3f3",
                    fontSize: 12.5,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      background: j.status === "running" ? "#278f5e" : "#d9d9d9",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "#171717" }}>{runningNames[j.type] ?? j.type}</span>
                  {j.who && <span style={{ color: "#999999" }}>· {j.who}</span>}
                  <span style={{ flexGrow: 1 }} />
                  <span style={{ color: "#999999", fontVariantNumeric: "tabular-nums" }}>
                    {j.status === "running"
                      ? j.progress > 0
                        ? `${Math.round(j.progress * 100)}%`
                        : t("进行中", "running")
                      : t("排队中", "queued")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Heading({ text, count }: { text: string; count: number | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 11 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#171717" }}>{text}</h2>
      {count !== null && <span style={{ fontSize: 12, color: "#999999" }}>{count}</span>}
    </div>
  );
}

function Status({ status, zh }: { status: AgentState["status"]; zh: boolean }) {
  const look =
    status === "working"
      ? { bg: "#e4faeb", fg: "#278f5e", zh: "工作中", en: "Working" }
      : status === "waiting"
        ? { bg: "#fff7d3", fg: "#db7706", zh: "等批准", en: "Waiting" }
        : { bg: "#f3f3f3", fg: "#7c7c7c", zh: "空闲", en: "Idle" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 8px",
        borderRadius: 7,
        background: look.bg,
        color: look.fg,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {zh ? look.zh : look.en}
    </span>
  );
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 28,
    padding: "0 12px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    textDecoration: "none",
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
  };
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function greeting(zh: boolean): string {
  const hour = new Date().getHours();
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
