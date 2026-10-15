"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { railActive, type RailItem } from "@/lib/nav";
import { TR_EN } from "@/components/ui/Tr";
import { LangToggle } from "@/components/shell/ThemeToggle";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import type { RailAccountInfo } from "@/components/shell/RailAccount";

/**
 * The phone's navigation, from the approved phone artboards (design/canvas/phone-shell.mjs, "the Database phone
 * view the user likes"): a floating dock at the foot of the screen — a grey pill of the person's first rail entries,
 * the one you are on grown into a white pill with its name — and a black round button beside it that opens
 * everything else as a sheet. It follows the person's own rail order and pins (15 Oct sidebar editor), so the
 * phone and the desktop agree. Only drawn below 760px; the desktop rail is untouched.
 */
export function PhoneDock({
  main,
  more,
  back,
  pathname,
  zh,
  account,
}: {
  main: RailItem[];
  more: RailItem[];
  back: RailItem[];
  pathname: string;
  zh: boolean;
  account?: RailAccountInfo;
}) {
  /* The browser only (a portal into <body>); open belongs to the page it was opened on, so moving page closes it. */
  const mounted = React.useSyncExternalStore(noop, () => true, () => false);
  const [openOn, setOpenOn] = React.useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (v: boolean | ((was: boolean) => boolean)) => setOpenOn((typeof v === "function" ? v(open) : v) ? pathname : null);
  React.useEffect(() => {
    if (!open) return;
    const off = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", off);
    document.documentElement.dataset.launcher = "";
    return () => {
      window.removeEventListener("keydown", off);
      delete document.documentElement.dataset.launcher;
    };
  }, [open]);
  if (!mounted) return null;

  const label = (i: RailItem) => (zh ? i.labelZh : (TR_EN[i.labelZh] ?? i.label));
  const all = [...main, ...more, ...back];
  const current = all.find((i) => railActive(i, pathname));
  /* Four in the pill; the page you are on always among them (the artboard's "a business module you are in sits at the end"). */
  let dock = main.slice(0, 4);
  if (current && !dock.includes(current)) dock = [...main.slice(0, 3), current];
  const rest = (list: RailItem[]) => list.filter((i) => !dock.includes(i));
  const groups: [string, RailItem[]][] = [
    [zh ? "常用" : "Main", rest(main)],
    [zh ? "更多" : "More", rest(more)],
    [zh ? "后台" : "Back office", rest(back)],
  ];
  const restActive = current ? !dock.includes(current) : false;
  const who = account ? (zh && account.nameLocal ? account.nameLocal : account.name) : "";

  return createPortal(
    <>
      <style>{CSS}</style>
      <nav className="pd" aria-label={zh ? "主导航" : "Main navigation"}>
        <div className="pd-bar">
          {dock.map((i) => {
            const on = railActive(i, pathname);
            return (
              <Link key={i.href} href={i.href} prefetch={false} className={`pd-i${on ? " on" : ""}`} aria-current={on ? "page" : undefined} aria-label={label(i)}>
                <svg viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: i.icon }} />
                <span>{label(i)}</span>
              </Link>
            );
          })}
        </div>
        <button type="button" className={`pd-more${open ? " on" : ""}${restActive ? " dot" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={zh ? "全部功能" : "Everything"}>
          {open ? (
            <svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden><rect x="4" y="4" width="7" height="7" rx="2.2" fill="currentColor" /><rect x="13" y="4" width="7" height="7" rx="2.2" fill="currentColor" /><rect x="4" y="13" width="7" height="7" rx="2.2" fill="currentColor" /><rect x="13" y="13" width="7" height="7" rx="2.2" fill="currentColor" /></svg>
          )}
        </button>
      </nav>
      {open ? (
        <>
          <div className="pd-veil" onClick={() => setOpen(false)} />
          <div className="pd-sheet" role="dialog" aria-label={zh ? "全部功能" : "Everything"}>
            <div className="pd-grip" aria-hidden />
            {account ? (
              <div className="pd-me">
                <Link href="/settings" prefetch={false} className="pd-me-l" onClick={() => setOpen(false)}>
                  <PersonAvatar id={account.id} url={account.avatarUrl ?? null} name={who} size={40} />
                  <span style={{ minWidth: 0 }}>
                    <b>{who}</b>
                    <i>{zh ? "设置和个人资料" : "Settings and profile"}</i>
                  </span>
                </Link>
                <span className="pd-lang">
                  <LangToggle zh={zh} wide />
                </span>
              </div>
            ) : null}
            {groups.map(([title, items]) =>
              items.length ? (
                <section key={title}>
                  <h3>{title}</h3>
                  <div className="pd-grid">
                    {items.map((i) => {
                      const on = railActive(i, pathname);
                      return (
                        <Link key={i.href} href={i.href} prefetch={false} className={`pd-tile${on ? " on" : ""}`} onClick={() => setOpen(false)}>
                          <span className="pd-ic">
                            <svg viewBox="0 0 24 24" aria-hidden dangerouslySetInnerHTML={{ __html: i.icon }} />
                          </span>
                          <span className="pd-nm">{label(i)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ) : null,
            )}
          </div>
        </>
      ) : null}
    </>,
    document.body,
  );
}

const noop = () => () => {};

const CSS = `
.pd, .pd-veil, .pd-sheet { display: none; }
@media (max-width: 760px) {
  .pd { display: flex; position: fixed; left: 12px; right: 12px; bottom: calc(10px + env(safe-area-inset-bottom)); z-index: 1003; gap: 8px; align-items: center; pointer-events: none; }
  .pd > * { pointer-events: auto; }
  html[data-m="agent"] .pd, html[data-kb] .pd { display: none; }
  .pd-bar { flex: 1 1 0; min-width: 0; height: 56px; border-radius: 28px; background: rgba(243,243,243,.94); -webkit-backdrop-filter: saturate(1.6) blur(14px); backdrop-filter: saturate(1.6) blur(14px); display: flex; align-items: center; gap: 2px; padding: 4px; box-shadow: 0 6px 24px -10px rgba(23,23,23,.28), inset 0 0 0 1px rgba(0,0,0,.04); }
  .pd-i { flex: 1 1 0; min-width: 0; height: 48px; border-radius: 24px; display: flex; align-items: center; justify-content: center; gap: 7px; color: #8a8a8a; -webkit-tap-highlight-color: transparent; transition: background .18s ease, color .18s ease; }
  .pd-i svg { width: 21px; height: 21px; fill: currentColor; flex-shrink: 0; }
  .pd-i span { display: none; font-size: 13.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pd-i.on { flex: 0 1 auto; padding: 0 16px 0 14px; background: #fff; color: #171717; box-shadow: 0 1px 3px rgba(23,23,23,.12); }
  .pd-i.on span { display: block; }
  .pd-i:active { transform: scale(.96); }
  .pd-more { width: 56px; height: 56px; border-radius: 28px; border: 0; background: #171717; color: #fff; flex-shrink: 0; display: flex; align-items: center; justify-content: center; position: relative; box-shadow: 0 6px 18px -4px rgba(23,23,23,.4); -webkit-tap-highlight-color: transparent; cursor: pointer; }
  .pd-more svg { width: 22px; height: 22px; }
  .pd-more.dot::after { content: ""; position: absolute; top: 13px; right: 13px; width: 8px; height: 8px; border-radius: 4px; background: #fff; box-shadow: 0 0 0 2px #171717; }
  .pd-more:active { transform: scale(.95); }
  .pd-veil { display: block; position: fixed; inset: 0; z-index: 1001; background: rgba(17,17,17,.3); animation: pd-fade .18s ease-out; }
  .pd-sheet { display: block; position: fixed; left: 0; right: 0; bottom: 0; z-index: 1002; max-height: 82dvh; overflow-y: auto; overscroll-behavior: contain; background: #fff; border-radius: 22px 22px 0 0; padding: 8px 16px calc(92px + env(safe-area-inset-bottom)); box-shadow: 0 -12px 40px rgba(23,23,23,.16); animation: pd-up .24s cubic-bezier(.2,.8,.2,1); }
  .pd-grip { width: 38px; height: 5px; border-radius: 3px; background: #e2e2e2; margin: 2px auto 12px; }
  .pd-me { display: flex; align-items: center; gap: 10px; padding: 4px 2px 12px; border-bottom: 1px solid #f1f1f1; }
  .pd-me-l { flex: 1; min-width: 0; display: flex; align-items: center; gap: 11px; color: #171717; }
  .pd-me-l b { display: block; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pd-me-l i { display: block; font-style: normal; font-size: 12.5px; color: #999; margin-top: 2px; }
  .pd-lang { flex-shrink: 0; }
  .pd-lang > * { height: 34px; border-radius: 17px; background: #f3f3f3; padding: 0 12px; }
  .pd-sheet h3 { margin: 16px 2px 8px; font-size: 12px; font-weight: 600; color: #999; letter-spacing: .04em; }
  .pd-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 4px; }
  .pd-tile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 2px; border-radius: 14px; color: #262626; min-width: 0; -webkit-tap-highlight-color: transparent; }
  .pd-tile:active { background: #f5f5f5; }
  .pd-ic { width: 48px; height: 48px; border-radius: 15px; background: #f3f3f3; color: #383838; display: flex; align-items: center; justify-content: center; }
  .pd-ic svg { width: 22px; height: 22px; fill: currentColor; }
  .pd-tile.on .pd-ic { background: #171717; color: #fff; }
  .pd-nm { font-size: 12px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes pd-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pd-up { from { transform: translateY(100%); } to { transform: none; } }
}
`;
