"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { setFileAccess } from "@/lib/files/access";
import { conversationDetail } from "@/lib/chat/service";
import {
  addChannelMembers,
  attachmentsFor,
  channelById,
  channelBySlug,
  channelMembers,
  createChannel,
  listConversations,
  postMessage,
  removeChannelMember,
} from "@/lib/chat/service";

/** Post to a channel. Authorisation is re-checked here: a server action is a
 * public endpoint, whatever the UI around it looked like. */
/** A message is stored and shown to everyone in the channel; the composer's
 * own limit is not a limit. */
const MAX_BODY = 16_000;
/*
 * Long enough for a direct message.
 *
 * A DM's slug is `dm-` plus both user ids — 64 characters — and this was 60,
 * so every send in every DM was refused here as "Channel not found" before it
 * reached the database. The composer threw the refusal away, so a message
 * typed to a colleague vanished with nothing on screen. The limit is a guard
 * against an absurd string, not a format, so it is now well clear of the
 * longest slug the app itself makes.
 */
const MAX_SLUG = 200;
/** More than this on one message is a folder, not a message. */
const MAX_ATTACHMENTS = 10;

/**
 * Sending a message, now that a message can do two more things.
 *
 *   — **files.** "the current AI you can not update file in the chat box" —
 *     the composer had no attach button at all. The bytes still go straight to
 *     R2 through `/api/files/presign` and `/api/files/[id]/complete`, exactly
 *     as the rest of the product uploads; this records which files the message
 *     carries, and opens them to the people in the room.
 *   — **tags.** `@视频助理` now reaches the video agent (`lib/agents/mentions`),
 *     which answers in the channel under its own name and its own permissions.
 *     Handed to `after()` because it is a model call: the person's own message
 *     must appear at once, and the channel's poll picks the answer up when it
 *     lands.
 */
export async function sendChannelMessage(
  slug: string,
  body: string,
  /** Files already uploaded and confirmed, in the order they were attached. */
  attachmentIds: string[] = [],
) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof slug !== "string" || !slug || slug.length > MAX_SLUG) {
    return { error: "Channel not found" };
  }
  if (typeof body !== "string") return { error: "Nothing to send" };
  if (body.length > MAX_BODY) return { error: "That message is too long" };

  const wanted = Array.isArray(attachmentIds)
    ? [
        ...new Set(attachmentIds.filter((id): id is string => typeof id === "string" && id.length <= 64)),
      ].slice(0, MAX_ATTACHMENTS)
    : [];
  // A message with a file on it and nothing typed is an ordinary thing to
  // send; an empty one with nothing attached is not.
  if (!body.trim() && !wanted.length) return { error: "Nothing to send" };

  const channel = await channelBySlug(viewer, slug);
  if (!channel) return { error: "Channel not found" };

  /* Ids off the wire are a claim. Only files this person can actually read
     become attachments; anything else is dropped rather than refused, so a
     stale id does not cost them the message they typed. */
  const readable = wanted.length ? await attachmentsFor(viewer, wanted) : new Map();
  const attachments = wanted.filter((id) => readable.has(id));

  /*
   * A file nobody else can open is not an attachment.
   *
   * Uploads are private to the uploader by default, so attaching one without
   * this would post a chip only its owner can click. The channel decides how
   * far it opens: a public channel is the studio, a private one is exactly the
   * people in it. `setFileAccess` refuses anything this person does not own,
   * which is what stops a message re-sharing somebody else's file.
   */
  if (attachments.length) {
    try {
      if (channel.isPrivate) {
        const members = await channelMembers(viewer, channel.id);
        await setFileAccess(viewer, attachments, { mode: "people", userIds: members.map((m) => m.id) });
      } else {
        await setFileAccess(viewer, attachments, { mode: "everyone" });
      }
    } catch (err) {
      // Sharing is not the message. If it fails the message still goes, and
      // the owner can open the file from its own sharing sheet.
      console.error("[chat] could not open an attachment to the channel", err);
    }
  }

  await postMessage(viewer, channel.id, body, {}, attachments);
  revalidatePath(`/chat/c/${slug}`);

  /* The agents that were tagged, if any. After the response: each one is a
     model call with tool use behind it, and nobody pressing enter should wait
     for that. */
  if (parseAgentMentions(body).length) {
    after(async () => {
      try {
        await dispatchAgentMentions({ viewer, channelId: channel.id, body });
      } catch (err) {
        console.error("[chat] a tagged agent could not be reached", err);
      }
    });
  }

  return {};
}

