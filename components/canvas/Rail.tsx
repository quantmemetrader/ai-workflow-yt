"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryButton } from "@/components/shell/HistoryButton";
import { BrandMark } from "@/components/brand/BrandMark";
import { NAV } from "@/lib/nav";
import type { Module } from "@/lib/db/schema";

/**
 * The module rail, transcribed from the artboards (every screen in
 * design/canvas opens with this same 52px column). Markup, sizes and colours
 * are the artboard's; what changes is that the list is the modules this person
 * actually holds, and the tiles are links.
 *
 * Keep in step with design/canvas/shell.mjs `rail()`.
 */
export function Rail({ modules, locale }: { modules: Module[]; locale: string }) {
  const pathname = usePathname();
  const zh = locale.startsWith("zh");
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
        width: 52,
        flexShrink: 0,
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 3,
      }}
    >
      <Link href="/chat" aria-label="腾亚创变" style={{ display: "flex", marginBottom: 10 }}>
        <BrandMark size={28} />
      </Link>

      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        // Every module is an app route now — the design-only ones render
        // their approved screen behind the same entitlement check — so they
        // all navigate the same way.
        const Tile = Link;
        return (
          <span key={item.module} style={{ display: "contents" }}>
            <Tile
              href={item.href}
              className={`r${active ? " on" : ""}`}
              aria-label={zh ? item.labelZh : item.label}
              aria-current={active ? "page" : undefined}
              onMouseEnter={(e: React.MouseEvent<HTMLElement>) => show(e, zh ? item.labelZh : item.label)}
              onMouseLeave={hide}
              onClick={hide}
            >
              <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
            </Tile>
            {item.dividerAfter && (
              <div style={{ width: 22, height: 1, background: "#e2e2e2", margin: "6px 0" }} />
            )}
          </span>
        );
      })}

      <div style={{ flexGrow: 1 }} />

      {/* Your own history with the assistant, from any screen. */}
      <HistoryButton locale={locale} />

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
            font: "500 12px/16px Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif",
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
