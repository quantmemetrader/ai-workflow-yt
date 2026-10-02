"use client";

import * as React from "react";
import Link from "next/link";
import type { LookKey } from "@/components/office/art";
import { nameOf } from "@/components/office/text";
import { OfficeFloor } from "@/components/office/OfficeFloor";
import { RosterStrip } from "@/components/office/RosterStrip";
import { CommandPanel, type CommandPanelHandle } from "@/components/office/CommandPanel";
import { AutoRefresh } from "@/components/office/AutoRefresh";
import { STATUS_TONE, type OfficeMember } from "@/components/office/text";

/**
 * AI 同事 as an office (owner, 2 Oct): the floor with everyone at a desk, the
 * roster along the bottom, and 指挥中心 on the right to message any of them.
 * Picking someone on the floor or on a card puts them in the composer.
 */
export function OfficeView({ members, zh, model, header, initialPick = null }: { members: OfficeMember[]; zh: boolean; model: string; header: React.ReactNode; initialPick?: LookKey | null }) {
  const panel = React.useRef<CommandPanelHandle | null>(null);
  const [selected, setSelected] = React.useState<LookKey | null>(null);
  const [speaking, setSpeaking] = React.useState<LookKey | null>(null);
  const pick = React.useCallback((key: LookKey) => {
    setSelected(key);
    panel.current?.pick(key);
  }, []);
  /* Arrived from a desk on 首页 (?pick=…): that colleague is already in the composer. */
  React.useEffect(() => {
    if (!initialPick) return;
    const id = window.setTimeout(() => pick(initialPick), 300);
    return () => window.clearTimeout(id);
  }, [initialPick, pick]);

  /* The one answering in the panel is at work, whatever the last refresh said. */
  const shown = React.useMemo(
    () => members.map((m) => (m.key === speaking && m.status !== "working" ? { ...m, status: "working" as const, task: zh ? "正在回你的消息" : "Answering you", progress: null } : m)),
    [members, speaking, zh],
  );
  const working = shown.filter((m) => m.status === "working").length;
  const waiting = shown.filter((m) => m.status === "waiting").length;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", background: "#f6f5f2" }}>
      <AutoRefresh />
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
          {header}
          <section aria-label={zh ? "办公室" : "Office"} style={{ borderRadius: 14, border: "1px solid #ecebe7", background: "#fff", padding: "12px 14px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#171717" }}>{zh ? "办公室" : "Office"}</span>
              <span style={{ fontSize: 12.5, color: "#8a8a8a" }}>
                {zh ? `${working} 位在忙 · ${waiting} 位等你` : `${working} busy · ${waiting} waiting on you`}
              </span>
              <span style={{ flexGrow: 1 }} />
              {selected ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#525252" }}>
                  <span style={{ fontWeight: 600, color: "#171717" }}>{nameOf(selected, zh)}</span>
                  <span style={{ color: "#8a8a8a" }}>{zh ? "已选，在右边交代" : "picked; tell them on the right"}</span>
                  <Link prefetch={false} href={selected === "host" ? "/chat" : `/chat?agent=${selected}`} style={{ color: "#1f5fbf", textDecoration: "none" }}>{zh ? "聊天" : "Chat"}</Link>
                  {selected === "host" ? null : <Link prefetch={false} href={`/train/${selected}`} style={{ color: "#1f5fbf", textDecoration: "none" }}>{zh ? "训练" : "Train"}</Link>}
                </span>
              ) : null}
              <Legend zh={zh} />
            </div>
            <OfficeFloor members={shown} zh={zh} selected={selected} onPick={pick} />
          </section>
          <RosterStrip members={shown} zh={zh} selected={selected} onPick={pick} />
        </div>
      </div>
      <CommandPanel ref={panel} zh={zh} model={model} onSpeaking={setSpeaking} />
    </div>
  );
}

function Legend({ zh }: { zh: boolean }) {
  const items: [keyof typeof STATUS_TONE, string][] = [
    ["working", zh ? "工作中" : "Working"],
    ["waiting", zh ? "等你" : "Waiting on you"],
    ["idle", zh ? "空闲" : "Free"],
  ];
  return (
    <span style={{ display: "inline-flex", gap: 12 }} aria-hidden>
      {items.map(([k, label]) => (
        <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#7c7c7c" }}>
          <span style={{ width: 8, height: 8, background: STATUS_TONE[k].bg, border: `2px solid ${STATUS_TONE[k].edge}`, borderRadius: 2 }} />
          {label}
        </span>
      ))}
    </span>
  );
}
