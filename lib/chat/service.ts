import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, toDate } from "@/lib/db/client";
import {
  agentMessages,
  chatChannels,
  chatMembers,
  chatMessages,
  citations,
  conversations,
  files,
  folders,
  toolCalls,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { canReadFiles, relationOn } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { readCardActions, readCardDone } from "@/lib/agents/cards";
import { readCardKind, readHandoff, readJob, readWorkRefs } from "@/lib/chat/handoff";
import { pendingInChannel } from "@/lib/chat/pending";
import type { AgentKey } from "@/lib/agents/catalog";

/** Channels this person is in, plus the public ones they could join. A private
 * channel they are not in is not listed — the same rule as files. */
export const listChannels = cache(async function listChannels(viewer: Viewer) {
  const rows = await db
    .select({
      channel: chatChannels,
      member: chatMembers.userId,
      lastReadAt: chatMembers.lastReadAt,
      unread: sql<number>`(
        select count(*)::int from chat_messages m
        where m.channel_id = ${chatChannels.id}
          and m.deleted_at is null
          and m.author_id <> ${viewer.id}
          and (${chatMembers.lastReadAt} is null or m.created_at > ${chatMembers.lastReadAt})
      )`,
    })
    .from(chatChannels)
    .leftJoin(
      chatMembers,
      and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, viewer.id)),
    )
    .where(
      and(
        eq(chatChannels.tenantId, viewer.tenantId),
        isNull(chatChannels.archivedAt),
        /* Direct messages have their own list in the sidebar. Announcements
           belongs in the channel list — it is a channel you read — and sorts
           to the top below, because that is the one people are looking for
           when something has been announced. */
        inArray(chatChannels.kind, ["channel", "announce"]),
        or(eq(chatChannels.isPrivate, false), sql`${chatMembers.userId} is not null`),
      ),
    )
    .orderBy(chatChannels.name);

  return rows
    .map((r) => ({
      id: r.channel.id,
      slug: r.channel.slug,
      name: r.channel.name,
      topic: r.channel.topic,
      isPrivate: r.channel.isPrivate,
      kind: r.channel.kind,
      isMember: Boolean(r.member),
      unread: Number(r.unread ?? 0),
    }))
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "announce" ? -1 : 1,
    );
});

export async function channelBySlug(viewer: Viewer, slug: string) {
  const [row] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), eq(chatChannels.slug, slug)))
    .limit(1);
  if (!row) return null;

  if (row.isPrivate) {
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, row.id), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!member) return null;
  }
  return row;
}

/** The same visibility rule as `channelBySlug`, by id: a private channel does
 * not exist for somebody who is not in it. */
export async function channelById(viewer: Viewer, channelId: string) {
  if (typeof channelId !== "string" || !channelId || channelId.length > 64) return null;

  const [row] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), eq(chatChannels.id, channelId)))
    .limit(1);
  if (!row) return null;

  if (row.isPrivate) {
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, row.id), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!member) return null;
  }
  return row;
}

