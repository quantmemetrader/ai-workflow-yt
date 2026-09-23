"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAV } from "@/lib/nav";
import type { Module } from "@/lib/db/schema";
import type { PaletteHit } from "@/app/api/palette/route";
import { beginWork } from "@/lib/client/busy";

/**
 * "Jump to…", as the box has always promised.
 *
 * It used to be a link to `/search`: a whole page navigation that threw away
 * the screen you were on to show you a text field. This is the Spotlight
 * shape instead. The palette sits over the work rather than replacing it —
 * near the top of the window, the page still readable behind it — and
 * dismissing it (Escape, or a click anywhere outside) puts you back exactly
 * where you were, because you never left.
 *
 * Two halves. Places come from the viewer's own entitlements, already in the
 * shell, so they filter as fast as you can type with no round trip. Things
 * come from `/api/palette`, which runs the same permission-filtered search the
 * agent uses, so the palette can never offer a door into something you may not
 * open.
 *
 * Opened by ⌘K / Ctrl-K from anywhere in the app, or by the sidebar's own box
 * dispatching `aura:jump`.
 */
export const JUMP_EVENT = "aura:jump";

type Row =
  | { kind: "module"; id: string; href: string; title: string; subtitle: string | null; icon: string }
  | (PaletteHit & { icon?: undefined });

const GLYPH: Record<string, string> = {
  channel: '<path d="M6 9h12M6 15h12M10.5 4 9 20M16 4l-1.5 16"/>',
  person: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5.2 20a6.8 6.8 0 0 1 13.6 0"/>',
  folder:
    '<path d="M3.8 7.2a1.9 1.9 0 0 1 1.9-1.9h3a1.9 1.9 0 0 1 1.47.69l.93 1.13h6.2a1.9 1.9 0 0 1 1.9 1.9v7.7a1.9 1.9 0 0 1-1.9 1.9H5.7a1.9 1.9 0 0 1-1.9-1.9z"/>',
  file: '<path d="M7 3.6h7L18 8v12.4H7z"/><path d="M9.6 12.4h5.4M9.6 15.6h5.4"/>',
};

