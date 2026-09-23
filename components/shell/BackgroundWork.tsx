"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  readCollecting,
  serverCollecting,
  subscribeCollecting,
  writeCollecting,
} from "@/lib/client/collecting";

/**
 * The toast that says what is still being collected, wherever you are.
 *
 * Adding a phrase to Search & compare queues a fetch across sources that
 * answer in their own time (GDELT allows one request every five seconds and
 * rate-limits an address that asks faster). That is minutes, not seconds, so
 * nobody should have to sit on the page and watch it. They did have to: the
 * "collecting" chip was the page's own state and the phrases were in the URL,
 * so leaving took both away.
 *
 * Mounted in the app layout, above every module. It polls the same cached
 * endpoint the Compare screen polls — and because asking is also what re-queues
 * anything missing, keeping this on screen keeps the collection moving.
 *
 * On Search & compare itself it draws nothing: that page shows the state in
 * full, in the chips, and owns the record while you are there.
 */
type SeriesState = { query: string; pending: boolean; points: unknown[]; error: string | null };

export function BackgroundWork({ locale }: { locale: string }) {
  const zh = locale.startsWith("zh");
  const pathname = usePathname();
  const job = useSyncExternalStore(subscribeCollecting, readCollecting, serverCollecting);
  const [state, setState] = useState<SeriesState[] | null>(null);
  const onCompare = pathname === "/research/compare";

  useEffect(() => {
    if (!job || onCompare) return;

    let live = true;
    const url = `/api/research/series?q=${encodeURIComponent(job.queries.join("|"))}&window=${job.window}`;

    async function tick() {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok || !live) return;
        const data = (await res.json()) as { series: SeriesState[] };
        if (!live) return;
        setState(data.series);
        // Nothing left to wait for: forget it, so the toast does not become
        // furniture.
        if (!data.series.some((s) => s.pending)) writeCollecting(null);
      } catch {
        // A dropped poll is not worth reporting; the next one runs.
      }
    }

    void tick();
    const id = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [job, onCompare]);

  if (!job || onCompare) return null;

  const total = job.queries.length;
  const done = state ? state.filter((s) => !s.pending).length : 0;
  // The provider's own words, if it said anything. This is the answer to "why
  // is it not collecting", and it used to be reachable only by hovering a chip.
  const problem = state?.find((s) => s.error)?.error ?? null;

  return (
    <Link
      href={`/research/compare?q=${encodeURIComponent(job.queries.join("|"))}&window=${job.window}`}
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 150,
        maxWidth: 340,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "11px 13px",
        borderRadius: 11,
        border: "1px solid #ededed",
        background: "rgba(255,255,255,0.98)",
        boxShadow: "0 8px 28px rgba(23,23,23,0.13)",
        color: "#171717",
        animation: "fadeUp .2s cubic-bezier(.32,.72,0,1) both",
      }}
    >
      <Spinner />
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, display: "block" }}>
          {zh ? "正在后台收集" : "Collecting in the background"}
        </span>
        <span style={{ fontSize: 12.5, color: "#999999", display: "block", marginTop: 2, lineHeight: 1.55 }}>
          {job.queries.join(zh ? "、" : ", ")}
          {" · "}
          {zh ? `${total} 个中已完成 ${done} 个` : `${done} of ${total} done`}
        </span>
        {problem && (
          <span style={{ fontSize: 12.5, color: "#a35f00", display: "block", marginTop: 4, lineHeight: 1.5 }}>
            {problem}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={zh ? "不再提示" : "Stop showing this"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          writeCollecting(null);
        }}
        style={{
          marginLeft: "auto",
          flexShrink: 0,
          width: 18,
          height: 18,
          padding: 0,
          border: 0,
          borderRadius: 5,
          background: "transparent",
          cursor: "pointer",
          color: "#c7c7c7",
          lineHeight: 0,
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.1, strokeLinecap: "round" }}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </Link>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, animation: "auraSpin 1s linear infinite" }}
    >
      <circle cx="12" cy="12" r="8.6" stroke="#ededed" strokeWidth="2.6" fill="none" />
      <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" stroke="#007be0" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