export async function channelMessages(channelId: string, limit = 80) {
  const rows = await db
    .select({
      message: chatMessages,
      authorName: users.name,
      authorNameLocal: users.nameLocal,
      authorAvatar: users.avatarUrl,
      /** So the message list can say "this is an AI employee" rather than
       * leaving it to be mistaken for a colleague. */
      authorIsAgent: users.isAgent,
      authorTitle: users.title,
      /* Which employee an agent row is, read off its address
         (`agentKeyFromEmail`). Without it a direct message could say "this is
         an AI employee" but not which one, and every one of them was drawn
         with the host's face. */
      authorEmail: users.email,
    })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.authorId))
    .where(and(eq(chatMessages.channelId, channelId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function postMessage(
  viewer: Viewer,
  channelId: string,
  body: string,
  /** Machine-readable context — an agent's mentions and hand-off ids — kept
   * beside the text rather than parsed back out of it (`lib/agents`). */
  meta?: Record<string, unknown>,
  /** File ids already uploaded and confirmed. Stored as ids, never as URLs:
   * what a reader may open is decided when the message is drawn, for that
   * reader, not when it was sent. */
  attachments?: string[],
) {
  const text = body.trim();
  const files = attachments?.length ? [...new Set(attachments)].slice(0, 10) : [];
  // A message with a file on it and nothing typed is a perfectly ordinary
  // thing to send; an empty one with nothing attached is not.
  if (!text && !files.length) return null;

  const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  if (!channel || channel.tenantId !== viewer.tenantId) throw new Error("Channel not found");

  /* An announcements channel is read-only to everybody but an administrator.
     Enforced here rather than by hiding the composer: a composer that is not
     drawn is a UI decision, and this is a rule. */
  if (channel.kind === "announce" && !viewer.isAdmin) {
    throw new Error("Only an administrator posts in announcements.");
  }

  if (channel.isPrivate) {
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!member) throw new Error("Channel not found");
  }

  const id = newId("msg");
  await db
    .insert(chatMessages)
    .values({ id, channelId, authorId: viewer.id, body: text, meta: meta ?? {}, attachments: files });

  // The channel's clock and the sender's own read mark touch different rows and
  // neither gates the other. Sent together they cost one crossing of the planet
  // instead of two, which is most of the wait after pressing enter.
  await Promise.all([
    db.update(chatChannels).set({ lastMessageAt: new Date() }).where(eq(chatChannels.id, channelId)),
    db
      .insert(chatMembers)
      .values({ channelId, userId: viewer.id, lastReadAt: new Date() })
      .onConflictDoUpdate({
        target: [chatMembers.channelId, chatMembers.userId],
        set: { lastReadAt: new Date() },
      }),
  ]);

  return id;
}

export async function markRead(viewer: Viewer, channelId: string) {
  await db
    .insert(chatMembers)
    .values({ channelId, userId: viewer.id, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [chatMembers.channelId, chatMembers.userId],
      set: { lastReadAt: new Date() },
    });
}

/* ---------- the agent side ---------- */

export async function listConversations(viewer: Viewer, limit = 20) {
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.userId, viewer.id), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

/**
 * This person's own conversations in which one employee answered, newest
 * first, with the employee's last line in each.
 *
 * "Press on an AI 同事 and see their texts, not a blank box": `/chat?agent=…`
 * opens the newest of these, and lists the rest. Only the person's own
 * threads (`conversations.user_id`), the same rule the thread page keeps; an
 * employee's own threads in the channels are its, and what it said there is
 * `agentChannelLines` below.
 */
export async function conversationsWithAgent(viewer: Viewer, key: AgentKey, limit = 12) {
  const { rows } = await db.execute<{ id: string; title: string; updated_at: unknown; last: string | null; last_at: unknown }>(sql`
    select c.id, c.title, c.updated_at, l.content as last, l.created_at as last_at
      from ${conversations} c
      join lateral (
        select am.content, am.created_at
          from ${agentMessages} am
         where am.conversation_id = c.id and am.speaker = ${key} and am.role = 'assistant' and am.content <> ''
         order by am.created_at desc
         limit 1
      ) l on true
     where c.user_id = ${viewer.id} and c.archived_at is null
     order by greatest(c.updated_at, l.created_at) desc
     limit ${Math.min(Math.max(limit, 1), 40)}
  `);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: (toDate(r.last_at) ?? toDate(r.updated_at) ?? new Date()).toISOString(),
    last: (r.last ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
  }));
}

/**
 * What one employee said lately in the channels this person can read:
 * public rooms and the private ones they are in, direct messages aside.
 * A project's chat is named as its project, so the link opens the project
 * page, where that chat lives. Placeholders are never among them (deleted
 * from birth), nor anything deleted.
 */
