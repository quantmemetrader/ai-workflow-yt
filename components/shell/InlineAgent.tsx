"use client";

import { getPanelModel } from "@/components/chat/ModelChip";
import { AUTO_MODEL } from "@/lib/ai/chat-models";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, AGENT_KEYS, AGENT_LABELS, SCREEN_AGENT, agentAliases, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { AgentTyping, streamStep } from "@/components/agents/AgentTyping";
import { AgentName } from "@/components/ui/Tr";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/ui/Markdown";
import { conversationMessagesAction } from "@/app/(app)/chat/actions";
import { tidyMarkdown } from "@/components/chat/look";
import { ProjectBridge } from "@/components/chat/ProjectBridge";
import { STEP_LABELS, stepForTool } from "@/lib/agents/steps";

/**
 * A person's message as they read it: the "[附件] 名称 (doc) file id fil_… ·
 * 已读取全文 38 字" lines the stream route writes for the employee become
 * small file chips, and only what was typed is shown as text (QA, 2 Oct:
 * a reloaded Home thread printed those lines).
 */
function splitAttached(content: string): { text: string; files: { id: string; name: string; kind: string; read: boolean }[] } {
  const files: { id: string; name: string; kind: string; read: boolean }[] = [];
  const kept: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\[附件\]\s+(.+?)\s+\(([a-z]+)[^)]*\)\s+file id\s+(fil_[0-9a-z]+)/i.exec(line.trim());
    if (m) files.push({ id: m[3].toLowerCase(), name: m[1], kind: m[2], read: /已读取/.test(line) });
    else if (!line.trim().startsWith("[附件]")) kept.push(line);
  }
  return { text: kept.join("\n").trim(), files };
}

/** A tool step in words ("查资料", "正在写脚本"), never the tool's raw output (QA, 2 Oct). */
function stepWords(name: string, status: string, zh: boolean): string {
  const label = STEP_LABELS[stepForTool(name)] ?? STEP_LABELS.working;
  const words = (zh ? label.zh : label.en).replace(/…$/, "");
  if (status === "running") return words;
  return zh ? words.replace(/^正在/, "") : words.replace(/^(\w)/, (c) => c.toUpperCase());
}

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

/** What a tool made or touched, with its id: the thread links to it (an article written from chat used to be named and not linked). */
export type InlineArtifact = { kind: string; id: string; title?: string; action?: string };
export type InlineTool = { id: string; name: string; status: "running" | "ok" | "error"; summary?: string; artifacts?: InlineArtifact[] };

const ARTIFACT_HREF: Record<string, (id: string) => string | null> = {
  script: (id) => `/script/${id}`,
  work_project: (id) => `/projects/${id}`,
  video_project: (id) => `/video?project=${id}`,
  article: (id) => `/article?id=${id}`,
  file: (id) => `/files/${id}`,
  contract: () => "/legal",
  spend_request: () => "/finance",
  finance_report: () => "/finance",
};
const ARTIFACT_WORD: Record<string, [string, string]> = {
  script: ["打开脚本", "Open the script"],
  work_project: ["打开项目", "Open the project"],
  video_project: ["打开视频", "Open the video"],
  article: ["打开文章", "Open the article"],
  file: ["打开文件", "Open the file"],
  contract: ["打开法务", "Open legal"],
  spend_request: ["打开财务", "Open finance"],
  finance_report: ["打开财务", "Open finance"],
};
function artifactLinks(tools: InlineTool[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const t of tools) {
    for (const a of t.artifacts ?? []) {
      const to = ARTIFACT_HREF[a.kind]?.(a.id);
      if (!to || seen.has(a.kind + a.id)) continue;
      seen.add(a.kind + a.id);
      out.push({ href: to, label: a.title ? `《${a.title.slice(0, 24)}》` : "" });
      out[out.length - 1].label = (out[out.length - 1].label ? out[out.length - 1].label + " · " : "") + a.kind;
    }
  }
  return out;
}

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
  /** The article on screen (the Article page): its writer revises that one. */
  articleId?: string;
};


