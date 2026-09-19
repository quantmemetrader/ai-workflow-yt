"use client";

import { useActionState, useState } from "react";
import { makeT, type Locale } from "@/lib/i18n";
import { signIn, type LoginState } from "./actions";

/**
 * Sign-in, transcribed from design/canvas/Login.dc.html: the 660px left panel
 * with the cover collage and the claim, the right column with the form.
 *
 * Two honest departures from the artboard. It shows a single-sign-on link and
 * a line promising a 6-digit code after the password; neither exists yet, and
 * a sign-in screen is the last place to imply security that is not there. They
 * come back the day OIDC and TOTP are wired. The footer states this build's
 * real session policy, not the artboard's placeholder.
 */
const COVERS = [
  { src: "/app/cover-history.jpg", marginTop: 0 },
  { src: "/app/cover-porsche.jpg", marginTop: 22 },
  { src: "/app/cover-orange.jpg", marginTop: 0 },
  { src: "/app/cover-goodday.jpg", marginTop: -22 },
  { src: "/app/cover-domore.jpg", marginTop: 0 },
];

export function LoginForm() {
  // Read once, lazily, on the client. An effect would render the default
  // first and then swap the language out from under the reader.
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh-CN";
    try {
      return (window.localStorage.getItem("af-lang") as Locale | null) ?? "zh-CN";
    } catch {
      // Private windows and blocked storage both throw rather than return null.
      return "zh-CN";
    }
  });
  const [focused, setFocused] = useState<"email" | "password" | null>("email");
  const [reveal, setReveal] = useState(false);
  const t = makeT(locale);
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  function choose(next: Locale) {
    setLocale(next);
    try {
      window.localStorage.setItem("af-lang", next);
    } catch {
      // Not being able to remember the choice is not worth an error.
    }
  }

  const zh = locale.startsWith("zh");

  return (
    <div
      className="scr"
      style={{
        width: "100%",
        minHeight: "100dvh",
        display: "flex",
        background: "#ffffff",
        color: "#171717",
        fontFamily: "Inter, system-ui, sans-serif",
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
          <span style={{ fontSize: 15, fontWeight: 600 }}>Aura Farmers</span>
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
          <form action={action} style={{ width: 380 }}>
            <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>{t("Sign in")}</div>
            <p style={{ fontSize: 14, color: "#7c7c7c", marginTop: 7 }}>
              {zh ? "使用你的光环农夫工作账号。" : "Use your Aura Farmers work account."}
            </p>

            <div className="flbl" style={{ marginTop: 28 }}>
              <label htmlFor="email">{t("Work email")}</label>
            </div>
            <div className={`fld${focused === "email" ? " focus" : ""}`}>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="username"
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                placeholder="name@aurafarmers.hk"
                style={{
                  width: "100%",
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  font: "inherit",
                  color: "#171717",
                }}
              />
            </div>

            <div className="flbl" style={{ marginTop: 16 }}>
              <label htmlFor="password">{t("Password")}</label>
            </div>
            <div className={`fld${focused === "password" ? " focus" : ""}`}>
              <input
                id="password"
                name="password"
                type={reveal ? "text" : "password"}
                required
                autoComplete="current-password"
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                style={{
                  width: "100%",
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  font: "inherit",
                  letterSpacing: reveal ? "inherit" : ".22em",
                  color: "#525252",
                }}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={zh ? "显示密码" : "Show password"}
                style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, display: "flex" }}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 17,
                    height: 17,
                    stroke: "#999999",
                    fill: "none",
                    strokeWidth: 1.7,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>

            {state.error && (
              <p
                role="alert"
                style={{
                  marginTop: 14,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #fdc2c2",
                  background: "#fff7f7",
                  color: "#b52a2a",
                  fontSize: 12.5,
                }}
              >
                {t(state.error)}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              style={{
                height: 46,
                width: "100%",
                marginTop: 22,
                borderRadius: 11,
                border: 0,
                background: "#007be0",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "inherit",
                letterSpacing: "inherit",
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? t("Signing in…") : zh ? "继续" : "Continue"}
            </button>
          </form>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#999999" }}>
          <span>{zh ? "30 天不活动后自动退出" : "Sessions expire after 30 days of inactivity"}</span>
          <span>{zh ? "每次读取都按你的权限过滤" : "Every read is filtered to your own permissions"}</span>
        </div>
      </div>
    </div>
  );
}
