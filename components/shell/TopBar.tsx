"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locate } from "@/lib/nav";
import { Pulse } from "@/components/shell/Pulse";
import { makeT, type Locale } from "@/lib/i18n";
import type { Viewer } from "@/lib/auth/types";

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
  name,
  nameLocal,
  title,
  role,
  avatarUrl,
  locale,
}: {
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
            {zh ? here.module.labelZh : here.module.label}
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

      {/* One target, not two: the avatar, the name and the role are the same
        * link to Settings, which is also where the role can be read in full. */}
      <Link
        href="/settings"
        title={title ? `${who} · ${title}` : who}
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
        <Avatar name={who} url={avatarUrl} />
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

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={{ width: 22, height: 22, borderRadius: 11, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        background: "#e2e2e2",
        color: "#525252",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * The same rule the rail used: the first letter of the first two words.
 *
 * Chinese names are written without spaces, so `split` returns one part and
 * this takes one glyph — which is the right answer. A 姓名 rendered as two
 * full-width characters in a 22px circle does not fit.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
