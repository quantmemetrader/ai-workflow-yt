"use client";

import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, SCREEN_AGENT, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { AgentTyping, streamStep } from "@/components/agents/AgentTyping";
import { AgentName } from "@/components/ui/Tr";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/ui/Markdown";
import { conversationMessagesAction } from "@/app/(app)/chat/actions";
import { tidyMarkdown } from "@/components/chat/look";
import { ProjectBridge } from "@/components/chat/ProjectBridge";

/**
 * The agent, answering inside the module you are already in.
 *
 * Every module's artboard draws an agent panel down its right edge, and every
 * one of them was wired to `router.push("/chat?q=…")`. Asking "who changed
 * this?" about a folder therefore threw away the folder, the selection and the
 * scroll, and left you on the chat home with your question in a URL. The panel
 * was a link dressed as a conversation.
 *
 * This is the same turn, run in place. It posts to the same
 * `/api/agent/stream` the chat screen posts to, so the tools, the citation
 * filter and the token ledger are the same ones, and the conversation it
 * creates is a real conversation: the footer links to it, so a thread that
 * turns out to be worth keeping is already in Chat when you get there.
 */
export type InlineCitation = { fileId: string; name: string; relation?: string | null };

export type InlineTool = { id: string; name: string; status: "running" | "ok" | "error"; summary?: string };

export type InlineMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "complete" | "failed" | "stopped";
  citations: InlineCitation[];
  /** What it did on the way to the answer, one line each, as it happens. */
  tools: InlineTool[];
  withheld?: boolean;
  error?: string;
  /** Which employee answered; null or absent is the personal assistant. */
  speaker?: AgentKey | null;
};

/**
 * What is open on this screen, so the agent can act on it.
 *
 * Without this the agent can talk about the studio and not touch it: "summarise
 * this channel" has no channel and "cut that bit" has no video. Every field is
 * a hint — the server re-checks each id against the viewer inside the tool
 * that uses it, so naming something you cannot read gets you nothing.
 */
export type AgentContext = {
  module?: string;
  channelId?: string;
  projectId?: string;
  topicId?: string;
  fileId?: string;
  scriptId?: string;
};

