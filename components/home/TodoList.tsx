"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { hideTodoAction } from "@/app/(app)/home/actions";
import type { TodoRow } from "@/lib/home/today";

/** 等你做的事, each with × 「不再提醒」: put away a task you don't want (it comes back when the video reaches its next step). */
export function TodoList({ rows, zh }: { rows: TodoRow[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [gone, setGone] = React.useState<string[]>([]);
  const shown = rows.filter((r) => !gone.includes(`${r.id}:${r.verb}`));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {shown.map((r, i) => {
        const k = `${r.id}:${r.verb}`;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", borderTop: i ? "1px solid #f0efeb" : 0 }}>
            <Link href={r.href} prefetch={false} className="ht-row" style={{ flexGrow: 1, minWidth: 0, borderTop: 0 }}>
              <span className="ht-dot" aria-hidden />
              <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: "#171717" }}>{r.verb}</span>
                <span style={{ fontSize: 13, color: "#7a7a7a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              <span style={{ ...smallButton(i === 0), height: 34, padding: "0 14px", fontSize: 13 }}>{r.press} →</span>
            </Link>
            <button
              type="button"
              title={t("不再提醒（这条视频到下一步时会再出现）", "Hide this (it comes back at the video's next step)")}
              aria-label={t("不再提醒", "Hide")}
              onClick={async () => {
                setGone((g) => [...g, k]);
                const res = await hideTodoAction(k);
                if (res.error) {
                  setGone((g) => g.filter((x) => x !== k));
                  return notify(res.error);
                }
                notify(t("已收起这条提醒", "Hidden"), "ok");
                router.refresh();
              }}
              style={{ flexShrink: 0, width: 32, height: 32, marginLeft: 6, border: 0, borderRadius: 8, background: "transparent", color: "#a3a3a3", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
