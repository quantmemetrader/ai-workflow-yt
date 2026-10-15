"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * The phone (15 Oct: "目前手机端不支持"). Moving between modules is the dock at the foot of the screen
 * (`PhoneDock`, drawn by the rail, from the approved phone artboards). This file is the rest of the phone layer:
 * a page's own list column becomes a drawer (the 列表 button in the top bar), its AI panel a sheet that rises from
 * the bottom (the round button above the dock), and the page keeps clear of the dock and the keyboard. Desktop is
 * untouched: the buttons and the rules only exist below 760px.
 */
type Mode = "" | "list" | "agent";

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
    const look = () => setHas({ list: Boolean(document.querySelector("[data-ws-sidebar], [data-trends-screen], .folder-rail")), agent: Boolean(document.querySelector("[data-agent-panel], .gd-side")) });
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
    /* The on-screen keyboard is up: the dock and the AI button step aside so the field being typed in stays visible. */
    const vv = window.visualViewport;
    const kb = () => {
      const a = document.activeElement as HTMLElement | null;
      const typing = !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
      if (typing && !!vv && window.innerHeight - vv.height > 140) document.documentElement.dataset.kb = "";
      else delete document.documentElement.dataset.kb;
    };
    const later = () => window.setTimeout(kb, 80);
    vv?.addEventListener("resize", kb);
    window.addEventListener("focusout", later);
    return () => {
      window.removeEventListener("keydown", off);
      vv?.removeEventListener("resize", kb);
      window.removeEventListener("focusout", later);
    };
  }, []);
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <>
      <style>{CSS}</style>
      <span className="mnav">
        {has.list ? (
          <button type="button" className={`mnav-b${mode === "list" ? " on" : ""}`} onClick={() => go("list")} aria-label={t("列表", "List")}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><rect x="4" y="4.5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M9.5 4.5v15" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
        ) : null}
      </span>
      {has.agent ? (
        <button type="button" className={`mnav-ai${mode === "agent" ? " on" : ""}`} onClick={() => go("agent")} aria-label={t("AI 助手", "AI assistant")}>
          {mode === "agent" ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" fill="currentColor" /><path d="M18.4 14.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="currentColor" /></svg>
          )}
        </button>
      ) : null}
      <div className="mnav-veil" onClick={() => (setMode(""), setLocal(""))} />
      {mode === "agent" ? <div className="mnav-grip" aria-hidden /> : null}
    </>
  );
}

