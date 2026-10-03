"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CLEAR_ERRORS_EVENT, NOTIFY_EVENT, notifyRich, type Notice } from "@/lib/client/notify";
import { zhNotice } from "@/lib/text/zh-errors";

/** Module names for the "no access" notice below. */
const MODULE_ZH: Record<string, string> = {
  chat: "聊天",
  files: "文件",
  research: "选题",
  script: "脚本",
  video: "视频",
  publish: "发布",
  accounting: "账务",
  finance: "财务",
  legal: "法务",
  hr: "人事",
  admin: "后台",
};

/**
 * Where a failure goes now that nothing calls `window.alert` — and where
 * "《蒸馏之战》成片已出" lands, with 打开 and 下载 under it, when a film
 * finishes while you are on some other page (`lib/client/live.ts`).
 *
 * Bottom left, so it never lands on the background-work toast in the other
 * corner. Errors stay until they are dismissed, because an error you did not
 * read is an error you will hit again; anything else clears itself, a notice
 * with presses on it a little later than one without.
 */
const HOLD = { error: 0, ok: 4000, info: 5000 } as const;
const HOLD_WITH_ACTIONS = 15_000;

export function Toaster({ locale = "zh-CN" }: { locale?: string } = {}) {
  /* A notice that arrives in English (a server action's "Not allowed") is put into Chinese for a Chinese reader (QA, 2 Oct). */
  const zhReader = !locale.startsWith("en");
  const [notices, setNotices] = useState<Notice[]>([]);

  const drop = useCallback((id: number) => {
    setNotices((cur) => cur.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function onNotice(event: Event) {
      const raw = (event as CustomEvent<Notice>).detail;
      if (!raw?.text && !raw?.title) return;
      const notice = zhReader ? { ...raw, text: zhNotice(raw.text), ...(raw.title ? { title: zhNotice(raw.title) } : {}) } : raw;
      setNotices((cur) => [...cur.slice(-3), notice]);
      const hold = notice.hold !== undefined ? notice.hold : notice.actions?.length && notice.kind !== "error" ? HOLD_WITH_ACTIONS : HOLD[notice.kind];
      if (hold) timers.add(setTimeout(() => drop(notice.id), hold));
    }

    function onClearErrors() {
      setNotices((cur) => cur.filter((n) => n.kind !== "error"));
    }

    window.addEventListener(NOTIFY_EVENT, onNotice);
    window.addEventListener(CLEAR_ERRORS_EVENT, onClearErrors);
    return () => {
      window.removeEventListener(NOTIFY_EVENT, onNotice);
      window.removeEventListener(CLEAR_ERRORS_EVENT, onClearErrors);
      for (const t of timers) clearTimeout(t);
    };
  }, [drop, zhReader]);

  /* `requireModule` sends someone without a module to where they can work,
     with `?denied=<module>`; this says why, then tidies the address
     (QA, 2 Oct: the redirect used to be silent). */
  const pathname = usePathname();
  useEffect(() => {
    const url = new URL(window.location.href);
    const denied = url.searchParams.get("denied");
    if (!denied) return;
    url.searchParams.delete("denied");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const zh = !document.documentElement.lang.startsWith("en");
    const name = MODULE_ZH[denied];
    notifyRich({
      kind: "info",
      title: zh ? (name ? `你还没有「${name}」的权限` : "你还没有这个模块的权限") : "You do not have access to that module",
      text: zh ? "需要的话，可以请管理员帮你开通。" : "Ask an admin if you need it.",
      hold: 9000,
    });
  }, [pathname]);

  if (!notices.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 220,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 380,
      }}
    >
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.kind === "error" ? "alert" : "status"}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "11px 12px",
            borderRadius: 11,
            border: `1px solid ${n.kind === "error" ? "#ffd6d6" : n.kind === "ok" ? "#cdeed9" : "#ededed"}`,
            background: n.kind === "error" ? "#fff7f7" : n.kind === "ok" ? "#f4fcf7" : "#ffffff",
            boxShadow: "0 8px 28px rgba(23,23,23,0.13)",
            animation: "fadeUp .18s cubic-bezier(.32,.72,0,1) both",
          }}
        >
          <Glyph kind={n.kind} />
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            {n.title ? <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.45, color: n.kind === "error" ? "#8a2b2b" : "#171717", overflowWrap: "anywhere" }}>{n.title}</span> : null}
            {n.text ? (
              <span
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: n.kind === "error" ? "#8a2b2b" : "#383838",
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {n.text}
              </span>
            ) : null}
            {n.actions?.length ? (
              <span style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                {n.actions.map((a, i) => {
                  const style: React.CSSProperties = {
                    display: "inline-flex",
                    alignItems: "center",
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: "none",
                    border: `1px solid ${i === 0 ? "#171717" : "#e2e2e2"}`,
                    background: i === 0 ? "#171717" : "#ffffff",
                    color: i === 0 ? "#ffffff" : "#171717",
                  };
                  return a.download ? (
                    <a key={a.label} href={a.href} style={style} onClick={() => drop(n.id)}>
                      {a.label}
                    </a>
                  ) : (
                    <Link key={a.label} href={a.href} prefetch={false} style={style} onClick={() => drop(n.id)}>
                      {a.label}
                    </Link>
                  );
                })}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => drop(n.id)}
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              width: 18,
              height: 18,
              padding: 0,
              border: 0,
              borderRadius: 5,
              background: "transparent",
              cursor: "pointer",
              color: "#c7c7c7",
              lineHeight: 0,
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.1, strokeLinecap: "round" }}>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function Glyph({ kind }: { kind: Notice["kind"] }) {
  const stroke = kind === "error" ? "#e03636" : kind === "ok" ? "#278f5e" : "#7c7c7c";
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, stroke, fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
    >
      <circle cx="12" cy="12" r="8.6" />
      {kind === "ok" ? <path d="m8.4 12.2 2.6 2.6 4.8-5" /> : <path d="M12 7.8v5M12 16.1h.01" />}
    </svg>
  );
}
