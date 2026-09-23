"use client";

import { useActionState, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { LoginChrome } from "./chrome";
import { signIn, type LoginState } from "./actions";

/**
 * Sign-in, transcribed from design/canvas/Login.dc.html: the 660px left panel
 * with the cover collage and the claim, the right column with the form.
 *
 * One honest departure from the artboard remains. It shows a single-sign-on
 * link; OIDC is not wired, and a sign-in screen is the last place to imply
 * security that is not there. The artboard's other promise — a 6-digit code
 * after the password — is real now: anyone who has enrolled an authenticator
 * in Settings is sent to /login/verify from here.
 */
export function LoginForm({ locale }: { locale?: Locale | null }) {
  const [focused, setFocused] = useState<"email" | "password" | null>("email");
  const [reveal, setReveal] = useState(false);
  /* Kept across a refused attempt. React resets a form once its action
     returns, which emptied the address along with the password: after one
     typo somebody had to type their email again as well. The password box
     clearing is right; the address clearing was not. */
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <LoginChrome locale={locale}>
      {({ zh, t }) => (
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
      )}
    </LoginChrome>
  );
}
