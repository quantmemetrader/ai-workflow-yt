"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MentionMenu } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { asksSomething } from "@/components/chat/look";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AnswerPicker } from "@/components/chat/AnswerPicker";
import { AGENT_LABELS, agentTag, parseAgentMentions, screenAgentForPath, type AgentKey } from "@/lib/agents/catalog";
import { useResizable } from "@/components/ui/Resizer";
import { AgentName } from "@/components/ui/Tr";

/**
 * The 312px Agent panel every Market Research artboard draws down its right
 * edge.
 *
 * One component rather than one per screen, for the reason the sidebar is one
 * component: the artboards draw the same column five times, and five
 * transcriptions of the same thing drift.
 *
 * Two things the artboards did that this deliberately does not:
 *
 *   — They scripted a conversation. A question nobody asked, a tool trace
 *     nobody ran ("Read 27 comments · 0.6 s"), and a pair of buttons wired to
 *     nothing. What is left is `note`: one line the screen can say from its
 *     own data, and nothing it cannot.
 *   — They paired the Agent tab with a "Watchlist" tab. The watchlist lives on
 *     the Trends dashboard, and a tab that switches to nothing is worse than
 *     no tab.
 *
 * The composer is real: it hands the question to the agent on /chat, which is
 * where an answer can actually cite the files the asker is allowed to read.
 *
 * Carries its own CSS rather than borrowing the host screen's. The first
 * version relied on the screens' `.rtab` rule being in scope; two of the four
 * screens do not define it, so the tab rendered as unstyled text. A shared
 * component that only looks right inside some of its hosts is not shared.
 */

/*
 * 28 Sep: no longer a column. The owner wanted the pages calm and readable for
 * people who are not technical ("less info per page"), and a chat column
 * down the right of every module was the fourth column on most screens. It
 * is now one round 「问 AI」 button in the bottom-right corner that slides the
 * same panel in over the page; Esc or a click outside puts it away. The
 * conversation stays while the page is open (the host holds it), and the
 * model picker moved out of here (the chat box and Settings choose it).
 */
