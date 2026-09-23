"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/ui/Markdown";
import { formatTextarea, type Format } from "./composer-format";
import { FormattedPreview } from "@/components/ui/FormattedPreview";
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
};

const AGENT_MARK = (size: number, stroke = "#fff") => (
  <svg
    viewBox="0 0 24 24"
    style={{
      width: size,
      height: size,
      stroke,
      fill: "none",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }}
  >
    <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
    <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
  </svg>
);

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
}: {
  conversationId: string | null;
  initialMessages: ThreadMessage[];
  locale: Locale;
  me: { name: string; avatarUrl: string | null };
  model: string;
  /** A question handed over from another screen (Files asks here). */
  initialPrompt?: string;
}) {
  const zh = locale.startsWith("zh");
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveModel, setLiveModel] = useState(model);
  /** The sources rail lists three; this opens the rest. */
  const [allSources, setAllSources] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const format = (f: Format) => formatTextarea(box.current, f, setInput);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    setInput("");
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

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "0 18px 0 22px",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "#171717",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {AGENT_MARK(16)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
            {zh ? "你的助理" : "Your agent"}
            <span className="app" style={{ marginLeft: 0 }}>
              APP
            </span>
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "#999999",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {zh
              ? "私密 · 只有你能看到 · 权限与你完全一致"
              : "Private · only you can see this · works with exactly your permissions"}
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        {/* Which model is answering — and the control that changes it. It was
            a bare chip printing a model id with nothing to say why it was
            there; it is the same picker the composer carries everywhere else. */}
        <span className="chip" style={{ height: 28, fontSize: 11.5 }}>
          <ModelPicker current={liveModel} zh={zh} />
        </span>
        <Link href="/search" className="ico2" aria-label={zh ? "搜索" : "Search"}>
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
              // scrolls; with none, the opening state sits where the first
              // message will appear rather than stranded at the bottom.
              justifyContent: "flex-start",
              paddingBottom: 4,
            }}
          >
            {messages.length === 0 ? (
              <div style={{ paddingTop: 22 }}>
                <Empty zh={zh} />
              </div>
            ) : (
              <>
                <div className="day">
                  <span>{dayLabel(messages[0].createdAt, locale)}</span>
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
              <div style={{ padding: "0 22px 10px" }}>
                <div
                  style={{
                    border: "1px solid #fbdb73",
                    background: "#fdfaed",
                    borderRadius: 9,
                    padding: "9px 12px",
                    fontSize: 12,
                    color: "#db7706",
                    maxWidth: 640,
                  }}
                >
                  {notice}
                </div>
              </div>
            )}
          </div>

          {/* composer */}
          <div style={{ flexShrink: 0, padding: "8px 22px 18px" }}>
            <div
              style={{
                border: "1px solid #d9d9d9",
                borderRadius: 12,
                background: "#fff",
                boxShadow: "0 1px 1px rgba(5,5,6,.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  padding: "6px 8px",
                  borderBottom: "1px solid #f3f3f3",
                }}
              >
                <button type="button" className="ico2" onClick={() => format("bold")} aria-label="Bold">
                  <svg viewBox="0 0 24 24">
                    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("italic")} aria-label="Italic">
                  <svg viewBox="0 0 24 24">
                    <path d="M10 5h8M6 19h8M14.5 5 9.5 19" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("link")} aria-label="Link">
                  <svg viewBox="0 0 24 24">
                    <path d="M9.5 14.5 14.5 9.5M8 11l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("list")} aria-label="List">
                  <svg viewBox="0 0 24 24">
                    <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
                  </svg>
                </button>
                <button type="button" className="ico2" onClick={() => format("code")} aria-label="Code">
                  <svg viewBox="0 0 24 24">
                    <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
                  </svg>
                </button>
              </div>

              {/* The formatting buttons write Markdown; this is what it will
                  look like once sent. */}
              <FormattedPreview text={input} zh={zh} />

              <textarea
                ref={box}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={
                  zh ? "给助理发消息，或指定一个模块运行…" : "Message your agent, or name a module to run…"
                }
                style={{
                  width: "100%",
                  border: 0,
                  outline: "none",
                  resize: "none",
                  padding: "11px 13px 4px",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  letterSpacing: "inherit",
                  color: "#171717",
                  maxHeight: 160,
                  background: "transparent",
                }}
              />

              {/* The artboard drew attach, emoji and mention glyphs here. None
                  of the three has anything behind it, and an icon that looks
                  like a button and is not one is worse than no icon, so only
                  the "who this goes to" label and Send are drawn. */}
              <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 8px 8px" }}>
                <div className="ico2" style={{ gap: 6, width: "auto", padding: "0 8px" }}>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: "#171717",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {AGENT_MARK(9)}
                  </div>
                  <span style={{ fontSize: 12, color: "#525252" }}>{zh ? "询问助理" : "Ask agent"}</span>
                </div>
                <div style={{ flexGrow: 1 }} />
                <button
                  onClick={() => (busy ? abort.current?.abort() : void send(input))}
                  disabled={!busy && !input.trim()}
                  aria-label={busy ? (zh ? "停止" : "Stop") : zh ? "发送" : "Send"}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    border: 0,
                    cursor: "pointer",
                    background: !busy && !input.trim() ? "#c7c7c7" : "#007be0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
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
              width: 300,
              flexShrink: 0,
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
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
                  <div style={{ fontSize: 11, color: "#999999", marginTop: 2 }}>{s.folder ?? "—"}</div>
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