export function CommandPalette({ modules, locale }: { modules: Module[]; locale: string }) {
  const router = useRouter();
  const zh = locale.startsWith("zh");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PaletteHit[]>([]);
  const [withheld, setWithheld] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setWithheld(0);
    setCursor(0);
  }, []);

  /* ⌘K from anywhere, including from inside a text field: the shortcut is
   * drawn on the box, so it has to work wherever the box is visible. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
      }
    }
    function onJump() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(JUMP_EVENT, onJump);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(JUMP_EVENT, onJump);
    };
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  /* Places: the modules this person actually holds, filtered here. Settings is
   * not a module and is always reachable. */
  const places = useMemo<Row[]>(() => {
    const items: Row[] = NAV.filter((n) => modules.includes(n.module)).map((n) => ({
      kind: "module" as const,
      id: n.href,
      href: n.href,
      title: zh ? n.labelZh : n.label,
      subtitle: null,
      icon: n.icon,
    }));
    items.push({
      kind: "module",
      id: "settings",
      href: "/settings",
      title: zh ? "设置" : "Settings",
      subtitle: null,
      icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2"/>',
    });
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  }, [modules, query, zh]);

  /*
   * The previous query's answer is not this query's answer. Clearing it while
   * rendering — rather than in an effect — is React's own pattern for state
   * derived from other state: it costs no extra render pass, and it means the
   * list is never briefly showing hits for a phrase you have already changed.
   */
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setHits([]);
    setWithheld(0);
    setBusy(false);
    setCursor(0);
  }

  /* Things: debounced, because every keystroke would otherwise be a search
   * across the whole studio. 180ms is about one character of typing. */
  useEffect(() => {
    const q = query.trim();
    if (!open || !q) return;

    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setBusy(true);
      const doneWorking = beginWork(zh ? `搜索“${q}”` : `Searching “${q}”`);
      try {
        const res = await fetch(`/api/palette?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { hits: PaletteHit[]; withheld: number };
        setHits(data.hits);
        setWithheld(data.withheld);
      } catch {
        // An aborted or dropped lookup is not worth reporting: the next
        // keystroke runs another one.
      } finally {
        doneWorking();
        setBusy(false);
      }
    }, 180);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query, open, zh]);

  const rows = useMemo<Row[]>(() => [...places, ...hits], [places, hits]);

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      close();
      router.push(row.href);
    },
    [close, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (rows.length) choose(rows[cursor]);
      else if (query.trim()) {
        close();
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  }

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const placeCount = places.length;

  return (
    <div
      // The backdrop is the dismiss target: "if touched anywhere it goes
      // back". It is deliberately light, so the screen underneath stays
      // readable and the palette reads as sitting over your work rather than
      // replacing it.
      onMouseDown={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(23,23,23,0.16)",
        backdropFilter: "blur(1.5px)",
        WebkitBackdropFilter: "blur(1.5px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        // Near the top, not the middle: the same place macOS puts it, and it
        // leaves the page visible under the panel instead of behind it.
        paddingTop: "13vh",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "跳转到" : "Jump to"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "68vh",
          display: "flex",
          flexDirection: "column",
          background: "rgba(255,255,255,0.97)",
          borderRadius: 14,
          border: "1px solid #e2e2e2",
          boxShadow: "0 24px 64px rgba(23,23,23,0.22), 0 2px 8px rgba(23,23,23,0.08)",
          overflow: "hidden",
          animation: "fadeUp .16s cubic-bezier(.32,.72,0,1) both",
        }}
      >
        <div
          style={{
            height: 54,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "0 17px",
            borderBottom: rows.length || query ? "1px solid #f3f3f3" : "none",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: 17, height: 17, stroke: "#999999", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="6.4" />
            <path d="m15.8 15.8 4 4" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? "跳转到频道、成员、文件夹或文件" : "Jump to a channel, a person, a folder or a file"}
            style={{
              flexGrow: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              fontSize: 16,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              color: "#171717",
            }}
          />
          {busy && (
            <span style={{ fontSize: 11.5, color: "#c7c7c7", flexShrink: 0 }}>
              {zh ? "查找中" : "looking"}
            </span>
          )}
          <button
            type="button"
            onClick={close}
            style={{
              flexShrink: 0,
              height: 20,
              padding: "0 7px",
              borderRadius: 6,
              border: "1px solid #ededed",
              background: "#fff",
              color: "#999999",
              fontSize: 11.5,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              fontWeight: 500,
              cursor: "pointer",
              lineHeight: "18px",
            }}
          >
            esc
          </button>
        </div>

        <div ref={list} style={{ overflowY: "auto", padding: rows.length ? "7px 7px 9px" : 0 }}>
          {rows.map((row, i) => {
            const first = i === 0;
            const firstThing = i === placeCount && placeCount > 0;
            return (
              <div key={`${row.kind}:${row.id}`}>
                {first && placeCount > 0 && <Label text={zh ? "位置" : "Places"} />}
                {firstThing && <Label text={zh ? "找到的内容" : "Found"} />}
                <button
                  type="button"
                  data-row={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => choose(row)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    height: 38,
                    padding: "0 10px",
                    borderRadius: 9,
                    border: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    background: i === cursor ? "#f3f3f3" : "transparent",
                    font: "inherit",
                    color: "#171717",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: 15,
                      height: 15,
                      flexShrink: 0,
                      ...(row.kind === "module"
                        ? { fill: "#7c7c7c" }
                        : { stroke: "#7c7c7c", fill: "none", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }),
                    }}
                    dangerouslySetInnerHTML={{
                      __html: row.kind === "module" ? row.icon : (GLYPH[row.kind] ?? GLYPH.file),
                    }}
                  />
                  <span style={{ fontSize: 13.5, whiteSpace: "nowrap", flexShrink: 0 }}>{row.title}</span>
                  {row.subtitle && (
                    <span
                      style={{
                        fontSize: 11.5,
                        color: "#999999",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.subtitle}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11.5, color: "#c7c7c7" }}>
                    {row.kind === "module"
                      ? zh
                        ? "模块"
                        : "module"
                      : row.kind === "channel"
                        ? zh
                          ? "频道"
                          : "channel"
                        : row.kind === "person"
                          ? zh
                            ? "消息"
                            : "message"
                          : row.kind === "folder"
                            ? zh
                              ? "文件夹"
                              : "folder"
                            : zh
                              ? "文件"
                              : "file"}
                  </span>
                </button>
              </div>
            );
          })}

          {query.trim() && !rows.length && !busy && (
            <p style={{ fontSize: 12.5, color: "#999999", padding: "16px 17px", margin: 0, lineHeight: 1.6 }}>
              {zh
                ? "没有匹配的内容。按回车用完整搜索再找一次。"
                : "Nothing here matches. Press Enter to run the full search instead."}
            </p>
          )}

          {withheld > 0 && (
            <p style={{ fontSize: 11.5, color: "#c7c7c7", padding: "4px 17px 10px", margin: 0 }}>
              {zh
                ? `另有 ${withheld} 条结果你无权查看，已隐藏。`
                : `${withheld} more matches are not shown, because you may not read them.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 500, color: "#999999", padding: "9px 10px 4px" }}>
      {text}
    </div>
  );
}