/**
 * Creates a channel, or a private group, and hands back where to go.
 *
 * "Group" is not a separate thing: it is a private channel with people in it.
 * The distinction people care about is who can see it, and that is one flag
 * and one membership list, not a second kind of room.
 */
export async function createChannelAction(
  name: string,
  options: { topic?: string; isPrivate?: boolean; memberIds?: string[] } = {},
) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof name !== "string" || !name.trim()) return { error: "A channel needs a name" };
  if (name.length > 200) return { error: "That name is too long for a channel" };

  const topic = typeof options.topic === "string" ? options.topic.trim().slice(0, 300) : null;
  const memberIds = Array.isArray(options.memberIds)
    ? options.memberIds.filter((id): id is string => typeof id === "string" && id.length <= 64).slice(0, 200)
    : [];

  try {
    const channel = await createChannel(viewer, {
      name,
      topic: topic || null,
      isPrivate: Boolean(options.isPrivate),
    });
    // The creator is already a member; `addChannelMembers` validates the rest
    // against this studio before any of them becomes a row.
    if (memberIds.length) await addChannelMembers(viewer, channel.id, memberIds);
    revalidatePath("/chat", "layout");
    return { slug: channel.slug };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create that channel" };
  }
}

/** Who is in a channel, for the members sheet. */
export async function channelMembersAction(slug: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" as const };
  if (typeof slug !== "string" || !slug || slug.length > MAX_SLUG) {
    return { error: "Channel not found" as const };
  }

  const channel = await channelBySlug(viewer, slug);
  if (!channel) return { error: "Channel not found" as const };

  const members = await channelMembers(viewer, channel.id);
  return {
    channelId: channel.id,
    canManage:
      channel.createdBy === viewer.id || viewer.role === "owner" || viewer.role === "admin",
    members: members.map((m) => ({
      id: m.id,
      name: m.nameLocal ?? m.name,
      avatarUrl: m.avatarUrl,
      title: m.title,
    })),
  };
}

export async function addChannelMembersAction(channelId: string, userIds: string[]) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (!(await channelById(viewer, channelId))) return { error: "Channel not found" };
  if (!Array.isArray(userIds)) return { error: "Nobody to add" };

  try {
    const added = await addChannelMembers(
      viewer,
      channelId,
      userIds.filter((id): id is string => typeof id === "string" && id.length <= 64).slice(0, 200),
    );
    revalidatePath("/chat", "layout");
    return { added };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add anybody" };
  }
}

export async function removeChannelMemberAction(channelId: string, userId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof userId !== "string" || !userId || userId.length > 64) return { error: "Not allowed" };
  if (!(await channelById(viewer, channelId))) return { error: "Channel not found" };

  try {
    await removeChannelMember(viewer, channelId, userId);
    revalidatePath("/chat", "layout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not do that" };
  }
}

/** One person's own agent threads, newest first, for the rail's clock. */
export type RecentConversation = { id: string; title: string; when: string };

export async function recentConversationsAction(): Promise<{
  conversations?: RecentConversation[];
  error?: string;
}> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };

  const rows = await listConversations(viewer, 30);
  const locale = viewer.locale === "en" ? "en-GB" : (viewer.locale ?? "zh-CN");

  return {
    conversations: rows.map((c) => {
      const days = Math.floor((Date.now() - c.updatedAt.getTime()) / 86_400_000);
      const when =
        days <= 0
          ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(c.updatedAt)
          : days < 7
            ? new Intl.DateTimeFormat(locale, { weekday: "short" }).format(c.updatedAt)
            : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(c.updatedAt);
      return { id: c.id, title: c.title, when };
    }),
  };
}

/**
 * One conversation's messages, for the assistant panel to pick up where it
 * left off. The same ownership check the thread page makes: somebody else's
 * id is an empty answer, not a 403.
 */
export async function conversationMessagesAction(conversationId: string): Promise<{
  messages?: { id: string; role: "user" | "assistant"; content: string; status: "complete" | "failed" | "stopped" | "streaming"; error?: string }[];
  error?: string;
}> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };
  if (typeof conversationId !== "string" || !conversationId || conversationId.length > 64) return { error: "Not found" };
  const detail = await conversationDetail(viewer, conversationId);
  if (!detail) return { error: "Not found" };
  return {
    messages: detail.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        status: m.status === "streaming" ? "failed" : m.status,
        error: m.error ?? undefined,
      })),
  };
}
