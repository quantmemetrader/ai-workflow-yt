"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { createChannelAction } from "@/app/(app)/chat/actions";
import { setLocaleAction } from "@/app/(app)/settings/actions";
import type { Locale } from "@/lib/i18n";

/**
 * The 256px workspace sidebar, transcribed from design/canvas/Main.dc.html and
 * Chat-Channel.dc.html. Same markup and metrics; the agent row, the channel
 * list, the direct messages and the footer are live.
 *
 * Presence: the artboard has three dot states. They map to how recently
 * someone was actually seen — green within five minutes, amber within the
 * hour, orange for a guest — rather than to a socket we do not have.
 */
export type SidebarChannel = {
  id: string;
  slug: string;
  name: string;
  isPrivate: boolean;
  unread: number;
};

export type SidebarPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  presence: "g" | "a" | "o";
  isGuest: boolean;
  unread: number;
};

/* The artboard drew a chevron beside the studio name, for a workspace switcher.
 * There is one workspace per deployment, so it is not drawn. */

const AGENT_MARK = (
  <svg
    viewBox="0 0 24 24"
    style={{
      width: 9,
      height: 9,
      stroke: "#fff",
      fill: "none",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }}
  >
    <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
    <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
  </svg>
);

const LOCK = (
  <svg
    viewBox="0 0 24 24"
    style={{
      width: 11,
      height: 11,
      stroke: "#999999",
      fill: "none",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      flexShrink: 0,
    }}
  >
    <path d="M6.8 10.5h10.4v8H6.8z" />
    <path d="M9.2 10.5V8a2.8 2.8 0 0 1 5.6 0v2.5" />
  </svg>
);

