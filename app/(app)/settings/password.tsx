"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "./actions";

/**
 * Changing your own password.
 *
 * Until this existed the only way to change one was for an operator to run a
 * script and read the new password out — which meant the studio's passwords
 * were only ever as private as a terminal. The current password is required,
 * so someone who walks up to an unlocked screen cannot lock the owner out of
 * their own account.
 */
export function PasswordCard({ zh }: { zh: boolean }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePasswordAction, {});

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-gray-9">{zh ? "修改密码" : "Change password"}</h2>

      <form action={action} className="flex max-w-[360px] flex-col gap-2">
        <label className="text-xs text-ink-gray-6" htmlFor="current">
          {zh ? "当前密码" : "Current password"}
        </label>
        <input
          id="current"
          name="current"
          type="password"
          required
          autoComplete="current-password"
          className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none focus:border-outline-gray-4"
        />

        <label className="mt-2 text-xs text-ink-gray-6" htmlFor="next">
          {zh ? "新密码（至少 12 个字符）" : "New password (at least 12 characters)"}
        </label>
        <input
          id="next"
          name="next"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none focus:border-outline-gray-4"
        />

        {state.error && (
          <p role="alert" className="mt-1 text-xs text-ink-red-3">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="mt-1 text-xs text-ink-green-3">
            {zh
              ? "已更新。其他设备上的登录已全部退出。"
              : "Updated. Every other signed-in device has been signed out."}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-9 w-fit rounded-lg bg-surface-gray-7 px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
        </button>
      </form>
    </section>
  );
}
