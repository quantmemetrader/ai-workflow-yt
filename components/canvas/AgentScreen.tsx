"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { MentionMenu } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AGENT_COLORS, AGENT_KEYS, AGENT_LABELS, AGENT_TINTS, agentTag, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { Markdown } from "@/components/ui/Markdown";
import { formatTextarea, type Format } from "./composer-format";
import { FormattedPreview } from "@/components/ui/FormattedPreview";
import { useResizable } from "@/components/ui/Resizer";
import { clock, dayLabel } from "@/components/chat/when";
import { initials, soft, threadCss, tidyMarkdown } from "@/components/chat/look";
import type { Locale } from "@/lib/i18n";

/**
 * The agent screen, transcribed from design/canvas/Main.dc.html.
 *
 * Markup, metrics and colours are the artboard's. What is live: the stream,
 * the tool trace, the sources panel on the right (with the relation the reader
 * holds on each file), the model name in the header, and the cost.
 *
 * The three questions the brief says this screen must answer — can I trust it,
 * where did it come from, what did it cost — are answered by the artboard's own
 * elements, not by anything added on top.
 */
export type ThreadTool = { id: string; name: string; status: string; summary?: string; durationMs?: number | null };
export type ThreadCitation = {
  fileId: string;
  name: string;
  kind: string;
  folder: string | null;
  relation: string | null;
};

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "failed" | "stopped";
  error?: string | null;
  model?: string | null;
  costMicros?: number;
  withheld?: boolean;
  createdAt?: string;
  citations: ThreadCitation[];
  tools: ThreadTool[];
  /** The employee who answered, when an @ handed the turn to one. */
  speaker?: AgentKey | null;
};

/**
 * The thread's rules: the shared ones every chat thread uses (`threadCss`),
 * plus this screen's own — the employee cards on the empty screen, the
 * "who answers" chip and the faces beside it in the composer.
 */
const CSS = `
${threadCss("[data-agent-screen]")}
[data-agent-screen] .pick { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #ececec; border-radius: 11px; background: #fff; cursor: pointer; text-align: left; font: inherit; letter-spacing: inherit; min-width: 0; transition: border-color .15s, background .15s; }
[data-agent-screen] .pick:hover { border-color: #d4d4d4; background: #fafafa; }
[data-agent-screen] .pick .nm { font-size: 13px; font-weight: 600; color: #171717; }
[data-agent-screen] .pick .hn { font-size: 11.5px; color: #8a8a8a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
[data-agent-screen] .answer { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 4px; border-radius: 8px; font-size: 12px; color: #525252; white-space: nowrap; flex-shrink: 0; }
[data-agent-screen] .answer b { font-weight: 600; color: #171717; }
[data-agent-screen] .answer .x { border: 0; background: transparent; padding: 0 2px; cursor: pointer; color: #8a8a8a; font: inherit; line-height: 1; }
[data-agent-screen] .answer .x:hover { color: #171717; }
[data-agent-screen] .faces { display: flex; align-items: center; gap: 3px; margin-left: 2px; }
[data-agent-screen] .faces button { border: 1px solid transparent; background: transparent; border-radius: 7px; padding: 2px; cursor: pointer; display: flex; opacity: .8; transition: opacity .15s, border-color .15s; }
[data-agent-screen] .faces button:hover { opacity: 1; border-color: #e5e5e5; }
[data-agent-screen] .tool { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border: 1px solid #ececec; border-radius: 8px; background: #fafafa; margin: 2px 6px 8px 0; font-size: 12px; color: #525252; }
`;

const ICON2 = {
  search: (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4 4" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24">
      <path d="m15 4 5 5-3.5 1.5-4 4 .5 4.5-1.5 1.5-4-4L4 20l3.5-3.5-4-4L5 11l4.5.5 4-4z" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  ),
};

