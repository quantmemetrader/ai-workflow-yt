"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { conversationDetail } from "@/lib/chat/service";
import {
  addChannelMembers,
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

export async function sendChannelMessage(slug: string, body: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof slug !== "string" || !slug || slug.length > MAX_SLUG) {
    return { error: "Channel not found" };
  }
  if (typeof body !== "string" || !body.trim()) return { error: "Nothing to send" };
  if (body.length > MAX_BODY) return { error: "That message is too long" };

  const channel = await channelBySlug(viewer, slug);
  if (!channel) return { error: "Channel not found" };

  await postMessage(viewer, channel.id, body);
  revalidatePath(`/chat/c/${slug}`);
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
