import Link from "next/link";

/** 办公室 / 列表: the team page's two looks, as links so each has its own address. */
export function ViewToggle({ view, zh }: { view: "office" | "list"; zh: boolean }) {
  const item = (on: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    padding: "0 11px",
    borderRadius: 7,
    fontSize: 12.5,
    fontWeight: on ? 600 : 500,
    color: on ? "#171717" : "#7c7c7c",
    background: on ? "#fff" : "transparent",
    boxShadow: on ? "0 1px 2px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.04)" : "none",
    textDecoration: "none",
  });
  const icon: React.CSSProperties = { width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <nav aria-label={zh ? "切换视图" : "Switch view"} style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "#efeee9", flexShrink: 0 }}>
      <Link prefetch={false} href="/team" aria-current={view === "office" ? "page" : undefined} style={item(view === "office")}>
        <svg viewBox="0 0 24 24" style={icon} aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 13h3v3H8zM14 13h3v3h-3z" />
        </svg>
        {zh ? "办公室" : "Office"}
      </Link>
      <Link prefetch={false} href="/team?view=list" aria-current={view === "list" ? "page" : undefined} style={item(view === "list")}>
        <svg viewBox="0 0 24 24" style={icon} aria-hidden>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
        </svg>
        {zh ? "列表" : "List"}
      </Link>
    </nav>
  );
}
