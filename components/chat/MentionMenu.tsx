"use client";

import * as React from "react";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";

/**
 * The @-picker: who you can tag, people and AI employees together.
 *
 * The studio's ask was "AI employees they can tag" and "make each role clearer
 * in the chat", so the two kinds are listed in one menu and drawn as different
 * things. An agent gets the dark cube the message list gives its messages, its
 * Chinese name, and one line saying what to tag it for; a colleague gets their
 * face and their job title. Agents come first — they are the new thing, and
 * they are what the picker exists for.
 *
 * The agents are listed from the catalog rather than from the database. They
 * are created on first use (`lib/agents/ensureAgent`), so in a studio that has
 * never tagged one there is no row to list, and "the feature does not appear
 * until you have used it" is not a feature.
 */
export type MentionTarget = {
  /** Exactly the characters written after `@`. */
  tag: string;
  label: string;
  /** The role line under the name. */
  sub: string | null;
  avatarUrl: string | null;
  /** Set for an AI employee; null for a person. */
  agent: AgentKey | null;
};

export type MentionPerson = { id: string; name: string; avatarUrl: string | null; title?: string | null };

/** Everyone who can be tagged here: the three AI employees, then the studio. */
export function mentionTargets(people: MentionPerson[], zh: boolean): MentionTarget[] {
  const agents: MentionTarget[] = AGENT_KEYS.map((key) => {
    const a = AGENT_LABELS[key];
    return {
      tag: zh ? a.nameLocal : a.name.replace(/\s+/g, ""),
      label: zh ? a.nameLocal : a.name,
      sub: zh ? a.hint : a.hintEn,
      avatarUrl: null,
      agent: key,
    };
  });

  const humans: MentionTarget[] = people.map((p) => ({
    // A tag is one run of characters, so a name with a space in it would be
    // read back as the first word only.
    tag: p.name.replace(/\s+/g, ""),
    label: p.name,
    sub: p.title ?? null,
    avatarUrl: p.avatarUrl,
    agent: null,
  }));

  return [...agents, ...humans];
}

/** Matches on the typed name and on the tag, so `@vid`, `@视频` and `@视` all
 * find 视频助理. An empty query lists everybody. */
export function filterTargets(targets: MentionTarget[], query: string): MentionTarget[] {
  const q = query.trim().toLowerCase();
  if (!q) return targets.slice(0, 8);
  return targets
    .filter((t) => t.tag.toLowerCase().includes(q) || t.label.toLowerCase().includes(q))
    .slice(0, 8);
}

/** The cube that means "this is an AI employee", at whatever size. */
export function AgentMark({ size = 36, radius = 10 }: { size?: number; radius?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "#171717",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{
          width: Math.round(size / 2),
          height: Math.round(size / 2),
          stroke: "#fff",
          fill: "none",
          strokeWidth: "1.7",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      >
        <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
        <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
      </svg>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function MentionMenu({
  matches,
  active,
  zh,
  onPick,
  onHover,
}: {
  matches: MentionTarget[];
  active: number;
  zh: boolean;
  onPick: (target: MentionTarget) => void;
  onHover: (index: number) => void;
}): React.JSX.Element | null {
  if (!matches.length) return null;

  return (
    <div
      role="listbox"
      aria-label={zh ? "可以 @ 的人和助理" : "People and agents you can tag"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 6px)",
        maxHeight: 268,
        overflowY: "auto",
        border: "1px solid #ededed",
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 8px 28px rgba(5,5,6,.12)",
        padding: 5,
        zIndex: 40,
      }}
    >
      <div style={{ fontSize: 10.5, color: "#999999", padding: "5px 9px 6px", letterSpacing: ".04em" }}>
        {zh ? "输入名字，回车选择" : "Type a name, Enter to pick"}
      </div>
      {matches.map((t, i) => (
        <button
          key={`${t.agent ?? "u"}-${t.tag}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => onHover(i)}
          // The textarea must keep the caret: a blur here closes the menu
          // before the click can land on it.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            padding: "6px 9px",
            border: 0,
            borderRadius: 8,
            background: i === active ? "#f3f3f3" : "transparent",
            cursor: "pointer",
            textAlign: "left",
            font: "inherit",
            letterSpacing: "inherit",
          }}
        >
          {t.agent ? (
            <AgentMark size={26} radius={8} />
          ) : t.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={t.avatarUrl}
              alt=""
              style={{ width: 26, height: 26, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "#e2e2e2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9.5,
                fontWeight: 600,
                color: "#525252",
                flexShrink: 0,
              }}
            >
              {initials(t.label)}
            </div>
          )}

          <span style={{ minWidth: 0, flexGrow: 1 }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{t.label}</span>
              {t.agent ? <span className="app">{zh ? "AI 员工" : "AI STAFF"}</span> : null}
            </span>
            {t.sub ? (
              <span
                style={{
                  display: "block",
                  fontSize: 11.5,
                  color: "#999999",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.sub}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
