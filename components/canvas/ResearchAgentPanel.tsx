"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MentionMenu } from "@/components/chat/MentionMenu";
import { useMentions } from "@/components/chat/useMentions";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_LABELS, agentTag, parseAgentMentions, screenAgentForPath, type AgentKey } from "@/lib/agents/catalog";
import { useResizable } from "@/components/ui/Resizer";

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
`;
export function ResearchAgentPanel({
  accent,
  zh,
  /** Top-right caption. The artboards put the region here. */
  corner,
  /** The pill under the tab strip: what this screen is currently showing. */
  scope,
  /** One line of plain fact about what is on screen. */
  note,
  placeholder,
  model,
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
  // One stored width for the agent column, shared by every screen that draws
  // it: narrowing it on Compare and finding it wide again on Inbox would be
  // the same panel disagreeing with itself.
  const { width, handle } = useResizable("agent-panel", { min: 220, max: 620, initial: 272, edge: "left" });
  // Docked, the host owns the size and draws the seam.
  const frame: React.CSSProperties = dock
    ? { flexGrow: 1, minHeight: 0, borderTop: "1px solid #ededed" }
    : { width, flexShrink: 0, borderLeft: "1px solid #ededed" };

  /* Who answers here unless the message tags someone: the screen's own
     employee, or the personal assistant where the screen has none. */
  const pathname = usePathname();
  const home = screenAgentForPath(pathname ?? "");
  const box = useRef<HTMLTextAreaElement | null>(null);
  const mentions = useMentions({ people: undefined, zh, draft: ask, setDraft: setAsk, box });
  const taggedNow = parseAgentMentions(ask)[0] ?? null;
  const answering: AgentKey | null = taggedNow ?? home;
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name);

  const send = () => {
    if (!ask.trim()) return;
    onAsk(ask.trim());
    setAsk("");
  };

  return (
    <div
      data-agent-panel=""
      style={{
        position: "relative",
        background: "#fcfcfc",
        display: "flex",
        flexDirection: "column",
        ...frame,
      }}
    >
      {dock ? null : handle}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div
        style={{
          height: 42,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 10px",
          borderBottom: "1px solid #ededed",
        }}
      >
        {/* Who this panel is: the screen's own employee, or — where the
            screen has none, as in Chat — the host's pixel robot. It was a
            cube in the screen's accent colour that stood for nobody. */}
        <div className="rtab on" style={{ gap: 7 }}>
          <AgentIcon agent={home} size={18} radius={5} />
          {home ? name(home) : zh ? "助理" : "Agent"}
        </div>
        <div style={{ flexGrow: 1 }} />
        {corner ? <span className="cap">{corner}</span> : null}
      </div>

      <div style={{ flexShrink: 0, padding: "11px 13px", borderBottom: "1px solid #f3f3f3" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 25,
            padding: "0 10px",
            borderRadius: 7,
            background: "#fff",
            border: "1px solid #ededed",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 3, background: accent }} />
          <span style={{ fontSize: 11.5, color: "#525252" }}>{scope}</span>
        </div>
      </div>

      {/* The screen's one line of fact, until something has been asked. A
          host that passes a thread (AgentDock does) used to hide it for good,
          leaving an empty column; the thread's empty state is marked
          `data-agent-empty`, and while it has nothing in it the note shows in
          its place. A browser without :has() simply shows the empty thread,
          as before. */}
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
        {/* Who answers, and one press to ask a colleague instead. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 7 }}>
          <span style={{ fontSize: 11.5, color: "#999999", marginRight: 1 }}>{zh ? "回答：" : "Answering:"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#171717" }}>
            <AgentIcon agent={answering} size={16} radius={4} />
            {answering ? name(answering) : zh ? "你的助理" : "Your assistant"}
          </span>
          <span style={{ flexGrow: 1 }} />
          {(["research", "script", "video", "article"] as AgentKey[])
            .filter((k) => k !== answering)
            .map((k) => (
              <button
                key={k}
                type="button"
                title={zh ? `问${name(k)}` : `Ask ${name(k)}`}
                onClick={() => {
                  setAsk((d) => (parseAgentMentions(d).length ? d.replace(/^@\S+\s*/, `${agentTag(k)} `) : `${agentTag(k)} ${d}`.trimEnd() + " "));
                  requestAnimationFrame(() => box.current?.focus());
                }}
                className="ap-ask"
              >
                <AgentIcon agent={k} size={16} radius={4} />
              </button>
            ))}
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
            {/* Which model answers — and, for an owner or an administrator,
                the control that changes it. It was a caption for months while
                the only way to change the model was an environment variable
                on a box. */}
            <ModelPicker current={model} zh={zh} />
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
                cursor: "pointer",
                /* The product's one primary colour. The screen's accent
                   stays on the scope dot above. */
                background: ask.trim() ? "#171717" : "#d4d4d4",
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
  );
}
