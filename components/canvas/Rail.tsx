"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { HistoryButton } from "@/components/shell/HistoryButton";
import { RailAccount, type RailAccountInfo } from "@/components/shell/RailAccount";
import { BrandMark } from "@/components/brand/BrandMark";
import { useLocalPreference } from "@/lib/client/preference";
import { useResizable } from "@/components/ui/Resizer";
import { NAV } from "@/lib/nav";
import { Suspense } from "react";
import { ProjectTree, type TreeProject } from "@/components/projects/ProjectTree";
import type { Module } from "@/lib/db/schema";
import { Tr, TR_EN } from "@/components/ui/Tr";

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

export function Rail({ modules, locale, projects = [], account }: { modules: Module[]; locale: string; projects?: TreeProject[]; account?: RailAccountInfo }) {
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

  const [tip, setTip] = useState<{ text: string; en: string; top: number } | null>(null);
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
  const show = useCallback((e: React.MouseEvent<HTMLElement>, text: string, en: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    if (timer.current) clearTimeout(timer.current);

    // Instant when the pointer is already travelling down the rail; a beat's
    // delay on first hover so the tooltip never flickers past.
    timer.current = setTimeout(
      () => setTip({ text, en, top }),
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
        href="/home"
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
        /* The name as it shows: in Chinese, translate-proof — the short
           English from `TR_EN` is what a page translated by Chrome shows,
           instead of its "front page" for 首页. */
        const en = TR_EN[item.labelZh] ?? item.label;
        const shown = zh ? <Tr zh={item.labelZh} en={en} /> : label;
        return (
          <span key={`${item.module}${item.secondary ? ":2" : ""}`} style={{ display: "contents" }}>
            <Link
              href={item.href}
              /* No prefetch: every refresh on a working page re-prefetched all
                 eleven modules, forty requests a minute for nothing. */
              prefetch={false}
              className={`r${active ? " on" : ""}${open ? " wide" : ""}`}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onMouseEnter={open ? undefined : (e: React.MouseEvent<HTMLElement>) => show(e, label, en)}
              onMouseLeave={open ? undefined : hide}
              onClick={hide}
            >
              <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.icon }} />
              {open && <span>{shown}</span>}
              <RailSpinner wide={open} />
            </Link>
            {/* Right under Home: the projects, as a tree. */}
            {item.href === "/home" ? (
              <Suspense fallback={null}>
                <ProjectTree projects={projects} zh={zh} wide={open} />
              </Suspense>
            ) : null}
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
        /* The family only: a whole `font: inherit` also brought in the
           page's 16px and made 收起 the largest word in the rail. */
        style={{ border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit" }}
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
        {open && (
          <span>
            <Tr zh="收起" en="Collapse" inZh={zh} />
          </span>
        )}
      </button>

      {/* The signed-in person, at the foot as well as in the top bar: the
        * owner asked for it here, beside 历史记录 and 收起. Named and with the
        * role (the old bare avatar said who you were, never what you were). */}
      {account ? <RailAccount account={account} zh={zh} wide={open} /> : null}

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
          {zh ? <Tr zh={tip.text} en={tip.en} /> : tip.text}
        </span>
      )}
    </nav>
  );
}

/**
 * The click answered at once. A page whose scripts are not cached yet can take
 * a moment to arrive from the server, and a rail entry that does nothing for
 * that moment reads as broken. Same spinner the chat sidebar uses.
 */
function RailSpinner({ wide }: { wide: boolean }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="spin" aria-hidden style={wide ? { marginLeft: "auto" } : { position: "absolute", right: 4, top: 4, width: 8, height: 8 }} />;
}
