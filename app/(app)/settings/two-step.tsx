"use client";

import { useActionState, useState, useTransition } from "react";
import {
  beginTotpAction,
  confirmTotpAction,
  disableTotpAction,
  forgetAllDevicesAction,
  forgetDeviceAction,
  newRecoveryCodesAction,
  type TotpBeginState,
  type TotpConfirmState,
  type TotpOffState,
} from "./actions";

/*
 * One object, not a fresh `{}` per render. The "derive state during render"
 * below compares the action's state by identity; on the server React hands
 * back the initial argument on every pass, so an inline literal is a new
 * object each time and the comparison never settles ("Too many re-renders"
 * on /settings). A module constant is the same object every pass.
 */
const NOTHING_YET = {} as const;

/**
 * Two-step verification, from this person's own side.
 *
 * The screen is a small state machine — off, setting up, on — and it is
 * written as one rather than as three cards, because the middle state is the
 * one people get lost in: a QR on screen, an account that is *not* protected
 * yet, and a code that has to be typed before it is.
 *
 * The recovery codes appear exactly once, at the moment they are made. There
 * is no "show them again" because there is nothing to show: the server keeps
 * hashes. The copy button and the reissue button are the two honest answers
 * to "I lost them".
 */
type Device = { id: string; label: string | null; ip: string | null; lastSeenAt: string; expiresAt: string };

