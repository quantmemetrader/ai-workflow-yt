"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChannelScreen, type ChannelMember, type ChannelMessage } from "@/components/canvas/ChannelScreen";
import { sendChannelMessage } from "@/app/(app)/chat/actions";
import { MembersSheet } from "@/components/chat/MembersSheet";
import { AgentDock } from "@/components/shell/AgentDock";

/**
 * Live wiring for the channel artboard: sending, and picking up other people's
 * messages.
 *
 * New messages arrive by re-fetching the server component every few seconds
 * rather than over a socket — the studio is nine people, the payload is small,
 * and it keeps the deployment to one stateless service. This is the single
 * component to change when that stops being true.
 */
export function ChannelView({
  slug,
  name,
  topic,
  isPrivate = false,
  memberCount,
  members,
  studioPeople,
  messages,
  locale,
  channelId,
  model,
  canPost = true,
  me,
}: {
  slug: string;
  /** Who is typing: the name the optimistic row is signed with while the
   * server's copy is on its way. It was the channel's name. */
  me: { name: string; avatarUrl: string | null };
  name: string;
  topic: string | null;
  isPrivate?: boolean;
  memberCount: number;
  members: ChannelMember[];
  /** Everyone in the studio, for the members sheet's "add" list. A direct
   * message has exactly two people in it and no list to manage, so it passes
   * nothing and the header's pill stays a label. */
  studioPeople?: { id: string; name: string; avatarUrl: string | null }[];
  messages: ChannelMessage[];
  locale: string;
  /** The channel's id, so the agent beside it knows which room it is in. */
  channelId: string;
  model: string;
  /** False on an announcements channel for anyone but an administrator. */
  canPost?: boolean;
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
  const [seen, setSeen] = useState(messages);
  if (seen !== messages) {
    setSeen(messages);
    setOptimistic([]);
  }

  // Polling asks a one-row question ("newest message id?") and only re-renders
  // the thread when the answer changes. An idle open channel therefore costs a
  // single indexed read every few seconds, not a page render.
  const latest = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    let known = latest;
    let stop = false;

    async function poll() {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/chat/pulse?slug=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { latest: newest } = await res.json();
        if (newest && newest !== known) {
          known = newest;
          router.refresh();
        }
      } catch {
        // A dropped poll is not worth telling anyone about; the next one runs.
      }
    }

    const id = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [router, slug, latest]);

  function send(body: string) {
    /*
     * Three things, and the last two are the reason direct messages looked
     * broken for a week.
     *
     *   — The message appears *now*, as the person's own, and is replaced by
     *     the server's copy when the refresh lands. Waiting for a round trip
     *     to Singapore before anything appears reads as "it didn't send".
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
      const res = await sendChannelMessage(slug, body);
      if (res?.error) {
        setOptimistic((rest) => rest.filter((m) => m.id !== mine.id));
        setFailed({ body, error: res.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      <ChannelScreen
        name={name}
        topic={topic}
        memberCount={memberCount}
        members={members}
        messages={[...messages, ...optimistic]}
        sending={pending}
        onSend={send}
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
        onOpenMembers={studioPeople ? () => setShowMembers(true) : undefined}
      />

      {/* The agent, in the room.
          It was on every screen but this one, which is the screen where "what
          did I miss" and "tell them it's ready" are asked most. It is given
          this channel's id, so both mean something without anybody naming it —
          and it posts as the person, never as a bot. */}
      <AgentDock
        zh={zh}
        model={model}
        context={{ module: "chat", channelId }}
        scope={`#${name}`}
        note={
          zh
            ? "可以让它总结这个频道、找某条消息，或替你发一条。它以你的身份发送。"
            : "Ask it to summarise this channel, find a message, or send one for you. It posts as you."
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
