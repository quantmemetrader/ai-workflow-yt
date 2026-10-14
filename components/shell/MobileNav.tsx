"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * The phone (15 Oct: "目前手机端不支持"). On a narrow screen the module rail, a page's own list column and its
 * AI panel would sit side by side and leave the page a strip in the middle. Here they become a slide-out menu
 * (☰), a slide-out list (列表) and a full-screen panel (AI), each opened from the top bar and closed by tapping
 * outside, the ×, or moving to another page. Desktop is untouched: the buttons and the rules only exist below
 * 760px.
 */
type Mode = "" | "rail" | "list" | "agent";

function setMode(m: Mode) {
  document.documentElement.dataset.m = m;
}

export function MobileNav({ zh }: { zh: boolean }) {
  const pathname = usePathname();
  const [has, setHas] = React.useState({ list: false, agent: false });
  const [mode, setLocal] = React.useState<Mode>("");
  const go = (m: Mode) => {
    const next = mode === m ? "" : m;
    setMode(next);
    setLocal(next);
  };
  React.useEffect(() => {
    setMode("");
    setLocal("");
    const look = () => setHas({ list: Boolean(document.querySelector("[data-ws-sidebar], [data-trends-screen]")), agent: Boolean(document.querySelector("[data-agent-panel]")) });
    look();
    const t1 = window.setTimeout(look, 400);
    const t2 = window.setTimeout(look, 1500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname]);
  React.useEffect(() => {
    const off = (e: KeyboardEvent) => e.key === "Escape" && (setMode(""), setLocal(""));
    window.addEventListener("keydown", off);
    return () => window.removeEventListener("keydown", off);
  }, []);
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <>
      <style>{CSS}</style>
      <span className="mnav">
        <button type="button" className={`mnav-b${mode === "rail" ? " on" : ""}`} onClick={() => go("rail")} aria-label={t("菜单", "Menu")}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M4.5 7h15M4.5 12h15M4.5 17h15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" fill="none" /></svg>
        </button>
        {has.list ? (
          <button type="button" className={`mnav-b${mode === "list" ? " on" : ""}`} onClick={() => go("list")} aria-label={t("列表", "List")}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><rect x="4" y="4.5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 4.5v15" stroke="currentColor" strokeWidth="1.8" /></svg>
            <span>{t("列表", "List")}</span>
          </button>
        ) : null}
      </span>
      {has.agent ? (
        <button type="button" className={`mnav-ai${mode === "agent" ? " on" : ""}`} onClick={() => go("agent")} aria-label={t("AI 助手", "AI assistant")}>
          {mode === "agent" ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" fill="currentColor" /></svg>
              <span>AI</span>
            </>
          )}
        </button>
      ) : null}
      <div className="mnav-veil" onClick={() => (setMode(""), setLocal(""))} />
    </>
  );
}

const CSS = `
.mnav, .mnav-ai, .mnav-veil { display: none; }
@media (max-width: 760px) {
  .mnav { display: inline-flex; gap: 4px; margin-left: -8px; flex-shrink: 0; }
  .mnav-b { height: 30px; min-width: 32px; padding: 0 7px; border: 1px solid #ededed; border-radius: 8px; background: #fff; color: #262626; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; cursor: pointer; }
  .mnav-b.on { background: #171717; color: #fff; border-color: #171717; }
  .mnav-ai { display: inline-flex; position: fixed; right: 14px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 1002; height: 46px; min-width: 46px; padding: 0 14px; border-radius: 23px; border: 0; background: #171717; color: #fff; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 13px; font-weight: 600; box-shadow: 0 10px 28px -6px rgba(0,0,0,.45); cursor: pointer; }
  .mnav-ai.on { top: calc(10px + env(safe-area-inset-top)); bottom: auto; right: 10px; height: 38px; min-width: 38px; padding: 0; background: #fff; color: #171717; border: 1px solid #e3e2dd; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
  html[data-m="rail"] .mnav-veil, html[data-m="list"] .mnav-veil { display: block; position: fixed; inset: 0; z-index: 999; background: rgba(17,17,17,.32); animation: mnav-fade .18s ease-out; }
  @keyframes mnav-fade { from { opacity: 0; } to { opacity: 1; } }

  /* The module rail: a drawer from the left. */
  nav.app-rail { position: fixed !important; left: 0; top: 0; bottom: 0; z-index: 1000; width: min(280px, 84vw) !important; transform: translateX(-105%); transition: transform .24s cubic-bezier(.2,.8,.2,1); box-shadow: 0 0 44px rgba(0,0,0,.2); padding-top: calc(10px + env(safe-area-inset-top)) !important; }
  html[data-m="rail"] nav.app-rail { transform: none; }

  /* A page's own list (chat sidebar, script and video lists, research): a drawer too. */
  [data-ws-sidebar], [data-trends-screen] { position: fixed !important; left: 0; top: 0; bottom: 0; z-index: 1000; width: min(330px, 88vw) !important; transform: translateX(-105%); transition: transform .24s cubic-bezier(.2,.8,.2,1); box-shadow: 0 0 44px rgba(0,0,0,.2); padding-top: calc(10px + env(safe-area-inset-top)) !important; }
  html[data-m="list"] [data-ws-sidebar], html[data-m="list"] [data-trends-screen] { transform: none; }

  /* The AI panel beside a page: full screen, from the bottom. */
  [data-agent-panel] { position: fixed !important; inset: 0 !important; z-index: 1001; width: 100% !important; min-width: 0 !important; max-width: none !important; height: 100dvh !important; transform: translateY(105%); transition: transform .26s cubic-bezier(.2,.8,.2,1); padding-top: calc(52px + env(safe-area-inset-top)); }
  html[data-m="agent"] [data-agent-panel] { transform: none; }

  /* Drag handles have nothing to drag on a phone. */
  [role="separator"] { display: none !important; }

  /* The page fills the screen and scrolls rather than squeezing. */
  #main { overflow-x: hidden; }
  #main > * { min-width: 0 !important; }
  [data-topbar-crumb-screen] { display: none; }
  body { -webkit-text-size-adjust: 100%; }
  input, textarea, select { font-size: 16px !important; }
}
`;