/** "Today" / "Yesterday", the date for anything older — the artboard's pill. */
function dayLabel(iso: string | undefined, locale: Locale): string {
  const loc = locale === "en" ? "en-GB" : locale;
  const d = iso ? new Date(iso) : new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date())) / 86400000);
  if (days === 0 || days === -1) {
    const rel = new Intl.RelativeTimeFormat(loc, { numeric: "auto" }).format(days, "day");
    return rel.charAt(0).toUpperCase() + rel.slice(1);
  }
  return new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

function time(iso: string | undefined, locale: Locale): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
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
            background: "#e2e2e2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            color: "#525252",
          }}
        >
          {me.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span className="who">{me.name}</span>
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>
        <div className="txt" style={{ whiteSpace: "pre-wrap" }}>
          {message.content}
        </div>
      </div>
    </div>
  );
}

function AgentRow({ message, zh, locale }: { message: ThreadMessage; zh: boolean; locale: Locale }) {
  return (
    <div className="msg">
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "#171717",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {AGENT_MARK(18)}
      </div>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span className="who">{zh ? "助理" : "Agent"}</span>
          <span className="app">APP</span>
          <span className="when">{time(message.createdAt, locale)}</span>
        </div>

        <div className="txt">
          {message.tools.map((tool) => (
            <div
              key={tool.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 26,
                padding: "0 10px",
                border: "1px solid #ededed",
                borderRadius: 8,
                background: "#f8f8f8",
                margin: "2px 6px 8px 0",
              }}
            >
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
              <span style={{ fontSize: 12, color: "#525252" }}>{tool.summary ?? tool.name}</span>
            </div>
          ))}

          {message.content ? (
            <Markdown text={message.content} />
          ) : message.status === "streaming" ? (
            <span style={{ color: "#999999" }}>{zh ? "思考中…" : "Thinking…"}</span>
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
                  className="chip"
                  style={{
                    height: 24,
                    fontSize: 11.5,
                    color: "#007be0",
                    borderColor: "#a7d7fd",
                    background: "#f2f9ff",
                  }}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          )}

          {message.status === "complete" && message.costMicros !== undefined && (
            <p className="mut" style={{ marginTop: 8 }}>
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

function Empty({ zh }: { zh: boolean }) {
  return (
    <div style={{ padding: "0 22px 18px" }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "#171717",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        {AGENT_MARK(22)}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{zh ? "你的助理" : "Your agent"}</div>
      <p className="mut" style={{ marginTop: 4, lineHeight: 1.55, maxWidth: 460 }}>
        {zh
          ? "它的权限与你完全一致。它读过的文件会列在右边。"
          : "It holds exactly your permissions. Whatever it reads is listed on the right."}
      </p>
    </div>
  );
}
