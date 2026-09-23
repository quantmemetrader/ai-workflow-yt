"use client";

import { useState } from "react";
import { LANG_COOKIE, makeT, type Locale } from "@/lib/i18n";

/**
 * Everything around the sign-in form: the 660px cover panel, the language
 * switch and the two footer lines.
 *
 * Extracted because there are two screens inside it now — the password and
 * the 6-digit code — and the artboards draw exactly the same frame around
 * both. A second copy would be a second place for the covers to drift.
 *
 * The language choice lives here, since it is the chrome's own control, and
 * is handed down to whatever is inside.
 */
const COVERS = [
  { src: "/app/cover-history.jpg", marginTop: 0 },
  { src: "/app/cover-porsche.jpg", marginTop: 22 },
  { src: "/app/cover-orange.jpg", marginTop: 0 },
  { src: "/app/cover-goodday.jpg", marginTop: -22 },
  { src: "/app/cover-domore.jpg", marginTop: 0 },
];

export function LoginChrome({
  children,
  footerLeft,
  locale: remembered,
}: {
  children: (ctx: { locale: Locale; zh: boolean; t: (key: string) => string }) => React.ReactNode;
  /** The session policy line, which differs between the two screens. */
  footerLeft?: (zh: boolean) => React.ReactNode;
  /** What the last person to sign in on this browser reads in, from the
   * cookie sign-in leaves behind. Beats the browser's own memory, which is
   * only ever a guess made on this screen. */
  locale?: Locale | null;
}) {
  // Read once, lazily, on the client. An effect would render the default
  // first and then swap the language out from under the reader.
  const [locale, setLocale] = useState<Locale>(() => {
    if (remembered) return remembered;
    if (typeof window === "undefined") return "zh-CN";
    try {
      return (window.localStorage.getItem(LANG_COOKIE) as Locale | null) ?? "zh-CN";
    } catch {
      // Private windows and blocked storage both throw rather than return null.
      return "zh-CN";
    }
  });
  const t = makeT(locale);
  const zh = locale.startsWith("zh");

  function choose(next: Locale) {
    setLocale(next);
    try {
      /* Only this browser's memory. The cookie the server reads is written
         by signing in and by the language control in Settings — both know
         *whose* language it is, which a choice made on a sign-in screen by
         somebody not yet identified does not. */
      window.localStorage.setItem(LANG_COOKIE, next);
    } catch {
      // Not being able to remember the choice is not worth an error.
    }
  }

  return (
    <div
      className="scr"
      style={{
        width: "100%",
        minHeight: "100dvh",
        display: "flex",
        background: "#ffffff",
        color: "#171717",
        fontFamily: "Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif",
        fontWeight: 420,
        letterSpacing: "0.02em",
      }}
    >
      {/* left panel */}
      <div
        style={{
          width: 660,
          flexShrink: 0,
          background: "#f8f8f8",
          borderRight: "1px solid #ededed",
          display: "flex",
          flexDirection: "column",
          padding: "44px 52px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "#171717",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            AF
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>腾亚创变</span>
        </div>

        <div style={{ marginTop: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0,1fr))",
              gap: 10,
              transform: "rotate(-3deg)",
              margin: "0 -8px 44px",
            }}
          >
            {COVERS.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={c.src}
                src={c.src}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "16/10",
                  objectFit: "cover",
                  borderRadius: 12,
                  boxShadow: "0 2px 8px 1px rgba(5,5,6,.07)",
                  marginTop: c.marginTop,
                }}
              />
            ))}
            {/* The artboard filled this sixth tile with "1.28M views · last 28
                days". Nobody is signed in yet, so there is no figure to show
                and an invented one is the first thing a new employee would
                read. The tile carries the claim instead. */}
            <div
              style={{
                width: "100%",
                aspectRatio: "16/10",
                borderRadius: 12,
                background: "#fff",
                border: "1px solid #ededed",
                marginTop: -22,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: "0 16px",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, textWrap: "pretty" }}>
                {zh ? "工作室的片、剧本与素材，都在一处。" : "Every video, script and asset, in one place."}
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              maxWidth: 460,
              textWrap: "pretty",
            }}
          >
            {zh
              ? "一个工作台，管好每一条片、每一份剧本、每一个助理。"
              : "One workspace for every video, every script, and every agent."}
          </div>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "#7c7c7c",
              marginTop: 12,
              maxWidth: 440,
              textWrap: "pretty",
            }}
          >
            {zh
              ? "助理的权限与你完全一致：它读取、引用或发布的一切，你自己都能打开。"
              : "Your agent works with exactly your permissions — nothing it reads, cites or posts is anything you couldn’t open yourself."}
          </p>
        </div>
      </div>

      {/* right column */}
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", padding: "32px 44px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 3,
              borderRadius: 9,
              background: "#f3f3f3",
              fontSize: 12,
            }}
          >
            {(
              [
                ["zh-CN", "简体中文"],
                ["en", "English"],
              ] as [Locale, string][]
            ).map(([value, label]) => {
              const on = locale === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(value)}
                  style={{
                    padding: "4px 11px",
                    borderRadius: 6,
                    border: 0,
                    cursor: "pointer",
                    font: "inherit",
                    background: on ? "#fff" : "transparent",
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
                    fontWeight: on ? 500 : 400,
                    color: on ? "#171717" : "#7c7c7c",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {children({ locale, zh, t })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#999999" }}>
          <span>{footerLeft ? footerLeft(zh) : zh ? "30 天不活动后自动退出" : "Sessions expire after 30 days of inactivity"}</span>
          <span>{zh ? "每次读取都按你的权限过滤" : "Every read is filtered to your own permissions"}</span>
        </div>
      </div>
    </div>
  );
}
