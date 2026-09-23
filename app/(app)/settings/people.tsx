"use client";

import { useState, useTransition } from "react";
import { MODULES, type Module } from "@/lib/db/schema";
import { inviteAction, revokeInviteAction } from "@/app/(app)/chat/invite-actions";

/**
 * Inviting colleagues, until the Admin module exists.
 *
 * `invites` has been a table since the first migration with nothing writing to
 * it: the only way to add anybody was `npm run db:add-user` over SSH, so the
 * studio's own owner could not add their own staff. This is the smallest
 * honest version of that, in the product, behind the same owner/admin check
 * the action re-applies on the server.
 *
 * It does not claim to send anything. No mail provider is configured on this
 * deployment, so the link comes back here to be passed on. A screen that said
 * "invitation sent" would be a screen telling a lie.
 */
type Sent = { email: string; link: string; expiresAt: string };

type InviteRow = {
  id: string;
  email: string;
  role: string;
  modules: Module[];
  expiresAt: string;
  acceptedAt: string | null;
};

export function PeopleCard({ zh, initialInvites }: { zh: boolean; initialInvites: InviteRow[] }) {
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");
  const [modules, setModules] = useState<Module[]>(["chat", "files"]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [rows, setRows] = useState(initialInvites);
  const [copied, setCopied] = useState(false);

  function submit() {
    setError(null);
    setSent(null);
    start(async () => {
      const res = await inviteAction({ email, name, role, modules });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSent({ email: res.email, link: res.link, expiresAt: res.expiresAt });
      setRows((cur) => [
        { id: res.id, email: res.email, role: res.role, modules, expiresAt: res.expiresAt, acceptedAt: null },
        ...cur.filter((r) => r.email !== res.email),
      ]);
      setEmail("");
      setName("");
    });
  }

  return (
    <section className="rounded-xl border border-outline-gray-1 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-ink-gray-9">{zh ? "同事" : "People"}</h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto h-8 rounded-lg border border-outline-gray-2 px-3 text-xs font-medium text-ink-gray-7 hover:bg-surface-gray-2"
        >
          {open ? (zh ? "收起" : "Close") : zh ? "邀请" : "Invite someone"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={zh ? "邮箱地址" : "Their email address"}
            className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={zh ? "姓名（可留空）" : "Their name (optional)"}
            className="h-9 rounded-lg border border-outline-gray-2 px-3 text-sm outline-none"
          />

          <div className="mt-1 flex gap-1.5">
            {(["admin", "member", "guest"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`h-7 rounded-lg px-3 text-xs ${
                  role === r ? "bg-surface-gray-7 text-white" : "border border-outline-gray-2 text-ink-gray-6"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <p className="mt-2 text-xs text-ink-gray-5">
            {zh ? "他们可以打开的模块" : "What they may open"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MODULES.map((m) => {
              const on = modules.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModules((cur) => (on ? cur.filter((x) => x !== m) : [...cur, m]))}
                  className={`h-7 rounded-lg px-2.5 text-xs ${
                    on ? "bg-surface-gray-7 text-white" : "border border-outline-gray-2 text-ink-gray-6"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !email.trim() || modules.length === 0}
            className="mt-2 h-9 self-start rounded-lg bg-surface-gray-7 px-4 text-sm font-medium text-white disabled:opacity-45"
          >
            {busy ? (zh ? "创建中…" : "Creating…") : zh ? "创建邀请链接" : "Create the invitation"}
          </button>
        </div>
      )}

      {sent && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            {zh
              ? "这个部署还没有配置邮件服务，所以系统没有发送任何邮件。把下面的链接发给他们：打开链接后，他们自己填写姓名并设置密码，随后直接登录。链接 14 天内有效，只能用一次。"
              : "No mail provider is configured on this deployment, so nothing was sent. Pass this link on yourself: they open it, type their name, choose their own password and are signed in. It works once and expires in 14 days."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-white px-2 py-1 text-[11px] text-ink-gray-7">
              {sent.link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(sent.link);
                setCopied(true);
              }}
              className="h-7 shrink-0 rounded-lg border border-outline-gray-2 bg-white px-2.5 text-xs text-ink-gray-7"
            >
              {copied ? (zh ? "已复制" : "Copied") : zh ? "复制" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-t border-outline-gray-1 py-2 text-xs">
              <span className="text-ink-gray-8">{r.email}</span>
              <span className="text-ink-gray-5">{r.role}</span>
              <span className="ml-auto text-ink-gray-5">
                {r.acceptedAt
                  ? zh
                    ? "已加入"
                    : "joined"
                  : zh
                    ? `有效期至 ${r.expiresAt.slice(0, 10)}`
                    : `expires ${r.expiresAt.slice(0, 10)}`}
              </span>
              {!r.acceptedAt && (
                <button
                  type="button"
                  onClick={() =>
                    start(async () => {
                      await revokeInviteAction(r.id);
                      setRows((cur) => cur.filter((x) => x.id !== r.id));
                    })
                  }
                  className="text-ink-gray-5 hover:text-red-600"
                >
                  {zh ? "撤销" : "revoke"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
