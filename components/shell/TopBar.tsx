"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { locate } from "@/lib/nav";
import { Pulse } from "@/components/shell/Pulse";
import { makeT, type Locale } from "@/lib/i18n";
import type { Viewer } from "@/lib/auth/types";
import { Tr, TR_EN } from "@/components/ui/Tr";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { AvatarSheet } from "@/components/shell/AvatarSheet";

/**
 * The strip across the top of every module: where you are, and who you are.
 *
 * The studio asked for this twice, and for the same reason both times —
 * "better show the character - so we can see users' role on the up part". An
 * owner and a guest see two different products (a guest cannot approve
 * anything, an owner can grant access to everything) and until now the only
 * place that said which of the two you were was the Settings page.
 *
 * It is one bar for the whole app rather than a line added to each screen's
 * own header, because "every screen" has to include the ones this repo does
 * not own — Video, Articles, Admin — and because a fact about the person
 * should not be re-rendered by ten components that each get it slightly
 * differently.
 *
 * Deliberately slim (38px) and quiet. Each screen already has its own header
 * naming the thing you are looking at; this one names the *room*, so the two
 * lines read as "market research · comment inbox" rather than saying the same
 * word twice.
 */
export function TopBar({
  userId,
  name,
  nameLocal,
  title,
  role,
  avatarUrl,
  locale,
}: {
  /** Whose bar this is: picks the default picture, and the chooser saves to it. */
  userId: string;
  name: string;
  nameLocal: string | null;
  /** The job title on the account, if there is one. Shown in the tooltip. */
  title: string | null;
  role: Viewer["role"];
  avatarUrl: string | null;
  locale: string;
}) {
  const pathname = usePathname();
  const zh = locale.startsWith("zh");
  const t = makeT(locale as Locale);
  const here = locate(pathname);

  const who = zh && nameLocal ? nameLocal : name;
  const roleLabel = t(role);
  const [choosing, setChoosing] = React.useState(false);

  return (
    <header
      style={{
        height: 38,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 14px 0 16px",
        borderBottom: "1px solid #ededed",
        background: "#fdfdfd",
      }}
    >
      {here.module && (
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: "#171717", whiteSpace: "nowrap" }}>
            {/* Translate-proof, like the rail: 首页 must not become "front page". */}
            {zh ? <Tr zh={here.module.labelZh} en={TR_EN[here.module.labelZh] ?? here.module.label} /> : here.module.label}
          </span>
          {here.screen && (
            <>
              <span style={{ fontSize: 12, color: "#c7c7c7" }} aria-hidden>
                ·
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "#7c7c7c",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {zh ? here.screen.labelZh : here.screen.label}
              </span>
            </>
          )}
        </span>
      )}

      <div style={{ flexGrow: 1 }} />

      {/* What the team is doing, on every page. */}
      <Pulse zh={zh} />

      <div style={{ width: 4 }} />

      {/* One pill, two targets. Your face opens the picture chooser — the
        * studio's "default them to good pfps, and have multiple choices" —
        * and the name and role still go to Settings, where the role can be
        * read in full. Two siblings rather than a button inside the link: a
        * button nested in an <a> is invalid and reads as one control. */}
      <style dangerouslySetInnerHTML={{ __html: "[data-face-button]:hover > *{box-shadow:0 0 0 2px #d4d4d4}[data-face-button]:focus-visible > *{box-shadow:0 0 0 2px #171717}" }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 28,
          padding: "0 9px 0 3px",
          borderRadius: 999,
          border: "1px solid #ededed",
          background: "#ffffff",
          color: "#171717",
          maxWidth: 260,
        }}
      >
        <button
          type="button"
          data-face-button=""
          onClick={() => setChoosing(true)}
          aria-haspopup="dialog"
          aria-label={zh ? "更换头像" : "Change your picture"}
          title={zh ? "更换头像" : "Change your picture"}
          style={{ display: "flex", padding: 0, border: 0, borderRadius: 11, background: "transparent", cursor: "pointer", flexShrink: 0, outline: "none" }}
        >
          <PersonAvatar id={userId} url={avatarUrl} name={who} size={22} style={{ transition: "box-shadow .12s ease" }} />
        </button>
        <Link
          href="/settings"
          title={title ? `${who} · ${title}` : who}
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: "#171717" }}
        >
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {who}
          </span>
          <RoleBadge role={role} label={roleLabel} />
        </Link>
      </div>

      {choosing ? (
        <AvatarSheet userId={userId} name={who} avatarUrl={avatarUrl} zh={zh} onClose={() => setChoosing(false)} />
      ) : null}
    </header>
  );
}

/**
 * Four roles, four weights of ink.
 *
 * Owner is the darkest because it is the one that can do anything; guest is
 * amber because it is the one that surprises people ("why can I not approve
 * this?"). Member — almost everybody — is grey, so the bar is quiet on almost
 * every screen and loud on the two where the answer matters.
 */
function RoleBadge({ role, label }: { role: Viewer["role"]; label: string }) {
  const palette = {
    owner: { bg: "#171717", fg: "#ffffff" },
    admin: { bg: "#e6f4ff", fg: "#0060b0" },
    member: { bg: "#f3f3f3", fg: "#525252" },
    guest: { bg: "#fff7d3", fg: "#a35f00" },
  }[role];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 19,
        padding: "0 8px",
        borderRadius: 10,
        background: palette.bg,
        color: palette.fg,
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
