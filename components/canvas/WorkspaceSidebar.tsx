"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NewChannelDialog } from "@/components/chat/NewChannelDialog";
import { PlusGlyph, plusButton } from "@/components/canvas/FilesScreen";
import { useResizable } from "@/components/ui/Resizer";
import { setLocaleAction } from "@/app/(app)/settings/actions";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";
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

export type SidebarConversation = { id: string; title: string; updatedAt: string };

/**
 * A spinner that only knows about the <Link> it sits inside. `useLinkStatus`
 * reports that link's own pending state, so the row the person actually
 * clicked is the one that reacts — the sidebar used to sit silent until the
 * next page resolved.
 */
function NavSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <span className="spin" aria-hidden /> : null;
}

export function WorkspaceSidebar({
  studio,
  channels,
  people,
  conversations = [],
  me,
  locale,
}: {
  studio: string;
  channels: SidebarChannel[];
  people: SidebarPerson[];
  /** This person's own past conversations with the agent, newest first. */
  conversations?: SidebarConversation[];
  me: { name: string; avatarUrl: string | null; status: string };
  locale: Locale;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [composing, setComposing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The artboard's 256 is a good default, not a law. Drag the seam.
  const { width, handle } = useResizable("chat-sidebar", { min: 190, max: 460, initial: 256, edge: "right" });
  const zh = locale.startsWith("zh");
  const onAgent = pathname === "/chat" || pathname.startsWith("/chat/t/");


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
        width,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
      }}
    >
      {handle}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 8px 10px" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{studio}</span>
        <button
          type="button"
          onClick={() => setComposing(true)}
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

      {/* This used to be a link to /search, which is not a jump: it threw away
        * the screen you were on to show you a text field. It opens the palette
        * over the page instead, and ⌘K does the same from anywhere. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(JUMP_EVENT))}
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
          cursor: "pointer",
          font: "inherit",
          width: "calc(100% - 4px)",
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
        <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>⌘K</span>
      </button>

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
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>
          {zh ? "私密" : "private"}
        </span>
      <NavSpinner /></Link>

      {/*
        Everything this person has asked the agent before.
        Every turn was already stored and every one of them had a real page at
        /chat/t/<id> — but nothing listed them, so a thread was gone the moment
        the panel closed unless somebody had kept the link. It is their own
        history and nobody else's: the query is by user id, and opening
        somebody else's conversation is a 404.
      */}
      {conversations.length > 0 ? (
        <>
          <div className="lbl" style={{ margin: "16px 0 5px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flexGrow: 1 }}>{zh ? "最近对话" : "Recent chats"}</span>
            <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>{zh ? "仅你可见" : "only you"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {(historyOpen ? conversations : conversations.slice(0, 3)).map((c) => {
              const active = pathname === `/chat/t/${c.id}`;
              return (
                <Link key={c.id} href={`/chat/t/${c.id}`} className={`ws${active ? " on" : ""}`} title={c.title}>
                  <span className="hs" aria-hidden>
                    ⌁
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#c7c7c7", flexShrink: 0 }}>
                    {shortDay(c.updatedAt, locale)}
                  </span>
                <NavSpinner /></Link>
              );
            })}
            {conversations.length > 3 ? (
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                style={{
                  border: 0,
                  background: "transparent",
                  padding: "3px 9px",
                  textAlign: "left",
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 11.5,
                  color: "#7c7c7c",
                }}
              >
                {historyOpen
                  ? zh
                    ? "收起"
                    : "Show fewer"
                  : zh
                    ? `+ 再看 ${conversations.length - 3} 条`
                    : `+ ${conversations.length - 3} more`}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {/* The + is on the heading, next to the channels, rather than only on
          the pencil at the top of the sidebar. */}
      <div className="lbl" style={{ margin: "16px 0 5px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flexGrow: 1 }}>{zh ? "频道" : "Channels"}</span>
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label={zh ? "新建频道" : "New channel"}
          title={zh ? "新建频道" : "New channel"}
          style={plusButton}
        >
          <PlusGlyph />
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {channels.length === 0 ? (
          <p
            style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 9px 0" }}
          >
            {zh ? "还没有频道。" : "No channels yet."}
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
            <NavSpinner /></Link>
          );
        })}
      </div>

      <div className="lbl" style={{ margin: "16px 0 5px" }}>
        {zh ? "消息" : "Direct messages"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {people.length === 0 ? (
          <p
            style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 9px 0" }}
          >
            {zh
              ? "工作室里还没有其他人。管理员添加成员后，他们会出现在这里。"
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
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>
                  {zh ? "访客" : "guest"}
                </span>
              )}
            <NavSpinner /></Link>
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
                fontSize: 11.5,
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
        <NavSpinner /></Link>
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{me.name}</div>
          <div style={{ fontSize: 11.5, color: "#999999" }}>{me.status}</div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: 2,
            borderRadius: 7,
            background: "#ededed",
            fontSize: 11.5,
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

      {composing && (
        <NewChannelDialog
          zh={zh}
          people={people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, title: null }))}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

/** "Today", "Tue", or a date once it is older than a week. */
function shortDay(iso: string, locale: Locale): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  const loc = locale === "en" ? "en-GB" : locale;
  if (days <= 0) return new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" }).format(then);
  if (days < 7) return new Intl.DateTimeFormat(loc, { weekday: "short" }).format(then);
  return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).format(then);
}