export async function agentChannelLines(viewer: Viewer, key: AgentKey, limit = 6) {
  const { rows } = await db.execute<{
    id: string;
    body: string;
    created_at: unknown;
    channel_id: string;
    channel_name: string;
    slug: string | null;
    project_id: string | null;
    project_title: string | null;
  }>(sql`
    select m.id, m.body, m.created_at, c.id as channel_id, c.name as channel_name, c.slug,
           wp.id as project_id, wp.title as project_title
      from ${chatMessages} m
      join ${users} u on u.id = m.author_id and u.tenant_id = ${viewer.tenantId} and u.email = ${`${key}@agents.invalid`}
      join ${chatChannels} c on c.id = m.channel_id and c.tenant_id = ${viewer.tenantId}
      left join work_projects wp on wp.channel_id = c.id and wp.deleted_at is null
     where m.deleted_at is null
       and m.body <> ''
       and c.archived_at is null
       and c.kind in ('channel', 'announce')
       and (c.is_private = false or exists (
            select 1 from ${chatMembers} cm where cm.channel_id = c.id and cm.user_id = ${viewer.id}))
     order by m.created_at desc
     limit ${Math.min(Math.max(limit, 1), 20)}
  `);
  return rows.map((r) => ({
    id: r.id,
    body: r.body.replace(/\s+/g, " ").trim().slice(0, 220),
    at: (toDate(r.created_at) ?? new Date()).toISOString(),
    where: r.project_title ? { kind: "project" as const, name: r.project_title, href: `/projects/${r.project_id}` } : { kind: "channel" as const, name: r.channel_name, href: r.slug ? `/chat/c/${encodeURIComponent(r.slug)}` : "/chat" },
  }));
}

/** A conversation with everything the screen must show: the answer, what it
 * ran, what it read, and what it cost. */
export async function conversationDetail(viewer: Viewer, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, viewer.id)))
    .limit(1);
  if (!conversation) return null;

  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(asc(agentMessages.createdAt));

  const ids = messages.map((m) => m.id);
  const [cites, calls] = ids.length
    ? await Promise.all([
        db
          .select({
            messageId: citations.messageId,
            fileId: citations.fileId,
            name: files.name,
            kind: files.kind,
            folder: folders.name,
          })
          .from(citations)
          .innerJoin(files, eq(files.id, citations.fileId))
          .leftJoin(folders, eq(folders.id, files.folderId))
          .where(inArray(citations.messageId, ids)),
        db
          .select({
            messageId: toolCalls.messageId,
            id: toolCalls.id,
            name: toolCalls.name,
            status: toolCalls.status,
            args: toolCalls.args,
            durationMs: toolCalls.durationMs,
          })
          .from(toolCalls)
          .where(inArray(toolCalls.messageId, ids)),
      ])
    : [[], []];

  // The sources panel names the access the reader holds on each cited file.
  // A file whose sharing changed since the answer was written drops out here,
  // which is the correct behaviour: the list must reflect access now.
  //
  // Asked once per *file*, not once per citation: a conversation cites the same
  // few documents over and over, and each ask is its own query.
  const fileIds = [...new Set(cites.map((c) => c.fileId))];
  const relations = new Map(
    await Promise.all(
      fileIds.map(async (id) => [id, await relationOn(viewer, "file", id)] as const),
    ),
  );

  return {
    conversation,
    messages,
    citations: cites
      .map((c) => ({ ...c, relation: relations.get(c.fileId) ?? null }))
      .filter((c) => c.relation !== null),
    toolCalls: calls,
  };
}

/** Everyone else in the studio, for the direct-message list. Presence is
 * derived from when they were last actually seen — the artboard has three dot
 * states and this is what they mean here. */
