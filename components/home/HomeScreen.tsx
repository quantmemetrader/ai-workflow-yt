"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MentionMenu, type MentionPerson } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_LABELS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import type { AgentState, Decision, Running } from "@/lib/home/service";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
import { MiniFlow } from "@/components/home/MiniFlow";
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
  teamChannel,
  runningNames,
  zh,
  me,
  people,
  pipeline,
  thread,
  focus,
  recentProject,
}: {
  focus: { agent: AgentKey; fromId: string } | null;
  recentProject: { id: string; title: string; render: { fileId: string; at: string } | null } | null;
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
  /* The box under the conversation, apart from the big one at the top. */
  const [quick, setQuick] = React.useState("");
  /* The focus card closes for the exchange it was showing; a new request opens it again. */
  const [closedFocus, setClosedFocus] = React.useState<string | null>(null);
  const focusOpen = Boolean(focus && closedFocus !== focus.fromId);
  const quickBox = React.useRef<HTMLTextAreaElement | null>(null);
  const quickMentions = useMentions({ people, zh, draft: quick, setDraft: setQuick, box: quickBox });
  /* Who a reply without a tag goes to: the employee who spoke last, if
     nobody has spoken since (the server applies the same rule). */
  const lastMsg = thread[thread.length - 1];
  const talkingTo = lastMsg?.agent ?? null;

  /* After something is said, the answer comes from a model call that ends
     after the request returns. Refresh every few seconds for a minute and a
     half, then stop. */
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

  function say(body: string, from: "top" | "quick" = "top") {
    if (!teamChannel || !body.trim()) return;
    setError(null);
    start(async () => {
      const res = await sendChannelMessage(teamChannel.slug, body.trim());
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (from === "top") {
        setDraft("");
        if (box.current) box.current.style.height = "auto";
      }
      /* A tagged colleague answers, and so does the one being replied to:
         the server says who when a reply without a tag goes to them. */
      if (parseAgentMentions(body).length || ("answering" in res && res.answering)) {
        setSentAt(new Date().toISOString());
        setWatching(true);
      }
      router.refresh();
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
              say(draft);
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
            <span style={{ fontSize: 11, color: "#b3b3b3", whiteSpace: "nowrap", marginLeft: 4 }}>
              {teamChannel ? t(`发到 #${teamChannel.name} · Enter 发送`, `Posts to #${teamChannel.name} · Enter to send`) : t("还没有团队频道", "No team channel yet")}
            </span>
          </div>
          <button
            type="button"
            disabled={pending || !draft.trim() || !teamChannel}
            onClick={() => say(draft)}
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
          <Fold
              id="home-work"
              title={t("在这里干活", "Work here")}
              sub={teamChannel ? `#${teamChannel.name}` : undefined}
              icon={<AgentIcon size={20} radius={6} />}
              flush
              height={448}
              footer={
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!quick.trim()) return;
                    say(quick, "quick");
                    setQuick("");
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, position: "relative" }}
                >
                  <MentionMenu matches={quickMentions.matches} active={quickMentions.active} zh={zh} onPick={quickMentions.pick} onHover={quickMentions.setActive} placement="up" />
                  {talkingTo ? (
                    <span title={t("Replies go to this colleague without a tag", "不用 @，回复会直接给它")} style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 11.5, color: "#525252", background: "#f3f3f1", borderRadius: 999, padding: "3px 8px 3px 4px" }}>
                      <AgentIcon agent={talkingTo} size={18} radius={5} />
                      {zh ? AGENT_LABELS[talkingTo].nameLocal : AGENT_LABELS[talkingTo].name}
                    </span>
                  ) : null}
                  <textarea
                    ref={quickBox}
                    rows={1}
                    value={quick}
                    onChange={(e) => {
                      setQuick(e.target.value);
                      quickMentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    }}
                    onBlur={quickMentions.close}
                    onKeyDown={(e) => {
                      if (quickMentions.onKeyDown(e)) return;
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (!quick.trim()) return;
                        say(quick, "quick");
                        setQuick("");
                      }
                    }}
                    placeholder={
                      talkingTo
                        ? t(`回复${AGENT_LABELS[talkingTo].nameLocal}…（不用再 @）`, `Reply to ${AGENT_LABELS[talkingTo].name}… (no tag needed)`)
                        : t(`在 #${teamChannel?.name ?? "制作"} 里说…（@研究员 叫同事）`, `Message #${teamChannel?.name ?? "制作"}… (@ a colleague to bring them in)`)
                    }
                    style={{ flexGrow: 1, minWidth: 0, height: 34, padding: "7px 12px", border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff", outline: "none", resize: "none", fontFamily: "inherit", fontSize: 13, lineHeight: "18px", letterSpacing: "inherit", color: "#171717" }}
                  />
                  <button
                    type="submit"
                    disabled={pending || !quick.trim() || !teamChannel}
                    style={{ height: 34, padding: "0 14px", borderRadius: 10, border: 0, background: quick.trim() ? "#171717" : "#ededed", color: quick.trim() ? "#fff" : "#999999", fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, cursor: quick.trim() ? "pointer" : "default", flexShrink: 0 }}
                  >
                    {t("发送", "Send")}
                  </button>
                </form>
              }
              right={
                teamChannel ? (
                  <Link href={`/chat/c/${encodeURIComponent(teamChannel.slug)}`} style={{ fontSize: 12, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
                    {t("整个频道", "Whole channel")} →
                  </Link>
                ) : null
              }
          >
              <Conversation zh={zh} messages={thread} waiting={waiting} pending={pending} pressing={pressing} onPress={(id, action) => teamChannel && press(teamChannel.slug, id, action)} />
          </Fold>
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

          {/* ---- what you asked for, being done right here ---- */}
          {focusOpen && focus ? (
            <FocusCard
              zh={zh}
              focus={focus}
              thread={thread}
              waiting={waiting}
              pending={pending}
              pressing={pressing}
              recentProject={recentProject}
              onPress={(id, action) => teamChannel && press(teamChannel.slug, id, action)}
              onReply={(text) => say(text, "quick")}
              onClose={() => setClosedFocus(focus.fromId)}
            />
          ) : null}

          {/* ---- 2. today's video, straight under it ---- */}
          <Fold id="home-flow" title={t("今天这条片走到哪了", "Where today's video is")} sub={pipeline.title ?? t("还没有开始的片子", "Nothing in progress yet")} resizable={false}>
            <MiniFlow pipeline={pipeline} zh={zh} bare direct={focusOpen ? focus?.agent ?? null : null} />
          </Fold>

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

function Conversation({
  zh,
  messages,
  waiting,
  pending,
  pressing,
  onPress,
}: {
  zh: boolean;
  messages: ThreadMessage[];
  waiting: boolean;
  pending: boolean;
  pressing: string | null;
  onPress: (messageId: string, actionId: string) => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const last = messages[messages.length - 1]?.id;
  React.useEffect(() => {
    /* The fold's body is the thing that scrolls; keep the newest in view. */
    const el = scroller.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last, waiting]);

  return (
    <div ref={scroller} style={{ padding: "6px 14px" }}>
      {messages.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#999999", padding: "24px 0", textAlign: "center" }}>{t("还没有动静。在下面说一句。", "Nothing yet. Say something below.")}</div>
      ) : null}
      {messages.map((m) => (
        <div key={m.id} style={{ display: "flex", gap: 10, padding: "9px 0" }}>
          {m.agent ? (
            <AgentIcon agent={m.agent} size={28} radius={8} />
          ) : (
            <span style={{ width: 28, height: 28, borderRadius: 8, background: "#e8e8e6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600, color: "#525252", flexShrink: 0 }}>
              {m.author.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div style={{ minWidth: 0, flexGrow: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{m.agent ? (zh ? AGENT_LABELS[m.agent].nameLocal : AGENT_LABELS[m.agent].name) : m.author}</span>
              <span style={{ fontSize: 11, color: "#b3b3b3" }}>{ago(new Date(m.at), zh)}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "#2b343d", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{trim(m.body, 480)}</div>
            {m.actions.length > 0 ? (
              m.done ? (
                <div style={{ fontSize: 11.5, color: "#278f5e", marginTop: 6 }}>
                  ✓ {(() => {
                    const a = m.actions.find((x) => x.id === m.done!.actionId);
                    return a ? (zh ? a.label : a.labelEn) : t("已处理", "Done");
                  })()}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {m.actions.map((a, i) =>
                    a.kind === "open" ? (
                      <Link key={a.id} href={a.href ?? "#"} style={{ ...btn(false), height: 28, fontSize: 12, textDecoration: "none" }}>
                        {zh ? a.label : a.labelEn}
                      </Link>
                    ) : (
                      <button key={a.id} type="button" disabled={pending} onClick={() => onPress(m.id, a.id)} style={{ ...btn(i === 0), height: 28, fontSize: 12, opacity: pressing === m.id + a.id ? 0.55 : 1 }}>
                        {zh ? a.label : a.labelEn}
                      </button>
                    ),
                  )}
                </div>
              )
            ) : null}
          </div>
        </div>
      ))}
      {waiting ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", fontSize: 12.5, color: "#525252" }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite" }} />
          {t("同事正在回复…", "A colleague is answering…")}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- the focus card */

/**
 * What you just asked one employee for, done here rather than in a channel.
 *
 * Your request, what the employee has said since, and a box to answer it
 * (no tag needed: the reply goes to them). For 剪辑师 the project it worked
 * in is one press away, with the clips button beside it.
 */
function FocusCard({
  zh,
  focus,
  thread,
  waiting,
  pending,
  pressing,
  recentProject,
  onPress,
  onReply,
  onClose,
}: {
  zh: boolean;
  focus: { agent: AgentKey; fromId: string };
  thread: ThreadMessage[];
  waiting: boolean;
  pending: boolean;
  pressing: string | null;
  recentProject: { id: string; title: string; render: { fileId: string; at: string } | null } | null;
  onPress: (messageId: string, actionId: string) => void;
  onReply: (text: string) => void;
  onClose: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [text, setText] = React.useState("");
  const from = thread.findIndex((m) => m.id === focus.fromId);
  const exchange = from >= 0 ? thread.slice(from) : [];
  const request = exchange[0];
  const after = exchange.slice(1);
  const name = zh ? AGENT_LABELS[focus.agent].nameLocal : AGENT_LABELS[focus.agent].name;
  const answering = waiting || (after.length > 0 && !after[after.length - 1].agent) || after.length === 0;

  return (
    <section style={{ borderRadius: 16, border: "1px solid transparent", background: "linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5 60%, #6a3fc4) border-box", boxShadow: "0 6px 24px rgba(15,91,213,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 10px", borderBottom: "1px solid #f0f0f0" }}>
        <AgentIcon agent={focus.agent} size={32} radius={9} />
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{answering ? t(`${name}正在做`, `${name} is on it`) : t(`${name}回复了你`, `${name} answered`)}</div>
          <div style={{ fontSize: 11.5, color: "#999999" }}>{t("直接交代 · 跳过前面的步骤", "Asked directly · earlier steps skipped")}</div>
        </div>
        {answering ? <span style={{ width: 8, height: 8, borderRadius: 4, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite" }} /> : null}
        <button type="button" onClick={onClose} aria-label={t("关闭", "Close")} style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 16, color: "#999999", padding: "0 4px" }}>
          ×
        </button>
      </div>

      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
        {request ? (
          <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: "#171717", color: "#fff", borderRadius: "12px 12px 4px 12px", padding: "8px 12px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{trim(request.body, 300)}</div>
        ) : null}
        {after.map((m) =>
          m.agent ? (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", maxWidth: "92%" }}>
              <AgentIcon agent={m.agent} size={24} radius={7} />
              <div style={{ background: "#f5f7fb", borderRadius: "12px 12px 12px 4px", padding: "8px 12px", fontSize: 13, lineHeight: 1.6, color: "#2b343d", whiteSpace: "pre-wrap", minWidth: 0 }}>
                {trim(m.body, 600)}
                {m.actions.length && !m.done ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {m.actions.map((a, i) =>
                      a.kind === "open" ? (
                        <Link key={a.id} href={a.href ?? "#"} style={{ ...btn(false), height: 28, fontSize: 12, textDecoration: "none" }}>
                          {zh ? a.label : a.labelEn}
                        </Link>
                      ) : (
                        <button key={a.id} type="button" disabled={pending} onClick={() => onPress(m.id, a.id)} style={{ ...btn(i === 0), height: 28, fontSize: 12, opacity: pressing === m.id + a.id ? 0.55 : 1 }}>
                          {zh ? a.label : a.labelEn}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "#171717", color: "#fff", borderRadius: "12px 12px 4px 12px", padding: "8px 12px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{trim(m.body, 300)}</div>
          ),
        )}
        {answering ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#525252" }}>
            <AgentIcon agent={focus.agent} size={24} radius={7} />
            <span style={{ background: "#f5f7fb", borderRadius: 12, padding: "6px 12px" }}>{t(`${name}正在处理…`, `${name} is working…`)}</span>
          </div>
        ) : null}
      </div>

      {focus.agent === "video" && recentProject?.render ? (
        /* The finished video, playable here: what was asked for, not a
           sentence saying it exists somewhere. */
        <div style={{ padding: "0 14px 10px" }}>
          <video
            controls
            preload="metadata"
            src={`/api/files/${recentProject.render.fileId}/download`}
            style={{ width: "100%", maxHeight: 360, borderRadius: 12, background: "#000", display: "block" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12 }}>
            <a href={`/api/files/${recentProject.render.fileId}/download`} target="_blank" rel="noreferrer" style={{ color: "#0f5bd5", textDecoration: "none" }}>
              {t("在新窗口打开", "Open in a new tab")} ↗
            </a>
            <span style={{ color: "#999999" }}>{recentProject.title}</span>
          </div>
        </div>
      ) : null}

      {focus.agent === "video" && recentProject ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px 10px", flexWrap: "wrap" }}>
          <Link href={`/video?project=${recentProject.id}`} style={{ ...btn(true), textDecoration: "none" }}>
            ▶ {t(`打开视频《${recentProject.title}》`, `Open the video “${recentProject.title}”`)}
          </Link>
          <Link href={`/video?project=${recentProject.id}`} style={{ ...btn(false), textDecoration: "none" }}>
            🎬 {t("添加素材", "Add clips")}
          </Link>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onReply(text);
          setText("");
        }}
        style={{ display: "flex", gap: 8, padding: "10px 14px 12px", borderTop: "1px solid #f0f0f0" }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(`回复${name}…（不用 @）`, `Reply to ${name}… (no tag needed)`)}
          style={{ flexGrow: 1, minWidth: 0, height: 34, padding: "0 12px", border: "1px solid #e2e2e2", borderRadius: 10, outline: "none", fontFamily: "inherit", fontSize: 13, letterSpacing: "inherit" }}
        />
        <button type="submit" disabled={pending || !text.trim()} style={{ ...btn(true), height: 34, opacity: text.trim() ? 1 : 0.45 }}>
          {t("发送", "Send")}
        </button>
      </form>
    </section>
  );
}

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
