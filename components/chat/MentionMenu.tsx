"use client";

import { AgentIcon } from "@/components/agents/AgentIcon";

import * as React from "react";
import { AGENT_COLORS, AGENT_KEYS, AGENT_LABELS, AGENT_TINTS, agentAliases, type AgentKey } from "@/lib/agents/catalog";
import { soft } from "./look";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { AgentName } from "@/components/ui/Tr";

/**
 * The @-picker: who you can tag, people and AI employees together.
 *
 * The studio's ask was "AI employees they can tag" and "make each role clearer
 * in the chat", so the two kinds are listed in one menu and drawn as different
 * things. An agent gets the pixel face the message list gives its messages,
 * its Chinese name, and one line saying what to tag it for; a colleague gets
 * their face and their job title. Agents come first, under their own heading
 * — they are the new thing, and they are what the picker exists for.
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
  /** A person's user id, for their default picture; absent for an employee. */
  personId?: string | null;
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
    personId: p.id,
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
 * always what was meant. The AI employees who match are listed above the
 * people who do, because the employees are what the picker exists for.
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

  /* Best first within each kind, and the employees as one block above the
     people: the menu heads each kind once, and a person whose name matched
     exactly ranked above an employee's prefix match and split the employees
     into two runs, each with its own "AI 同事" heading. */
  const ranked = scored.sort((a, b) => b.score - a.score).map((s) => s.target);
  return [...ranked.filter((t) => t.agent), ...ranked.filter((t) => !t.agent)].slice(0, 8);
}

/** An AI employee's own face — the pixel sprite on its tint — or the host's
 *  robot when no employee is named. Kept under this name so every screen that
 *  drew the old cube now draws the right face without changing its import. */
export function AgentMark({ size = 36, radius = 10, agent = null }: { size?: number; radius?: number; agent?: AgentKey | null }) {
  return <AgentIcon agent={agent} size={size} radius={radius} />;
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
      <div style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: "#a3a3a3", padding: "5px 9px 4px" }}>
        <span style={{ flexGrow: 1 }}>{zh ? "输入名字，回车选择" : "Type a name, Enter to pick"}</span>
        <span>{zh ? "↑↓ 切换" : "↑↓ to move"}</span>
      </div>
      {matches.map((t, i) => (
        <React.Fragment key={`${t.agent ?? "u"}-${t.tag}-${i}`}>
          {/* A heading where the list changes kind: the employees, then the
              people. `filterTargets` keeps each kind in one block, so each
              heading is drawn once. */}
          {i === 0 || Boolean(matches[i - 1]?.agent) !== Boolean(t.agent) ? (
            <div
              aria-hidden
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "#737373",
                padding: i === 0 ? "4px 9px 3px" : "9px 9px 3px",
                borderTop: i === 0 ? undefined : "1px solid #f3f3f3",
                marginTop: i === 0 ? 0 : 4,
              }}
            >
              {t.agent ? (zh ? "AI 同事" : "AI teammates") : zh ? "同事" : "People"}
            </div>
          ) : null}
          <button
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
              background: i === active ? (t.agent ? soft(AGENT_TINTS[t.agent], 0.45) : "#f4f4f5") : "transparent",
              cursor: "pointer",
              textAlign: "left",
              font: "inherit",
              letterSpacing: "inherit",
            }}
          >
            {t.agent ? (
              <AgentMark agent={t.agent} size={26} radius={8} />
            ) : (
              <PersonAvatar id={t.personId} url={t.avatarUrl} name={t.label} size={26} radius={8} />
            )}

            <span style={{ minWidth: 0, flexGrow: 1 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                {/* An employee's name is translate-proof (`AgentName`): read through
                    Chrome's translate, 策划 is "Planner", not "plan". */}
                <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{t.agent ? <AgentName agent={t.agent} zh={zh} /> : t.label}</span>
                {t.agent ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      height: 17,
                      padding: "0 6px",
                      borderRadius: 5,
                      fontSize: 11,
                      fontWeight: 600,
                      color: AGENT_COLORS[t.agent],
                      background: AGENT_TINTS[t.agent],
                    }}
                  >
                    {zh ? "AI 员工" : "AI STAFF"}
                  </span>
                ) : null}
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
        </React.Fragment>
      ))}
    </div>
  );
}
