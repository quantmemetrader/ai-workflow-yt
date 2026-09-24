"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryButton } from "@/components/shell/HistoryButton";
import { BrandMark } from "@/components/brand/BrandMark";
import { useLocalPreference } from "@/lib/client/preference";
import { useResizable } from "@/components/ui/Resizer";
import { NAV } from "@/lib/nav";
import type { Module } from "@/lib/db/schema";

/**
 * The module rail.
 *
 * It began as the artboards' 52px column of icons and nothing else, and the
 * client's answer to that was plain: *"the left hand side, better to have the
 * words next to the icons"*. An icon is a reminder of a name you already know;
 * it is not a way to learn one. So the rail is now a named list, open by
 * default, and 腾亚 is written next to its mark at the top rather than being a
 * tile you hover to identify.
 *
 * Collapsing back to the icons is kept, because somebody who has learned the
 * eleven modules would rather have the 130px, and the width is draggable in
 * between like every other column here. Both are remembered in this browser.
 * The hover tooltip only exists while it is collapsed — a label beside a label
 * is noise.
 */
const WIDTH_KEY = "rail";
const RAIL_MIN = 148;
const RAIL_MAX = 268;
const RAIL_DEFAULT = 186;
const COLLAPSED = 52;

export function Rail({ modules, locale }: { modules: Module[]; locale: string }) {
  const pathname = usePathname();
  const zh = locale.startsWith("zh");
  const [state, setState] = useLocalPreference("aura:rail", ["open", "icons"] as const, "open");
  const open = state === "open";
  const { width, handle } = useResizable(WIDTH_KEY, {
    min: RAIL_MIN,
    max: RAIL_MAX,
    initial: RAIL_DEFAULT,
    edge: "right",
  });

  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = useRef(0);

  const items = NAV.filter((n) => modules.includes(n.module));

  // A tooltip due after the rail has gone would set state on nothing.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // The clock is read inside the timer callback rather than in the handler
  // body: these run on pointer events, never during render, and reading it
  // here keeps that obvious to both a reader and the compiler's lint rule.
  const show = useCallback((e: React.MouseEvent<HTMLElement>, text: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    if (timer.current) clearTimeout(timer.current);

    // Instant when the pointer is already travelling down the rail; a beat's
    // delay on first hover so the tooltip never flickers past.
    timer.current = setTimeout(
      () => setTip({ text, top }),
      performance.now() - warm.current < 400 ? 0 : 350,
    );
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    warm.current = performance.now();
    setTip(null);
  }, []);

  return (
    <nav
      aria-label={zh ? "模块" : "Modules"}
      style={{
        width: open ? width : COLLAPSED,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        alignItems: open ? "stretch" : "center",
        padding: open ? "10px 8px" : "10px 0",
        gap: 3,
        minHeight: 0,
      }}
    >
      {/* Only while it is open: there is nothing to drag a 52px strip to. */}
      {open ? handle : null}

      <Link
        href="/chat"
        aria-label="腾亚创变"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginBottom: 10,
          padding: open ? "0 5px" : 0,
          color: "#171717",
          minWidth: 0,
        }}
      >
        <BrandMark size={28} />
        {open && (
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            腾亚创变
          </span>
        )}
      </Link>

      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const label = zh ? item.labelZh : item.label;
        return (
          <span key={`${item.module}${item.secondary ? ":2" : ""}`} style={{ display: "contents" }}>
            <Link
              href={item.href}
              className={`r${active ? " on" : ""}${open ? " wide" : ""}`}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onMouseEnter={open ? undefined : (e: React.MouseEvent<HTMLElement>) => show(e, label)}
              onMouseLeave={open ? undefined : hide}
              onClick={hide}
            >
              <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
              {open && <span>{label}</span>}
            </Link>
            {item.dividerAfter && (
              <div
                style={{
                  height: 1,
                  background: "#e2e2e2",
                  margin: open ? "6px 9px" : "6px 0",
                  width: open ? "auto" : 22,
                }}
              />
            )}
          </span>
        );
      })}

      <div style={{ flexGrow: 1 }} />

      {/* Your own history with the assistant, from any screen. */}
      <HistoryButton locale={locale} wide={open} />

      <button
        type="button"
        onClick={() => setState(open ? "icons" : "open")}
        title={open ? (zh ? "收起侧栏" : "Collapse") : zh ? "展开侧栏" : "Expand"}
        aria-label={open ? (zh ? "收起侧栏" : "Collapse sidebar") : zh ? "展开侧栏" : "Expand sidebar"}
        aria-expanded={open}
        className={`r${open ? " wide" : ""}`}
        style={{ border: 0, background: "transparent", cursor: "pointer", font: "inherit" }}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path
            d={open ? "M14.6 6.6 9.2 12l5.4 5.4" : "M9.4 6.6 14.8 12l-5.4 5.4"}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {open && <span>{zh ? "收起" : "Collapse"}</span>}
      </button>

      {/* The signed-in person used to be a bare avatar at the foot of this
        * column, which said who you were and never what you were. Both now
        * live in the top bar (components/shell/TopBar.tsx), named and with the
        * role beside them; two avatars on one screen was one too many. */}

      {tip && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: 58,
            top: tip.top,
            transform: "translateY(-50%)",
            zIndex: 50,
            display: "flex",
            gap: 6,
            borderRadius: 6,
            padding: "4px 8px",
            background: "#171717",
            color: "#fff",
            font: "500 12px/16px Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif",
            boxShadow: "0 2px 6px rgba(0,0,0,.14)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {tip.text}
        </span>
      )}
    </nav>
  );
}
