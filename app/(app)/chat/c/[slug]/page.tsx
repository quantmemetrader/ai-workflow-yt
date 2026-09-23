import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { announcementsChannel, channelMembers, channelThread, listPeople, markRead } from "@/lib/chat/service";
import { ChannelView } from "@/components/chat/ChannelView";
import { answeringModel } from "@/lib/ai/models";

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireModule("chat");

  // One query for the channel and its messages, and the people list alongside
  // it — a private channel this person is not in reports as missing, not as
  // denied.
  /* The announcements channel is made on demand and joined on every open, so
     a studio that has never used it has no empty channel and somebody who
     joined yesterday is already a member. */
  if (slug === "announcements") await announcementsChannel(viewer);

  const [thread, people] = await Promise.all([channelThread(viewer, slug), listPeople(viewer)]);
  if (!thread) notFound();
  const { channel } = thread;

  /*
   * The faces in the header used to be the whole studio, and the count was
   * `everyone + 1`. In a public channel that was merely wrong; in a private
   * one it showed the people who are specifically not in it. These are the
   * channel's own members.
   */
  const members = await channelMembers(viewer, channel.id);

  // Marking the channel read is a write nobody should wait on.
  after(() => markRead(viewer, channel.id));

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  return (
    <ChannelView
      slug={slug}
      channelId={channel.id}
      model={answeringModel()}
      name={channel.name}
      topic={channel.topic}
      isPrivate={channel.isPrivate}
      canPost={channel.kind !== "announce" || viewer.isAdmin}
      me={{ name: (zh && viewer.nameLocal) || viewer.name, avatarUrl: viewer.avatarUrl }}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={members.length}
      members={members.map((m) => ({ name: (zh && m.nameLocal) || m.name, avatar: m.avatarUrl }))}
      studioPeople={people.map((p) => ({
        id: p.id,
        name: (zh && p.nameLocal) || p.name,
        avatarUrl: p.avatarUrl,
      }))}
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