/**
 * Whom the assistant just handed work to, read off its own receipt line
 * ("已交给策划，…"). That colleague answers in a channel and the answer is
 * copied into this thread (`handoff-origin.ts`); until it lands, the thread
 * shows them typing, so a hand-off never looks like silence (Avon, 2 Oct).
 */
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function handedTo(text: string): AgentKey | null {
  if (!text) return null;
  for (const key of AGENT_KEYS) {
    const names = [AGENT_LABELS[key].nameLocal, AGENT_LABELS[key].nameEn, ...agentAliases(key)].filter((n) => n.length >= 2).map(esc).join("|");
    if (new RegExp(`(?:已交给|交给了?|已派给|派给了?|安排给|已安排|已转给|handed (?:it |this |that )?(?:on )?to|asked)\\s*(?:${names})`, "i").test(text)) return key;
  }
  return null;
}
const AWAIT_MS = 4 * 60_000;

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
  /* A colleague whose answer is on its way (the last line is a hand-off receipt
     and nothing from them has arrived yet), for up to four minutes. */
  const [clock, setClock] = useState(0);
  const awaitSince = useRef<{ id: string; at: number } | null>(null);
  const awaiting: AgentKey | null = useMemo(() => {
    void clock;
    if (busy || !messages.length) return null;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || last.status !== "complete" || last.speaker) return null;
    const key = handedTo(last.content);
    if (!key) return null;
    if (awaitSince.current?.id !== last.id) awaitSince.current = { id: last.id, at: Date.now() };
    return Date.now() - awaitSince.current.at < AWAIT_MS ? key : null;
  }, [messages, busy, clock]);

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
    async (text: string, attachments?: string[]) => {
      const files = (attachments ?? []).filter((x) => typeof x === "string" && x).slice(0, 10);
      const content = text.trim() || (files.length ? "请看附件" : "");
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
        { id: `u-${stamp}`, role: "user", content: files.length ? `${content}\n（附了 ${files.length} 个参考文件）` : content, status: "complete", citations: [], tools: [] },
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
            ...(files.length ? { attachments: files } : {}),
            context: latest.current,
            ...(defaultAgent ? { agent: defaultAgent } : {}),
            ...(getPanelModel() !== AUTO_MODEL ? { model: getPanelModel() } : {}),
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
                setNotice(null);
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
                    ? m.tools.map((x) => (x.id === event.id ? { ...x, status: event.status, summary: event.summary ?? x.summary, artifacts: event.artifacts ?? x.artifacts } : x))
                    : [...m.tools, { id: event.id, name: event.name, status: event.status, summary: event.summary, artifacts: event.artifacts }];
                  return { ...m, tools };
                });
                break;
              case "done":
                setNotice(null);
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

  /* A colleague's reply written into this thread from the server (a hand-off
     made here is answered in a channel and copied back: `handoff-origin.ts`)
     shows up without a reload: while the thread is open and idle, the server
     is asked every 15 s for ten minutes whether it has more than we show. */
  useEffect(() => {
    if (!conversationId || busy) return;
    let stopped = false;
    const started = Date.now();
    const id = conversationId;
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible" || Date.now() - started > 10 * 60_000) return;
      const res = await conversationMessagesAction(id).catch(() => null);
      const list = res?.messages;
      if (stopped || !list) return;
      setMessages((prev) => (list.length > prev.length ? list.map((m) => ({ ...m, citations: [], tools: [] })) : prev));
    };
    /* Quicker while a colleague's answer is on its way. */
    const timer = window.setInterval(() => {
      void tick();
      if (awaiting) setClock((c) => c + 1);
    }, awaiting ? 5_000 : 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [conversationId, busy, awaiting]);

  /* The colleague typing at the end of the thread until their answer lands. */
  const shown = useMemo<InlineMessage[]>(
    () => (awaiting ? [...messages, { id: `awaiting-${awaiting}`, role: "assistant", content: "", status: "streaming", citations: [], tools: [], speaker: awaiting }] : messages),
    [messages, awaiting],
  );

  return { messages: shown, conversationId, busy, notice, send, stop, load, reset };
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
          <UserLine key={m.id} content={m.content} zh={zh} />
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
                {/* One line per step, the same step once: what it did in
                    words. The tool's own first line (「《…》 (id: wp_…) —
                    active」) is for the model, not the person (QA, 2 Oct). */}
                {m.tools.filter((x, i, all) => x.status === "running" || all.findIndex((y) => y.status !== "running" && stepWords(y.name, y.status, zh) === stepWords(x.name, x.status, zh) && (y.status === "error") === (x.status === "error")) === i).map((x) => (
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
                      {stepWords(x.name, x.status, zh)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {m.content ? <Markdown text={tidyMarkdown(m.content)} /> : null}
            {/* What this turn made, as links: the article it wrote, the project it started. */}
            {m.status !== "streaming" && artifactLinks(m.tools).length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {artifactLinks(m.tools).map((a) => {
                  const kind = a.label.split(" · ").pop() ?? "";
                  const word = ARTIFACT_WORD[kind] ? (zh ? ARTIFACT_WORD[kind][0] : ARTIFACT_WORD[kind][1]) : kind;
                  const title = a.label.includes(" · ") ? a.label.split(" · ")[0] : "";
                  return (
                    <Link key={a.href} href={a.href} prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#171717", background: "#f3f3f1", border: "1px solid #e3e1dc", borderRadius: 999, padding: "3px 10px", textDecoration: "none", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {word}
                      {title ? <span style={{ fontWeight: 400, color: "#525252" }}>{title}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ) : null}
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

/** The person's own line, with the files on it as chips. */
function UserLine({ content, zh }: { content: string; zh: boolean }) {
  const { text, files } = splitAttached(content);
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "88%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {text ? (
        <div style={{ background: "#171717", color: "#fff", borderRadius: "11px 11px 3px 11px", padding: "7px 10px", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</div>
      ) : null}
      {files.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
          {files.map((f) => (
            <Link key={f.id} href={`/files/${f.id}`} prefetch={false} title={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, maxWidth: 220, padding: "0 8px", borderRadius: 7, border: "1px solid #e7e6e2", background: "#fafaf8", fontSize: 11.5, color: "#404040", textDecoration: "none" }}>
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
                <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
                <path d="M14 3.5v5h5" />
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              {f.read ? <span style={{ color: "#1e7a4f", flexShrink: 0 }}>{zh ? "已读取" : "Read"}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
