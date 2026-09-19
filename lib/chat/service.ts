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
import { relationOn } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";

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
        // Direct messages have their own list in the sidebar.
        eq(chatChannels.kind, "channel"),
        or(eq(chatChannels.isPrivate, false), sql`${chatMembers.userId} is not null`),
      ),
    )
    .orderBy(chatChannels.name);

  return rows.map((r) => ({
    id: r.channel.id,
    slug: r.channel.slug,
    name: r.channel.name,
    topic: r.channel.topic,
    isPrivate: r.channel.isPrivate,
    isMember: Boolean(r.member),
    unread: Number(r.unread ?? 0),
  }));
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

export async function channelMessages(channelId: string, limit = 80) {
  const rows = await db
    .select({
      message: chatMessages,
      authorName: users.name,
      authorNameLocal: users.nameLocal,
      authorAvatar: users.avatarUrl,
    })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.authorId))
    .where(and(eq(chatMessages.channelId, channelId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function postMessage(viewer: Viewer, channelId: string, body: string) {
  const text = body.trim();
  if (!text) return null;

  const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  if (!channel || channel.tenantId !== viewer.tenantId) throw new Error("Channel not found");
  if (channel.isPrivate) {
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!member) throw new Error("Channel not found");
  }

  const id = newId("msg");
  await db.insert(chatMessages).values({ id, channelId, authorId: viewer.id, body: text });

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

export async function startConversation(viewer: Viewer) {
  const id = newId("cnv");
  await db.insert(conversations).values({ id, userId: viewer.id, module: "chat" });
  await audit(viewer, "agent.conversation.create", { objectType: "conversation", objectId: id, module: "chat" });
  return id;
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
      role: users.role,
      lastActiveAt: users.lastActiveAt,
    })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)))
    .orderBy(users.name);

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
        presence,
        isGuest: r.role === "guest",
        unread: 0,
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
    message_id: string | null;
    body: string | null;
    created_at: unknown;
    author_id: string | null;
    author_name: string | null;
    author_name_local: string | null;
    author_avatar: string | null;
  }>(sql`
    with ch as (
      select c.id, c.name, c.topic, c.is_private
        from ${chatChannels} c
       where c.tenant_id = ${viewer.tenantId} and c.slug = ${slug}
         and (c.is_private = false or exists (
              select 1 from ${chatMembers} m
               where m.channel_id = c.id and m.user_id = ${viewer.id}))
       limit 1
    )
    select ch.id as channel_id, ch.name as channel_name, ch.topic, ch.is_private,
           m.id as message_id, m.body, m.created_at, m.author_id,
           u.name as author_name, u.name_local as author_name_local, u.avatar_url as author_avatar
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
  return {
    channel: {
      id: first.channel_id,
      name: first.channel_name,
      topic: first.topic,
      isPrivate: first.is_private,
    },
    messages: rows
      .filter((r) => r.message_id)
      .map((r) => ({
        id: r.message_id!,
        body: r.body ?? "",
        authorId: r.author_id,
        authorName: r.author_name,
        authorNameLocal: r.author_name_local,
        authorAvatar: r.author_avatar,
        createdAt: toDate(r.created_at) ?? new Date(),
      })),
  };
}

/**
 * Creates a channel. The slug is derived from the name the way people expect
 * (#night-market from "Night market"), and the creator joins it — a channel
 * you made but are not in would be a strange thing to own.
 */
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
