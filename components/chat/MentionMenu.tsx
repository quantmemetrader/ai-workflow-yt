"use client";

import * as React from "react";
import { AGENT_KEYS, AGENT_LABELS, agentAliases, type AgentKey } from "@/lib/agents/catalog";

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
  /**
   * Everything this target answers to, lower-cased.
   *
   * Searching only the written tag meant that on a Chinese keyboard layout the
   * picker was useless to anyone typing Latin: `@r` matched none of 研究员,
   * 策划, 编剧, 剪辑师, 撰稿人, because none of them contains an "r". An
   * employee's aliases come from the catalog — the same list that routes a
   * tag — and a person's are their name, each word of it, and the local part
   * of their email.
   */
  aliases: string[];
};

export type MentionPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  title?: string | null;
  /** Searched by the picker; never shown. */
  email?: string | null;
};

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
      aliases: words([...agentAliases(key), a.name, a.nameLocal]),
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
    aliases: words([p.name, p.name.replace(/\s+/g, ""), ...p.name.split(/\s+/), p.email?.split("@")[0] ?? ""]),
  }));

  return [...agents, ...humans];
}

/** Lower-cased, de-duplicated, empties dropped. */
function words(list: (string | null | undefined)[]): string[] {
  return [...new Set(list.filter((s): s is string => Boolean(s && s.trim())).map((s) => s.trim().toLowerCase()))];
}

/**
 * Who `@…` could mean, best first.
 *
 * Matched against every name a target answers to, so `@r`, `@研`, `@剪`,
 * `@edit` and `@videoagent` all land somewhere sensible. Ranked rather than
 * merely filtered: something that *starts* with what has been typed is almost
 * always what was meant, and an AI employee is listed above a person on an
 * equal match because the employees are what the picker exists for.
 *
 * An empty query lists everybody, which is what pressing `@` on its own
 * should do.
 */
export function filterTargets(targets: MentionTarget[], query: string): MentionTarget[] {
  const q = query.trim().toLowerCase();
  if (!q) return targets.slice(0, 8);

  /* One character is not enough to be interesting in the middle of a word.
     `@r` matching 策划 because one of its aliases is "planner" is technically
     a match and practically noise; at one character, only a name that starts
     with it counts. */
  const floor = q.length === 1 ? 3 : 2;

  const scored: { target: MentionTarget; score: number }[] = [];
  for (const target of targets) {
    let best = 0;
    for (const alias of target.aliases) {
      const score = alias === q ? 4 : alias.startsWith(q) ? 3 : alias.includes(q) ? 2 : 0;
      if (score > best) best = score;
    }
    if (best >= floor) scored.push({ target, score: best + (target.agent ? 0.5 : 0) });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.target);
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
  placement = "up",
}: {
  matches: MentionTarget[];
  active: number;
  zh: boolean;
  onPick: (target: MentionTarget) => void;
  onHover: (index: number) => void;
  /**
   * Which way it opens. A composer at the foot of a thread has room above it
   * and none below; a box at the top of a page is the other way round, and
   * opening upward there put the list over the page heading.
   */
  placement?: "up" | "down";
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
        ...(placement === "down" ? { top: "calc(100% + 6px)" } : { bottom: "calc(100% + 6px)" }),
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
