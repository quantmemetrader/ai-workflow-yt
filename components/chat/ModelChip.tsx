"use client";

import * as React from "react";
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
const price = (m: ProviderModel, zh: boolean) =>
  m.inPerM === null || m.outPerM === null ? "" : zh ? `每百万 token $${m.inPerM} / $${m.outPerM}` : `$${m.inPerM} / $${m.outPerM} per M`;

/**
 * 「模型：自动 ▾」: which model answers. The pinned picks in plain words
 * first (Claude among them), then 「全部模型」 — every model the studio's key
 * can call, searchable, grouped by maker (the owner, 30 Sep: "I want all the
 * available models to be there"). `autoLabel` renames 自动 where it means
 * something else (an employee's own model falls back to the studio default).
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
  const box = React.useRef<HTMLSpanElement | null>(null);
  const all = useProviderModels(open || (isRoutedModel(value) && !CHAT_MODELS.some((m) => m.id === value)));
  const names = React.useMemo(() => new Map((all ?? []).map((m) => [m.id, m.name])), [all]);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const listH = 520;
      const up = placement === "up" ? r.top > listH || r.top > window.innerHeight - r.bottom : r.bottom + listH > window.innerHeight && r.top > window.innerHeight - r.bottom;
      const horiz = align === "right" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, Math.min(r.left, window.innerWidth - 352)) };
      setAt(up ? { bottom: window.innerHeight - r.top + 6, ...horiz, maxHeight: Math.min(560, r.top - 16) } : { top: r.bottom + 6, ...horiz, maxHeight: Math.min(560, window.innerHeight - r.bottom - 16) });
    }
    setQ("");
    setOpen(true);
  };
  const now = value === AUTO_MODEL && autoLabel ? { ...CHAT_MODELS[0], zh: autoLabel.zh, en: autoLabel.en } : chatModel(value, names);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = (all ?? []).filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || (VENDOR[m.vendor] ?? "").toLowerCase().includes(needle));
  const groups: [string, ProviderModel[]][] = [];
  for (const m of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0] === m.vendor) last[1].push(m);
    else groups.push([m.vendor, [m]]);
  }
  const tick = (on: boolean) => (
    <span style={{ width: 14, flexShrink: 0, paddingTop: 2, color: "#171717" }}>
      {on ? (
        <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : null}
    </span>
  );

  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex", flexShrink: 0, minWidth: 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={zh ? "选用哪个模型回答" : "Which model answers"}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, maxWidth: 220, padding: "0 8px", border: "1px solid #e7e6e2", borderRadius: 8, background: value === AUTO_MODEL ? "#fff" : "#f4f4f2", color: "#404040", fontFamily: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <span style={{ color: "#8a8a8a" }}>{zh ? "模型" : "Model"}</span>
        <b style={{ fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{zh ? now.zh : now.en}</b>
        <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d={placement === "up" ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={zh ? "选模型" : "Choose a model"}
          style={{ position: "fixed", ...(at ?? { bottom: 60, right: 16 }), zIndex: 90, overflowY: "auto", width: 340, maxWidth: "calc(100vw - 16px)", padding: 6, background: "#fff", border: "1px solid #e7e6e2", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.12)", boxSizing: "border-box" }}
        >
          <div style={{ padding: "4px 8px 6px", fontSize: 11.5, color: "#8a8a8a" }}>{note ?? (zh ? "只对这里发的消息有效" : "Only for messages sent from here")}</div>
          {CHAT_MODELS.map((m) => {
            const on = m.id === value;
            const label = m.id === AUTO_MODEL && autoLabel ? autoLabel : null;
            return (
              <button key={m.id} type="button" role="option" aria-selected={on} onClick={() => pick(m.id)} className="mc-row" style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "7px 8px", border: 0, borderRadius: 8, background: on ? "#f4f4f2" : "transparent", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}>
                {tick(on)}
                <span style={{ minWidth: 0, flexGrow: 1 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{label ? (zh ? label.zh : label.en) : zh ? m.zh : m.en}</span>
                    {m.real ? <span style={{ fontSize: 10.5, color: "#b0b0ac" }}>{m.real}</span> : null}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#7a7a7a", marginTop: 1 }}>{label ? (zh ? label.lineZh : label.lineEn) : zh ? m.lineZh : m.lineEn}</span>
                </span>
              </button>
            );
          })}
          <div style={{ borderTop: "1px solid #efeee9", margin: "6px 0 4px", paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 6px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#404040" }}>{zh ? "全部模型" : "All models"}</span>
              <span style={{ fontSize: 11, color: "#a3a3a3" }}>{all ? (zh ? `${all.length} 个` : `${all.length}`) : zh ? "正在读取…" : "Loading…"}</span>
            </div>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={zh ? "搜索：claude、gpt、gemini、qwen…" : "Search: claude, gpt, gemini, qwen…"} style={{ width: "100%", boxSizing: "border-box", height: 32, border: "1px solid #dcdbd6", borderRadius: 8, padding: "0 10px", fontSize: 12.5, fontFamily: "inherit", outline: "none", marginBottom: 4 }} />
            {groups.map(([vendor, list]) => (
              <div key={vendor}>
                <div style={{ padding: "8px 8px 2px", fontSize: 11, fontWeight: 600, color: "#8a8a8a" }}>{VENDOR[vendor] ?? vendor}</div>
                {list.map((m) => {
                  const on = m.id === value;
                  return (
                    <button key={m.id} type="button" role="option" aria-selected={on} onClick={() => pick(m.id)} className="mc-row" style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "6px 8px", border: 0, borderRadius: 8, background: on ? "#f4f4f2" : "transparent", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}>
                      {tick(on)}
                      <span style={{ minWidth: 0, flexGrow: 1 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                        <span style={{ display: "block", fontSize: 10.5, color: "#a3a3a3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[m.id, price(m, zh)].filter(Boolean).join(" · ")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {all && !shown.length ? <div style={{ padding: "10px 8px", fontSize: 12, color: "#8a8a8a" }}>{zh ? "没有找到这个模型" : "No model matches"}</div> : null}
          </div>
          <style>{`.mc-row:hover{background:#f7f7f5 !important}`}</style>
        </div>
      ) : null}
    </span>
  );
}

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
