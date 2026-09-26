"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { NewChannelDialog } from "@/components/chat/NewChannelDialog";
import { PlusGlyph, plusButton } from "@/components/canvas/FilesScreen";
import { useResizable } from "@/components/ui/Resizer";
import { setLocaleAction } from "@/app/(app)/settings/actions";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { shortDay } from "@/components/chat/when";
import { initials } from "@/components/chat/look";
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

/**
 * The sidebar's own rules, on top of the canvas's `.ws` rows: a hover state
 * (rows had none, so nothing said they were clickable until the click), a
 * quieter selected row, section headings that read as headings, the scrolling
 * middle, and an unread count in the product's ink rather than alarm red.
 */
const CSS = `
[data-ws-sidebar] .ws { height: 30px; border-radius: 8px; transition: background .12s; }
[data-ws-sidebar] .ws:hover { background: rgba(0,0,0,.045); }
[data-ws-sidebar] .ws.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.035); }
[data-ws-sidebar] .ws .ct { background: #171717; font-variant-numeric: tabular-nums; }
[data-ws-sidebar] .ws .hint { font-size: 11.5px; color: #a3a3a3; font-weight: 400; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ws-sidebar] .ws .nm { flex-shrink: 0; }
[data-ws-sidebar] .sec { display: flex; align-items: center; gap: 6px; margin: 16px 0 4px; padding: 0 10px; font-size: 11.5px; font-weight: 600; color: #8a8a8a; }
[data-ws-sidebar] .sec .aside { font-size: 11.5px; font-weight: 400; color: #b5b5b5; }
[data-ws-sidebar] .mid { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0 -8px; padding: 0 8px 8px; scrollbar-width: thin; }
[data-ws-sidebar] .more { border: 0; background: transparent; padding: 3px 10px; text-align: left; cursor: pointer; font: inherit; font-size: 11.5px; color: #7c7c7c; border-radius: 6px; }
[data-ws-sidebar] .more:hover { color: #171717; }
`;

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
 * The person's own assistant, then the AI employees, one row each: face,
 * name, and the one line on what to ask them for. An employee's row opens the
 * assistant chat with that employee already tagged (`/chat?agent=…`), which is
 * the same as typing "@编剧" — the shortest way in for anybody who did not
 * know the @ was there.
 *
 * Which row is selected is read from the query string. `useSearchParams`
 * sits under its own Suspense boundary so it can never pull the rest of the
 * sidebar into client-only rendering; the fallback is the same rows, selected
 * by path alone.
 */
function AssistantRows({ zh }: { zh: boolean }) {
  return (
    <Suspense fallback={<AssistantRowList zh={zh} picked={null} />}>
      <AssistantRowsLive zh={zh} />
    </Suspense>
  );
}

function AssistantRowsLive({ zh }: { zh: boolean }) {
  const params = useSearchParams();
  const raw = params.get("agent");
  const picked = raw && (AGENT_KEYS as readonly string[]).includes(raw) ? (raw as AgentKey) : null;
  return <AssistantRowList zh={zh} picked={picked} />;
}

