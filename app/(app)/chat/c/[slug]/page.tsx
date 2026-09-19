import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { channelThread, listPeople, markRead } from "@/lib/chat/service";
import { ChannelView } from "@/components/chat/ChannelView";

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireModule("chat");

  // One query for the channel and its messages, and the people list alongside
  // it — a private channel this person is not in reports as missing, not as
  // denied.
  const [thread, people] = await Promise.all([channelThread(viewer, slug), listPeople(viewer)]);
  if (!thread) notFound();
  const { channel } = thread;

  // Marking the channel read is a write nobody should wait on.
  after(() => markRead(viewer, channel.id));

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  return (
    <ChannelView
      slug={slug}
      name={channel.name}
      topic={channel.topic}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={people.length + 1}
      members={[
        { name: viewer.name, avatar: viewer.avatarUrl },
        ...people.map((p) => ({ name: p.name, avatar: p.avatarUrl })),
      ]}
      messages={thread.messages.map((m) => ({
        id: m.id,
        authorName: (zh && m.authorNameLocal) || m.authorName || "—",
        authorAvatar: m.authorAvatar,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
