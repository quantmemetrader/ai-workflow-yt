"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import { useState } from "react";
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
[data-agent-panel] .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; font-size: 12.5px; color: #7c7c7c; }
[data-agent-panel] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-agent-panel] .cap { font-size: 11.5px; color: #999999; }
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
      <style>{CSS}</style>
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
        <div className="rtab on" style={{ gap: 6 }}>
          <svg
            viewBox="0 0 24 24"
            style={{
              width: 12,
              height: 12,
              stroke: accent,
              fill: "none",
              strokeWidth: 1.8,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }}
          >
            <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
            <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
          </svg>
          {zh ? "助理" : "Agent"}
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

      {thread ?? (
        <div style={{ flexGrow: 1, minHeight: 0, padding: "14px 13px 0", overflow: "hidden" }}>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: "#383838", textWrap: "pretty", margin: 0 }}>{note}</p>
        </div>
      )}

      <div style={{ flexShrink: 0, padding: "11px 13px 9px" }}>
        {/* History and a new thread sit right above the composer, where the
            hand already is, rather than in the header two panes away. */}
        {tools ? <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 7 }}>{tools}</div> : null}
        <div style={{ border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff", padding: "9px 10px 7px" }}>
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            aria-label={placeholder}
            placeholder={placeholder}
            style={{
              width: "100%",
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 12,
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
                width: 25,
                height: 25,
                borderRadius: 7,
                border: 0,
                padding: 0,
                cursor: "pointer",
                background: accent,
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
