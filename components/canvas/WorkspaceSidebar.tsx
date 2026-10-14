"use client";

import { ConversationMenu } from "@/components/chat/RowMenu";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { onBump } from "@/lib/client/live";
import { sidebarAction } from "@/app/(app)/chat/actions";
import { Suspense, useState, useTransition , useEffect } from "react";
import { useResizable } from "@/components/ui/Resizer";
import { setLocaleAction } from "@/app/(app)/settings/actions";
import { JUMP_EVENT } from "@/components/shell/CommandPalette";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { shortDay } from "@/components/chat/when";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import type { Locale } from "@/lib/i18n";
import { AgentName } from "@/components/ui/Tr";
import { channelName } from "@/lib/chat/channel-name";

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
.ws-row .ws-more{opacity:0;transition:opacity .12s ease}.ws-row:focus-within,.ws-row:has([aria-expanded="true"]){z-index:30}.ws-row:hover .ws-more,.ws-row .ws-more:focus-within{opacity:1}.ws-row:hover .ws>span:last-of-type{visibility:hidden}

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
[data-ws-sidebar] .sec-link { font-size: 11.5px; font-weight: 500; color: #a3a3a3; text-decoration: none; }
[data-ws-sidebar] .sec-link:hover { color: #171717; }
[data-ws-sidebar] .ws-empty { font-size: 12px; color: #a3a3a3; line-height: 1.5; padding: 2px 10px 0; margin: 0; }
[data-ws-sidebar] .ws-faces { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 6px 2px; }
[data-ws-sidebar] .ws-face { position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 3px; width: 46px; padding: 5px 0 4px; border-radius: 10px; text-decoration: none; color: #6b6b6b; transition: background .12s, transform .12s; }
[data-ws-sidebar] .ws-face:hover { background: rgba(0,0,0,.045); transform: translateY(-1px); }
[data-ws-sidebar] .ws-face.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.035); color: #171717; }
[data-ws-sidebar] .ws-face-n { font-size: 10.5px; line-height: 1.2; max-width: 44px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ws-sidebar] .pj-row { position: relative; display: flex; align-items: center; height: 30px; border-radius: 8px; transition: background .12s; }
[data-ws-sidebar] .pj-row:hover { background: rgba(0,0,0,.045); }
[data-ws-sidebar] .pj-row.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.035); }
[data-ws-sidebar] .pj-toggle { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 4px; border: 0; background: transparent; font: inherit; font-size: 13px; color: #262626; cursor: pointer; text-align: left; }
[data-ws-sidebar] .pj-chev { color: #b5b5b5; flex-shrink: 0; transition: transform .15s; }
[data-ws-sidebar] .pj.open .pj-chev { transform: rotate(90deg); color: #6b6b6b; }
[data-ws-sidebar] .pj-ic { color: #8a8a8a; flex-shrink: 0; }
[data-ws-sidebar] .pj.open .pj-ic { color: #171717; }
[data-ws-sidebar] .pj-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-ws-sidebar] .pj-count { margin-left: auto; font-size: 11px; color: #a3a3a3; font-variant-numeric: tabular-nums; padding-left: 4px; }
[data-ws-sidebar] .pj-acts { display: flex; gap: 1px; padding-right: 3px; opacity: 0; transition: opacity .12s; }
[data-ws-sidebar] .pj-row:hover .pj-acts, [data-ws-sidebar] .pj-row:focus-within .pj-acts { opacity: 1; }
[data-ws-sidebar] .pj-row:hover .pj-count { display: none; }
[data-ws-sidebar] .pj-act { width: 22px; height: 22px; border-radius: 6px; border: 0; background: transparent; display: inline-flex; align-items: center; justify-content: center; color: #6b6b6b; cursor: pointer; }
[data-ws-sidebar] .pj-act:hover { background: rgba(0,0,0,.07); color: #171717; }
[data-ws-sidebar] .pj-kids { position: relative; margin: 1px 0 4px 14px; padding-left: 8px; border-left: 1px solid #e6e5e1; display: flex; flex-direction: column; gap: 1px; }
[data-ws-sidebar] .pj-new, [data-ws-sidebar] .pj-more { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border: 0; background: transparent; border-radius: 7px; font: inherit; font-size: 12px; color: #8a8a8a; cursor: pointer; text-decoration: none; }
[data-ws-sidebar] .pj-new:hover, [data-ws-sidebar] .pj-more:hover { background: rgba(0,0,0,.045); color: #171717; }
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

export type SidebarConversation = { id: string; title: string; updatedAt: string; projectId?: string | null };
export type SidebarProject = { id: string; title: string; status: string; updatedAt?: string };


/**
 * The person's own assistant, then the AI employees, one row each: face,
 * name, and the one line on what to ask them for. An employee's row opens the
 * assistant chat with that employee already tagged (`/chat?agent=…`), which is
 * the same as typing "@文案" — the shortest way in for anybody who did not
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
  const onChat = pathname === "/chat" || pathname.startsWith("/chat/t/");
  /* One row of faces instead of eight rows (15 Oct: "too many channels / chats, make it minimalist"):
     your assistant first, then the employees; the name and what to ask them shows on hover. */
  const faces: { key: AgentKey | null; href: string; label: string; hint: string }[] = [
    { key: null, href: "/chat", label: zh ? "你的助理" : "Your assistant", hint: zh ? "什么都可以问" : "Ask anything" },
    ...AGENT_KEYS.map((k) => ({ key: k, href: `/chat?agent=${k}`, label: zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name, hint: zh ? AGENT_LABELS[k].hint : AGENT_LABELS[k].hintEn })),
  ];
  return (
    <div className="ws-faces">
      {faces.map((f) => {
        const on = onChat && (f.key === null ? !picked : picked === f.key);
        return (
          <Link key={f.key ?? "me"} href={f.href} prefetch={false} className={`ws-face${on ? " on" : ""}`} title={`${f.label} · ${f.hint}`} aria-label={f.label}>
            <AgentIcon agent={f.key} size={26} radius={8} />
            <span className="ws-face-n">{f.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** One chat in the list: its title, when, and its menu (rename, move to a project, delete). */
function ChatRow({ c, active, zh, now, locale, projects }: { c: SidebarConversation; active: boolean; zh: boolean; now: string; locale: Locale; projects: SidebarProject[] }) {
  const title = c.title === "New chat" ? (zh ? "新对话" : "New chat") : c.title;
  return (
    <div className="ws-row" style={{ position: "relative" }}>
      <Link href={`/chat/t/${c.id}`} prefetch={false} className={`ws${active ? " on" : ""}`} title={title}>
        <span className="hs" aria-hidden>
          <Icon name="chat" size={12} color="#a3a3a3" />
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#b5b5b5", flexShrink: 0, fontWeight: 400 }}>{shortDay(c.updatedAt, now, locale)}</span>
        <NavSpinner />
      </Link>
      <ConversationMenu id={c.id} title={c.title} zh={zh} current={active} size={22} className="ws-more" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)" }} projects={projects.map((p) => ({ id: p.id, title: p.title }))} projectId={c.projectId ?? null} />
    </div>
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
  channels: channelsProp,
  people: peopleProp,
  conversations: conversationsProp = [],
  projects: projectsProp = [],
  me,
  locale,
  now,
}: {
  studio: string;
  channels: SidebarChannel[];
  people: SidebarPerson[];
  /** This person's own past conversations with the agent, newest first. */
  conversations?: SidebarConversation[];
  /** Live projects, newest activity first: each has its own conversation on its page. */
  projects?: SidebarProject[];
  me: { id: string; name: string; avatarUrl: string | null; status: string };
  locale: Locale;
  /** The server render's clock, for "today / weekday / date" beside a thread. */
  now: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const [historyOpen, setHistoryOpen] = useState(false);
  /* Which projects are unfolded: remembered on this computer; the project of the open chat always is. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("aura:chat-projects-open");
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* private window: nothing remembered */
    }
  }, []);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem("aura:chat-projects-open", JSON.stringify([...next]));
      } catch {
        /* not remembered */
      }
      return next;
    });
  const newChatIn = (projectId: string) => {
    document.cookie = `tg_chat_new=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    setExpanded((prev) => new Set(prev).add(projectId));
    router.push(`/chat?fresh=1&project=${projectId}`);
  };
  /* The rows refreshed on their own (13 Oct): every half minute while the tab is visible, at once when the
     page on the right says it changed (bumpLive), and when the tab comes back. A fresh server render resets them. */
  const [fresh, setFresh] = useState<{ channels: SidebarChannel[]; people: SidebarPerson[]; conversations: SidebarConversation[]; projects: SidebarProject[] } | null>(null);
  useEffect(() => setFresh(null), [channelsProp, peopleProp, conversationsProp, projectsProp]);
  useEffect(() => {
    let gone = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      const r = (await sidebarAction().catch(() => null)) as { channels?: SidebarChannel[]; people?: SidebarPerson[]; conversations?: SidebarConversation[]; projects?: SidebarProject[]; error?: string } | null;
      if (!gone && r && !r.error && r.channels && r.people && r.conversations) setFresh({ channels: r.channels, people: r.people, conversations: r.conversations, projects: r.projects ?? [] });
    };
    const every = window.setInterval(pull, 30_000);
    const off = onBump(() => void window.setTimeout(pull, 1200));
    const back = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", back);
    return () => { gone = true; window.clearInterval(every); off(); document.removeEventListener("visibilitychange", back); };
  }, []);
  const channels = fresh?.channels ?? channelsProp;
  const people = fresh?.people ?? peopleProp;
  const conversations = fresh?.conversations ?? conversationsProp;
  const projects = fresh?.projects ?? projectsProp;
  const loose = conversations.filter((c) => !c.projectId || !projects.some((p) => p.id === c.projectId));
  void channels;
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
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 4px 10px 8px" }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zh ? "消息" : "Messages"}</span>
        {/* A new chat with your assistant, one press from anywhere in Chat. The
            cookie keeps it new until its first message (app/(app)/chat/page.tsx). */}
        <button
          type="button"
          onClick={() => {
            document.cookie = `tg_chat_new=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
            router.push("/chat?fresh=1");
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" /></svg>
          {zh ? "新对话" : "New chat"}
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
        <span style={{ fontSize: 12, color: "#999999", flexGrow: 1 }}>{zh ? "搜索…" : "Search…"}</span>
        <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>⌘K</span>
      </button>

      {/* Everything between the search box and the footer scrolls as one:
          with the employees, a few threads, the channels and the studio's
          people, the list outgrows a laptop screen, and it used to push the
          footer off the bottom with no way to reach it. */}
      <div className="mid">
        <div className="sec" style={{ marginTop: 2 }}>{zh ? "AI 同事" : "AI teammates"}</div>
        <AssistantRows zh={zh} />

        {/* Projects, each holding this person's chats about it (15 Oct: "projects, like Claude / Codex, to organise chats"). */}
        <div className="sec">
          <span style={{ flexGrow: 1 }}>{zh ? "项目" : "Projects"}</span>
          <Link href="/projects" prefetch={false} className="sec-link">{zh ? "全部" : "All"}</Link>
        </div>
        {projects.length === 0 ? (
          <p className="ws-empty">{zh ? "还没有项目。在「项目」页新建一个，对话就可以归进去。" : "No projects yet. Start one on Projects and file chats under it."}</p>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {projects.map((p) => {
            const chats = conversations.filter((c) => c.projectId === p.id);
            const activeChat = chats.some((c) => pathname === `/chat/t/${c.id}`);
            const isOpen = expanded.has(p.id) || activeChat;
            const onPage = pathname.startsWith(`/projects/${p.id}`);
            return (
              <div key={p.id} className={`pj${isOpen ? " open" : ""}`}>
                <div className={`pj-row${onPage ? " on" : ""}`}>
                  <button type="button" className="pj-toggle" onClick={() => toggle(p.id)} aria-expanded={isOpen} title={p.title}>
                    <svg className="pj-chev" viewBox="0 0 24 24" width="10" height="10" aria-hidden><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <svg className="pj-ic" viewBox="0 0 24 24" width="15" height="15" aria-hidden>
                      {isOpen ? <path d="M3.5 8a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.2a2 2 0 0 0-1.9 1.4L3.5 18z M5.3 12.4A2 2 0 0 1 7.2 11h13.6l-2 6.6a2 2 0 0 1-1.9 1.4H3.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /> : <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />}
                    </svg>
                    <span className="pj-name">{p.title}</span>
                    {chats.length ? <span className="pj-count">{chats.length}</span> : null}
                  </button>
                  <span className="pj-acts">
                    <button type="button" className="pj-act" title={zh ? "在这个项目里新对话" : "New chat in this project"} aria-label={zh ? "在这个项目里新对话" : "New chat in this project"} onClick={() => newChatIn(p.id)}>
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
                    </button>
                    <Link href={`/projects/${p.id}`} prefetch={false} className="pj-act" title={zh ? "打开项目页" : "Open the project"} aria-label={zh ? "打开项目页" : "Open the project"}>
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </Link>
                  </span>
                </div>
                {isOpen ? (
                  <div className="pj-kids">
                    {chats.slice(0, 8).map((c) => (
                      <ChatRow key={c.id} c={c} active={pathname === `/chat/t/${c.id}`} zh={zh} now={now} locale={locale} projects={projects} />
                    ))}
                    {chats.length > 8 ? <Link href={`/projects/${p.id}`} prefetch={false} className="pj-more">{zh ? `还有 ${chats.length - 8} 个对话` : `${chats.length - 8} more`}</Link> : null}
                    <button type="button" className="pj-new" onClick={() => newChatIn(p.id)}>
                      <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
                      {zh ? "在这个项目里新对话" : "New chat here"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Chats not filed under any project. */}
        {loose.length > 0 ? (
          <>
            <div className="sec">
              <span style={{ flexGrow: 1 }}>{zh ? "其他对话" : "Other chats"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {(historyOpen ? loose : loose.slice(0, 5)).map((c) => (
                <ChatRow key={c.id} c={c} active={pathname === `/chat/t/${c.id}`} zh={zh} now={now} locale={locale} projects={projects} />
              ))}
              {loose.length > 5 ? (
                <button type="button" className="more" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {historyOpen ? (zh ? "收起" : "Show fewer") : zh ? `更多 ${loose.length - 5} 条` : `${loose.length - 5} more`}
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: historyOpen ? "rotate(180deg)" : undefined }}>
                    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
                  </svg>
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="sec">{zh ? "同事" : "People"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {people.length === 0 ? <p className="ws-empty">{zh ? "还没有其他同事。" : "No one else yet."}</p> : null}
          {people.map((p) => {
            const active = pathname === `/chat/dm/${p.id}`;
            return (
              <Link key={p.id} href={`/chat/dm/${p.id}`} className={`ws${active ? " on" : p.unread ? " unread" : ""}`} style={{ gap: 9 }}>
                <span className="pr">
                  <PersonAvatar id={p.id} url={p.avatarUrl} name={p.name} size={20} radius={6} />
                  <i className={`on-${p.presence}`} />
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                {p.unread > 0 && !active && <span className="ct">{p.unread > 99 ? "99+" : p.unread}</span>}
                {p.isGuest && !p.unread && <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#999999" }}>{zh ? "访客" : "guest"}</span>}
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
          <PersonAvatar id={me.id} url={me.avatarUrl} name={me.name} size={30} radius={9} />
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


    </div>
  );
}
