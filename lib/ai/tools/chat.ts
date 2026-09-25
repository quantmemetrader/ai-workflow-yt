import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { ToolDef } from "@/lib/ai/openrouter";
import { AGENT_KEYS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
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
        "Recent messages from a channel, oldest first, with who wrote each and when. Your own messages are marked （你）; a plan's to-dos and a verified hand-off are marked as such. Use this to summarise a conversation or to catch up on one. Defaults to the channel currently open on screen.",
      parameters: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "The channel's id, or its name (\"研究日报\", \"#制作\"). Leave out to read the channel that is open on screen.",
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

/**
 * The channel a tool should act on: the one named, or the one on screen.
 *
 * Named by id or by name. Models pass whichever they saw, and a channel is
 * written "#研究日报" everywhere a person reads it; asked to read it that way,
 * this used to answer "no such channel" and cost a round finding the id.
 */
async function resolve(ctx: ToolContext, given: unknown): Promise<{ id: string; name: string } | null> {
  const byName = typeof given === "string" && given.trim() && !id(given) ? await channelNamed(ctx, given) : null;
  const wanted = id(given) ?? byName ?? (given === undefined || given === null || given === "" ? (ctx.channelId ?? null) : null);
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

/** One of this person's channels by its name or slug, exactly first and then
 * as the only one containing it. */
async function channelNamed(ctx: ToolContext, given: string): Promise<string | null> {
  const wanted = given.trim().replace(/^#/, "").toLowerCase();
  if (!wanted) return null;
  const rows = await db
    .select({ id: chatChannels.id, name: chatChannels.name, slug: chatChannels.slug })
    .from(chatMembers)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMembers.channelId))
    .where(and(eq(chatMembers.userId, ctx.viewer.id), eq(chatChannels.tenantId, ctx.viewer.tenantId), isNull(chatChannels.archivedAt)));
  const exact = rows.find((r) => r.name.toLowerCase() === wanted || (r.slug ?? "").toLowerCase() === wanted);
  if (exact) return exact.id;
  const partial = rows.filter((r) => r.name.toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0].id : null;
}

const KIND_ZH: Record<string, string> = {
  script: "脚本",
  video_project: "视频项目",
  work_project: "项目",
  article: "文章",
  topic: "选题",
  file: "文件",
  render: "成片",
  competitor: "对标账号",
  assignment: "派活",
};

const agentName = (key: unknown): string =>
  typeof key === "string" && AGENT_KEYS.includes(key as AgentKey)
    ? AGENT_LABELS[key as AgentKey].nameLocal
    : key === "human"
      ? "人"
      : String(key ?? "");

/**
 * What a message's `meta` says that its text does not, as lines under it.
 *
 * Two readings went wrong without these. The morning plan reads "编剧 —
 * 完成脚本《AI模型蒸馏》初稿", which a model took for a report that the
 * script was done; it is an assignment. And a hand-off the system checked
 * looks exactly like a colleague's unchecked "@剪辑师" in plain text, so
 * the checked one says what was handed over, by id.
 */
export function notesFor(meta: Record<string, unknown> | null): string[] {
  if (!meta) return [];
  const notes: string[] = [];
  const plan = meta.plan as { date?: unknown; list?: unknown } | undefined;
  if (plan && Array.isArray(plan.list)) {
    notes.push(
      `这是${typeof plan.date === "string" ? ` ${plan.date} 的` : ""}今日计划。每条“名字 — 事情”是派给那个人的待办，不是已经完成的工作；做没做完要用工具查。`,
    );
    const done = meta.done as { actionId?: unknown; by?: unknown; at?: unknown } | undefined;
    if (done && typeof done.actionId === "string") {
      const who = typeof done.by === "string" ? done.by : "有人";
      const when = typeof done.at === "string" ? ` 在 ${done.at.slice(0, 16).replace("T", " ")}` : "";
      notes.push(`${who}${when} 按了它的「${done.actionId.replace(/^hand-/, "交给")}」按钮：只是把待办交了出去，不代表做完。`);
    }
  }
  const handoff = meta.handoff as { from?: unknown; to?: unknown; artifacts?: unknown; verified?: unknown } | undefined;
  if (handoff && handoff.verified === true) {
    const items = Array.isArray(handoff.artifacts)
      ? (handoff.artifacts as { kind?: unknown; id?: unknown; title?: unknown }[])
          .filter((a) => typeof a.id === "string")
          .map((a) => `${KIND_ZH[String(a.kind)] ?? String(a.kind)}${typeof a.title === "string" && a.title ? `《${a.title}》` : ""} ${a.id}`)
      : [];
    notes.push(`系统已核实的交接：${agentName(handoff.from)} → ${agentName(handoff.to)}${items.length ? `：${items.join("；")}` : ""}`);
  }
  const digest = meta.digest as { date?: unknown } | undefined;
  if (digest) notes.push(`研究员的晨报${typeof digest.date === "string" ? `（${digest.date}）` : ""}。`);
  return notes;
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
        authorId: chatMessages.authorId,
        meta: chatMessages.meta,
        author: users.name,
        authorLocal: users.nameLocal,
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
    // backwards gets the order of events wrong. Names as the studio writes
    // them — 策划, not "Planning agent" — and the reader's own words marked,
    // because an employee that does not recognise its own plan reads it as
    // somebody else's news.
    const lines = rows.reverse().map((m) => {
      const who = `${m.authorLocal || m.author || "someone"}${m.authorId === ctx.viewer.id ? "（你）" : ""}`;
      const line = `[${m.createdAt.toISOString().slice(0, 16).replace("T", " ")}] ${who}: ${(m.body ?? "").replace(/\s+/g, " ")}`;
      const notes = notesFor(m.meta);
      return notes.length ? `${line}\n${notes.map((n) => `  ↳ ${n}`).join("\n")}` : line;
    });

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