function AssistantRowList({ zh, picked }: { zh: boolean; picked: AgentKey | null }) {
  const pathname = usePathname();
  /* A thread opened from an employee's page carries `?agent=` too, so the
     employee's row stays the selected one while you read their thread. */
  const onChat = pathname === "/chat" || pathname.startsWith("/chat/t/");
  const onAgent = onChat && !picked;
  return (
    <>
      <Link href="/chat" className={`ws${onAgent ? " on" : ""}`} style={{ gap: 9, height: 32 }}>
        {/* The host's own assistant: the pixel robot, beside the employees'
            pixel faces below — it was a black cube like nothing else here. */}
        <AgentIcon agent={null} size={20} radius={6} />
        <span>{zh ? "你的助理" : "Your agent"}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#a3a3a3" }}>{zh ? "私密" : "private"}</span>
        <NavSpinner />
      </Link>

      <div className="sec">
        <span style={{ flexGrow: 1 }}>{zh ? "AI 同事" : "AI teammates"}</span>
        <span className="aside">{zh ? "点一下直接问" : "click to ask"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {AGENT_KEYS.map((k) => {
          const a = AGENT_LABELS[k];
          return (
            <Link
              key={k}
              href={`/chat?agent=${k}`}
              prefetch={false}
              className={`ws${onChat && picked === k ? " on" : ""}`}
              style={{ gap: 9, height: 32 }}
              title={zh ? `问${a.nameLocal}：${a.hint}` : `Ask the ${a.name}: ${a.hintEn}`}
            >
              <AgentIcon agent={k} size={20} radius={6} />
              <span className="nm">{zh ? a.nameLocal : a.name.replace(/ agent$/, "")}</span>
              <span className="hint">{zh ? a.hint : a.hintEn}</span>
              <NavSpinner />
            </Link>
          );
        })}
      </div>
    </>
  );
}

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
  now,
}: {
  studio: string;
  channels: SidebarChannel[];
  people: SidebarPerson[];
  /** This person's own past conversations with the agent, newest first. */
  conversations?: SidebarConversation[];
  me: { name: string; avatarUrl: string | null; status: string };
  locale: Locale;
  /** The server render's clock, for "today / weekday / date" beside a thread. */
  now: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [composing, setComposing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The artboard's 256 is a good default, not a law. Drag the seam.
  const { width, handle } = useResizable("chat-sidebar", { min: 190, max: 460, initial: 256, edge: "right" });
  const zh = locale.startsWith("zh");


  function switchLocale(next: Locale) {
    if (next === locale) return;
    start(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div
      data-ws-sidebar=""
      style={{
        width,
        flexShrink: 0,
        position: "relative",
        background: "#f8f8f8",
        borderRight: "1px solid #ededed",
        display: "flex",
        flexDirection: "column",
        padding: "10px 8px",
        minHeight: 0,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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

      {/* Everything between the search box and the footer scrolls as one:
          with the employees, a few threads, the channels and the studio's
          people, the list outgrows a laptop screen, and it used to push the
          footer off the bottom with no way to reach it. */}
      <div className="mid">
        <AssistantRows zh={zh} />

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
            <div className="sec">
              <span style={{ flexGrow: 1 }}>{zh ? "最近对话" : "Recent chats"}</span>
              <span className="aside">{zh ? "仅你可见" : "only you"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {(historyOpen ? conversations : conversations.slice(0, 3)).map((c) => {
                const active = pathname === `/chat/t/${c.id}`;
                return (
                  <Link key={c.id} href={`/chat/t/${c.id}`} prefetch={false} className={`ws${active ? " on" : ""}`} title={c.title}>
                    <span className="hs" aria-hidden>
                      <Icon name="chat" size={12} color="#a3a3a3" />
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#b5b5b5", flexShrink: 0, fontWeight: 400 }}>
                      {shortDay(c.updatedAt, now, locale)}
                    </span>
                    <NavSpinner />
                  </Link>
                );
              })}
              {conversations.length > 3 ? (
                <button type="button" className="more" onClick={() => setHistoryOpen((v) => !v)}>
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
        <div className="sec">
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
            <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 10px 0" }}>
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
                {c.unread > 0 && !active && <span className="ct">{c.unread > 99 ? "99+" : c.unread}</span>}
                <NavSpinner />
              </Link>
            );
          })}
        </div>

        <div className="sec">{zh ? "消息" : "Direct messages"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {people.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#999999", lineHeight: 1.5, padding: "2px 10px 0" }}>
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
                        background: "#e5e5e5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#525252",
                        flexShrink: 0,
                      }}
                    >
                      {initials(p.name)}
                    </div>
                  )}
                  <i className={`on-${p.presence}`} />
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                {p.unread > 0 && !active && <span className="ct">{p.unread > 99 ? "99+" : p.unread}</span>}
                {p.isGuest && !p.unread && (
                  <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>
                    {zh ? "访客" : "guest"}
                  </span>
                )}
                <NavSpinner />
              </Link>
            );
          })}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
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
              {initials(me.name)}
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
