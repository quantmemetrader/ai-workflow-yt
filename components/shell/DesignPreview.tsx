import type { Module } from "@/lib/db/schema";
import { NAV_BY_MODULE } from "@/lib/nav";

/**
 * A module whose screens are approved but not yet wired to data.
 *
 * These used to be served straight from `public/app` by a rewrite, which meant
 * two things that should not be true of a work platform: anyone signed in
 * could open a module they are not entitled to just by typing its address
 * (ground rule 3 — the navigation shows only entitled modules, and no screen
 * may assume a peer module exists), and the demo content inside those pages
 * read as though it were the studio's own data.
 *
 * Now it is a real route behind `requireModule`, and it says plainly what it
 * is: the approved design, with nothing behind it yet.
 */
export function DesignPreview({ module, zh }: { module: Module; zh: boolean }) {
  const item = NAV_BY_MODULE.get(module);
  const title = zh ? (item?.labelZh ?? module) : (item?.label ?? module);

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 56,
          flexShrink: 0,
          borderBottom: "1px solid #ededed",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 22px",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 20,
            padding: "0 8px",
            borderRadius: 10,
            background: "#f3f3f3",
            color: "#7c7c7c",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {zh ? "设计稿" : "Design"}
        </span>
        <span style={{ fontSize: 11.5, color: "#999999" }}>
          {zh
            ? "已批准的设计，尚未接入真实数据。下面的内容是示例。"
            : "Approved design, not yet connected to data. Everything below is sample content."}
        </span>
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, background: "#f8f8f8", padding: 14 }}>
        <iframe
          src={`/demo/${module}`}
          title={`${title} — design`}
          style={{
            width: "100%",
            height: "100%",
            border: "1px solid #ededed",
            borderRadius: 10,
            background: "#fff",
          }}
        />
      </div>
    </div>
  );
}
