"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LoginChrome } from "../chrome";
import { cancelSecondFactor, verifySecondFactor, type VerifyState } from "../actions";

/* The same object on every server pass: the derive-during-render below
   compares by identity, and a fresh `{}` per render would never settle. */
const NOTHING_YET = {} as const;

/**
 * Two-step verification, transcribed from design/canvas/Login-Totp.dc.html.
 *
 * The six boxes are one hidden input and six drawn cells rather than six real
 * inputs. Six inputs is the usual way and it is the reason these screens are
 * so unpleasant: paste lands in one box, backspace has to hop between fields,
 * and password managers fill the first cell and stop. One field autocompleted
 * with `one-time-code` gets the code off an iPhone's keyboard in a tap.
 *
 * The countdown is the artboard's "Code refreshes in 18 s", driven by the
 * clock rather than hard-coded — its only job is to tell somebody whose code
 * has just turned over to wait for the next one rather than retype the same
 * digits.
 */
export function VerifyForm({ email, recoveryLeft }: { email: string; recoveryLeft: number }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifySecondFactor, NOTHING_YET);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [trust, setTrust] = useState(true);
  const [left, setLeft] = useState(30);
  const box = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const tick = () => setLeft(30 - Math.floor((Date.now() / 1000) % 30));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  // Six digits and the form goes: nobody wants to reach for a button after
  // typing the last one. The guard stops a re-submit while one is in flight.
  useEffect(() => {
    if (recovery || pending) return;
    if (code.length === 6) form.current?.requestSubmit();
  }, [code, recovery, pending]);

  /* A refused code clears the boxes, so the next attempt starts from empty
     rather than from six digits somebody has to delete first. Derived during
     render rather than in an effect — the alternative renders the old digits
     once and then blanks them. */
  const [lastResult, setLastResult] = useState<VerifyState | null>(null);
  if (state !== lastResult) {
    setLastResult(state);
    // Compared by identity, not by message: two wrong codes in a row produce
    // the same words, and the second one must still clear the boxes.
    if (state.error && code.length === 6) setCode("");
  }

  const cells = Array.from({ length: 6 }, (_, i) => code[i] ?? "");

  return (
    <LoginChrome footerLeft={(zh) => (zh ? "30 天无操作后自动退出登录" : "Sessions expire after 30 days of inactivity")}>
      {({ zh, t }) => (
        <form ref={form} action={action} style={{ width: 380 }}>
          <button
            type="button"
            onClick={() => void cancelSecondFactor()}
            style={{
              fontSize: 12.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "#525252",
              border: 0,
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              font: "inherit",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round" }}
            >
              <path d="m14.5 5.5-7 6.5 7 6.5" />
            </svg>
            {zh ? "返回" : "Back"}
          </button>

          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 15,
              background: "#f3f3f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 22,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              style={{
                width: 24,
                height: 24,
                stroke: "#383838",
                fill: "none",
                strokeWidth: 1.7,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              }}
            >
              <rect x="6.5" y="3" width="11" height="18" rx="2.2" />
              <path d="M11 17.5h2" />
            </svg>
          </div>

          <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 18 }}>
            {zh ? "两步验证" : "Two-step verification"}
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "#7c7c7c", marginTop: 8 }}>
            {recovery ? (
              zh ? (
                <>
                  输入你保存的其中一个恢复码，用于 <b style={{ fontWeight: 500, color: "#383838" }}>{email}</b>。每个恢复码只能用一次。
                </>
              ) : (
                <>
                  Enter one of the recovery codes you saved for{" "}
                  <b style={{ fontWeight: 500, color: "#383838" }}>{email}</b>. Each one works once.
                </>
              )
            ) : zh ? (
              <>
                输入验证器应用为 <b style={{ fontWeight: 500, color: "#383838" }}>{email}</b> 生成的 6 位验证码。
              </>
            ) : (
              <>
                Enter the 6-digit code from your authenticator app for{" "}
                <b style={{ fontWeight: 500, color: "#383838" }}>{email}</b>.
              </>
            )}
          </p>

          {recovery ? (
            <>
              <input
                name="code"
                required
                autoFocus
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="abcde-fghij"
                style={{
                  /* `.fld` is a flex row meant to hold an input; this *is*
                     the input, so it carries the same box itself. */
                  width: "100%",
                  height: 44,
                  marginTop: 24,
                  padding: "0 13px",
                  border: "1px solid #d9d9d9",
                  borderRadius: 10,
                  background: "#fff",
                  color: "#171717",
                  outline: "none",
                  fontSize: 15,
                  letterSpacing: "0.08em",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              />
              {recoveryLeft === 0 ? (
                <p style={{ fontSize: 12, color: "#b52a2a", marginTop: 10 }}>
                  {zh
                    ? "这个账号没有未使用的恢复码。请联系管理员。"
                    : "This account has no unused recovery codes left. Ask an admin."}
                </p>
              ) : null}
            </>
          ) : (
            <div
              style={{ display: "flex", gap: 9, marginTop: 26, alignItems: "center", position: "relative" }}
              onClick={() => box.current?.focus()}
            >
              {/* The real field: one input, offscreen but focusable, so paste,
                  autofill and the phone keyboard's code suggestion all work. */}
              <input
                ref={box}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-label={zh ? "6 位验证码" : "6-digit code"}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                  border: 0,
                  padding: 0,
                  font: "inherit",
                  cursor: "default",
                }}
              />
              {cells.map((digit, i) => (
                <div key={i} style={{ display: "contents" }}>
                  {i === 3 ? (
                    <span style={{ width: 10, height: 2, background: "#c7c7c7", borderRadius: 1 }} />
                  ) : null}
                  <div
                    className="otp"
                    style={{
                      borderColor: code.length === i ? "#2b7fff" : "#d9d9d9",
                      boxShadow: code.length === i ? "0 0 0 3px #EFF6FF" : "none",
                      color: digit ? "#171717" : "#c7c7c7",
                    }}
                  >
                    {digit || "·"}
                  </div>
                </div>
              ))}
            </div>
          )}

          <label
            style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              name="trust"
              checked={trust}
              onChange={(e) => setTrust(e.target.checked)}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
            />
            <span
              aria-hidden
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: trust ? "#171717" : "#ffffff",
                border: trust ? "1px solid #171717" : "1px solid #d9d9d9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {trust ? (
                <svg
                  viewBox="0 0 16 16"
                  style={{ width: 11, height: 11, stroke: "#fff", fill: "none", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}
                >
                  <path d="M3.6 8.3 6.5 11.2 12.4 5.1" />
                </svg>
              ) : null}
            </span>
            <span style={{ fontSize: 13, color: "#525252" }}>
              {zh ? "记住此浏览器 30 天" : "Trust this browser for 30 days"}
            </span>
          </label>

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
            {pending ? (zh ? "验证中…" : "Verifying…") : zh ? "验证" : "Verify"}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 12.5 }}>
            <span style={{ color: "#999999" }}>
              {recovery
                ? zh
                  ? "恢复码用过即失效"
                  : "A recovery code works once"
                : zh
                  ? `验证码将在 ${left} 秒后刷新`
                  : `Code refreshes in ${left} s`}
            </span>
            <button
              type="button"
              onClick={() => {
                setRecovery((v) => !v);
                setCode("");
                /* A recovery code means the phone is not to hand, so the
                   browser is not a thing to trust on the strength of it. */
                if (!recovery) setTrust(false);
              }}
              style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", font: "inherit", color: "#007be0" }}
            >
              {recovery
                ? zh
                  ? "改用验证器应用"
                  : "Use your authenticator app"
                : zh
                  ? "使用恢复码"
                  : "Use a recovery code"}
            </button>
          </div>
        </form>
      )}
    </LoginChrome>
  );
}
