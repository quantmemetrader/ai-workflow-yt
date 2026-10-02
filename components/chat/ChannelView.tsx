"use client";

import { getPanelModel } from "@/components/chat/ModelChip";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChannelSurface, type ChannelMember, type ChannelMessage, type ChannelPending, type SentFile } from "@/components/chat/ChannelSurface";
import { pendingStamp } from "@/lib/agents/steps";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { archiveChannelAction, deleteChannelMessageAction, editChannelMessageAction, leaveChannelAction, pressCardAction, sendChannelMessage, startCutFromChatAction } from "@/app/(app)/chat/actions";
import { notify } from "@/lib/client/notify";
import { bumpLive } from "@/lib/client/live";
import { MembersSheet } from "@/components/chat/MembersSheet";
import { AgentDock } from "@/components/shell/AgentDock";

type Person = { id: string; name: string; avatarUrl: string | null; title?: string | null };

/**
 * Live wiring for the channel artboard: sending, and picking up other people's
 * messages.
 *
 * New messages arrive by re-fetching the server component every few seconds
 * rather than over a socket — the studio is nine people, the payload is small,
 * and it keeps the deployment to one stateless service. This is the single
 * component to change when that stops being true.
 *
 * The poll is also how a tagged agent's answer arrives. `sendChannelMessage`
 * hands the model call to `after()` and returns at once, so the person's own
 * message appears immediately and 视频助理 turns up a few seconds later, the
 * same way a colleague would.
 */