export function useInlineAgent(
  context: AgentContext = {},
  opts: {
    /**
     * Remember the conversation for this thing, so coming back to the same
     * project finds the same thread. A key such as `video:prj_…`; the id is
     * kept in the browser, the messages on the server.
     */
    key?: string;
    /** Who answers by default. Unset: the screen's own employee (see
     *  SCREEN_AGENT); null: the personal assistant. */
    agent?: AgentKey | null;
  } = {},
) {
  const defaultAgent: AgentKey | null = opts.agent !== undefined ? opts.agent : context.module ? (SCREEN_AGENT[context.module] ?? null) : null;
  /*
   * The context as it is *now*, read at send time.
   *
   * A caller builds this object inline, so it is a new object on every render;
   * in `send`'s dependency list it would rebuild the callback every frame, and
   * leaving it out would send whatever was open when the panel first mounted.
   * A ref is neither.
   */
  const latest = useRef(context);
  latest.current = context;

  const [messages, setMessages] = useState<InlineMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const patchLast = useCallback((fn: (m: InlineMessage) => InlineMessage) => {
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

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || abort.current) return;

      setBusy(true);
      setNotice(null);
      const stamp = Date.now();
      /* The answer's row goes up at once, typing under the face of whoever
         will answer: the employee tagged, else the one this panel belongs
         to. The stream's `speaker` event confirms or corrects it. */
      const speaker = parseAgentMentions(content)[0] ?? defaultAgent;
      setMessages((prev) => [
        ...prev,
        { id: `u-${stamp}`, role: "user", content, status: "complete", citations: [], tools: [] },
        { id: `a-${stamp}`, role: "assistant", content: "", status: "streaming", citations: [], tools: [], speaker },
      ]);

      const controller = new AbortController();
      abort.current = controller;

      try {
        const res = await fetch("/api/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          /*
           * The key is left out when there is no conversation yet, rather than
           * sent as null. The route reads a present-but-not-a-string
           * `conversationId` as a malformed request and answers 400, so every
           * first message from this panel came back "Bad request".
           */
          body: JSON.stringify({
            ...(conversationId ? { conversationId } : {}),
            content,
            context: latest.current,
            ...(defaultAgent ? { agent: defaultAgent } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const said = (await res.text().catch(() => "")).trim();
          throw new Error(
            res.status === 401
              ? "Your session has ended. Sign in again."
              : res.status === 403
                ? "You do not hold a module that can use the assistant here."
                : res.status === 413
                  ? "That message is too long."
                  : said && said.length < 200
                    ? said
                    : `The assistant could not be reached (${res.status}).`,
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 2);
            if (!frame.startsWith("data:")) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let event: any;
            try {
              event = JSON.parse(frame.slice(5).trim());
            } catch {
              // One malformed frame is not the end of the answer.
              continue;
            }

            switch (event.type) {
              case "conversation":
                setConversationId(event.id);
                break;
              case "speaker":
                patchLast((m) => ({ ...m, speaker: event.agent ?? null }));
                break;
              case "delta":
                patchLast((m) => ({ ...m, content: m.content + event.text }));
                break;
              case "citations":
                patchLast((m) => ({ ...m, citations: event.files, withheld: event.withheld }));
                break;
              case "notice":
                setNotice(event.text);
                break;
              case "tool":
                /* The trace, live: "Looked at the timeline", "Cut 0:14–0:19".
                   It used to be dropped here, so a turn that took forty
                   seconds to make six changes showed "thinking…" for forty
                   seconds and then a paragraph. */
                patchLast((m) => {
                  const tools = m.tools.some((x) => x.id === event.id)
                    ? m.tools.map((x) => (x.id === event.id ? { ...x, status: event.status, summary: event.summary ?? x.summary } : x))
                    : [...m.tools, { id: event.id, name: event.name, status: event.status, summary: event.summary }];
                  return { ...m, tools };
                });
                break;
              case "done":
                patchLast((m) => ({ ...m, status: "complete" }));
                break;
              case "error":
                patchLast((m) => ({ ...m, status: "failed", error: event.message }));
                break;
              default:
                // `message` and `usage` are for the full chat screen.
                break;
            }
          }
        }
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
    },
    [conversationId, patchLast, defaultAgent],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Open an earlier conversation in the panel. */
  const load = useCallback(async (id: string) => {
    abort.current?.abort();
    const res = await conversationMessagesAction(id);
    if (!res.messages) return;
    setConversationId(id);
    setNotice(null);
    setMessages(res.messages.map((m) => ({ ...m, citations: [], tools: [] })));
  }, []);

  /** A fresh thread. */
  const reset = useCallback(() => {
    abort.current?.abort();
    setConversationId(null);
    setMessages([]);
    setNotice(null);
    if (opts.key) {
      try {
        localStorage.removeItem(`aura:agent:${opts.key}`);
      } catch {
        // Nothing to forget.
      }
    }
  }, [opts.key]);

  /* Coming back to the same project finds the same thread. Read on mount,
     written when a thread starts. */
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!opts.key || restoredFor.current === opts.key) return;
    restoredFor.current = opts.key;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`aura:agent:${opts.key}`);
    } catch {
      saved = null;
    }
    if (saved) void load(saved);
    else {
      setConversationId(null);
      setMessages([]);
    }
  }, [opts.key, load]);

  useEffect(() => {
    if (!opts.key || !conversationId) return;
    try {
      localStorage.setItem(`aura:agent:${opts.key}`, conversationId);
    } catch {
      // Private mode: the thread still lives in Chat.
    }
  }, [opts.key, conversationId]);

  return { messages, conversationId, busy, notice, send, stop, load, reset };
}

