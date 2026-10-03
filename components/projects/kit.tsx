import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * The building blocks every project page is drawn with, so the pages look
 * like one product: the client asked for "each component similar size",
 * one block per row, and a clear next press (28 Sep, the reference board).
 *
 *   PageBody   the scrolling page, centred, the same width on every tab
 *   Card       a white block: icon, title, one grey line under it, a slot on
 *              the right for a badge or a small button, the content, and an
 *              optional footer bar for the block's main press
 *   NextStep   the band at the top of a page that says what to do here now,
 *              with the one big button
 *   bigButton  the style of that button (and any main press), so it is the
 *              same size and colour everywhere
 *
 * Server-safe (no hooks); inline styles like the rest of components/projects.
 */

export const INK = "#171717";
export const MUTED = "#8a8a8a";
export const LINE = "#e7e6e2";
export const ACCENT = "#1f6feb";

export function PageBody({ children, width = 1440 }: { children: React.ReactNode; width?: number }) {
  return (
    <div data-page-scroll="" style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: width, padding: "18px 32px 64px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </div>
  );
}

export function Card({
  icon,
  title,
  sub,
  right,
  children,
  footer,
  id,
  tone = "plain",
  pad = true,
}: {
  icon?: IconName;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  id?: string;
  /** `accent` for the AI's block (a light blue wash), `warn` for something that needs a person. */
  tone?: "plain" | "accent" | "warn";
  /** False lets the content run edge to edge (a table, a player). */
  pad?: boolean;
}) {
  const bg = tone === "accent" ? "#f5f9ff" : tone === "warn" ? "#fffaf0" : "#ffffff";
  const border = tone === "accent" ? "#d6e4fb" : tone === "warn" ? "#f3dfb3" : LINE;
  return (
    <section id={id} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,.03)", scrollMarginTop: 12, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 18px 12px" }}>
        {icon ? (
          <span style={{ width: 28, height: 28, borderRadius: 8, background: tone === "accent" ? "#e3edfd" : "#f3f3f1", color: tone === "accent" ? ACCENT : "#404040", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={icon} size={15} />
          </span>
        ) : null}
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: INK, lineHeight: "28px" }}>{title}</h2>
          {sub ? <div style={{ fontSize: 12.5, color: MUTED, marginTop: 1, lineHeight: 1.5 }}>{sub}</div> : null}
        </div>
        {right ? <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>{right}</div> : null}
      </header>
      {children !== undefined && children !== null ? <div style={pad ? { padding: "0 18px 18px" } : { paddingBottom: 4 }}>{children}</div> : null}
      {footer ? <footer style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 18px", borderTop: `1px solid ${border}` }}>{footer}</footer> : null}
    </section>
  );
}

/** Two blocks side by side on a wide screen, one below the other on a narrow one. */
export function Pair({ children, ratio = "1fr 1fr" }: { children: React.ReactNode; ratio?: string }) {
  return (
    <div className="pj-pair" style={{ display: "grid", gridTemplateColumns: ratio, gap: 14, alignItems: "start" }}>
      <style>{`@media (max-width: 900px){.pj-pair{grid-template-columns:1fr !important}}`}</style>
      {children}
    </div>
  );
}

export function bigButton(kind: "primary" | "secondary" | "danger" = "primary", disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 40,
    padding: "0 18px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  if (kind === "primary") return { ...base, background: INK, color: "#fff", border: `1px solid ${INK}` };
  if (kind === "danger") return { ...base, background: "#fff", color: "#c42b2b", border: "1px solid #f0c7c7" };
  return { ...base, background: "#fff", color: INK, border: "1px solid #d6d5d0" };
}

export function smallButton(active = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    padding: "0 12px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: "pointer",
    background: active ? INK : "#fff",
    color: active ? "#fff" : "#333",
    border: `1px solid ${active ? INK : "#dcdbd6"}`,
    whiteSpace: "nowrap",
  };
}

/**
 * What to do on this page now: a pill (下一步 / 等你 / 已完成), one sentence,
 * and the page's main press on the right. At the top of every step page, so
 * nobody has to hunt for how to move on.
 */
export function NextStep({
  state,
  zh,
  text,
  children,
}: {
  state: "you" | "running" | "waiting" | "done";
  zh: boolean;
  text: React.ReactNode;
  /** The main press (a `bigButton`), or nothing when there is nothing to press. */
  children?: React.ReactNode;
}) {
  const tone =
    state === "done"
      ? { bg: "#eef8f2", line: "#cbe9d8", ink: "#1e7a4f", label: zh ? "已完成" : "Done" }
      : state === "you"
        ? { bg: "#fff6e5", line: "#f4ddb0", ink: "#95590a", label: zh ? "现在做这一步" : "Do this now" }
        : state === "running"
          ? { bg: "#eef4fe", line: "#cfe0fb", ink: "#1f5fbf", label: zh ? "AI 正在做" : "AI at work" }
          : { bg: "#f5f5f3", line: "#e6e6e3", ink: "#5f5f5f", label: zh ? "等上一步" : "Waiting" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 18px", borderRadius: 14, background: tone.bg, border: `1px solid ${tone.line}` }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, background: "#fff", color: tone.ink, fontSize: 12, fontWeight: 600, border: `1px solid ${tone.line}`, flexShrink: 0 }}>
        {state === "done" ? <Icon name="check" size={12} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: tone.ink }} />}
        {tone.label}
      </span>
      <div style={{ flexGrow: 1, minWidth: 200, fontSize: 14, color: "#2b2b2b", lineHeight: 1.55 }}>{text}</div>
      {children ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div> : null}
    </div>
  );
}

/** A link styled as the big button, for moving to another tab. */
export function GoButton({ href, children, kind = "primary" }: { href: string; children: React.ReactNode; kind?: "primary" | "secondary" }) {
  return (
    <Link href={href} prefetch={false} style={bigButton(kind)}>
      {children}
    </Link>
  );
}

export function Empty({ icon = "folder", text, children }: { icon?: IconName; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "28px 12px", color: MUTED, fontSize: 13, textAlign: "center", border: `1px dashed ${LINE}`, borderRadius: 12 }}>
      <Icon name={icon} size={22} />
      <div>{text}</div>
      {children}
    </div>
  );
}

/** One label / value line, like the reference board's 本片資訊 block. */
export function Fact({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: `1px solid #f0efeb`, fontSize: 13 }}>
      <span style={{ color: MUTED, width: 96, flexShrink: 0 }}>{label}</span>
      <span style={{ color: INK, minWidth: 0, flexGrow: 1, textAlign: "right", overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}
