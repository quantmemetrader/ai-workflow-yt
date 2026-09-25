import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { attachmentsFor, channelMessages, dmChannelWith, listPeople, markRead } from "@/lib/chat/service";
import { ChannelView } from "@/components/chat/ChannelView";
import { answeringModel } from "@/lib/ai/models";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { readCardKind, readHandoff } from "@/lib/chat/handoff";

/** A one-to-one conversation. The room is created the first time either person
 * opens it, so there is no "start a chat" step to get wrong. */
export default async function DirectMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("chat");

  const dm = await dmChannelWith(viewer, id);
  if (!dm) notFound();

  const rows = await channelMessages(dm.channel.id);
  await markRead(viewer, dm.channel.id);

  // Who can be tagged in here, and what the attached files are — both checked
  // against this reader, not against whoever sent the message.
  const [people, attachments] = await Promise.all([
    listPeople(viewer),
    attachmentsFor(
      viewer,
      rows.flatMap((r) => r.message.attachments ?? []),
    ),
  ]);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const otherName = (zh && dm.other.nameLocal) || dm.other.name;

  return (
    <ChannelView
      slug={dm.channel.slug!}
      channelId={dm.channel.id}
      model={answeringModel()}
      name={otherName}
      topic={dm.other.title}
      directAvatar={dm.other.avatarUrl}
      canAttach={viewer.modules.includes("files")}
      me={{ name: (zh && viewer.nameLocal) || viewer.name, avatarUrl: viewer.avatarUrl }}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={2}
      members={[
        { name: (zh && viewer.nameLocal) || viewer.name, avatar: viewer.avatarUrl },
        { name: otherName, avatar: dm.other.avatarUrl },
      ]}
      /* A direct message has two people in it and no list to manage, so the
         header's pill stays a label — but the composer still needs names to
         offer, because an AI employee can be pulled into a DM too. */
      mentionPeople={people.map((p) => ({
        id: p.id,
        name: (zh && p.nameLocal) || p.name,
        avatarUrl: p.avatarUrl,
        title: p.title,
      }))}
      messages={rows.map((r) => ({
        id: r.message.id,
        authorName: (zh && r.authorNameLocal) || r.authorName || "—",
        authorAvatar: r.authorAvatar,
        isAgent: r.authorIsAgent === true,
        /* Which employee, so an agent pulled into a DM answers with its own
           face and colour. This was never set here, and every employee who
           answered in a DM was drawn as the host's assistant. */
        agentKey: r.authorIsAgent ? agentKeyFromEmail(r.authorEmail) : null,
        roleLabel: r.authorTitle,
        attachments: (r.message.attachments ?? []).flatMap((id) => attachments.get(id) ?? []),
        handoff: readHandoff(r.message.meta),
        card: readCardKind(r.message.meta),
        body: r.message.body,
        createdAt: r.message.createdAt.toISOString(),
      }))}
      now={new Date().toISOString()}
    />
  );
}