export function ChannelView({
  slug,
  name,
  topic,
  isPrivate = false,
  memberCount,
  members,
  studioPeople,
  mentionPeople,
  messages,
  locale,
  channelId,
  model,
  canPost = true,
  canAttach = true,
  me,
  now,
  isDirect = false,
  directAvatar = null,
  directId = null,
  pending: workingRows = [],
  project = null,
  canLeave = false,
  canArchive = false,
  archived = false,
}: {
  /** A member of a private channel may leave it (退出频道). */
  canLeave?: boolean;
  /** Whoever started it, or an admin, may archive it; never a system room. */
  canArchive?: boolean;
  /** Archived: read-only, said where the composer was. */
  archived?: boolean;
  slug: string;
  /** The project this chat belongs to, when it is a project's own. */
  project?: { id: string; title: string; videoProjectId: string | null } | null;
  /** The employees at work in this channel, each on its current step. */
  pending?: ChannelPending[];
  /** Who is typing: the name the optimistic row is signed with while the
   * server's copy is on its way. It was the channel's name. */
  me: { id?: string; name: string; avatarUrl: string | null };
  name: string;
  topic: string | null;
  isPrivate?: boolean;
  memberCount: number;
  members: ChannelMember[];
  /** Everyone in the studio, for the members sheet's "add" list. Passing it is
   * also what puts the members pill in the header, so a direct message — which
   * has two people in it and nothing to manage — passes nothing. */
  studioPeople?: Person[];
  /** Who the composer's @-picker offers, when that is not the same list. The
   * AI employees are added to it from the catalog either way, so they are on
   * offer before anybody has ever tagged one. */
  mentionPeople?: Person[];
  messages: ChannelMessage[];
  locale: string;
  /** The channel's id, so the agent beside it knows which room it is in. */
  channelId: string;
  model: string;
  /** False on an announcements channel for anyone but an administrator. */
  canPost?: boolean;
  /** False for somebody without the Files module — the upload route would
   * refuse them, so the paperclip is not drawn. */
  canAttach?: boolean;
  /** The server render's clock, handed to the list so day labels hydrate. */
  now?: string;
  /** A one-to-one conversation: its header is the other person rather than
   * a #room. Said by the DM page rather than read off the slug — a channel
   * somebody named "dm test" has the slug `dm-test`. */
  isDirect?: boolean;
  /** In a direct message, the other person's picture for the header. */
  directAvatar?: string | null;
  /** And their user id, for their default picture. */
  directId?: string | null;
}) {
  const router = useRouter();
  const zh = locale.startsWith("zh");
  const [pending, start] = useTransition();
  const [showMembers, setShowMembers] = useState(false);
  /*
   * Anything typed before the server render catches up lives here, and is
   * thrown away the moment the server's own copy arrives. Adjusting during
   * render is React's documented pattern for state derived from a prop — an
   * effect would paint the message twice.
   */
  const [optimistic, setOptimistic] = useState<ChannelMessage[]>([]);
  const [failed, setFailed] = useState<{ body: string; error: string } | null>(null);
  /** The card button waiting on the server, so it reads as busy and the
   *  rest of them are not pressed underneath it. */
  const [pressing, setPressing] = useState<string | null>(null);
  /** The dropped take whose 开始剪 press is on its way to the server. */
  const [cutting, setCutting] = useState<string | null>(null);
  /* Edits and deletions shown at once, until the server's copy agrees. */
  const [patched, setPatched] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<string[]>([]);
  /* The assistant beside the channel, opened by hand on a narrow window. */
  const [dockOpen, setDockOpen] = useState(false);
  /* The folded assistant closes with its ×, Esc, or a click outside it (QA round 2). */
  const dockRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dockOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDockOpen(false);
    };
    const away = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (dockRef.current?.contains(t as Node) || t?.closest?.(".cv-dock-btn")) return;
      if (window.innerWidth < 1200) setDockOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", away);
    };
  }, [dockOpen]);
  const [seen, setSeen] = useState(messages);
  if (seen !== messages) {
    setSeen(messages);
    setOptimistic([]);
    setPatched({});
    setGone([]);
  }

  // Polling asks a one-row question ("newest message id?") and only re-renders
  // the thread when the answer changes. An idle open channel therefore costs a
  // single indexed read every few seconds, not a page render.
  const latest = messages.length ? messages[messages.length - 1].id : null;
  /* Who is at work and on which step, as the pulse fingerprints it: a step
     moving on ("正在看…" → "正在写脚本") is news too, though no message is. */
  const working = pendingStamp(workingRows);
  useEffect(() => {
    let known = latest;
    let knownWork = working;
    let stop = false;

    async function poll() {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chat/pulse?slug=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { latest: newest, pending: work = "" } = (await res.json()) as { latest: string | null; pending?: string };
        if ((newest && newest !== known) || work !== knownWork) {
          known = newest;
          knownWork = work;
          router.refresh();
        }
      } catch {
        // A dropped poll is not worth telling anyone about; the next one runs.
      }
    }

    /* Quicker while an employee is at work, so its steps are seen as they
       happen; the ordinary pace otherwise. */
    const id = setInterval(poll, working ? 2500 : 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [router, slug, latest, working]);

  function send(body: string, attachmentIds: string[], files: SentFile[] = []) {
    /*
     * Three things, and the last two are the reason direct messages looked
     * broken for a week.
     *
     *   — The message appears *now*, as the person's own, and is replaced by
     *     the server's copy when the refresh lands. Waiting for a round trip
     *     to Frankfurt before anything appears reads as "it didn't send".
     *   — A refusal is shown. The action returns `{ error }` for a message it
     *     would not post, and this used to throw that away — so a DM, which
     *     was refused on every send by a slug-length check, vanished silently.
     *   — What was typed comes back with the error, so nobody loses a message
     *     they have already written.
     */
    const mine: ChannelMessage = {
      id: `pending-${Date.now()}`,
      authorId: me.id ?? null,
      authorName: me.name,
      authorAvatar: me.avatarUrl,
      body,
      createdAt: new Date().toISOString(),
      pending: true,
      /* The files as chips, by name, until the server's copy draws them
         properly (a video as its card, once its poster exists). */
      attachments: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, sizeBytes: f.size, durationMs: null })),
    };
    setFailed(null);
    setOptimistic((rest) => [...rest, mine]);

    start(async () => {
      const res = await sendChannelMessage(slug, body, attachmentIds, getPanelModel());
      if (res?.error) {
        setOptimistic((rest) => rest.filter((m) => m.id !== mine.id));
        setFailed({ body, error: res.error });
        return;
      }
      router.refresh();
      /* An employee was brought in: its working row goes up a moment after
         the response (the turn runs after it), so look once more soon
         rather than leaving the room still for a whole poll. */
      if (parseAgentMentions(body).length || ("answering" in res && res.answering)) setTimeout(() => router.refresh(), 1500);
      /* "传好了" may have started the cut: the live row wants to know now. */
      if ("answering" in res && res.answering === "video") setTimeout(bumpLive, 2500);
    });
  }

  /**
   * "素材传好了 · 开始剪" under a take dropped here. The server posts the
   * person's own line and starts the cut after its response; the refresh
   * draws the line, the next one 剪辑师's reply with its chip, and the
   * live store the row that follows the worker.
   */
  function startCut(messageId: string) {
    if (cutting) return;
    setFailed(null);
    setCutting(messageId);
    start(async () => {
      const res = await startCutFromChatAction(slug, messageId);
      setCutting(null);
      if (res?.error) {
        setFailed({ body: "", error: res.error });
        return;
      }
      router.refresh();
      setTimeout(() => router.refresh(), 1500);
      setTimeout(bumpLive, 2500);
    });
  }

  /**
   * Pressing a button an AI employee put under its message.
   *
   * No optimistic row: what the press posts is a line written by the agent,
   * and guessing at it here would mean two copies of the truth. The refresh is
   * a few hundred milliseconds and the button reads as busy meanwhile.
   */
  function press(messageId: string, actionId: string) {
    if (pressing) return;
    setFailed(null);
    setPressing(actionId);
    start(async () => {
      const res = await pressCardAction(slug, messageId, actionId);
      /* "交给编剧" on the plan: open the project it started, where 编剧 is writing. */
      if (res && "projectId" in res && res.projectId) {
        router.push(`/projects/${res.projectId}`);
        return;
      }
      setPressing(null);
      if (res?.error) {
        setFailed({ body: "", error: res.error });
        return;
      }
      router.refresh();
      /* Most presses start an employee; its working row follows shortly. */
      setTimeout(() => router.refresh(), 1500);
    });
  }

  /** Saving a change to one's own message (QA, 2 Oct). */
  async function edit(messageId: string, body: string): Promise<string | null> {
    const res = await editChannelMessageAction(slug, messageId, body).catch(() => ({ error: zh ? "没改成，再试一次" : "Not saved; try again" }));
    if (res?.error) {
      notify(res.error);
      return res.error;
    }
    setPatched((p) => ({ ...p, [messageId]: body.trim() }));
    router.refresh();
    return null;
  }

  function remove(messageId: string) {
    setGone((g) => [...g, messageId]);
    start(async () => {
      const res = await deleteChannelMessageAction(slug, messageId).catch(() => ({ error: zh ? "没删掉，再试一次" : "Not deleted; try again" }));
      if (res?.error) {
        setGone((g) => g.filter((id) => id !== messageId));
        notify(res.error);
        return;
      }
      router.refresh();
    });
  }

  /** 退出频道 / 归档频道: done, the room leaves the list and the screen. */
  function closeRoom(kind: "leave" | "archive") {
    start(async () => {
      const res = await (kind === "leave" ? leaveChannelAction(slug) : archiveChannelAction(slug)).catch(() => ({ error: zh ? "没成功，再试一次" : "That did not work; try again" }));
      if (res?.error) return notify(res.error);
      notify(kind === "leave" ? (zh ? `已退出 #${name}` : `Left #${name}`) : zh ? `#${name} 已归档` : `#${name} archived`, "ok");
      router.push("/chat");
      router.refresh();
    });
  }

  const shown = [...messages, ...optimistic]
    .filter((m) => !gone.includes(m.id))
    .map((m) => (m.id in patched ? { ...m, body: patched[m.id], editedAt: m.editedAt ?? new Date().toISOString() } : m));

  return (
    <>
      {/* Below ~1200px the assistant column folds away, so the messages keep
          their width; the header's spark button opens it over the channel
          (QA, 2 Oct: at 1024px four columns left the messages ~270px). */}
      <style>{DOCK_CSS}</style>
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative" }}>
        <ChannelSurface
          name={name}
          topic={topic}
          memberCount={memberCount}
          members={members}
          messages={shown}
          pending={workingRows}
          sending={pending}
          onSend={send}
          onPress={press}
          pressing={pressing}
          project={project}
          onStartCut={project ? startCut : undefined}
          cutting={cutting}
          people={mentionPeople ?? studioPeople}
          canAttach={canAttach}
          failed={failed}
          onDismissFailure={() => setFailed(null)}
          canPost={canPost && !archived}
          readOnlyNote={
            archived
              ? zh
                ? "这个频道已归档，只能查看，不能再发消息。"
                : "This channel is archived. You can read it but not post."
              : canPost
                ? undefined
                : zh
                  ? "公司公告，仅管理员可以发布。"
                  : "Company-wide announcements. Only an administrator posts here."
          }
          meId={me.id ?? null}
          isPrivate={isPrivate}
          onEdit={archived ? undefined : edit}
          onDelete={archived ? undefined : remove}
          onLeave={canLeave && !archived ? () => closeRoom("leave") : undefined}
          onArchive={canArchive && !archived ? () => closeRoom("archive") : undefined}
          onToggleAssistant={() => setDockOpen((v) => !v)}
          locale={locale}
          now={now}
          isDirect={isDirect}
          directAvatar={directAvatar}
          directId={directId}
          onOpenMembers={studioPeople ? () => setShowMembers(true) : undefined}
        />

        {/* The agent, in the room.
            It was on every screen but this one, which is the screen where "what
            did I miss" and "tell them it's ready" are asked most. It is given
            this channel's id, so both mean something without anybody naming it —
            and it posts as the person, never as a bot. The AI employees tagged
            in the channel itself are a different thing: they post as
            themselves, under their own names and their own permissions. */}
        <div className="cv-dock" data-open={dockOpen || undefined} ref={dockRef}>
          <button type="button" className="cv-dock-close" onClick={() => setDockOpen(false)} aria-label={zh ? "收起助理" : "Close the assistant"} title={zh ? "收起助理" : "Close"}>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M7 7l10 10M17 7 7 17" />
            </svg>
          </button>
          <AgentDock
            zh={zh}
            model={model}
            context={{ module: "chat", channelId }}
            scope={isDirect ? `@${name}` : `#${name}`}
            /* A direct message is a conversation, not a 频道 (QA, 2 Oct). */
            note={
              isDirect
                ? zh
                  ? `可以让它总结你和${name}的对话、找某条消息，或替你发一条。它以你的身份发送。要叫 AI 员工，在下面的输入框里 @ 它们。`
                  : `Ask it to summarise your conversation with ${name}, find a message, or send one for you. It posts as you. To bring in an AI employee, @ them in the composer below.`
                : zh
                  ? "可以让它总结这个频道、找某条消息，或替你发一条。它以你的身份发送。要叫 AI 员工，在下面的输入框里 @ 它们。"
                  : "Ask it to summarise this channel, find a message, or send one for you. It posts as you. To bring in an AI employee, @ them in the composer below."
            }
            placeholder={isDirect ? (zh ? "问这段对话…" : "Ask about this conversation…") : zh ? "问这个频道…" : "Ask about this channel…"}
          />
        </div>
      </div>

      {showMembers && studioPeople && (
        <MembersSheet
          slug={slug}
          channelName={name}
          isPrivate={isPrivate}
          studioPeople={studioPeople}
          zh={locale.startsWith("zh")}
          onClose={() => setShowMembers(false)}
        />
      )}
    </>
  );
}

/* The assistant column, folded below 1200px and opened over the channel by
   the header's spark button (QA, 2 Oct). */
const DOCK_CSS = `
.cv-dock { display: flex; flex-shrink: 0; min-height: 0; }
.cv-dock-btn { display: none !important; }
.cv-dock-close { display: none; }
@media (max-width: 1199px) {
  .cv-dock { display: none; }
  .cv-dock[data-open] { display: flex; position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; background: #fff; box-shadow: -12px 0 32px rgba(0,0,0,.08); }
  .cv-dock-btn { display: inline-flex !important; align-items: center; justify-content: center; }
  .cv-dock[data-open] .cv-dock-close { display: inline-flex; position: absolute; top: 8px; left: -40px; width: 32px; height: 32px; align-items: center; justify-content: center; border: 1px solid #e3e3e0; border-radius: 99px; background: #fff; color: #444; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
}
`;