export function AgentScreen({
  conversationId: initialId,
  initialMessages,
  locale,
  me,
  model,
  initialPrompt,
  initialAgent = null,
  now,
}: {
  conversationId: string | null;
  initialMessages: ThreadMessage[];
  locale: Locale;
  me: { name: string; avatarUrl: string | null };
  model: string;
  /** A question handed over from another screen (Files asks here). */
  initialPrompt?: string;
  /** An employee picked in the sidebar (`/chat?agent=…`), or the one who
   *  answered last in a reopened thread: the draft starts tagged to them,
   *  exactly as if "@编剧 " had been typed. */
  initialAgent?: AgentKey | null;
  /** The server render's clock, so the day pill hydrates to the same words. */
  now?: string;
}) {
  const zh = locale.startsWith("zh");
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [input, setInput] = useState(initialAgent ? `${agentTag(initialAgent)} ` : "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveModel, setLiveModel] = useState(model);
  /** The sources rail lists three; this opens the rest. */
  const [allSources, setAllSources] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const format = (f: Format) => formatTextarea(box.current, f, setInput);
  /* @ an employee to hand them this message; otherwise your assistant answers. */
  const mentions = useMentions({ people: undefined, zh, draft: input, setDraft: setInput, box });
  /* Who will answer what is in the box — the same rule the stream route
     applies (the first employee tagged, else the person's own assistant), so
     the label under the box is never a guess. */
  const answering: AgentKey | null = parseAgentMentions(input)[0] ?? null;
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name);

  /* Put a colleague's tag at the front of the draft, replacing one already
     there, and hand the caret back to the box. */
  function ask(k: AgentKey) {
    setInput((d) => (d.startsWith("@") ? d.replace(/^@\S+\s*/, `${agentTag(k)} `) : `${agentTag(k)} ${d}`));
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* Arriving with an employee picked: the caret goes after their tag, so the
     next thing typed is the question. */
  useEffect(() => {
    if (!initialAgent || initialPrompt) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A question passed in from another module is asked once, on arrival.
  const asked = useRef(false);
  useEffect(() => {
    if (!initialPrompt || asked.current) return;
    asked.current = true;
    void send(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const patchLast = useCallback((fn: (m: ThreadMessage) => ThreadMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    /* The next draft starts addressed to whoever this one was: a question to
       编剧 is usually followed by another to 编剧, the same way an untagged
       reply in a channel goes to the employee who just spoke. It is only a
       tag in the box — visible, and one × away from the assistant. */
    const to = parseAgentMentions(text)[0] ?? null;
    setInput(to ? `${agentTag(to)} ` : "");
    const now = new Date().toISOString();

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text, status: "complete", createdAt: now, citations: [], tools: [] },
      { id: `a-${Date.now()}`, role: "assistant", content: "", status: "streaming", createdAt: now, citations: [], tools: [] },
    ]);

    const controller = new AbortController();
    abort.current = controller;

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content: text }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let created: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 2);
          if (!frame.startsWith("data:")) continue;
          // The wire shape is the stream route's; `JSON.parse` is untyped and
          // the switch below narrows each event the way it always did.
          let event: ReturnType<typeof JSON.parse>;
          try {
            event = JSON.parse(frame.slice(5).trim());
          } catch {
            // One unreadable frame is not the answer failing; the next one is.
            continue;
          }

          switch (event.type) {
            case "conversation":
              created = event.id;
              setConversationId(event.id);
              break;
            case "speaker":
              patchLast((m) => ({ ...m, speaker: event.agent ?? null }));
              break;
            case "message":
              patchLast((m) => ({ ...m, id: event.id }));
              break;
            case "delta":
              patchLast((m) => ({ ...m, content: m.content + event.text }));
              break;
            case "tool":
              patchLast((m) => {
                const tools = [...m.tools];
                const at = tools.findIndex((x) => x.id === event.id);
                const entry = { id: event.id, name: event.name, status: event.status, summary: event.summary };
                if (at >= 0) tools[at] = entry;
                else tools.push(entry);
                return { ...m, tools };
              });
              break;
            case "citations":
              patchLast((m) => ({ ...m, citations: event.files, withheld: event.withheld }));
              break;
            case "notice":
              setNotice(event.text);
              break;
            case "usage":
              setLiveModel(event.model);
              patchLast((m) => ({ ...m, costMicros: event.costMicros, model: event.model }));
              break;
            case "done":
              patchLast((m) => ({ ...m, status: "complete" }));
              break;
            case "error":
              patchLast((m) => ({ ...m, status: "failed", error: event.message }));
              break;
          }
        }
      }

      if (created && !initialId) router.replace(`/chat/t/${created}`);
      else router.refresh();
    } catch (err) {
      if ((err as Error).name === "AbortError") patchLast((m) => ({ ...m, status: "stopped" }));
      else
        patchLast((m) => ({
          ...m,
          status: "failed",
          error: err instanceof Error ? err.message : "The connection dropped.",
        }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const last = [...messages].reverse().find((m) => m.role === "assistant" && m.citations.length);
  const sources = last?.citations ?? [];
  /* The Sources column. A citation is a file name and a line of quoted
   * text, and how much of either you want to see is not something the
   * artboard could decide for you. */
  const { width: sourcesWidth, handle: sourcesHandle } = useResizable("agent-sources", {
    min: 220,
    max: 520,
    initial: 300,
    edge: "left",
  });
  const today = now ?? messages[0]?.createdAt ?? "1970-01-01T00:00:00.000Z";

  return (
    <div data-agent-screen="" style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* header */}
      <div
        style={{
          height: 58,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "0 18px 0 24px",
        }}
      >
        {/* The host's own assistant is the little pixel robot, next to the
            employees' pixel faces — it used to be a black cube that looked
            like nothing else in the product. */}
        <AgentIcon agent={null} size={32} radius={9} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
            {zh ? "你的助理" : "Your agent"}
            <span className="role" style={{ background: "#f4f4f5", color: "#525252" }}>
              {zh ? "私密" : "Private"}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8a8a8a",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {zh
              ? "只有你能看到 · 权限与你完全一致 · @ 一位 AI 同事就由他来回答"
              : "Only you can see this · works with exactly your permissions · @ an AI teammate to have them answer"}
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        {/* Which model is answering — and the control that changes it. It was
            a bare chip printing a model id with nothing to say why it was
            there; it is the same picker the composer carries everywhere else. */}
        <span className="chip" style={{ height: 28, fontSize: 11.5 }}>
          <ModelPicker current={liveModel} zh={zh} />
        </span>
        <Link href="/search" prefetch={false} className="ico2" aria-label={zh ? "搜索" : "Search"}>
          {ICON2.search}
        </Link>
        <span
          className="ico2"
          role="note"
          tabIndex={0}
          aria-label={
            zh
              ? "这个助理的权限与你完全一致，读取的文件会列在右侧。"
              : "This agent holds exactly your permissions. Whatever it reads is listed on the right."
          }
          title={
            zh
              ? "这个助理的权限与你完全一致，读取的文件会列在右侧。"
              : "This agent holds exactly your permissions. Whatever it reads is listed on the right."
          }
        >
          {ICON2.info}
        </span>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            ref={scroller}
            style={{
              flexGrow: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              // With a conversation, messages run from the top and the pane
              // scrolls. With none, the opening state sits *just above the
              // composer*: pinned to the top of a tall pane it left a screen
              // of nothing between the greeting and the box you type in —
              // "ui looks bad since its so up from input bar" — which reads as
              // a page that failed to load rather than one waiting for you.
              justifyContent: messages.length === 0 ? "flex-end" : "flex-start",
              paddingBottom: 10,
            }}
          >
            {messages.length === 0 ? (
              <div style={{ paddingTop: 22 }}>
                <Empty zh={zh} picked={answering} onPick={ask} />
              </div>
            ) : (
              <>
                <div className="day">
                  <span>{dayLabel(messages[0].createdAt, today, locale)}</span>
                </div>
                {messages.map((m) =>
                  m.role === "user" ? (
                    <UserRow key={m.id} message={m} me={me} locale={locale} />
                  ) : (
                    <AgentRow key={m.id} message={m} zh={zh} locale={locale} />
                  ),
                )}
              </>
            )}

            {notice && (
              <div style={{ padding: "4px 24px 10px" }}>
                <div
                  style={{
                    border: "1px solid #fbdb73",
                    background: "#fdfaed",
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontSize: 12.5,
                    color: "#b45f06",
                    maxWidth: 640,
                  }}
                >
                  {notice}
                </div>
              </div>
            )}
          </div>

          {/* composer */}
          <div style={{ flexShrink: 0, padding: "6px 24px 18px" }}>
            <div className="composer">
              <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="up" />

              {/* The formatting buttons write Markdown; this is what it will
                  look like once sent. */}
              <FormattedPreview text={input} zh={zh} />

              <textarea
                ref={box}
                className="dc-composer"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onBlur={mentions.close}
                onKeyDown={(e) => {
                  if (mentions.onKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                aria-label={zh ? "给助理发消息" : "Message your assistant"}
                placeholder={
                  answering
                    ? zh
                      ? `问${name(answering)}…`
                      : `Ask ${name(answering)}…`
                    : zh
                      ? "给助理发消息，或输入 @ 叫一位 AI 同事来回答…"
                      : "Message your assistant, or type @ to have an AI teammate answer…"
                }
                style={{
                  display: "block",
                  width: "100%",
                  border: 0,
                  outline: "none",
                  resize: "none",
                  padding: "12px 14px 6px",
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  letterSpacing: "inherit",
                  color: "#171717",
                  maxHeight: 160,
                  background: "transparent",
                }}
              />

              {/* One row: who answers (and one press to ask somebody else),
                  the formatting buttons, send. */}
              <div className="bar">
                <span
                  className="answer"
                  style={{ background: answering ? soft(AGENT_TINTS[answering], 0.5) : "#f4f4f5" }}
                >
                  <AgentIcon agent={answering} size={20} radius={5} />
                  {zh ? "回答：" : "Answering: "}
                  <b>{answering ? name(answering) : zh ? "你的助理" : "Your agent"}</b>
                  {/* Back to the assistant: drop the tag at the front. A tag
                      further into the sentence is the writer's own business. */}
                  {answering && input.startsWith("@") ? (
                    <button
                      type="button"
                      className="x"
                      onClick={() => {
                        setInput((d) => d.replace(/^@\S+\s*/, ""));
                        requestAnimationFrame(() => box.current?.focus());
                      }}
                      aria-label={zh ? "改回你的助理" : "Back to your agent"}
                      title={zh ? "改回你的助理" : "Back to your agent"}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
                <span className="faces">
                  {AGENT_KEYS.filter((k) => k !== answering).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => ask(k)}
                      aria-label={zh ? `问${name(k)}` : `Ask ${name(k)}`}
                      title={zh ? `问${name(k)}：${AGENT_LABELS[k].hint}` : `Ask ${name(k)}: ${AGENT_LABELS[k].hintEn}`}
                    >
                      <AgentIcon agent={k} size={20} radius={5} />
                    </button>
                  ))}
                </span>
                <span className="sep" aria-hidden />
                <button type="button" className="ico2" onClick={() => format("bold")} aria-label="Bold" title={zh ? "加粗" : "Bold"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("italic")} aria-label="Italic" title={zh ? "斜体" : "Italic"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M10 5h8M6 19h8M14.5 5 9.5 19" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("link")} aria-label="Link" title={zh ? "链接" : "Link"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("list")} aria-label="List" title={zh ? "列表" : "List"}>
                  <svg viewBox="0 0 24 24">
                    <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("code")} aria-label="Code" title={zh ? "代码" : "Code"}>
                  <svg viewBox="0 0 24 24">
                    <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
                  </svg>
                </button>
                <div style={{ flexGrow: 1 }} />
                <button
                  type="button"
                  onClick={() => (busy ? abort.current?.abort() : void send(input))}
                  disabled={!busy && !input.trim()}
                  aria-label={busy ? (zh ? "停止" : "Stop") : zh ? "发送" : "Send"}
                  title={busy ? (zh ? "停止" : "Stop") : zh ? "发送" : "Send"}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    border: 0,
                    cursor: !busy && !input.trim() ? "default" : "pointer",
                    background: !busy && !input.trim() ? "#d4d4d4" : "#171717",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background .15s",
                  }}
                >
                  {busy ? (
                    <span style={{ width: 11, height: 11, borderRadius: 2, background: "#fff" }} />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 15,
                        height: 15,
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: 2.2,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* sources panel */}
        {/*
          The sources rail, and only when there are sources.
          It used to hold 300px of the window open to say "Sources used · 0"
          with a paragraph explaining what would go there one day. A panel
          that is empty on every screen anybody actually looks at is a panel
          that should not be drawn: it appears the moment an answer rests on a
          file, and takes the width back when it does not.
        */}
        {sources.length > 0 ? (
          <div
            style={{
              width: sourcesWidth,
              flexShrink: 0,
              position: "relative",
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {sourcesHandle}
            <div
              style={{
                height: 44,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                borderBottom: "1px solid #ededed",
              }}
            >
              <span className="lbl" style={{ padding: 0 }}>
                {zh ? "已使用的来源" : "Sources used"} · {sources.length}
              </span>
            </div>
            <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              {/* Three, then the rest on request: an answer that read forty
                  files should not push its own text off the screen. */}
              {(allSources ? sources : sources.slice(0, 3)).map((s) => (
                <Link
                  key={s.fileId}
                  href={`/files/${s.fileId}`}
                  style={{
                    border: "1px solid #ededed",
                    borderRadius: 9,
                    background: "#fff",
                    padding: "10px 11px",
                    color: "#171717",
                    display: "block",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#999999", marginTop: 2 }}>{s.folder ?? "—"}</div>
                  <span
                    className={`bd ${s.relation === "owner" || s.relation === "editor" ? "blue" : "gray"}`}
                    style={{ marginTop: 8 }}
                  >
                    {relationLabel(s.relation, zh)}
                  </span>
                </Link>
              ))}

              {sources.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setAllSources((v) => !v)}
                  style={{
                    border: 0,
                    background: "transparent",
                    padding: "2px 2px 0",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 11.5,
                    color: "#007be0",
                  }}
                >
                  {allSources
                    ? zh
                      ? "收起"
                      : "Show fewer"
                    : zh
                      ? `+ 再看 ${sources.length - 3} 个`
                      : `+ ${sources.length - 3} more`}
                </button>
              ) : null}

              {last?.withheld && (
                <p className="mut" style={{ lineHeight: 1.55, marginTop: 4 }}>
                  {zh
                    ? "已按你的权限过滤。另有文件匹配但未显示。"
                    : "Filtered to what you can read. Further files matched and were withheld."}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


function relationLabel(relation: string | null, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    owner: ["Owner", "所有者"],
    editor: ["Editor", "可编辑"],
    commenter: ["Commenter", "可评论"],
    viewer: ["Viewer", "可查看"],
  };
  const pair = relation ? map[relation] : undefined;
  return pair ? (zh ? pair[1] : pair[0]) : zh ? "可查看" : "Viewer";
}

/** "09:38", in the studio's zone on both sides of hydration. */
function time(iso: string | undefined, locale: Locale): string {
  return clock(iso, locale);
}

function UserRow({
  message,
  me,
  locale,
}: {
  message: ThreadMessage;
  me: { name: string; avatarUrl: string | null };
  locale: Locale;
}) {
  return (
    <div className="msg">
      {me.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="mav" src={me.avatarUrl} alt="" />
      ) : (
        <div
          className="mav"
          style={{
            background: "#ececec",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            color: "#525252",
          }}
        >
          {initials(me.name)}
        </div>
      )}
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div className="head">
          <span className="who">{me.name}</span>
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>
        <div className="txt plain">{message.content}</div>
      </div>
    </div>
  );
}

/**
 * One answer. Whoever gave it is drawn as themselves — the employee's pixel
 * face, name and job in their colour, or the host's robot for the person's own
 * assistant — and a reloaded thread says the same, because the speaker is
 * stored with the answer (`agent_messages.speaker`).
 */
function AgentRow({ message, zh, locale }: { message: ThreadMessage; zh: boolean; locale: Locale }) {
  const sp = message.speaker ?? null;
  return (
    <div className="msg">
      <div className="face">
        <AgentIcon agent={sp} size={36} radius={10} />
      </div>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div className="head">
          <span className="who">{sp ? (zh ? AGENT_LABELS[sp].nameLocal : AGENT_LABELS[sp].name) : zh ? "你的助理" : "Your agent"}</span>
          {sp ? (
            <span className="role" style={{ background: soft(AGENT_TINTS[sp], 0.75), color: AGENT_COLORS[sp] }}>
              {zh ? AGENT_LABELS[sp].title : AGENT_LABELS[sp].titleEn}
            </span>
          ) : (
            <span className="role" style={{ background: "#f4f4f5", color: "#525252" }}>
              {zh ? "私人助理" : "Assistant"}
            </span>
          )}
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>

        <div className="txt">
          {message.tools.map((tool) => (
            <div key={tool.id} className="tool">
              {tool.status === "running" ? (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    border: "2px solid #c7c7c7",
                    borderTopColor: "#525252",
                    animation: "spin .7s linear infinite",
                    display: "inline-block",
                  }}
                />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 12,
                    height: 12,
                    stroke: tool.status === "error" ? "#e03636" : "#278f5e",
                    fill: "none",
                    strokeWidth: 2.4,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  {tool.status === "error" ? <path d="M7 7l10 10M17 7 7 17" /> : <path d="m5 12.5 4.5 4.5L19 7.5" />}
                </svg>
              )}
              <span>{tool.summary ?? tool.name}</span>
            </div>
          ))}

          {message.content ? (
            <Markdown text={tidyMarkdown(message.content)} />
          ) : message.status === "streaming" ? (
            <span style={{ color: "#a3a3a3" }}>{zh ? "思考中…" : "Thinking…"}</span>
          ) : null}

          {message.error && (
            <div
              style={{
                border: "1px solid #fdc2c2",
                background: "#fff7f7",
                borderRadius: 9,
                padding: "9px 12px",
                fontSize: 12.5,
                color: "#b52a2a",
                marginTop: 8,
                maxWidth: 560,
              }}
            >
              {message.error}
            </div>
          )}

          {message.withheld && (
            <p className="mut" style={{ marginTop: 8 }}>
              {zh
                ? "此回答可能不完整：部分匹配内容超出你的权限范围。"
                : "This answer may be partial — some matches are outside your access."}
            </p>
          )}

          {message.citations.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {message.citations.map((c) => (
                <Link
                  key={c.fileId}
                  href={`/files/${c.fileId}`}
                  prefetch={false}
                  className="chip"
                  style={{
                    height: 24,
                    fontSize: 11.5,
                    color: "#0f5bd5",
                    borderColor: "#c9ddf7",
                    background: "#f2f8ff",
                  }}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}

          {message.status === "complete" && message.costMicros !== undefined && (
            <p className="mut" style={{ marginTop: 8, fontSize: 11.5, color: "#a3a3a3" }}>
              {message.model} · {cost(message.costMicros)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function cost(micros: number): string {
  const usd = micros / 1_000_000;
  if (!usd) return "US$0.00";
  return usd < 0.01 ? `US$${usd.toFixed(4)}` : `US$${usd.toFixed(2)}`;
}

/**
 * Before anything has been asked: who you are talking to, and the five
 * colleagues you could ask instead — each with their face and the one line on
 * what to ask them for. Picking one tags them in the box.
 */
function Empty({ zh, picked, onPick }: { zh: boolean; picked: AgentKey | null; onPick: (k: AgentKey) => void }) {
  return (
    <div style={{ padding: "0 24px 18px" }}>
      <AgentIcon agent={picked} size={44} radius={12} />
      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 14 }}>
        {picked ? (zh ? `问${AGENT_LABELS[picked].nameLocal}` : `Ask the ${AGENT_LABELS[picked].name}`) : zh ? "你的助理" : "Your agent"}
      </div>
      <p className="mut" style={{ marginTop: 4, lineHeight: 1.6, maxWidth: 520 }}>
        {picked
          ? zh
            ? `${AGENT_LABELS[picked].hint}。它用自己的权限回答，回答会留在这个对话里。`
            : `${AGENT_LABELS[picked].hintEn}. It answers with its own permissions, in this conversation.`
          : zh
            ? "它的权限与你完全一致。它读过的文件会列在右边。也可以直接找一位 AI 同事："
            : "It holds exactly your permissions. Whatever it reads is listed on the right. Or ask an AI teammate directly:"}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
          gap: 8,
          marginTop: 14,
          maxWidth: 760,
        }}
      >
        {AGENT_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className="pick"
            onClick={() => onPick(k)}
            style={k === picked ? { borderColor: AGENT_TINTS[k], background: soft(AGENT_TINTS[k], 0.35) } : undefined}
          >
            <AgentIcon agent={k} size={32} radius={9} />
            <span style={{ minWidth: 0 }}>
              <span className="nm" style={{ display: "block" }}>
                {zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name}
              </span>
              <span className="hn" style={{ display: "block" }}>
                {zh ? AGENT_LABELS[k].hint : AGENT_LABELS[k].hintEn}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
