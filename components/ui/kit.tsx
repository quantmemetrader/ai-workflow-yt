"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/client/notify";
import { beginWork } from "@/lib/client/busy";

/**
 * The pieces every module screen was about to redefine.
 *
 * Publish and Admin each grew their own `field`, `ghost`, `solid`, `Badge` and
 * `Empty`, with the same values and slightly different spelling. Four more
 * modules would have been four more copies drifting apart, which is exactly
 * what happened to the Research sidebar before it was made one component.
 *
 * These are the artboards' own metrics. Anything a screen genuinely needs
 * differently, it spreads over.
 */

export const field: React.CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 11px",
  border: "1px solid #e2e2e2",
  borderRadius: 9,
  outline: "none",
  background: "#fff",
  fontSize: 12.5,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  color: "#171717",
};

export const ghost: React.CSSProperties = {
  height: 30,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

export const solid: React.CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 8,
  border: 0,
  background: "#171717",
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

export const chip: React.CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 8,
  border: "1px solid #ededed",
  background: "#fff",
  color: "#525252",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "inherit",
  cursor: "pointer",
};

export function Badge({
  tone = "quiet",
  children,
}: {
  tone?: "good" | "bad" | "warn" | "quiet" | "info";
  children: React.ReactNode;
}) {
  const palette = {
    good: { bg: "#e4faeb", fg: "#278f5e" },
    bad: { bg: "#ffe7e7", fg: "#e03636" },
    warn: { bg: "#fff3e2", fg: "#a35f00" },
    info: { bg: "#e7f2fd", fg: "#0060b0" },
    quiet: { bg: "#f3f3f3", fg: "#525252" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        padding: "0 7px",
        borderRadius: 10,
        background: palette.bg,
        color: palette.fg,
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{ maxWidth: 480, padding: "26px 0" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      {body && (
        <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.65, margin: "7px 0 0" }}>{body}</p>
      )}
    </div>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 500, color: "#999999", margin: "20px 0 8px", ...style }}>
      {children}
    </div>
  );
}

/** The header every module screen opens with. */
export function ModuleHeader({
  title,
  note,
  right,
  /** Dark chrome, for the video editor. See `Tabs`. */
  tone = "light",
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        background: dark ? "#131315" : undefined,
        color: dark ? "#e8e8e8" : undefined,
        borderBottom: `1px solid ${dark ? "#2a2a2e" : "#ededed"}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 22px",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
      {note && <span style={{ fontSize: 11.5, color: dark ? "#8a8a90" : "#999999" }}>{note}</span>}
      {right && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{right}</span>}
    </header>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  /**
   * Dark chrome, for the video editor.
   *
   * A prop rather than a stylesheet override because this component styles
   * itself inline, and a rule that has to win with `!important` is a rule that
   * will lose quietly the next time the inline styles change.
   */
  tone = "light",
}: {
  tabs: { key: T; label: string; badge?: number }[];
  active: T;
  onChange: (key: T) => void;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      style={{
        flexShrink: 0,
        minHeight: 42,
        background: dark ? "#131315" : undefined,
        borderBottom: `1px solid ${dark ? "#2a2a2e" : "#ededed"}`,
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "6px 18px",
        flexWrap: "wrap",
      }}
    >
      {tabs.map((x) => (
        <button
          key={x.key}
          type="button"
          onClick={() => onChange(x.key)}
          style={{
            height: 28,
            padding: "0 11px",
            borderRadius: 8,
            border: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: active === x.key ? (dark ? "#2c2c32" : "#f3f3f3") : "transparent",
            color: active === x.key ? (dark ? "#ffffff" : "#171717") : dark ? "#9a9aa2" : "#7c7c7c",
            fontWeight: active === x.key ? 500 : 400,
            fontSize: 12.5,
            fontFamily: "inherit",
            letterSpacing: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {x.label}
          {x.badge ? (
            <span style={{ fontSize: 10.5, color: dark ? "#7a7a82" : "#999999" }}>{x.badge}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * One place that runs an action, reports its failure and refreshes.
 *
 * Every module had grown its own copy of this, and two of them threw the
 * action's `{ error }` away — which is how the Research module ended up with a
 * "Check now" button that silently did nothing when it failed.
 */
export function useAction() {
  const router = useRouter();
  const [busy, start] = useTransition();

  const run = (
    fn: () => Promise<{ error?: string } | void>,
    after?: () => void,
    /** What to call this on the indicator. "Saving the entry", not "Loading". */
    label?: string,
  ) =>
    start(async () => {
      // The indicator in the corner, for the whole round trip. A local `busy`
      // only ever changed one button's label.
      const done = beginWork(label);
      try {
        const res = await fn();
        if (res && "error" in res && res.error) {
          notify(res.error);
          return;
        }
        after?.();
        router.refresh();
      } finally {
        done();
      }
    });

  return { busy, run };
}

/** Millionths of a unit, as money. */
export function money(micros: number, currency = "$"): string {
  const amount = micros / 1_000_000;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currency}${abs.toLocaleString(undefined, {
    minimumFractionDigits: abs < 1000 ? 2 : 0,
    maximumFractionDigits: abs < 1000 ? 2 : 0,
  })}`;
}

/**
 * Text that gives way when the column does.
 *
 * Dragging a panel narrower used to push a long name onto a second and third
 * line, so a row grew taller as the window grew smaller and a list of ten
 * files became a list of twenty-five lines. A name that does not fit is
 * truncated with the whole of it on hover: the row keeps its height, and
 * nothing is lost, only folded away.
 */
export const clip: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** A row of a simple table. */
export function Row({
  children,
  head = false,
  style,
}: {
  children: React.ReactNode;
  head?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: head ? "center" : "flex-start",
        gap: 12,
        padding: head ? "0 4px" : "10px 4px",
        minHeight: head ? 30 : 40,
        borderBottom: head ? "1px solid #ededed" : "1px solid #f3f3f3",
        fontSize: head ? 10.5 : 12,
        fontWeight: head ? 500 : 400,
        color: head ? "#999999" : "#171717",
        // A narrow panel truncates rather than reflowing: see `clip` above.
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A number typed in whole units, held as a string until it is submitted. */
export function useAmount(initial = "") {
  const [value, setValue] = useState(initial);
  const clean = (v: string) => setValue(v.replace(/[^\d.-]/g, ""));
  return { value, set: clean, number: Number(value), valid: value !== "" && Number.isFinite(Number(value)) };
}
