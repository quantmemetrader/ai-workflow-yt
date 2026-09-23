import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { ToolDef } from "@/lib/ai/openrouter";
import { id, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Reading and writing the studio's conversations.
 *
 * "Summarise what happened in this channel" and "tell the team it's ready" are
 * the two things people actually want an assistant in a chat window to do, and
 * neither was possible: the agent could search files and nothing else.
 *
 * **Membership is the permission, and it is checked on every call.** A channel
 * the person is not in does not exist as far as these tools are concerned —
 * the same answer as a channel that does not exist, so the agent cannot be
 * used to probe for private rooms. Sending is worse than reading if it goes
 * wrong, so `send_message` writes as *the person*, never as a bot: their name
 * is on it, and the audit row says the agent typed it.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_channels",
      description:
        "The channels and groups this person is in, with unread counts. Use it to find the right channel before reading or sending.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_channel",
      description:
        "Recent messages from a channel, oldest first, with who wrote each and when. Use this to summarise a conversation or to catch up on one. Defaults to the channel currently open on screen.",
      parameters: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "Leave out to read the channel that is open on screen.",
          },
          limit: { type: "number", description: "How many messages. Default 60, most 200." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_message",
      description:
        "Post a message to a channel, as this person. Use it only when they have asked for something to be sent. Say what you sent and where, afterwards.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message. Write it as they would." },
          channel_id: {
            type: "string",
            description: "Leave out to send to the channel that is open on screen.",
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_messages",
      description:
        "Find messages across every channel this person is in, by keyword. Returns the message, its channel and when it was written.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Default 20, most 50." },
        },
        required: ["query"],
      },
    },
  },
];

/** The channels this person is actually in. The only set any tool here may
 * touch, and the reason a private room cannot be probed for. */
async function myChannels(ctx: ToolContext) {
  return db
    .select({
      id: chatChannels.id,
      name: chatChannels.name,
      kind: chatChannels.kind,
      lastReadAt: chatMembers.lastReadAt,
    })
    .from(chatMembers)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMembers.channelId))
    .where(
      and(
        eq(chatMembers.userId, ctx.viewer.id),
        eq(chatChannels.tenantId, ctx.viewer.tenantId),
        // An archived channel is not somewhere to send.
        isNull(chatChannels.archivedAt),
      ),
    )
    .orderBy(desc(chatChannels.lastMessageAt));
}

/** The channel a tool should act on: the one named, or the one on screen. */
async function resolve(ctx: ToolContext, given: unknown): Promise<{ id: string; name: string } | null> {
  const wanted = id(given) ?? (given === undefined || given === null ? (ctx.channelId ?? null) : null);
  if (!wanted) return null;

  const [row] = await db
    .select({ id: chatChannels.id, name: chatChannels.name })
    .from(chatMembers)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMembers.channelId))
    .where(
      and(
        eq(chatMembers.userId, ctx.viewer.id),
        eq(chatMembers.channelId, wanted),
        eq(chatChannels.tenantId, ctx.viewer.tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "list_channels") {
    const rows = await myChannels(ctx);
    if (rows.length === 0) return { text: "This person is not in any channel yet." };
    return {
      text: rows
        .map((r) => `- ${r.name} (${r.kind}, id: ${r.id})`)
        .join("\n"),
    };
  }

  if (name === "read_channel") {
    const channel = await resolve(ctx, args.channel_id);
    if (!channel) {
      return {
        text:
          "No such channel is open to this person. Call list_channels to see which ones there are, or open one on screen.",
      };
    }

    const limit = Math.min(Math.max(num(args.limit, 60), 1), 200);
    const rows = await db
      .select({
        body: chatMessages.body,
        createdAt: chatMessages.createdAt,
        author: users.name,
      })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.authorId))
      .where(and(eq(chatMessages.channelId, channel.id), isNull(chatMessages.deletedAt)))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);

    if (rows.length === 0) return { text: `"${channel.name}" has no messages yet.` };

    await audit(ctx.viewer, "agent.chat.read", {
      objectType: "channel",
      objectId: channel.id,
      module: "chat",
      meta: { messages: rows.length },
    });

    // Oldest first: a conversation reads forwards, and a model summarising one
    // backwards gets the order of events wrong.
    const lines = rows
      .reverse()
      .map(
        (m) =>
          `[${m.createdAt.toISOString().slice(0, 16).replace("T", " ")}] ${m.author ?? "someone"}: ${(
            m.body ?? ""
          ).replace(/\s+/g, " ")}`,
      );

    return { text: `# ${channel.name}\n\n${lines.join("\n")}` };
  }

  if (name === "send_message") {
    const text = str(args.text, 8000);
    if (!text) return { text: "There was nothing to send." };

    const channel = await resolve(ctx, args.channel_id);
    if (!channel) {
      return { text: "No such channel is open to this person, so nothing was sent." };
    }

    const messageId = newId("msg");
    await db.insert(chatMessages).values({
      id: messageId,
      channelId: channel.id,
      // As the person, never as a bot. Their name is on it because they asked
      // for it to be sent; the audit row below records that the agent typed it.
      authorId: ctx.viewer.id,
      body: text,
    });
    // What the channel list sorts by, and what "unread since" is measured
    // against. A message that does not move it is a message nobody sees.
    await db
      .update(chatChannels)
      .set({ lastMessageAt: new Date() })
      .where(eq(chatChannels.id, channel.id));

    await audit(ctx.viewer, "agent.chat.send", {
      objectType: "channel",
      objectId: channel.id,
      module: "chat",
      meta: { messageId, length: text.length },
    });

    return { text: `Sent to "${channel.name}".`, changed: true };
  }

  if (name === "search_messages") {
    const query = str(args.query, 200);
    if (!query) return { text: "Give me something to look for." };
    const limit = Math.min(Math.max(num(args.limit, 20), 1), 50);

    const mine = await myChannels(ctx);
    if (mine.length === 0) return { text: "This person is not in any channel yet." };

    const rows = await db
      .select({
        body: chatMessages.body,
        createdAt: chatMessages.createdAt,
        channelId: chatMessages.channelId,
        author: users.name,
      })
      .from(chatMessages)
      .leftJoin(users, eq(users.id, chatMessages.authorId))
      .where(
        and(
          inArray(
            chatMessages.channelId,
            mine.map((c) => c.id),
          ),
          isNull(chatMessages.deletedAt),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(400);

    const needle = query.toLowerCase();
    const byId = new Map(mine.map((c) => [c.id, c.name]));
    const hits = rows.filter((r) => (r.body ?? "").toLowerCase().includes(needle)).slice(0, limit);

    if (hits.length === 0) return { text: `Nothing in this person's channels mentions "${query}".` };
    return {
      text: hits
        .map(
          (h) =>
            `- ${byId.get(h.channelId) ?? "a channel"} · ${h.author ?? "someone"} · ${h.createdAt
              .toISOString()
              .slice(0, 10)}\n  ${(h.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`,
        )
        .join("\n"),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const chatPack: ToolPack = { module: "chat", defs, run };
