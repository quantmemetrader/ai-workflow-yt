"use client";

import * as React from "react";
import Link from "next/link";
import { AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";
import type { LookKey } from "@/components/office/art";
import { Portrait } from "@/components/office/Portrait";
import { STATUS_TONE, nameOf, statusWord, taskLine, type OfficeMember } from "@/components/office/text";

const CSS = `
[data-roster] { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; scroll-snap-type: x proximity; scrollbar-width: thin; }
[data-roster] .rs-item { flex: 0 0 204px; display: flex; flex-direction: column; gap: 6px; scroll-snap-align: start; min-width: 0; }
[data-roster] .rs-acts { display: flex; gap: 6px; padding: 0 2px; }
[data-roster] .rs-act { flex: 1; display: inline-flex; align-items: center; justify-content: center; height: 26px; border-radius: 7px; border: 1px solid #e3e1dc; background: #fff; color: #333; font: inherit; font-size: 12px; font-weight: 500; text-decoration: none; cursor: pointer; white-space: nowrap; }
[data-roster] .rs-act:hover { border-color: #c9c6bf; background: #faf9f7; }
[data-roster] .rs-act.primary { background: #171717; border-color: #171717; color: #fff; }
[data-roster] .rs-card { width: 100%; min-width: 0; display: flex; gap: 10px; align-items: stretch; text-align: left; padding: 10px; border-radius: 12px; border: 1px solid #ecebe7; background: #fff; cursor: pointer; font-family: inherit; transition: border-color .15s, box-shadow .15s, transform .15s; }
[data-roster] .rs-card:hover { border-color: #d6d4ce; box-shadow: 0 2px 8px rgba(30,25,20,.06); }
[data-roster] .rs-card:active { transform: scale(.98); }
[data-roster] .rs-card[aria-pressed="true"] { border-color: #3a2f3d; box-shadow: 0 0 0 1px #3a2f3d inset; }
[data-roster] .rs-card:focus-visible { outline: 2px solid #3a2f3d; outline-offset: 2px; }
[data-roster] .rs-bar { height: 4px; border-radius: 2px; background: #ecebe7; overflow: hidden; position: relative; }
[data-roster] .rs-bar > i { position: absolute; inset: 0 auto 0 0; background: #1f8f6f; border-radius: 2px; }
[data-roster] .rs-bar.unknown > i { width: 34%; animation: rsSlide 1.6s ease-in-out infinite; }
@keyframes rsSlide { 0% { left: -34%; } 100% { left: 100%; } }
@media (prefers-reduced-motion: reduce) { [data-roster] .rs-bar.unknown > i { animation: none; left: 0; width: 100%; opacity: .35; } [data-roster] .rs-card { transition: none; } }
`;

/**
 * The cast along the bottom of the office: face, name, status, what each one
 * is on, and a thin bar while a job runs. A card picks that colleague in the
 * 指挥中心 on the right.
 */
/**
 * The same three things the list view offers (owner, 2 Oct: "let me assign,
 * chat or train them from the office too"): 派任务 picks them in 指挥中心,
 * 聊天 opens their own conversation, 训练 their training page (the assistant
 * has no training page: it uses the studio's shared instructions).
 */
export function RosterStrip({ members, zh, selected, onPick }: { members: OfficeMember[]; zh: boolean; selected: LookKey | null; onPick: (key: LookKey) => void }) {
  return (
    <div data-roster="" role="list" aria-label={zh ? "同事名单" : "The team"}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {members.map((m) => {
        const tone = STATUS_TONE[m.status];
        const tint = m.key === "host" ? "#e6e1fa" : AGENT_TINTS[m.key as AgentKey];
        const line = taskLine(m, zh);
        return (
          <div role="listitem" key={m.key} className="rs-item">
            <button type="button" className="rs-card" aria-pressed={selected === m.key} onClick={() => onPick(m.key)} title={line}>
              <Portrait who={m.key} tint={tint} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1, gap: 4, paddingTop: 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "#171717", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameOf(m.key, zh)}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color: tone.ink, background: tone.bg, borderRadius: 999, padding: "0 7px", lineHeight: "18px", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {m.status === "working" ? <span style={{ width: 5, height: 5, borderRadius: 3, background: tone.ink, animation: "auraPulse 1.4s ease-in-out infinite" }} /> : null}
                    {statusWord(m.status, zh)}
                  </span>
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: m.status === "idle" && !m.line ? "#b5b5b1" : "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{line}</span>
                <span style={{ flexGrow: 1 }} />
                {m.status === "working" ? (
                  <span
                    className={`rs-bar ${m.progress == null ? "unknown" : ""}`}
                    role="progressbar"
                    aria-label={zh ? "进度" : "Progress"}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={m.progress ?? undefined}
                  >
                    <i style={m.progress == null ? undefined : { width: `${Math.max(4, m.progress)}%` }} />
                  </span>
                ) : (
                  <span style={{ height: 4 }} />
                )}
              </span>
            </button>
            <span className="rs-acts">
              <button type="button" className="rs-act primary" onClick={() => onPick(m.key)}>{zh ? "派任务" : "Assign"}</button>
              <Link prefetch={false} className="rs-act" href={m.key === "host" ? "/chat" : `/chat?agent=${m.key}`}>{zh ? "聊天" : "Chat"}</Link>
              {m.key === "host" ? null : <Link prefetch={false} className="rs-act" href={`/train/${m.key}`}>{zh ? "训练" : "Train"}</Link>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
