"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocalPreference } from "@/lib/client/preference";
import { useResizable } from "@/components/ui/Resizer";
import { AddTopicButton } from "./AddTopicButton";

/**
 * The Market Research sidebar, shared by every screen in the module.
 *
 * All three artboards draw the same 212px column, so it is one component here
 * rather than three transcriptions drifting apart — which is exactly what had
 * happened: Trends listed the real sources while Compare and Backlog still
 * carried the artboard's demo list and its invented "27" and "9" badges.
 *
 * Metrics and classes are the artboards'; the `[data-trends-screen]` attribute
 * is what their scoped CSS keys off, and each screen already emits that CSS.
 */
export type SourceStatus = {
  key: string;
  name: string;
  kind: string;
  status: "live" | "degraded" | "unconfigured";
  note: string | null;
};

const SCREENS = [
  { href: "/research", label: "Trends dashboard", labelZh: "趋势面板" },
  { href: "/research/compare", label: "Search & compare", labelZh: "搜索与对比" },
  { href: "/research/performance", label: "Content performance", labelZh: "内容表现" },
  { href: "/research/inbox", label: "Comment inbox", labelZh: "评论收件箱" },
  { href: "/research/backlog", label: "Topic backlog", labelZh: "选题储备" },
];

export function ResearchSidebar({
  sources,
  decisionCount,
  backlogCount,
  inboxCount,
  locale,
}: {
  sources: SourceStatus[];
  decisionCount: number;
  /** Adopted topics waiting in the backlog. Absent means do not show a badge —
   * better than the artboard's invented number. */
  backlogCount?: number;
  /** Comments waiting to be dealt with. The artboard draws this as a red pill
   * (`.n i`) rather than the grey count the backlog gets, because an unread
   * comment is someone waiting for an answer. */
  inboxCount?: number;
  locale: string;
}) {
  const pathname = usePathname();
  const { width, handle } = useResizable("research-sidebar", { min: 170, max: 380, initial: 212, edge: "right" });
  // Folded by default, and the choice is remembered: somebody who wants the
  // list open every morning should not have to open it every morning.
  const [open, setOpen] = useLocalPreference("aura:research-sources", ["open", "shut"] as const, "shut");
  const live = sources.filter((s) => s.status === "live").length;
  const degraded = sources.filter((s) => s.status === "degraded").length;
  const zh = locale.startsWith("zh");

  return (
    <div
      data-trends-screen=""
      style={{
        width,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
      }}
    >
      {handle}
      <div style={{ padding: "4px 9px 12px", fontSize: 14, fontWeight: 500 }}>
        {zh ? "市场调研" : "Market Research"}
      </div>

      {/*
        * Adding a topic by hand, from any screen in the module.
        *
        * The client could not find where to do it — the only control was the
        * phrase field on the Trends dashboard, which reads as a search box and
        * files what it makes on the watchlist rather than in the backlog. This
        * sits above the screen list, in the one column every Research screen
        * draws, so the answer to "where do I add a topic" is the same wherever
        * you happen to be standing.
        */}
      <AddTopicButton
        zh={zh}
        className="btn s"
        style={{ width: "100%", justifyContent: "center", marginBottom: 14, background: "#fff" }}
      />

      <div className="lbl" style={{ marginBottom: 5 }}>
        {zh ? "页面" : "Screens"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {SCREENS.map((screen) => (
          <Link
            key={screen.href}
            href={screen.href}
            className={`n${pathname === screen.href ? " on" : ""}`}
            style={{ textDecoration: "none" }}
          >
            <span>{zh ? screen.labelZh : screen.label}</span>
            {screen.href === "/research/backlog" && backlogCount ? <b>{backlogCount}</b> : null}
            {screen.href === "/research/inbox" && inboxCount ? <i>{inboxCount}</i> : null}
          </Link>
        ))}
      </div>

      {/* The connected-sources fold and the ranking-weights footer used to
          sit here. "9/14 sources, 2 answering badly" and "0 decisions this
          month" are the plumbing's own diary; the client read them as the
          product being broken. The sources still show on the Trends board
          when one actually fails. */}
      {void sources}
      {void decisionCount}
      {void open}
      {void setOpen}
      {void live}
      {void degraded}
    </div>
  );
}
