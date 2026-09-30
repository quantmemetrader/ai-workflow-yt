"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AUTO_MODEL, CHAT_MODELS, chatModel, isRoutedModel, type ProviderModel } from "@/lib/ai/chat-models";

/* The provider's full list, fetched once per page and shared by every chip. */
let listCache: ProviderModel[] | null = null;
let listLoad: Promise<ProviderModel[]> | null = null;
function loadModels(): Promise<ProviderModel[]> {
  if (listCache) return Promise.resolve(listCache);
  if (!listLoad)
    listLoad = fetch("/api/ai/models")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d: { models?: ProviderModel[] }) => (listCache = Array.isArray(d.models) ? d.models : []))
      .catch(() => [])
      .finally(() => {
        listLoad = null;
      });
  return listLoad;
}
export function useProviderModels(active = true): ProviderModel[] | null {
  const [list, setList] = React.useState<ProviderModel[] | null>(listCache);
  React.useEffect(() => {
    if (!active || listCache) return;
    let off = false;
    void loadModels().then((l) => !off && setList(l));
    return () => {
      off = true;
    };
  }, [active]);
  return list;
}

const VENDOR: Record<string, string> = { anthropic: "Claude（Anthropic）", openai: "OpenAI", google: "Google Gemini", qwen: "通义千问 Qwen", deepseek: "DeepSeek", moonshotai: "Kimi", "z-ai": "智谱 GLM", "x-ai": "xAI Grok", "meta-llama": "Meta Llama", mistralai: "Mistral", typesafe: "TypeSafe Jev" };
/* Each maker's own logo (public/ai-logos, from @lobehub/icons, MIT), served from our host so it loads in China. */
const LOGO: Record<string, string> = {"openai":"openai","qwen":"qwen-color","google":"gemini-color","mistralai":"mistral-color","anthropic":"claude-color","z-ai":"zhipu-color","recraft":"recraft","deepseek":"deepseek-color","x-ai":"grok","minimax":"minimax-color","bytedance-seed":"bytedance-color","bytedance":"bytedance-color","microsoft":"microsoft-color","cohere":"cohere-color","meta":"meta-color","meta-llama":"meta-color","moonshotai":"kimi","black-forest-labs":"bfl","tencent":"hunyuan-color","nvidia":"nvidia-color","voyageai":"voyage-color","perplexity":"perplexity-color","aion-labs":"aionlabs-color","alibaba":"alibaba-color","xiaomi":"xiaomimimo","openrouter":"openrouter-color","amazon":"nova-color","upstage":"upstage-color","sakana":"sakana-color","nousresearch":"nousresearch","inception":"inception","ibm-granite":"ibm","stepfun":"stepfun-color","rekaai":"reka","relace":"relace","morph":"morph-color","poolside":"poolside-color","fireworks":"fireworks-color","meituan":"longcat-color","kwaipilot":"kwaipilot-color","kwaivgi":"kling-color","arcee-ai":"arcee-color","baidu":"baidu-color"};
export const vendorOf = (id: string) => (id.includes("/") ? id.split("/")[0].replace(/^~/, "") : "");
const price = (m: ProviderModel, zh: boolean) =>
  m.inPerM === null || m.outPerM === null ? "" : zh ? `每百万 token $${m.inPerM} / $${m.outPerM}` : `$${m.inPerM} / $${m.outPerM} per M`;