export const listPeople = cache(async function listPeople(viewer: Viewer) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      nameLocal: users.nameLocal,
      avatarUrl: users.avatarUrl,
      /** The role line under a name in the composer's @-picker. */
      title: users.title,
      role: users.role,
      email: users.email,
      lastActiveAt: users.lastActiveAt,
    })
    .from(users)
    /*
     * People, and only people.
     *
     * A suspended service principal — the row the schedulers act as — was
     * listed here as a colleague called "Scheduled work", so the studio's
     * message list showed a member of staff nobody had hired. It is not an
     * agent (`is_agent` is for the AI employees) and it is not deleted, so
     * neither filter caught it; being suspended is what makes it not somebody
     * to message.
     */
    .where(
      and(
        eq(users.tenantId, viewer.tenantId),
        isNull(users.deletedAt),
        eq(users.isAgent, false),
        eq(users.status, "active"),
      ),
    )
    .orderBy(users.name);

  /* Unread per person: their messages in the one-to-one room since this
     viewer last read it. One query for everyone rather than one per row. */
  const unreadRows = await db.execute<{ other: string; unread: number }>(sql`
    select m.author_id as other, count(*)::int as unread
      from chat_messages m
      join chat_channels c on c.id = m.channel_id and c.kind = 'dm' and c.tenant_id = ${viewer.tenantId}
      join chat_members me on me.channel_id = c.id and me.user_id = ${viewer.id}
     where m.deleted_at is null
       and m.author_id <> ${viewer.id}
       and (me.last_read_at is null or m.created_at > me.last_read_at)
     group by m.author_id
  `);
  const unreadBy = new Map(unreadRows.rows.map((r) => [r.other, Number(r.unread)]));

  const now = Date.now();
  return rows
    .filter((r) => r.id !== viewer.id)
    .map((r) => {
      const seen = r.lastActiveAt ? now - r.lastActiveAt.getTime() : Infinity;
      const presence: "g" | "a" | "o" =
        r.role === "guest" ? "o" : seen < 5 * 60_000 ? "g" : seen < 60 * 60_000 ? "a" : "o";
      return {
        id: r.id,
        name: r.name,
        nameLocal: r.nameLocal,
        avatarUrl: r.avatarUrl,
        title: r.title,
        /* For the @-picker to search on, never to show: somebody whose
           display name is written in Chinese is still found by typing the
           Latin handle they sign in with. */
        email: r.email,
        presence,
        isGuest: r.role === "guest",
        unread: unreadBy.get(r.id) ?? 0,
      };
    });
});

/**
 * The one-to-one channel between two people, created on first use. The id is
 * derived from the pair so the same conversation is found from either side and
 * two people cannot end up with two private rooms.
 */
export async function dmChannelWith(viewer: Viewer, otherId: string) {
  const [other] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, otherId), eq(users.tenantId, viewer.tenantId)))
    .limit(1);
  if (!other) return null;

  const slug = `dm-${[viewer.id, otherId].sort().join("-")}`;
  const [existing] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), eq(chatChannels.slug, slug)))
    .limit(1);

  if (existing) return { channel: existing, other };

  const id = newId("ch");
  // Both sides can open the same conversation at the same moment; the slug
  // index is what keeps it one room, so let it decide rather than the read
  // above. No row back means the other side created it first.
  const [created] = await db
    .insert(chatChannels)
    .values({
      id,
      tenantId: viewer.tenantId,
      kind: "dm",
      slug,
      name: other.name,
      isPrivate: true,
      createdBy: viewer.id,
    })
    .onConflictDoNothing({ target: [chatChannels.tenantId, chatChannels.slug] })
    .returning();

  const channel = created ?? (await channelBySlugRaw(viewer.tenantId, slug));
  if (!channel) return null;

  await db
    .insert(chatMembers)
    .values([
      { channelId: channel.id, userId: viewer.id },
      { channelId: channel.id, userId: otherId },
    ])
    .onConflictDoNothing();

  return { channel, other };
}

/** The channel behind a slug, without the membership check — for the create
 * paths, which have just established the caller belongs there. */
