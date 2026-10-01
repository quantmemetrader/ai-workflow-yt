import { channelName } from "@/lib/chat/channel-name";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { announcementsChannel, canArchiveChannel, channelMembers, channelThread, listPeople, markRead } from "@/lib/chat/service";
import { distinctNames } from "@/lib/chat/people";
import { ChannelView } from "@/components/chat/ChannelView";
import { answeringModel } from "@/lib/ai/models";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { projectLinks, projectOfChannel } from "@/lib/projects/service";

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
  /* The project each message is about, for its "打开项目" button: named
     outright or through the script and video it handed over, and only the
     projects this person may see (`projectLinks`). */
  /* And the project this chat belongs to, when it is a project's own: the
     live status row while its film is made, and the 开始剪 press under a
     take dropped here, are about it. */
  const [members, links, project] = await Promise.all([
    channelMembers(viewer, channel.id),
    projectLinks(viewer, thread.messages.map((m) => ({ messageId: m.id, ...m.refs }))),
    projectOfChannel(viewer, channel.id),
  ]);

  // Marking the channel read is a write nobody should wait on.
  after(() => markRead(viewer, channel.id));

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* 退出 / 归档 (QA, 2 Oct): a project's chat is closed with its project. */
  const roomCanArchive = !project && canArchiveChannel(viewer, { createdBy: channel.createdBy, slug: channel.slug, name: channel.name, kind: channel.kind });
  const roomCanLeave = !project && channel.kind === "channel" && channel.isPrivate && members.some((m) => m.id === viewer.id) && members.length > 1;
  /* Two people with one name are told apart (QA, 2 Oct: two 「Ryan」). */
  const label = distinctNames(people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name, email: p.email, title: p.title })));

  return (
    <ChannelView
      slug={slug}
      channelId={channel.id}
      model={answeringModel()}
      name={zh ? channelName(slug, channel.name) : channel.name}
      topic={channel.topic}
      isPrivate={channel.isPrivate}
      archived={channel.archivedAt !== null}
      canArchive={roomCanArchive}
      canLeave={roomCanLeave}
      canPost={channel.kind !== "announce" || viewer.isAdmin}
      /* The composer's paperclip goes through /api/files/presign, which
         refuses anybody without the Files module. Better not drawn than
         drawn and refused. */
      canAttach={viewer.modules.includes("files")}
      me={{ id: viewer.id, name: (zh && viewer.nameLocal) || viewer.name, avatarUrl: viewer.avatarUrl }}
      locale={viewer.locale ?? "zh-CN"}
      memberCount={members.length}
      members={members.map((m) => ({ id: m.id, name: (zh && m.nameLocal) || m.name, avatar: m.avatarUrl }))}
      studioPeople={people.map((p) => ({
        id: p.id,
        name: label.get(p.id) ?? ((zh && p.nameLocal) || p.name),
        avatarUrl: p.avatarUrl,
        title: p.title,
        /* Searched by the @-picker so `@ry` finds somebody whose display name
           is written in Chinese. Never rendered. */
        email: p.email,
      }))}
      project={project ? { id: project.id, title: project.title, videoProjectId: project.videoProjectId } : null}
      messages={thread.messages.map((m) => ({
        id: m.id,
        /* A take dropped here went into the project's bin: offer the cut,
           once (`startCutFromChatAction`). */
        cutOffer: m.binned && project && m.binned.projectId === project.id && !m.cutPressed ? { projectId: project.id, title: project.title } : null,
        authorId: m.authorId,
        authorName: (zh && m.authorNameLocal) || m.authorName || "—",
        authorAvatar: m.authorAvatar,
        /* An AI employee's messages say so, and say which one. Without this
           the studio's three agents read as three colleagues. */
        isAgent: m.authorIsAgent,
        agentKey: m.authorIsAgent ? agentKeyFromEmail(m.authorEmail) : null,
        roleLabel: m.authorTitle,
        attachments: m.attachments,
        /* The buttons it put under what it said, and who has already
           pressed one. */
        actions: m.actions,
        done: m.done,
        handoff: m.handoff,
        card: m.card,
        project: links.get(m.id) ?? null,
        job: m.job,
        /* The renders and videos it names, as cards this reader may open. */
        videos: m.videos,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      }))}
      /* The employees at work here right now, drawn after the last message
         with the step each one is on. */
      pending={thread.pending.map((r) => ({ id: r.id, agent: r.agent, step: r.step, since: r.since, job: r.job ?? null }))}
      /* The server's "now", so "今天" and "昨天" are worked out once and
         hydrate to the same words. */
      now={new Date().toISOString()}
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