export function TwoStepCard({
  zh,
  enabled,
  enrolledAt,
  recoveryLeft,
  devices,
}: {
  zh: boolean;
  enabled: boolean;
  enrolledAt: string | null;
  recoveryLeft: number;
  devices: Device[];
}) {
  const [setup, setSetup] = useState<TotpBeginState | null>(null);
  const [starting, startBegin] = useTransition();
  const [confirm, confirmAction, confirming] = useActionState<TotpConfirmState, FormData>(confirmTotpAction, NOTHING_YET);
  const [off, offAction, turningOff] = useActionState<TotpOffState, FormData>(disableTotpAction, NOTHING_YET);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [reissuing, startReissue] = useTransition();
  const [forgetting, startForget] = useTransition();
  const [showOff, setShowOff] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Controlled, because React resets an uncontrolled form after an action
     returns — so a refused code wiped the field out from under whoever was
     retyping it. */
  const [typed, setTyped] = useState("");
  /* Same reason, for the password that turns it off: React resets the form
     after the action returns, which emptied the field mid-retype. Cleared
     deliberately when the password was wrong. */
  const [offPassword, setOffPassword] = useState("");
  const [lastOff, setLastOff] = useState<TotpOffState | null>(null);
  if (off !== lastOff) {
    setLastOff(off);
    if (off.error) setOffPassword("");
  }

  // The codes arrive from either the confirm form or the reissue button.
  const visible = confirm.codes ?? codes;

  const t = (en: string, cn: string) => (zh ? cn : en);

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-gray-9">{t("Two-step verification", "两步验证")}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] ${
            enabled ? "bg-surface-green-1 text-ink-green-3" : "bg-surface-gray-2 text-ink-gray-6"
          }`}
        >
          {enabled ? t("on", "已开启") : t("off", "未开启")}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-ink-gray-5">
        {enabled
          ? t(
              `A code from your authenticator app is asked for when you sign in on a browser you have not trusted.${
                enrolledAt ? ` Turned on ${enrolledAt}.` : ""
              }`,
              `在未信任的浏览器登录时，会要求输入验证器应用中的验证码。${enrolledAt ? `开启于 ${enrolledAt}。` : ""}`,
            )
          : t(
              "A password alone is one thing to lose. With this on, signing in also needs a 6-digit code from your phone.",
              "仅有密码，丢了就是丢了。开启后，登录还需要手机上的 6 位验证码。",
            )}
      </p>

      {/* ---------------------------------------------------------- off */}
      {!enabled && !setup && (
        <button
          type="button"
          disabled={starting}
          onClick={() =>
            startBegin(async () => {
              setSetup(await beginTotpAction());
            })
          }
          className="h-8 rounded-lg bg-ink-gray-9 px-3 text-xs text-white disabled:opacity-50"
        >
          {starting ? t("Preparing…", "准备中…") : t("Set this up", "开始设置")}
        </button>
      )}

      {/* ------------------------------------------------------ setting up */}
      {!enabled && setup && !visible && (
        <div className="flex flex-col gap-3">
          {setup.error ? (
            <p role="alert" className="text-xs text-ink-red-3">
              {setup.error}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start gap-4">
                <div
                  className="shrink-0 rounded-xl border border-outline-gray-1 bg-white p-3"
                  /* The QR is built on the server from the seed; it never
                     leaves this response. */
                  dangerouslySetInnerHTML={{ __html: setup.qrSvg ?? "" }}
                />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-xs leading-relaxed text-ink-gray-6">
                    {t(
                      "Scan this with Google Authenticator, 1Password, Authy — any app that does 6-digit codes.",
                      "用 Google Authenticator、1Password、Authy 等任意支持 6 位验证码的应用扫描。",
                    )}
                  </p>
                  <p className="mt-2 text-[11px] text-ink-gray-5">{t("Or type this key in by hand:", "或手动输入密钥：")}</p>
                  <code className="mt-1 block break-all rounded-lg bg-surface-gray-2 px-2 py-1.5 font-mono text-[11.5px] text-ink-gray-8">
                    {setup.secret}
                  </code>
                </div>
              </div>

              <form action={confirmAction} className="flex flex-wrap items-center gap-2">
                <input
                  name="code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  aria-label={t("6-digit code", "6 位验证码")}
                  className="h-8 w-28 rounded-lg border border-outline-gray-2 px-2.5 font-mono text-sm tracking-[0.2em] outline-none focus:border-outline-gray-4"
                />
                <button
                  type="submit"
                  disabled={confirming || typed.length !== 6}
                  className="h-8 rounded-lg bg-ink-gray-9 px-3 text-xs text-white disabled:opacity-50"
                >
                  {confirming ? t("Checking…", "验证中…") : t("Turn it on", "开启")}
                </button>
                <button
                  type="button"
                  onClick={() => setSetup(null)}
                  className="h-8 rounded-lg border border-outline-gray-2 px-3 text-xs text-ink-gray-7"
                >
                  {t("Cancel", "取消")}
                </button>
                {confirm.error ? (
                  <span role="alert" className="text-xs text-ink-red-3">
                    {confirm.error}
                  </span>
                ) : null}
              </form>
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------- recovery codes */}
      {visible && (
        <div className="rounded-xl border border-outline-amber-2 bg-surface-amber-1 p-3">
          <p className="text-xs font-medium text-ink-gray-9">
            {t("Save these recovery codes now", "现在保存这些恢复码")}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-gray-6">
            {t(
              "Each one signs you in once if your phone is not to hand. This is the only time they are shown — the server keeps only hashes of them.",
              "手机不在身边时，每个恢复码可登录一次。它们只显示这一次——服务器只保存其哈希值。",
            )}
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12.5px] text-ink-gray-8">
            {visible.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(visible.join("\n")).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
              className="h-7 rounded-lg border border-outline-gray-2 bg-white px-2.5 text-[11px] text-ink-gray-7"
            >
              {copied ? t("Copied", "已复制") : t("Copy", "复制")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCodes(null);
                setSetup(null);
              }}
              className="h-7 rounded-lg bg-ink-gray-9 px-2.5 text-[11px] text-white"
            >
              {t("I have saved them", "我已保存")}
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- on */}
      {enabled && !visible && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-gray-6">
              {recoveryLeft === 0
                ? t("No recovery codes left.", "没有可用的恢复码。")
                : t(`${recoveryLeft} recovery codes left.`, `剩余 ${recoveryLeft} 个恢复码。`)}
            </span>
            <button
              type="button"
              disabled={reissuing}
              onClick={() =>
                startReissue(async () => {
                  const res = await newRecoveryCodesAction();
                  if (res.codes) setCodes(res.codes);
                })
              }
              className="h-7 rounded-lg border border-outline-gray-2 px-2.5 text-[11px] text-ink-gray-7 disabled:opacity-50"
            >
              {reissuing ? t("Making…", "起草中…") : t("New codes", "重新生成")}
            </button>
          </div>

          {devices.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-ink-gray-6">
                {t("Browsers that skip the code", "跳过验证码的浏览器")}
              </p>
              <ul className="flex flex-col gap-1">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-[11.5px] text-ink-gray-7">
                    <span className="min-w-0 flex-1 truncate">
                      {d.label ?? t("a browser", "某个浏览器")}
                      {d.ip ? ` · ${d.ip}` : ""} · {t("until", "有效至")} {d.expiresAt}
                    </span>
                    <button
                      type="button"
                      disabled={forgetting}
                      onClick={() => startForget(async () => void (await forgetDeviceAction(d.id)))}
                      className="shrink-0 text-[11px] text-ink-gray-5 underline-offset-2 hover:underline"
                    >
                      {t("Forget", "移除")}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={forgetting}
                onClick={() => startForget(async () => void (await forgetAllDevicesAction()))}
                className="mt-1.5 h-7 rounded-lg border border-outline-gray-2 px-2.5 text-[11px] text-ink-gray-7 disabled:opacity-50"
              >
                {t("Ask on every browser", "所有浏览器都要求验证")}
              </button>
            </div>
          )}

          {showOff ? (
            <form action={offAction} className="flex flex-wrap items-center gap-2">
              <input
                name="password"
                type="password"
                required
                value={offPassword}
                onChange={(e) => setOffPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={t("Your password", "你的密码")}
                aria-label={t("Your password", "你的密码")}
                className="h-8 w-48 rounded-lg border border-outline-gray-2 px-2.5 text-sm outline-none focus:border-outline-gray-4"
              />
              <button
                type="submit"
                disabled={turningOff || offPassword.length === 0}
                className="h-8 rounded-lg border border-outline-red-2 px-3 text-xs text-ink-red-3 disabled:opacity-50"
              >
                {turningOff ? t("Turning off…", "关闭中…") : t("Turn off", "关闭")}
              </button>
              <button
                type="button"
                onClick={() => setShowOff(false)}
                className="h-8 rounded-lg px-2 text-xs text-ink-gray-6"
              >
                {t("Keep it on", "保持开启")}
              </button>
              {off.error ? (
                <span role="alert" className="text-xs text-ink-red-3">
                  {off.error}
                </span>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowOff(true)}
              className="self-start text-xs text-ink-gray-5 underline-offset-2 hover:underline"
            >
              {t("Turn two-step verification off", "关闭两步验证")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