async function channelBySlugRaw(tenantId: string, slug: string) {
  const [row] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, tenantId), eq(chatChannels.slug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * A channel and its messages in one round trip.
 *
 * Two queries that must run in sequence (find the channel, then read its
 * messages) cost two crossings of the planet while the database is in
 * Singapore and the app is in Amsterdam. Folded into one statement, the page
 * pays for one.
 */
export async function channelThread(viewer: Viewer, slug: string, limit = 80) {
  const { rows } = await db.execute<{
    channel_id: string;
    channel_name: string;
    topic: string | null;
    is_private: boolean;
    kind: string;
    message_id: string | null;
    body: string | null;
    created_at: unknown;
    author_id: string | null;
    author_name: string | null;
    author_name_local: string | null;
    author_avatar: string | null;
    author_is_agent: boolean | null;
    author_title: string | null;
    author_email: string | null;
    attachments: unknown;
    meta: unknown;
  }>(sql`
    with ch as (
      select c.id, c.name, c.topic, c.is_private, c.kind
        from ${chatChannels} c
       where c.tenant_id = ${viewer.tenantId} and c.slug = ${slug}
         and (c.is_private = false or exists (
              select 1 from ${chatMembers} m
               where m.channel_id = c.id and m.user_id = ${viewer.id}))
       limit 1
    )
    /* ch.kind was in the CTE and missing from this list, so every caller read
       it as undefined -- which is why the announcements channel drew a
       composer for everybody. */
    select ch.id as channel_id, ch.name as channel_name, ch.topic, ch.is_private, ch.kind,
           m.id as message_id, m.body, m.created_at, m.author_id, m.attachments, m.meta,
           u.name as author_name, u.name_local as author_name_local, u.avatar_url as author_avatar,
           u.is_agent as author_is_agent, u.title as author_title, u.email as author_email
      from ch
      left join lateral (
        select * from ${chatMessages} msg
         where msg.channel_id = ch.id and msg.deleted_at is null
         order by msg.created_at desc
         limit ${limit}
      ) m on true
      left join ${users} u on u.id = m.author_id
     order by m.created_at asc
  `);

  if (!rows.length) return null;

  const first = rows[0];
  const withMessages = rows.filter((r) => r.message_id);

  // One lookup for every file attached anywhere in the thread, checked against
  // *this* reader. A file shared with the channel yesterday and unshared today
  // drops out here, which is the correct behaviour — the poster's access is
  // not the reader's.
  /* And the employees at work in the room right now: their placeholder
     rows are "deleted" from birth, so the thread above never includes
     them, and they are drawn after the last message instead
     (`lib/chat/pending.ts`). */
  const [attachments, pending] = await Promise.all([
    attachmentsFor(
      viewer,
      withMessages.flatMap((r) => toIds(r.attachments)),
    ),
    pendingInChannel(first.channel_id).catch((err) => {
      console.error("[chat] could not read who is at work", err);
      return [];
    }),
  ]);

  return {
    channel: {
      id: first.channel_id,
      name: first.channel_name,
      topic: first.topic,
      isPrivate: first.is_private,
      kind: first.kind,
    },
    messages: withMessages.map((r) => ({
      id: r.message_id!,
      body: r.body ?? "",
      authorId: r.author_id,
      authorName: r.author_name,
      authorNameLocal: r.author_name_local,
      authorAvatar: r.author_avatar,
      authorIsAgent: r.author_is_agent === true,
      authorTitle: r.author_title,
      authorEmail: r.author_email,
      attachments: toIds(r.attachments).flatMap((id) => attachments.get(id) ?? []),
      /* The buttons an agent put under it, and whether somebody has already
         pressed one. Validated on the way out (`readCardActions`), because a
         jsonb column is `unknown` however it was written. */
      actions: readCardActions(r.meta),
      done: readCardDone(r.meta),
      /* A checked hand-off (`meta.handoff`), so the "交给 …" line is drawn
         from what the dispatcher recorded rather than from an @ in the text,
         and a morning brief or day plan, so it is drawn as the document it
         is. Both read defensively: the column is jsonb. */
      handoff: readHandoff(r.meta),
      card: readCardKind(r.meta),
      /* The project, script and video ids it names, for the page to turn
         into an "打开项目" button (`projectLinks`), and a long job it
         started, for the live chip. */
      refs: readWorkRefs(r.meta),
      job: readJob(r.meta),
      createdAt: toDate(r.created_at) ?? new Date(),
    })),
    pending,
  };
}

/** One message, with its raw `meta`, for the action behind a card's button. */
export async function channelMessage(channelId: string, messageId: string) {
  const [row] = await db
    .select({ id: chatMessages.id, meta: chatMessages.meta, authorId: chatMessages.authorId })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.channelId, channelId),
        isNull(chatMessages.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Records that somebody pressed one of a card's buttons.
 *
 * Merged into the existing `meta` in one statement rather than read-then-write:
 * two people pressing at the same moment is the ordinary case for an approval
 * card, and the loser of that race should not erase the agent's own buttons.
 * `where meta->'done' is null` makes the first press the one that counts.
 */
export async function markCardDone(
  channelId: string,
  messageId: string,
  done: { actionId: string; by: string; at: string },
) {
  await db.execute(sql`
    update ${chatMessages}
       set meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ done })}::jsonb
     where id = ${messageId}
       and channel_id = ${channelId}
       and (meta -> 'done') is null
  `);
}

/** A jsonb column that should hold file ids, treated as if it might not. */
function toIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.length <= 64) : [];
}

