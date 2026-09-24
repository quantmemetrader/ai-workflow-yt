import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { announcementsChannel, channelMembers, channelThread, listPeople, markRead } from "@/lib/chat/service";
import { ChannelView } from "@/components/chat/ChannelView";
import { answeringModel } from "@/lib/ai/models";

export default async function ChannelPage({ params }: { params: Promise<{ slug: string }> }) {
  /* The segment can arrive still percent-encoded: a channel named 研究日报
     reached this page as "%E7%A0%94…" and matched no slug, so every channel
     with a Chinese name was a 404. Slugs are only ever letters, digits and
     hyphens (`createChannel`), so a "%" can only mean an encoded one. */
  const { slug: raw } = await params;
  const slug = decodeSlug(raw);
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
      /* The composer's paperclip goes through /api/files/presign, which
         refuses anybody without the Files module. Better not drawn than
         drawn and refused. */
      canAttach={viewer.modules.includes("files")}
      me={{ name: (zh && viewer.nameLocal) || viewer.name, avatarUrl: viewer.avatarUrl }}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={members.length}
      members={members.map((m) => ({ name: (zh && m.nameLocal) || m.name, avatar: m.avatarUrl }))}
      studioPeople={people.map((p) => ({
        id: p.id,
        name: (zh && p.nameLocal) || p.name,
        avatarUrl: p.avatarUrl,
        title: p.title,
      }))}
      messages={thread.messages.map((m) => ({
        id: m.id,
        authorName: (zh && m.authorNameLocal) || m.authorName || "—",
        authorAvatar: m.authorAvatar,
        /* An AI employee's messages say so, and say which one. Without this
           the studio's three agents read as three colleagues. */
        isAgent: m.authorIsAgent,
        roleLabel: m.authorTitle,
        attachments: m.attachments,
        /* The buttons it put under what it said, and who has already
           pressed one. */
        actions: m.actions,
        done: m.done,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}

function decodeSlug(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
