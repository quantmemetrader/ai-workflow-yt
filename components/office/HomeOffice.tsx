"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LookKey } from "@/components/office/art";
import { OfficeFloor } from "@/components/office/OfficeFloor";
import { RosterStrip } from "@/components/office/RosterStrip";
import { AutoRefresh } from "@/components/office/AutoRefresh";
import { STATUS_TONE, type OfficeMember } from "@/components/office/text";

/**
 * The office on 首页 (owner, 2 Oct: "can we have it in home page too"): the
 * same floor as AI 同事, the work going left to right, and the cards under
 * it. A desk opens AI 同事 with that colleague ready to be messaged.
 */
export function HomeOffice({ members, zh }: { members: OfficeMember[]; zh: boolean }) {
  const router = useRouter();
  const open = React.useCallback((key: LookKey) => router.push(`/team?pick=${key}`), [router]);
  const assign = React.useCallback((key: LookKey, text: string) => router.push(`/team?pick=${key}&say=${encodeURIComponent(text)}`), [router]);
  const working = members.filter((m) => m.status === "working").length;
  const waiting = members.filter((m) => m.status === "waiting").length;
  return (
    <section aria-label={zh ? "AI 同事" : "AI team"} style={{ borderRadius: 16, border: "1px solid #ecebe7", background: "#fff", padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <AutoRefresh every={20_000} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15.5, fontWeight: 650, color: "#171717" }}>{zh ? "AI 同事" : "AI team"}</span>
        <span style={{ fontSize: 12.5, color: "#8a8a8a" }}>{zh ? `${working} 位在忙 · ${waiting} 位等你` : `${working} busy · ${waiting} waiting on you`}</span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ display: "inline-flex", gap: 12 }} aria-hidden>
          {([
            ["working", zh ? "工作中" : "Working"],
            ["waiting", zh ? "等你" : "Waiting"],
            ["idle", zh ? "空闲" : "Free"],
          ] as const).map(([k, label]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#7c7c7c" }}>
              <span style={{ width: 8, height: 8, background: STATUS_TONE[k].bg, border: `2px solid ${STATUS_TONE[k].edge}`, borderRadius: 2 }} />
              {label}
            </span>
          ))}
        </span>
        <Link href="/team" prefetch={false} style={{ fontSize: 12.5, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
          {zh ? "进办公室 →" : "Open the office →"}
        </Link>
      </div>
      <OfficeFloor members={members} zh={zh} selected={null} onPick={() => {}} onAssign={assign} />
      <RosterStrip members={members} zh={zh} selected={null} onPick={open} />
    </section>
  );
}