export type Attachment = { id: string; name: string; kind: string; mime: string | null; sizeBytes: number | null };

/**
 * The files behind a message's attachment ids, for one reader.
 *
 * The ids on a message are a claim, not a grant: `canReadFiles` is what
 * decides, and it is asked every time the thread is drawn. An id the reader
 * may not open simply is not in the answer, so the message renders with one
 * fewer chip rather than a broken link or a denial.
 */
export async function attachmentsFor(viewer: Viewer, fileIds: string[]): Promise<Map<string, Attachment>> {
  const ids = [...new Set(fileIds)].slice(0, 200);
  if (!ids.length) return new Map();

  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      kind: files.kind,
      mime: files.mime,
      sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(
      and(
        inArray(files.id, ids),
        eq(files.tenantId, viewer.tenantId),
        isNull(files.deletedAt),
        canReadFiles(viewer),
      ),
    );

  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Creates a channel. The slug is derived from the name the way people expect
 * (#night-market from "Night market"), and the creator joins it — a channel
 * you made but are not in would be a strange thing to own.
 */
/**
 * The announcements channel: everyone is a member, only admins post.
 *
 * Created on demand rather than seeded, so a studio that never uses it never
 * has an empty one — and joined by everybody each time it is opened, so
 * somebody who started last week is in it without anybody adding them. That is
 * what "company-wide" has to mean; a channel you can be left out of is not one.
 */
export async function announcementsChannel(viewer: Viewer) {
  const [existing] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), eq(chatChannels.kind, "announce")))
    .limit(1);

  const channel =
    existing ??
    (
      await db
        .insert(chatChannels)
        .values({
          id: newId("ch"),
          tenantId: viewer.tenantId,
          kind: "announce",
          slug: "announcements",
          name: "announcements",
          topic: "Company-wide updates",
          isPrivate: false,
          createdBy: viewer.id,
        })
        .returning()
    )[0];

  // Membership is automatic and is re-asserted on every open, which is how
  // somebody who joined the studio yesterday is already in it.
  await db
    .insert(chatMembers)
    .values({ channelId: channel.id, userId: viewer.id })
    .onConflictDoNothing();

  return channel;
}

