"use client";

import { useRef, useState } from "react";

/**
 * Picking a phrase to watch, instead of typing one into an empty box.
 *
 * Both places that took a phrase — "Watch a topic" on the dashboard and "Add
 * series" on Search & compare — were bare inputs. That asks a person to
 * remember the exact wording of something they already watch, and to invent
 * the wording of something they do not. So both were used the same way: type
 * a word, wait a minute, find out it was already there under another spelling.
 *
 * This offers three things under one input:
 *
 *   — **Already watching.** The phrases the studio has data for, filtered as
 *     you type. Picking one is instant; there is nothing to collect.
 *   — **Trending now.** What the region is actually searching for, from
 *     Google's own daily feed, so a person can recognise instead of recall.
 *   — **The phrase typed**, as an explicit "watch this" row, so a new subject
 *     is one press and never a guess about whether Enter did anything.
 *
 * Keyboard first: arrows move, Enter takes, Escape closes. The list is a
 * listbox with the input as its combobox, so it reads correctly aloud.
 */
export type Suggestion = {
  phrase: string;
  /** Right-hand column: "watching", "200+", a source name. */
  hint?: string | null;
  kind: "watched" | "trending";
  /** Trending rows carry the story behind them. */
  note?: string | null;
};

export function PhrasePicker({
  value,
  onChange,
  onPick,
  suggestions,
  placeholder,
  busy = false,
  disabled = false,
  zh,
  style,
  autoFocus = false,
  emptyNote,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Take this phrase. The picker clears itself; the caller does the work. */
  onPick: (phrase: string) => void;
  suggestions: Suggestion[];
  placeholder: string;
  busy?: boolean;
  disabled?: boolean;
  zh: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  /** Shown under the list when there is nothing to suggest. */
  emptyNote?: string | null;
}) {
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);

  const typed = value.trim();
  const matching = suggestions.filter((s) =>
    typed ? s.phrase.toLowerCase().includes(typed.toLowerCase()) : true,
  );

  // The typed phrase is offered as its own row unless it is already one.
  const exact = matching.some((s) => s.phrase.toLowerCase() === typed.toLowerCase());
  const rows: Suggestion[] = [
    ...(typed && !exact ? [{ phrase: typed, kind: "watched" as const, hint: t("new", "新建") }] : []),
    ...matching.slice(0, 12),
  ];

  const take = (phrase: string) => {
    onPick(phrase);
    onChange("");
    setOpen(false);
    setCursor(0);
  };

  return (
    <div ref={box} style={{ position: "relative", ...style }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls="phrase-picker-list"
          aria-autocomplete="list"
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onFocus={() => setOpen(true)}
          // A click inside the list must land before the blur closes it.
          onBlur={() => setTimeout(() => setOpen(false), 130)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setCursor((c) => Math.min(rows.length - 1, c + 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const row = open ? rows[cursor] : undefined;
              const phrase = row?.phrase ?? typed;
              if (phrase) take(phrase);
            }
          }}
          style={{
            width: "100%",
            height: 30,
            border: "1px solid #ededed",
            borderRadius: 8,
            background: "#ffffff",
            padding: "0 30px 0 9px",
            fontSize: 12,
            fontFamily: "inherit",
            letterSpacing: "inherit",
            color: "#171717",
            outline: "none",
            opacity: disabled ? 0.55 : 1,
          }}
        />
        <span style={{ position: "absolute", right: 9, display: "flex", pointerEvents: "none" }}>
          {busy ? (
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, animation: "auraSpin 1s linear infinite" }}>
              <circle cx="12" cy="12" r="8.6" stroke="#ededed" strokeWidth="2.8" fill="none" />
              <path
                d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6"
                stroke="#007be0"
                strokeWidth="2.8"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "none", stroke: "#c7c7c7", strokeWidth: 2 }}>
              <circle cx="10.6" cy="10.6" r="6.4" />
              <path d="m15.4 15.4 4 4" strokeLinecap="round" />
            </svg>
          )}
        </span>
      </div>

      {open && (rows.length > 0 || emptyNote) ? (
        <div
          id="phrase-picker-list"
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            minWidth: "100%",
            maxWidth: 420,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 60,
            background: "#fff",
            border: "1px solid #ededed",
            borderRadius: 11,
            boxShadow: "0 16px 40px rgba(23,23,23,0.14)",
            padding: 5,
          }}
        >
          {rows.map((s, i) => {
            const first = i === 0 || rows[i - 1].kind !== s.kind;
            return (
              <div key={`${s.kind}-${s.phrase}-${i}`}>
                {first && s.kind === "trending" ? (
                  <div
                    style={{
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      color: "#c7c7c7",
                      padding: "8px 8px 4px",
                    }}
                  >
                    {t("Trending now", "当前热搜")}
                  </div>
                ) : null}
                <div
                  role="option"
                  aria-selected={i === cursor}
                  tabIndex={-1}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(e) => {
                    // Keep the input focused so blur does not race the click.
                    e.preventDefault();
                    take(s.phrase);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: i === cursor ? "#f6f6f6" : "transparent",
                  }}
                >
                  <Star filled={s.kind === "watched" && s.hint !== t("new", "新建")} />
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "#171717",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.phrase}
                    </span>
                    {s.note ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#999999",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.note}
                      </span>
                    ) : null}
                  </span>
                  {s.hint ? (
                    <span style={{ fontSize: 11, color: "#999999", flexShrink: 0 }}>{s.hint}</span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {rows.length === 0 && emptyNote ? (
            <div style={{ fontSize: 11.5, color: "#999999", padding: "10px 9px", lineHeight: 1.5 }}>{emptyNote}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Filled for something already watched, hollow for something that would be
 * started. The same shape either way, so the row does not jump. */
function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{
        width: 13,
        height: 13,
        flexShrink: 0,
        fill: filled ? "#f0a500" : "none",
        stroke: filled ? "#f0a500" : "#c7c7c7",
        strokeWidth: 1.7,
        strokeLinejoin: "round",
      }}
    >
      <path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z" />
    </svg>
  );
}