export function Badge({ vendor, size = 28, auto = false }: { vendor: string; size?: number; auto?: boolean }) {
  const logo = LOGO[vendor.replace(/^~/, "")];
  const inner = Math.round(size * 0.64);
  return (
    <span aria-hidden style={{ width: size, height: size, flexShrink: 0, borderRadius: Math.round(size * 0.28), background: auto ? "#171717" : "#fff", border: auto ? 0 : "1px solid #ecebe7", boxSizing: "border-box", color: auto ? "#fff" : "#8a8a86", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {auto ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
          <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </svg>
      ) : logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/ai-logos/${logo}.svg`} alt="" width={inner} height={inner} style={{ display: "block", width: inner, height: inner }} loading="lazy" decoding="async" />
      ) : (
        /* A maker without a logo on file: a plain chip, not a made-up letter mark. */
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2.5" />
          <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
        </svg>
      )}
    </span>
  );
}

const Check = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="#1f5fbf" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/**
 * 「模型：自动 ▾」: which model answers. The pinned picks in plain words
 * first (Claude among them), then 「全部模型」 — every model the studio's key
 * can call, searchable, grouped by maker (the owner, 30 Sep: "I want all the
 * available models to be there"). `autoLabel` renames 自动 where it means
 * something else (an employee's own model falls back to the studio default).
 *
 * The list is drawn on `document.body` (the owner, 30 Sep: the script page's
 * toolbar was drawn across it), follows its chip while the page scrolls, and
 * is a bottom sheet on a phone. Arrow keys and Enter work from the search box.
 */
export function ModelChip({
  value,
  onChange,
  zh,
  placement = "up",
  align = "right",
  autoLabel,
  note,
}: {
  value: string;
  onChange: (id: string) => void;
  zh: boolean;
  placement?: "up" | "down";
  align?: "left" | "right";
  autoLabel?: { zh: string; en: string; lineZh: string; lineEn: string };
  note?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [at, setAt] = React.useState<React.CSSProperties | null>(null);
  const [sheet, setSheet] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const box = React.useRef<HTMLSpanElement | null>(null);
  const panel = React.useRef<HTMLDivElement | null>(null);
  const all = useProviderModels(open || (isRoutedModel(value) && !CHAT_MODELS.some((m) => m.id === value)));
  const names = React.useMemo(() => new Map((all ?? []).map((m) => [m.id, m.name])), [all]);
  const W = 400;

  const place = React.useCallback(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    if (window.innerWidth < 600) {
      setSheet(true);
      setAt(null);
      return;
    }
    setSheet(false);
    if (r.bottom < 0 || r.top > window.innerHeight) return setOpen(false);
    const listH = 560;
    const roomUp = r.top - 16;
    const roomDown = window.innerHeight - r.bottom - 16;
    const up = placement === "up" ? roomUp > 360 || roomUp > roomDown : roomDown < Math.min(listH, 360) && roomUp > roomDown;
    const left = align === "right" ? Math.min(window.innerWidth - W - 8, Math.max(8, r.right - W)) : Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    setAt(up ? { bottom: window.innerHeight - r.top + 8, left, maxHeight: Math.min(listH, roomUp) } : { top: r.bottom + 8, left, maxHeight: Math.min(listH, roomDown) });
  }, [placement, align]);

  const toggle = () => {
    if (open) return setOpen(false);
    place();
    setQ("");
    setActive(0);
    setOpen(true);
  };
  const now = value === AUTO_MODEL && autoLabel ? { ...CHAT_MODELS[0], zh: autoLabel.zh, en: autoLabel.en } : chatModel(value, names);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  React.useEffect(() => {
    if (!open) return;
    const inside = (n: EventTarget | null) => Boolean(n && (box.current?.contains(n as Node) || panel.current?.contains(n as Node)));
    const away = (e: Event) => {
      if (!inside(e.target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    /* The page scrolling under the list: keep it on its chip. */
    const follow = (e: Event) => {
      if (!inside(e.target)) place();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const needle = q.trim().toLowerCase();
  const pinned = CHAT_MODELS.filter((m) => !needle || [m.zh, m.en, m.real, m.id, m.lineZh].some((s) => s.toLowerCase().includes(needle)));
  const shown = (all ?? []).filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || (VENDOR[m.vendor] ?? "").toLowerCase().includes(needle));
  const groups: [string, ProviderModel[]][] = [];
  for (const m of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0] === m.vendor) last[1].push(m);
    else groups.push([m.vendor, [m]]);
  }
  const order = [...pinned.map((m) => m.id), ...groups.flatMap(([, l]) => l.map((m) => m.id))];
  React.useEffect(() => setActive(0), [needle]);
  React.useEffect(() => {
    if (!open) return;
    panel.current?.querySelector(`[data-mc-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(order.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && order[active]) {
      e.preventDefault();
      pick(order[active]);
    }
  };
  let idx = -1;

  const list = open ? (
    <>
      {sheet ? <div className="mc-scrim" onPointerDown={() => setOpen(false)} /> : null}
      <div
        ref={panel}
        role="listbox"
        aria-label={zh ? "选模型" : "Choose a model"}
        className={sheet ? "mc-panel mc-sheet" : "mc-panel"}
        style={sheet ? undefined : { ...(at ?? { bottom: 60, right: 16 }), width: W }}
      >
        <div className="mc-head">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: "#171717" }}>{zh ? "选择模型" : "Choose a model"}</span>
            <span style={{ fontSize: 11.5, color: "#8a8a86", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note ?? (zh ? "只对这里发的消息有效" : "Only for messages sent from here")}</span>
          </div>
          <label className="mc-search">
            <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input autoFocus={!sheet} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={zh ? "搜索模型：claude、gpt、gemini、qwen…" : "Search: claude, gpt, gemini, qwen…"} aria-label={zh ? "搜索模型" : "Search models"} />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label={zh ? "清空" : "Clear"} className="mc-clear">
                <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M7 7l10 10M17 7 7 17" />
                </svg>
              </button>
            ) : null}
          </label>
        </div>
        <div className="mc-body">
          {pinned.length ? (
            <>
              <div className="mc-sec">{zh ? "推荐" : "Recommended"}</div>
              {pinned.map((m) => {
                const i = ++idx;
                const on = m.id === value;
                const label = m.id === AUTO_MODEL && autoLabel ? autoLabel : null;
                return (
                  <button key={m.id} type="button" role="option" aria-selected={on} data-mc-i={i} data-on={on || undefined} data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(m.id)} className="mc-row">
                    <Badge vendor={vendorOf(m.id)} auto={m.id === AUTO_MODEL} />
                    <span style={{ minWidth: 0, flexGrow: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#171717", whiteSpace: "nowrap" }}>{label ? (zh ? label.zh : label.en) : zh ? m.zh : m.en}</span>
                        {m.real ? <span className="mc-pill">{m.real}</span> : null}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "#7a7a76", marginTop: 2, lineHeight: 1.4 }}>{label ? (zh ? label.lineZh : label.lineEn) : zh ? m.lineZh : m.lineEn}</span>
                    </span>
                    {on ? <Check /> : null}
                  </button>
                );
              })}
            </>
          ) : null}
          <div className="mc-sec" style={{ display: "flex", justifyContent: "space-between", marginTop: pinned.length ? 6 : 0 }}>
            <span>{zh ? "全部模型" : "All models"}</span>
            <span style={{ fontWeight: 500 }}>{all ? (needle ? `${shown.length} / ${all.length}` : zh ? `${all.length} 个` : `${all.length}`) : zh ? "正在读取…" : "Loading…"}</span>
          </div>
          {all === null ? (
            <div style={{ padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2].map((k) => (
                <span key={k} className="mc-skel" />
              ))}
            </div>
          ) : null}
          {groups.map(([vendor, rows]) => (
            <div key={vendor}>
              <div className="mc-vendor">{VENDOR[vendor] ?? vendor}</div>
              {rows.map((m) => {
                const i = ++idx;
                const on = m.id === value;
                return (
                  <button key={m.id} type="button" role="option" aria-selected={on} data-mc-i={i} data-on={on || undefined} data-active={i === active || undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(m.id)} className="mc-row mc-row-sm">
                    <Badge vendor={m.vendor} size={22} />
                    <span style={{ minWidth: 0, flexGrow: 1 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                      <span style={{ display: "block", fontSize: 11, color: "#a3a3a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[m.id, price(m, zh)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {on ? <Check /> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {all && !shown.length && !pinned.length ? <div style={{ padding: "18px 10px", fontSize: 12.5, color: "#8a8a86", textAlign: "center" }}>{zh ? "没有找到这个模型" : "No model matches"}</div> : null}
        </div>
        <style>{MC_CSS}</style>
      </div>
    </>
  ) : null;

  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex", flexShrink: 0, minWidth: 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={zh ? "选用哪个模型回答" : "Which model answers"}
        className="mc-chip"
        data-open={open || undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, maxWidth: 220, padding: "0 8px 0 6px", border: "1px solid #e7e6e2", borderRadius: 8, background: value === AUTO_MODEL ? "#fff" : "#f4f4f2", color: "#404040", fontFamily: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <Badge vendor={vendorOf(value)} size={16} auto={value === AUTO_MODEL} />
        <span style={{ color: "#8a8a8a" }}>{zh ? "模型" : "Model"}</span>
        <b style={{ fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{zh ? now.zh : now.en}</b>
        <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "transform .15s ease", transform: open ? "rotate(180deg)" : "none" }}>
          <path d={placement === "up" ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {list && typeof document !== "undefined" ? createPortal(list, document.body) : null}
    </span>
  );
}

const MC_CSS = `
.mc-panel { position: fixed; z-index: 2147483000; display: flex; flex-direction: column; background: #fff; border: 1px solid #e6e5e0; border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 18px 48px -8px rgba(17,17,17,.18); overflow: hidden; box-sizing: border-box; max-width: calc(100vw - 16px); font-family: inherit; animation: mcIn .14s cubic-bezier(.2,.8,.2,1); }
.mc-sheet { left: 0; right: 0; bottom: 0; width: 100%; max-width: none; max-height: 82vh; border-radius: 18px 18px 0 0; border-bottom: 0; animation: mcUp .2s cubic-bezier(.2,.8,.2,1); padding-bottom: env(safe-area-inset-bottom); }
.mc-scrim { position: fixed; inset: 0; z-index: 2147482999; background: rgba(17,17,17,.28); animation: mcFade .15s ease; }
.mc-head { padding: 14px 14px 10px; border-bottom: 1px solid #f0efeb; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
.mc-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 10px 0 12px; border-radius: 10px; background: #f5f5f3; color: #8a8a86; border: 1px solid transparent; transition: border-color .12s ease, background .12s ease; cursor: text; }
.mc-search:focus-within { background: #fff; border-color: #c9d8f0; box-shadow: 0 0 0 3px rgba(31,95,191,.1); }
.mc-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; font: inherit; font-size: 13px; color: #171717; }
.mc-clear { border: 0; background: #e4e3de; color: #555; width: 20px; height: 20px; border-radius: 99px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.mc-body { overflow-y: auto; overscroll-behavior: contain; padding: 6px 6px 8px; flex: 1; min-height: 0; }
.mc-sec { padding: 10px 10px 6px; font-size: 11px; font-weight: 650; color: #8a8a86; letter-spacing: .04em; }
.mc-vendor { position: sticky; top: -6px; z-index: 1; background: rgba(255,255,255,.96); backdrop-filter: blur(4px); padding: 8px 10px 4px; font-size: 11px; font-weight: 600; color: #a3a3a0; }
.mc-row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent; text-align: left; font-family: inherit; cursor: pointer; transition: background .08s ease; }
.mc-row-sm { gap: 10px; padding: 7px 10px; }
.mc-row[data-active] { background: #f5f5f2; }
.mc-row[data-on] { background: #eef4fd; }
.mc-row[data-on][data-active] { background: #e5eefb; }
.mc-pill { font-size: 10.5px; color: #6b6b67; background: #f1f1ee; border-radius: 99px; padding: 1px 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mc-row[data-on] .mc-pill { background: #dde8f9; color: #1f5fbf; }
.mc-skel { display: block; height: 30px; border-radius: 8px; background: linear-gradient(90deg,#f3f3f0 0%,#fafaf8 50%,#f3f3f0 100%); background-size: 200% 100%; animation: mcShim 1.2s linear infinite; }
.mc-chip:hover, .mc-chip[data-open] { border-color: #d4d3ce !important; }
@keyframes mcIn { from { opacity: 0; transform: translateY(4px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes mcUp { from { transform: translateY(100%); } to { transform: none; } }
@keyframes mcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mcShim { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .mc-panel, .mc-sheet, .mc-scrim, .mc-skel { animation: none; } }
`;

/**
 * The picked model for one box, kept for this browser tab per conversation
 * (sessionStorage, guarded), so it sticks while you keep writing there and
 * resets to 自动 in a new chat.
 */
export function useChatModel(scope: string): [string, (id: string) => void] {
  const key = `tg-model:${scope}`;
  const [value, setValue] = React.useState<string>(AUTO_MODEL);
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(key);
      setValue(saved && (saved === AUTO_MODEL || isRoutedModel(saved)) ? saved : AUTO_MODEL);
    } catch {
      setValue(AUTO_MODEL);
    }
  }, [key]);
  const set = React.useCallback(
    (id: string) => {
      setValue(id);
      try {
        window.sessionStorage.setItem(key, id);
      } catch {
        /* private window: the choice still holds for this page */
      }
    },
    [key],
  );
  return [value, set];
}

/* The side panels' model (ResearchAgentPanel draws the chip, useInlineAgent sends it): one choice per tab, shared. */
let panelModel = AUTO_MODEL;
const panelSubs = new Set<() => void>();
export function getPanelModel(): string {
  return panelModel;
}
export function usePanelModel(): [string, (id: string) => void] {
  const value = React.useSyncExternalStore(
    (cb) => {
      panelSubs.add(cb);
      return () => panelSubs.delete(cb);
    },
    () => panelModel,
    () => AUTO_MODEL,
  );
  const set = React.useCallback((id: string) => {
    panelModel = id;
    try {
      window.sessionStorage.setItem("tg-model:panel", id);
    } catch {
      /* fine */
    }
    panelSubs.forEach((f) => f());
  }, []);
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("tg-model:panel");
      if (saved && saved !== panelModel && (saved === AUTO_MODEL || isRoutedModel(saved))) set(saved);
    } catch {
      /* fine */
    }
  }, [set]);
  return [value, set];
}
