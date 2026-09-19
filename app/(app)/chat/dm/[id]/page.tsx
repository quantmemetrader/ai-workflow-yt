import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { channelMessages, dmChannelWith, markRead } from "@/lib/chat/service";
import { ChannelView } from "@/components/chat/ChannelView";

/** A one-to-one conversation. The room is created the first time either person
 * opens it, so there is no "start a chat" step to get wrong. */
export default async function DirectMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("chat");

  const dm = await dmChannelWith(viewer, id);
  if (!dm) notFound();

  const rows = await channelMessages(dm.channel.id);
  await markRead(viewer, dm.channel.id);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const otherName = (zh && dm.other.nameLocal) || dm.other.name;

  return (
    <ChannelView
      slug={dm.channel.slug!}
      name={otherName}
      topic={dm.other.title}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={2}
      members={[
        { name: viewer.name, avatar: viewer.avatarUrl },
        { name: otherName, avatar: dm.other.avatarUrl },
      ]}
      messages={rows.map((r) => ({
        id: r.message.id,
        authorName: (zh && r.authorNameLocal) || r.authorName || "—",
        authorAvatar: r.authorAvatar,
        body: r.message.body,
        createdAt: r.message.createdAt.toISOString(),
      }))}
    />
  );
}
