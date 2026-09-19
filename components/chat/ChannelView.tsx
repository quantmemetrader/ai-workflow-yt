"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChannelScreen, type ChannelMember, type ChannelMessage } from "@/components/canvas/ChannelScreen";
import { sendChannelMessage } from "@/app/(app)/chat/actions";

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
  memberCount,
  members,
  messages,
  locale,
}: {
  slug: string;
  name: string;
  topic: string | null;
  memberCount: number;
  members: ChannelMember[];
  messages: ChannelMessage[];
  locale: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  /*
   * Anything typed before the server render catches up lives here, and is
   * thrown away the moment the server's own copy arrives. Adjusting during
   * render is React's documented pattern for state derived from a prop — an
   * effect would paint the message twice.
   */
  const [optimistic, setOptimistic] = useState<ChannelMessage[]>([]);
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
    start(async () => {
      await sendChannelMessage(slug, body);
      router.refresh();
    });
  }

  return (
    <ChannelScreen
      name={name}
      topic={topic}
      memberCount={memberCount}
      members={members}
      messages={[...messages, ...optimistic]}
      sending={pending}
      onSend={send}
      locale={locale}
    />
  );
}
