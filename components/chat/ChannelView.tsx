"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChannelSurface, type ChannelMember, type ChannelMessage, type ChannelPending } from "@/components/chat/ChannelSurface";
import { pendingStamp } from "@/lib/agents/steps";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { pressCardAction, sendChannelMessage } from "@/app/(app)/chat/actions";
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
  pending: workingRows = [],
}: {
  slug: string;
  /** The employees at work in this channel, each on its current step. */
  pending?: ChannelPending[];
  /** Who is typing: the name the optimistic row is signed with while the
   * server's copy is on its way. It was the channel's name. */
  me: { name: string; avatarUrl: string | null };
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
  const [seen, setSeen] = useState(messages);
  if (seen !== messages) {
    setSeen(messages);
    setOptimistic([]);
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

  function send(body: string, attachmentIds: string[]) {
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
      authorName: me.name,
      authorAvatar: me.avatarUrl,
      body,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setFailed(null);
    setOptimistic((rest) => [...rest, mine]);

    start(async () => {
      const res = await sendChannelMessage(slug, body, attachmentIds);
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

  return (
    <>
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
        <ChannelSurface
          name={name}
          topic={topic}
          memberCount={memberCount}
          members={members}
          messages={[...messages, ...optimistic]}
          pending={workingRows}
          sending={pending}
          onSend={send}
          onPress={press}
          pressing={pressing}
          people={mentionPeople ?? studioPeople}
          canAttach={canAttach}
          failed={failed}
          onDismissFailure={() => setFailed(null)}
          canPost={canPost}
          readOnlyNote={
            canPost
              ? undefined
              : zh
                ? "公司公告，仅管理员可以发布。"
                : "Company-wide announcements. Only an administrator posts here."
          }
          locale={locale}
          now={now}
          isDirect={isDirect}
          directAvatar={directAvatar}
          onOpenMembers={studioPeople ? () => setShowMembers(true) : undefined}
        />

        {/* The agent, in the room.
            It was on every screen but this one, which is the screen where "what
            did I miss" and "tell them it's ready" are asked most. It is given
            this channel's id, so both mean something without anybody naming it —
            and it posts as the person, never as a bot. The AI employees tagged
            in the channel itself are a different thing: they post as
            themselves, under their own names and their own permissions. */}
        <AgentDock
          zh={zh}
          model={model}
          context={{ module: "chat", channelId }}
          scope={isDirect ? `@${name}` : `#${name}`}
          note={
            zh
              ? "可以让它总结这个频道、找某条消息，或替你发一条。它以你的身份发送。要叫 AI 员工，在下面的输入框里 @ 它们。"
              : "Ask it to summarise this channel, find a message, or send one for you. It posts as you. To bring in an AI employee, @ them in the composer below."
          }
          placeholder={zh ? "问这个频道…" : "Ask about this channel…"}
        />
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
