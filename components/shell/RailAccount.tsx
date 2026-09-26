"use client";

import Link from "next/link";
import { Tr } from "@/components/ui/Tr";
import type { Viewer } from "@/lib/auth/types";

/**
 * Who is signed in, at the foot of the rail.
 *
 * The owner wanted the account where people look for it in a sidebar app —
 * at the bottom, beside 历史记录 and 收起 — as well as in the top bar. The
 * same target as the top bar's (Settings, where the picture, the name and
 * the role are changed), so the two can never disagree. Collapsed, it is
 * just the picture.
 */
export type RailAccountInfo = {
  name: string;
  nameLocal: string | null;
  role: Viewer["role"];
  avatarUrl: string | null;
};

const ROLE: Record<Viewer["role"], { zh: string; en: string; bg: string; fg: string }> = {
  owner: { zh: "所有者", en: "Owner", bg: "#171717", fg: "#ffffff" },
  admin: { zh: "管理员", en: "Admin", bg: "#e6f4ff", fg: "#0060b0" },
  member: { zh: "成员", en: "Member", bg: "#f3f3f3", fg: "#525252" },
  guest: { zh: "访客", en: "Guest", bg: "#fff7d3", fg: "#a35f00" },
};

export function RailAccount({ account, zh, wide }: { account: RailAccountInfo; zh: boolean; wide: boolean }) {
  const who = (zh ? account.nameLocal : null) || account.name;
  const role = ROLE[account.role];
  return (
    <Link
      href="/settings"
      prefetch={false}
      title={`${who} · ${zh ? role.zh : role.en}`}
      className={`rail-acct${wide ? " wide" : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: wide ? "4px 8px 4px" : "4px auto 4px",
        padding: wide ? "4px 8px 4px 5px" : 3,
        borderRadius: 9,
        border: "1px solid #ececea",
        background: "#ffffff",
        color: "#171717",
        textDecoration: "none",
        minWidth: 0,
        width: wide ? "auto" : 30,
        justifyContent: wide ? "flex-start" : "center",
      }}
    >
      <Picture name={who} url={account.avatarUrl} />
      {/* One line, not two: the name, then the role as a small pill. The
          owner found the two-line version too tall for the rail's foot. */}
      {wide ? (
        <span style={{ display: "flex", alignItems: "center", minWidth: 0, gap: 6, flexGrow: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 500, lineHeight: "16px", padding: "0 6px", borderRadius: 8, background: role.bg, color: role.fg, whiteSpace: "nowrap", flexShrink: 0 }}>
            {zh ? <Tr zh={role.zh} en={role.en} /> : role.en}
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function Picture({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: 22, height: 22, borderRadius: 11, objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden style={{ width: 22, height: 22, borderRadius: 11, background: "#e2e2e2", color: "#525252", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