export function WorkspaceSidebar({
  studio,
  channels,
  people,
  me,
  locale,
}: {
  studio: string;
  channels: SidebarChannel[];
  people: SidebarPerson[];
  me: { name: string; avatarUrl: string | null; status: string };
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const zh = locale.startsWith("zh");
  const onAgent = pathname === "/chat" || pathname.startsWith("/chat/t/");

  // ⌘K / Ctrl-K was drawn on the box; it should do what it says.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  function newChannel() {
    const name = globalThis.prompt(zh ? "新频道名称" : "Name the channel");
    if (!name) return;
    start(async () => {
      const res = await createChannelAction(name);
      if (res.error) globalThis.alert(res.error);
      else if (res.slug) router.push(`/chat/c/${res.slug}`);
      router.refresh();
    });
  }

  function switchLocale(next: Locale) {
    if (next === locale) return;
    start(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div
      style={{
        width: 256,
        flexShrink: 0,
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px 10px" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{studio}</span>
        <button
          type="button"
          onClick={newChannel}
          style={{
            marginLeft: "auto",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "#fff",
            border: "1px solid #ededed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
          aria-label={zh ? "新建频道" : "New channel"}
          title={zh ? "新建频道" : "New channel"}
        >
          <svg
            viewBox="0 0 24 24"
            style={{
              width: 14,
              height: 14,
              stroke: "#383838",
              fill: "none",
              strokeWidth: 1.8,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }}
          >
            <path d="M12 20h8" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
      </div>

      <Link
        href="/search"
        style={{
          height: 30,
          border: "1px solid #ededed",
          borderRadius: 8,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 9px",
          margin: "0 2px 12px",
          color: "inherit",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          style={{ width: 13, height: 13, stroke: "#999999", fill: "none", strokeWidth: 1.8, strokeLinecap: "round" }}
        >
          <circle cx="11" cy="11" r="6.4" />
          <path d="m15.8 15.8 4 4" />
        </svg>
        <span style={{ fontSize: 12, color: "#999999", flexGrow: 1 }}>{zh ? "跳转到…" : "Jump to…"}</span>
        <span style={{ fontSize: 10.5, color: "#c7c7c7" }}>⌘K</span>
      </Link>

      <Link href="/chat" className={`ws${onAgent ? " on" : ""}`} style={{ gap: 9 }}>
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "#171717",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {AGENT_MARK}
        </div>
        <span>{zh ? "你的助理" : "Your agent"}</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#999999" }}>
          {zh ? "私密" : "private"}
        </span>
      </Link>

      <div className="lbl" style={{ margin: "16px 0 5px" }}>
        {zh ? "频道" : "Channels"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {channels.length === 0 ? (
          <p
            style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.5, padding: "2px 9px 0" }}
          >
            {zh
              ? "还没有频道。用右上角的笔新建一个。"
              : "No channels yet — the pencil above starts one."}
          </p>
        ) : null}
        {channels.map((c) => {
          const active = pathname === `/chat/c/${c.slug}`;
          return (
            <Link
              key={c.id}
              href={`/chat/c/${c.slug}`}
              className={`ws${active ? " on" : c.unread ? " unread" : ""}`}
            >
              <span className="hs">{c.isPrivate ? LOCK : "#"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.name}
              </span>
              {c.unread > 0 && !active && <span className="ct">{c.unread}</span>}
            </Link>
          );
        })}
      </div>

      <div className="lbl" style={{ margin: "16px 0 5px" }}>
        {zh ? "私信" : "Direct messages"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {people.length === 0 ? (
          <p
            style={{ fontSize: 11.5, color: "#999999", lineHeight: 1.5, padding: "2px 9px 0" }}
          >
            {zh
              ? "工作室里还没有其他人。管理员加入同事后，他们会出现在这里。"
              : "Nobody else in the studio yet. People appear here once an admin adds them."}
          </p>
        ) : null}
        {people.map((p) => {
          const active = pathname === `/chat/dm/${p.id}`;
          return (
            <Link
              key={p.id}
              href={`/chat/dm/${p.id}`}
              className={`ws${active ? " on" : p.unread ? " unread" : ""}`}
              style={{ gap: 9 }}
            >
              <span className="pr">
                {p.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.avatarUrl}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 6, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: "#e2e2e2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 7,
                      fontWeight: 600,
                      color: "#525252",
                      flexShrink: 0,
                    }}
                  >
                    {p.name
                      .split(/\s+/)
                      .map((s) => s[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                )}
                <i className={`on-${p.presence}`} />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </span>
              {p.unread > 0 && <span className="ct">{p.unread}</span>}
              {p.isGuest && !p.unread && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#999999" }}>
                  {zh ? "访客" : "guest"}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 8px 2px",
          borderTop: "1px solid #ededed",
        }}
      >
        <Link href="/settings" className="pr">
          {me.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.avatarUrl}
              alt=""
              style={{ width: 30, height: 30, borderRadius: 9, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "#e2e2e2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 600,
                color: "#525252",
              }}
            >
              {me.name
                .split(/\s+/)
                .map((s) => s[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          )}
          <i className="on-g" />
        </Link>
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{me.name}</div>
          <div style={{ fontSize: 11, color: "#999999" }}>{me.status}</div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            borderRadius: 7,
            background: "#ededed",
            fontSize: 10.5,
          }}
        >
          <button
            onClick={() => switchLocale("zh-CN")}
            style={{
              padding: "2px 6px",
              borderRadius: 5,
              border: 0,
              cursor: "pointer",
              background: zh ? "#fff" : "transparent",
              fontWeight: zh ? 500 : 400,
              color: zh ? "#171717" : "#7c7c7c",
              font: "inherit",
            }}
          >
            简
          </button>
          <button
            onClick={() => switchLocale("en")}
            style={{
              padding: "2px 6px",
              borderRadius: 5,
              border: 0,
              cursor: "pointer",
              background: zh ? "transparent" : "#fff",
              fontWeight: zh ? 400 : 500,
              color: zh ? "#7c7c7c" : "#171717",
              font: "inherit",
            }}
          >
            EN
          </button>
        </div>
      </div>
    </div>
  );
}