const CSS = `
.mnav, .mnav-ai, .mnav-veil, .mnav-grip { display: none; }
@media (max-width: 760px) {
  /* The top bar: what page this is, the task ring and your face. */
  .mnav { display: inline-flex; gap: 4px; flex-shrink: 0; margin-left: -4px; }
  header.tb { height: calc(50px + env(safe-area-inset-top)) !important; padding: env(safe-area-inset-top) 12px 0 14px !important; gap: 8px !important; background: rgba(255,255,255,.96) !important; }
  .tb-title { font-size: 16px !important; font-weight: 600 !important; overflow: hidden; text-overflow: ellipsis; }
  .tb-who { padding: 0 !important; border: 0 !important; height: auto !important; background: transparent !important; }
  .tb-who > a { display: none !important; }
  .mnav-b { height: 32px; width: 34px; padding: 0; border: 1px solid #ececec; border-radius: 10px; background: #fff; color: #262626; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .mnav-b.on { background: #171717; color: #fff; border-color: #171717; }

  /* AI: a round button above the dock; its panel is a sheet from the bottom. */
  .mnav-ai { display: inline-flex; position: fixed; right: 14px; bottom: calc(78px + env(safe-area-inset-bottom)); z-index: 1002; width: 48px; height: 48px; border-radius: 24px; border: 1px solid #e6e6e6; background: #fff; color: #171717; align-items: center; justify-content: center; box-shadow: 0 8px 24px -8px rgba(0,0,0,.3); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .mnav-ai:active { transform: scale(.95); }
  html[data-kb] .mnav-ai:not(.on), html[data-launcher] .mnav-ai { display: none; }
  .mnav-ai.on { top: calc(9dvh + 10px); bottom: auto; right: 12px; width: 34px; height: 34px; border-radius: 17px; background: #f3f3f3; border: 0; box-shadow: none; z-index: 1003; }
  html[data-m="list"] .mnav-veil, html[data-m="agent"] .mnav-veil { display: block; position: fixed; inset: 0; z-index: 999; background: rgba(17,17,17,.32); animation: mnav-fade .18s ease-out; }
  html[data-m="agent"] .mnav-grip { display: block; position: fixed; top: calc(9dvh + 8px); left: 50%; margin-left: -19px; width: 38px; height: 5px; border-radius: 3px; background: #e2e2e2; z-index: 1003; }
  @keyframes mnav-fade { from { opacity: 0; } to { opacity: 1; } }

  /* The module rail is the dock on a phone. */
  nav.app-rail { display: none !important; }

  /* A page's own list (chat sidebar, script and video lists, research): a drawer from the left. */
  [data-ws-sidebar], [data-trends-screen], .folder-rail { position: fixed !important; left: 0; top: 0; bottom: 0; z-index: 1000; width: min(330px, 86vw) !important; max-width: none !important; transform: translateX(-105%); transition: transform .26s cubic-bezier(.2,.8,.2,1); box-shadow: 0 0 44px rgba(0,0,0,.2); padding-top: calc(10px + env(safe-area-inset-top)) !important; border-radius: 0 18px 18px 0; overflow-y: auto !important; }
  html[data-m="list"] [data-ws-sidebar], html[data-m="list"] [data-trends-screen], html[data-m="list"] .folder-rail { transform: none; }
  .folder-rail { background: #fbfbfa !important; }

  /* The AI panel beside a page: a sheet that rises from the bottom. */
  [data-agent-panel], .gd-side { position: fixed !important; left: 0 !important; right: 0 !important; bottom: 0 !important; top: 9dvh !important; z-index: 1001; width: 100% !important; min-width: 0 !important; max-width: none !important; height: auto !important; max-height: none !important; transform: translateY(105%); transition: transform .28s cubic-bezier(.2,.8,.2,1); border-radius: 22px 22px 0 0; box-shadow: 0 -12px 40px rgba(23,23,23,.16); background: #fff !important; padding-top: 26px !important; padding-bottom: env(safe-area-inset-bottom) !important; border-left: 0 !important; overflow: hidden; }
  html[data-m="agent"] [data-agent-panel], html[data-m="agent"] .gd-side { transform: none; }
  .gd-side { overflow-y: auto !important; padding: 30px 16px calc(20px + env(safe-area-inset-bottom)) !important; }

  /* The script page: the sheet fills the screen, no ruler, toolbars scroll sideways. */
  .gd-ruler-wrap { display: none !important; }
  .gd-sheet-row { zoom: 1 !important; width: 100% !important; padding: 0 0 40px !important; }
  .gd-sheet { width: 100% !important; min-height: 60vh !important; padding: 20px 18px 60px !important; box-shadow: none !important; }
  .gd-toolbar { flex-wrap: nowrap !important; overflow-x: auto; margin: 4px 8px 6px !important; scrollbar-width: none; }
  .gd-menubar { overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap !important; }
  /* The document's own buttons on one line that scrolls, not five rows; asking the writer happens in the AI sheet. */
  .gd-actions { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; padding-left: 12px !important; padding-right: 12px !important; }
  .gd-actions::-webkit-scrollbar { display: none; }
  .gd-actions > * { flex-shrink: 0; }
  .gd-ai-dock { display: none !important; }
  .gd-actions .gd-menu { position: fixed !important; left: 12px !important; right: 12px !important; top: auto !important; bottom: calc(84px + env(safe-area-inset-bottom)) !important; min-width: 0 !important; max-height: 60dvh; overflow-y: auto; z-index: 1005 !important; border-radius: 16px !important; box-shadow: 0 16px 48px rgba(0,0,0,.22) !important; }

  /* Tab rows and chip rows scroll sideways instead of breaking words one character per line. */
  [role="tablist"] { overflow-x: auto; flex-wrap: nowrap !important; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  [role="tablist"] > * { flex-shrink: 0; white-space: nowrap; }
  [role="tablist"]::-webkit-scrollbar { display: none; }

  /* Drag handles have nothing to drag on a phone. */
  [role="separator"] { display: none !important; }

  /* The page fills the screen and keeps clear of the dock. */
  #main { overflow-x: hidden; padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
  #main > * { min-width: 0 !important; max-width: 100vw; }
  [data-topbar-crumb-screen] { display: none; }
  body { -webkit-text-size-adjust: 100%; }
  input, textarea, select { font-size: 16px !important; }
  img, video, canvas, svg { max-width: 100%; }
}
`;