/** The thread itself, sized for a 312px panel. */
export function InlineAgentThread({
  messages,
  notice,
  conversationId,
  zh,
  empty,
}: {
  messages: InlineMessage[];
  notice: string | null;
  conversationId: string | null;
  zh: boolean;
  /** What the panel says before anyone has asked anything. */
  empty?: React.ReactNode;
}) {
  if (!messages.length) {
    /* Marked, so a panel whose host passed no `empty` can show its own note
       here instead of a blank column (ResearchAgentPanel's `.ap-note`). */
    return (
      <div data-agent-empty="" style={{ flexGrow: 1, minHeight: 0, padding: "16px 14px 0", overflow: "hidden" }}>
        {empty}
      </div>
    );
  }

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        padding: "14px 14px 0",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <ProjectBridge compact conversationId={conversationId} messages={messages} zh={zh} />
      {messages.map((m) =>
        m.role === "user" ? (
          <div
            key={m.id}
            style={{
              alignSelf: "flex-end",
              maxWidth: "88%",
              background: "#171717",
              color: "#fff",
              borderRadius: "11px 11px 3px 11px",
              padding: "7px 10px",
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            {m.content}
          </div>
        ) : (
          <div key={m.id} style={{ fontSize: 12.5, lineHeight: 1.65, color: "#383838" }}>
            {/* Who is speaking, with their face: the employee who answered
                (stored with the answer, so a thread reopened here still says
                so), or the host's robot for the person's own assistant. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <AgentIcon agent={m.speaker ?? null} size={18} radius={5} />
              <span style={{ fontSize: 12, fontWeight: 600, color: m.speaker ? AGENT_COLORS[m.speaker] : "#171717" }}>
                {m.speaker ? <AgentName agent={m.speaker} zh={zh} /> : zh ? "你的助理" : "Your agent"}
              </span>
            </div>
            {m.tools.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: m.content ? 8 : 4 }}>
                {m.tools.map((x) => (
                  <div
                    key={x.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      color: x.status === "error" ? "#e03636" : x.status === "running" ? "#7c7c7c" : "#525252",
                      lineHeight: 1.4,
                    }}
                  >
                    {x.status === "running" ? (
                      <svg viewBox="0 0 24 24" style={{ width: 9, height: 9, flexShrink: 0, animation: "auraSpin 1s linear infinite" }}>
                        <circle cx="12" cy="12" r="8.6" stroke="#ededed" strokeWidth="3" fill="none" />
                        <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#007be0" strokeWidth="3" fill="none" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: x.status === "error" ? "#e03636" : "#278f5e", flexShrink: 0 }} />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {x.summary ?? x.name.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {m.content ? <Markdown text={tidyMarkdown(m.content)} /> : null}
            {/* The agent's waiting belongs to the agent's panel, where its
                answer will appear — not to an indicator somewhere else. The
                shared typing pill (`AgentTyping`): until the first word, and
                while a tool runs, on that tool's step. */}
            {m.status === "streaming" && (!m.content || m.tools.some((x) => x.status === "running")) ? (
              <div style={{ marginTop: m.content ? 6 : 0 }}>
                <AgentTyping agent={m.speaker ?? null} zh={zh} step={streamStep(m.tools)} face={false} size="sm" />
              </div>
            ) : null}

            {m.status === "failed" && (
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#e03636", lineHeight: 1.5 }}>
                {m.error}
              </p>
            )}
            {m.status === "stopped" && (
              <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "#999999" }}>
                {zh ? "已停止。" : "Stopped."}
              </p>
            )}

            {m.citations.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                {m.citations.map((c) => (
                  <Link
                    key={c.fileId}
                    href={`/files/${c.fileId}`}
                    style={{
                      fontSize: 11.5,
                      color: "#007be0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            )}
            {m.withheld && (
              <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "#c7c7c7", lineHeight: 1.5 }}>
                {zh ? "还有一些结果你无权查看，已隐藏。" : "Some matches are not shown, because you may not read them."}
              </p>
            )}
          </div>
        ),
      )}

      {notice && (
        <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, margin: 0 }}>{notice}</p>
      )}

      {conversationId && (
        <Link
          href={`/chat/t/${conversationId}`}
          style={{ fontSize: 11.5, color: "#999999", margin: "2px 0 12px", flexShrink: 0 }}
        >
          {zh ? "在聊天中继续 →" : "Continue in Chat →"}
        </Link>
      )}
    </div>
  );
}