export async function createChannel(
  viewer: Viewer,
  input: { name: string; topic?: string | null; isPrivate?: boolean },
) {
  const name = input.name.trim().replace(/^#/, "");
  if (!name) throw new Error("A channel needs a name");
  if (name.length > 60) throw new Error("That name is too long for a channel");

  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  if (!slug) throw new Error("That name has no letters or numbers in it");

  const [clash] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), eq(chatChannels.slug, slug)))
    .limit(1);
  if (clash) return clash;

  const id = newId("ch");
  const [created] = await db
    .insert(chatChannels)
    .values({
      id,
      tenantId: viewer.tenantId,
      kind: "channel",
      slug,
      name,
      topic: input.topic ?? null,
      isPrivate: Boolean(input.isPrivate),
      createdBy: viewer.id,
      lastMessageAt: new Date(),
    })
    // Two people naming a channel the same thing at the same time is a clash
    // the slug index settles; the reader above cannot.
    .onConflictDoNothing({ target: [chatChannels.tenantId, chatChannels.slug] })
    .returning();

  if (!created) {
    const existing = await channelBySlugRaw(viewer.tenantId, slug);
    if (existing) return existing;
    throw new Error("Could not create that channel");
  }

  await db.insert(chatMembers).values({ channelId: id, userId: viewer.id }).onConflictDoNothing();
  await audit(viewer, "chat.channel.create", {
    objectType: "channel",
    objectId: id,
    module: "chat",
    meta: { name, private: Boolean(input.isPrivate) },
  });

  return created;
}

/**
 * Who is in a channel.
 *
 * A private channel is a group: its membership is the thing that makes it
 * private, and until now membership could only be created (by whoever made the
 * channel, for themselves) and never read or changed. So a private channel was
 * a room with one person in it and no door.
 */
export async function channelMembers(viewer: Viewer, channelId: string) {
  const channel = await channelById(viewer, channelId);
  if (!channel) return [];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      nameLocal: users.nameLocal,
      avatarUrl: users.avatarUrl,
      title: users.title,
      joinedAt: chatMembers.joinedAt,
    })
    .from(chatMembers)
    .innerJoin(users, eq(users.id, chatMembers.userId))
    .where(and(eq(chatMembers.channelId, channelId), isNull(users.deletedAt)))
    .orderBy(users.name);

  return rows;
}

/** Add people to a channel. Only somebody already in it may do so, which is
 * what keeps a private channel private. */
export async function addChannelMembers(viewer: Viewer, channelId: string, userIds: string[]) {
  const channel = await channelById(viewer, channelId);
  if (!channel) throw new Error("Channel not found");

  if (channel.isPrivate) {
    const [mine] = await db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!mine) throw new Error("Only someone already in this channel can add people to it");
  }

  // Ids off the wire are not people. Each one has to be a live account in this
  // studio before it becomes a row.
  const valid = userIds.length
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt), inArray(users.id, userIds)))
    : [];
  if (!valid.length) return 0;

  await db
    .insert(chatMembers)
    .values(valid.map((u) => ({ channelId, userId: u.id })))
    .onConflictDoNothing();

  await audit(viewer, "chat.channel.members.add", {
    objectType: "channel",
    objectId: channelId,
    module: "chat",
    meta: { added: valid.length },
  });

  return valid.length;
}

/** Remove somebody, or leave yourself. */
export async function removeChannelMember(viewer: Viewer, channelId: string, userId: string) {
  const channel = await channelById(viewer, channelId);
  if (!channel) throw new Error("Channel not found");

  // Anyone in the channel may leave it; removing somebody else is for the
  // person who created it, or an administrator.
  const self = userId === viewer.id;
  if (!self && channel.createdBy !== viewer.id && viewer.role !== "owner" && viewer.role !== "admin") {
    throw new Error("Only whoever started this channel can remove people from it");
  }

  await db
    .delete(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));

  await audit(viewer, self ? "chat.channel.leave" : "chat.channel.members.remove", {
    objectType: "channel",
    objectId: channelId,
    module: "chat",
    meta: { userId },
  });
}