const CSS = `
[data-agent-panel] .rtab { height: 28px; padding: 0 10px 0 6px; border-radius: 8px; display: flex; align-items: center; font-size: 12.5px; color: #7c7c7c; }
[data-agent-panel] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.03); color: #171717; font-weight: 500; }
[data-agent-panel] .cap { font-size: 11.5px; color: #999999; }
[data-agent-panel] .ap-note { display: none; flex-grow: 1; min-height: 0; padding: 14px 14px 0; overflow: hidden; }
[data-agent-panel] .ap-note p { font-size: 12.5px; line-height: 1.65; color: #525252; text-wrap: pretty; margin: 0; }
[data-agent-panel]:has([data-agent-empty]:empty) .ap-note { display: block; }
[data-agent-panel]:has([data-agent-empty]:empty) [data-agent-empty] { display: none; }
[data-agent-panel] .ap-box { position: relative; border: 1px solid #e2e2e2; border-radius: 11px; background: #fff; padding: 9px 10px 7px; transition: border-color .15s, box-shadow .15s; }
[data-agent-panel] .ap-box:focus-within { border-color: #b5b5b5; box-shadow: 0 0 0 3px rgba(23,23,23,.05); }
[data-agent-panel] .ap-ask { border: 1px solid transparent; background: transparent; border-radius: 6px; padding: 1px; cursor: pointer; display: flex; opacity: .85; }
[data-agent-panel] .ap-ask:hover { opacity: 1; border-color: #e5e5e5; background: #fff; }
.ap-fab { position: fixed; right: 22px; bottom: 22px; z-index: 60; display: inline-flex; align-items: center; gap: 8px; height: 46px; padding: 0 18px 0 8px; border-radius: 999px; border: 1px solid #e3e2de; background: #fff; color: #171717; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 22px rgba(0,0,0,.12); transition: transform .15s ease, box-shadow .15s ease; }
.ap-fab:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(0,0,0,.16); }
.ap-fab:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.ap-veil { position: fixed; inset: 0; z-index: 70; background: rgba(23,23,23,.18); animation: apFade .15s ease-out; }
.ap-close { width: 30px; height: 30px; border-radius: 8px; border: 0; background: transparent; color: #525252; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.ap-close:hover { background: #f0f0ee; color: #171717; }
@keyframes apFade { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { [data-agent-panel] { transition: none !important; } .ap-veil { animation: none; } }
`;
export function ResearchAgentPanel({
  accent: _accent,
  zh,
  /** Top-right caption. The artboards put the region here. */
  corner: _corner,
  /** The pill under the tab strip: what this screen is currently showing. */
  scope,
  /** One line of plain fact about what is on screen. */
  note,
  placeholder,
  model: _model,
  /** Footer left. The Comment inbox uses it for the PDPO notice. */
  footnote,
  onAsk,
  thread,
  tools,
  dock = false,
}: {
  accent: string;
  zh: boolean;
  corner?: string;
  scope: string;
  note: string;
  placeholder: string;
  model: string;
  footnote?: string;
  onAsk: (prompt: string) => void;
  /** The conversation so far. Asking used to navigate to /chat, which took the
   * screen you were reading away to answer a question about it. */
  thread?: React.ReactNode;
  /** Controls in the header: history, a new thread. */
  tools?: React.ReactNode;
  /**
   * Fill the space given instead of claiming a column of its own.
   *
   * The Trends dashboard already spends its right edge on the watchlist, so
   * the agent goes underneath it rather than beside it — same panel, same
   * conversation, no second vertical seam on a screen that has three already.
   */
  dock?: boolean;
}) {
  const [ask, setAsk] = useState("");
  /* Closed until asked for: the page gets its full width. */
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    requestAnimationFrame(() => box.current?.focus());
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  // One stored width for the agent column, shared by every screen that draws
  // it: narrowing it on Compare and finding it wide again on Inbox would be
  // the same panel disagreeing with itself.
  const { width, handle } = useResizable("agent-drawer", { min: 320, max: 720, initial: 400, edge: "left" });
  /* A drawer over the page, docked or not (`dock` is kept for the callers
     that pass it; there is no column left to fill). */
  void dock;
  const frame: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width,
    zIndex: 71,
    borderLeft: "1px solid #e7e6e2",
    boxShadow: open ? "-12px 0 40px rgba(0,0,0,.12)" : "none",
    transform: open ? "translateX(0)" : "translateX(100%)",
    visibility: open ? "visible" : "hidden",
    transition: open ? "transform .22s cubic-bezier(.2,.8,.2,1)" : "transform .18s ease-in, visibility 0s linear .18s",
  };

  /* Who answers here unless the message tags someone: the screen's own
     employee, or the personal assistant where the screen has none. */
  const pathname = usePathname();
  const home = screenAgentForPath(pathname ?? "");
  const box = useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people: undefined, zh, draft: ask, setDraft: setAsk, box });
  const taggedNow = parseAgentMentions(ask)[0] ?? null;
  const answering: AgentKey | null = taggedNow ?? home;
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name);

  /* "@编剧 " from a face button is who to ask, not a question: nothing to
     send until something follows it. */
  const ready = asksSomething(ask);
  const send = () => {
    if (!ready) return;
    onAsk(ask.trim());
    setAsk("");
  };

  return (
    <>
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
    {open ? null : (
      <button type="button" className="ap-fab" onClick={() => setOpen(true)} aria-label={zh ? "问 AI" : "Ask AI"}>
        <AgentIcon agent={home} size={30} radius={15} />
        {zh ? "问 AI" : "Ask AI"}
      </button>
    )}
    {open ? <div className="ap-veil" onClick={() => setOpen(false)} aria-hidden /> : null}
    <div
      data-agent-panel=""
      role="dialog"
      aria-label={zh ? "问 AI" : "Ask AI"}
      aria-hidden={!open}
      style={{
        background: "#fcfcfc",
        display: "flex",
        flexDirection: "column",
        ...frame,
      }}
    >
      {handle}
      <div
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 12px 0 16px",
          borderBottom: "1px solid #ededed",
        }}
      >
        {/* Who answers here: the screen's own employee, or the assistant. */}
        <AgentIcon agent={home} size={30} radius={9} />
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#171717" }}>{home ? <AgentName agent={home} zh={zh} /> : zh ? "你的助理" : "Your assistant"}</div>
          <div style={{ fontSize: 12, color: "#8a8a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zh ? `正在看：${scope}` : `Looking at: ${scope}`}</div>
        </div>
        <button type="button" className="ap-close" onClick={() => setOpen(false)} aria-label={zh ? "关闭" : "Close"}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      {/* The screen's one line of fact, until something has been asked. A
          host that passes a thread (AgentDock does) used to hide it for good,
          leaving an empty column; the thread's empty state is marked
          `data-agent-empty`, and while it has nothing in it the note shows in
          its place. A browser without :has() simply shows the empty thread,
          as before. */}
      {/* An answer on its way is drawn by the thread itself: the shared
          typing pill (`AgentTyping`, inside `InlineAgentThread`). */}
      {thread ? (
        <>
          <div className="ap-note">
            <p>{note}</p>
          </div>
          {thread}
        </>
      ) : (
        <div style={{ flexGrow: 1, minHeight: 0, padding: "14px 14px 0", overflow: "hidden" }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.65, color: "#525252", textWrap: "pretty", margin: 0 }}>{note}</p>
        </div>
      )}

      <div style={{ flexShrink: 0, padding: "10px 12px 12px" }}>
        {/* History and a new thread sit right above the composer, where the
            hand already is, rather than in the header two panes away. */}
        {tools ? <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 7 }}>{tools}</div> : null}
        {/* Who answers: the same dropdown as the chat's composer, every employee in it — a row of faces had room for four. */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
          <AnswerPicker
            answering={answering}
            zh={zh}
            align="right"
            quick={3}
            compact
            prefer={home ? [home] : []}
            onPick={(k) => {
              setAsk((d) =>
                k
                  ? parseAgentMentions(d).length
                    ? d.replace(/^@\S+\s*/, `${agentTag(k)} `)
                    : `${agentTag(k)} ${d}`.trimEnd() + " "
                  : d.replace(/^@\S+\s*/, ""),
              );
              requestAnimationFrame(() => box.current?.focus());
            }}
          />
        </div>
        <div className="ap-box">
          <MentionMenu matches={mentions.matches} active={mentions.active} zh={zh} onPick={mentions.pick} onHover={mentions.setActive} placement="up" />
          <textarea
            ref={box}
            rows={1}
            value={ask}
            onChange={(e) => {
              setAsk(e.target.value);
              mentions.onValue(e.target.value, e.target.selectionStart ?? e.target.value.length);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
            }}
            onBlur={mentions.close}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            aria-label={placeholder}
            placeholder={answering ? (zh ? `问${name(answering)}…（@ 叫别的同事）` : `Ask ${name(answering)}… (@ another colleague)`) : placeholder}
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              resize: "none",
              background: "transparent",
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
            {/* The model is chosen in the chat box and in Settings, not here. */}
            <span style={{ fontSize: 11.5, color: "#a3a3a3" }}>{zh ? "Enter 发送 · Shift+Enter 换行" : "Enter to send"}</span>
            <button
              type="button"
              aria-label={zh ? "发送" : "Send"}
              onClick={send}
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                border: 0,
                padding: 0,
                cursor: ready ? "pointer" : "default",
                /* The product's one primary colour. The screen's accent
                   stays on the scope dot above. */
                background: ready ? "#171717" : "#d4d4d4",
                transition: "background .15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                style={{
                  width: 12,
                  height: 12,
                  stroke: "#fff",
                  fill: "none",
                  strokeWidth: 2.3,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                }}
              >
                <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {footnote ? (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid #f3f3f3",
            padding: "9px 13px 11px",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span style={{ fontSize: 11.5, color: "#999999" }}>{footnote}</span>
        </div>
      ) : null}
    </div>
    </>
  );
}
