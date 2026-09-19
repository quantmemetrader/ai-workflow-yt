"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
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
export function Rail({
  modules,
  locale,
  avatarUrl,
  name,
}: {
  modules: Module[];
  locale: string;
  avatarUrl: string | null;
  name: string;
}) {
  const pathname = usePathname();
  const zh = locale.startsWith("zh");
  const [tip, setTip] = useState<{ text: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = useRef(0);

  const items = NAV.filter((n) => modules.includes(n.module));

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
      <Link
        href="/chat"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "#171717",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        AF
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

      <Link href="/settings" aria-label={name} onMouseEnter={(e) => show(e, name)} onMouseLeave={hide}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="av"
            src={avatarUrl}
            alt=""
            style={{ width: 26, height: 26, borderRadius: 13, objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: "#e2e2e2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 600,
              color: "#525252",
            }}
          >
            {initials(name)}
          </div>
        )}
      </Link>

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
            font: "500 12px/16px Inter, system-ui, sans-serif",
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
