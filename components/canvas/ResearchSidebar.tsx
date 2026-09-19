"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const zh = locale.startsWith("zh");

  return (
    <div
      data-trends-screen=""
      style={{
        width: 212,
        flexShrink: 0,
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
      }}
    >
      <div style={{ padding: "4px 9px 12px", fontSize: 14, fontWeight: 500 }}>
        {zh ? "市场调研" : "Market Research"}
      </div>

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

      <div className="lbl" style={{ margin: "18px 0 5px" }}>
        {zh ? "已连接的来源" : "Connected sources"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {/* These used to link to /research/sources, a screen that does not
            exist — every one of them was a 404. A source is a status line, not
            a destination, so it is a row with its state on it. */}
        {sources.map((s) => (
          <div
            className="n"
            key={s.key}
            style={s.status === "live" ? {} : { color: "#999999" }}
            title={
              s.note ??
              (s.status === "live"
                ? zh
                  ? "已连接"
                  : "Connected"
                : s.status === "degraded"
                  ? zh
                    ? "连接不稳定"
                    : "Degraded"
                  : zh
                    ? "尚未配置"
                    : "Not configured yet")
            }
          >
            <span>{s.name}</span>
            <span
              style={{
                marginLeft: "auto",
                width: 6,
                height: 6,
                borderRadius: 3,
                background: s.status === "live" ? "#278f5e" : s.status === "degraded" ? "#db7706" : "#c7c7c7",
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto", padding: "11px 9px 4px", borderTop: "1px solid #ededed" }}>
        <div className="lbl" style={{ padding: 0, marginBottom: 5 }}>
          {zh ? "排序权重" : "Ranking weights"}
        </div>
        <div className="mut" style={{ lineHeight: 1.5 }}>
          {zh
            ? `采纳与拒绝会反馈到排序。本月 ${decisionCount} 次决定。`
            : `Adopt and reject feed back into ranking. ${decisionCount} decisions this month.`}
        </div>
      </div>
    </div>
  );
}
