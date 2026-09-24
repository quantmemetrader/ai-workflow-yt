import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, conversations } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import { runAgent } from "@/lib/ai/agent";
import { postMessage } from "@/lib/chat/service";
import { AGENT_KEYS, AGENT_LABELS, agentTag, parseAgentMentions, type AgentKey } from "./catalog";
import { agentViewer, ensureAgent } from "./index";

/**
 * Tagging an AI employee, and what happens next.
 *
 * The agents could already talk to each other — `handoff.ts` posts `@视频助理`
 * when a 脚本 is approved — but nothing ever *read* a mention, so a person
 * typing the same thing got silence. This is the missing half: a message is
 * scanned for tags, and each agent tagged answers in the channel.
 *
 * Three rules, and they are the whole design:
 *
 *   1. **The agent runs as itself, never as the asker.** `agentViewer` reads
 *      the agent's own user row and its own entitlements, and every tool takes
 *      that viewer (`lib/ai/tools/types.ts`). So 研究助理 cannot touch a video
 *      project and 视频助理 cannot read a research topic, whoever tagged them
 *      and whatever that person holds. Tagging an agent lends it the room, not
 *      your permissions.
 *   2. **It has to be in the room to read the room.** `read_channel` resolves
 *      through `chat_members`, so the agent is added to the channel before it
 *      is asked anything — by the person who tagged it, through the same
 *      `addChannelMembers` rule that stops anybody adding anybody to a private
 *      channel they are not in themselves.
 *   3. **A chain of tags is bounded, and paid for.** An agent's answer may tag
 *      another agent — that is the collaboration the studio asked for — but
 *      each hop is counted, an agent never answers itself, nobody in a branch
 *      speaks twice, and the whole chain shares one budget of answers. Two
 *      hops is enough for "研究 → 脚本 → 视频"; the budget is what stops three
 *      employees holding a meeting on the client's OpenRouter account.
 */

/** How far a tag may travel: the message, then two answers. */
const MAX_HOPS = 2;

/**
 * How many answers one tag may cost, in total, across the whole chain.
 *
 * Depth alone is not a bound. An answer may tag two agents, each of whose
 * answers may tag another, so "three hops" is up to fifteen model calls — and
 * watching it run, one tag produced eight. Four is a conversation: a hand-off,
 * a reply, and a round of it. Past that the studio is paying for the agents to
 * talk among themselves.
 */
const MAX_REPLIES = 4;

/** What an agent's answer may be before the channel becomes unreadable. Longer
 * than any useful chat reply and far short of a pasted document. */
const MAX_REPLY = 4_000;

export type MentionDispatch = {
  /** Who wrote the message: a person, or an agent answering one. */
  viewer: Viewer;
  channelId: string;
  body: string;
  /** Agents that have already spoken in this branch. */
  spoken?: AgentKey[];
  hop?: number;
  /** Answers left to the whole chain, shared by every branch of it. Internal:
   * a caller starts a chain, it does not budget one. */
  budget?: { left: number };
};

/**
 * Runs every agent tagged in a message and posts what each one says.
 *
 * Slow on purpose — a model call per agent — so callers hand it to `after()`
 * and let the channel's own poll pick the answers up. It never throws: a
 * failure here must not undo a message that is already posted.
 */
export async function dispatchAgentMentions(input: MentionDispatch): Promise<void> {
  const hop = input.hop ?? 0;
  const spoken = input.spoken ?? [];
  const budget = input.budget ?? { left: MAX_REPLIES };
  if (hop > MAX_HOPS || budget.left <= 0) return;

  const wanted = parseAgentMentions(input.body).filter((key) => !spoken.includes(key));
  if (!wanted.length) return;

  const channel = await channelFor(input.viewer, input.channelId);
  if (!channel) return;

  for (const key of wanted) {
    if (budget.left <= 0) return;
    budget.left--;
    try {
      await answerOne({ ...input, hop, spoken, budget }, key, channel);
    } catch (err) {
      // One agent falling over is not the others' problem, and it is certainly
      // not the message's.
      console.error(`[agents] ${key} could not answer a mention`, err);
    }
  }
}

/** The channel, and whether the writer is actually in it. A tag in a room the
 * writer cannot see reaches nobody. */
async function channelFor(viewer: Viewer, channelId: string) {
  const [row] = await db
    .select({
      id: chatChannels.id,
      name: chatChannels.name,
      kind: chatChannels.kind,
      isPrivate: chatChannels.isPrivate,
      topic: chatChannels.topic,
    })
    .from(chatChannels)
    .where(
      and(
        eq(chatChannels.id, channelId),
        eq(chatChannels.tenantId, viewer.tenantId),
        isNull(chatChannels.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Announcements is admin-only to post in, and an agent is not an admin, so
  // its answer would be refused after the model had already been paid for.
  if (row.kind === "announce") return null;

  if (row.isPrivate) {
    const [member] = await db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, row.id), eq(chatMembers.userId, viewer.id)))
      .limit(1);
    if (!member) return null;
  }
  return row;
}

type Channel = NonNullable<Awaited<ReturnType<typeof channelFor>>>;

async function answerOne(
  input: Required<Pick<MentionDispatch, "viewer" | "channelId" | "body" | "spoken" | "hop" | "budget">>,
  key: AgentKey,
  channel: Channel,
) {
  const { viewer, channelId } = input;
  const tenantId = viewer.tenantId;

  const agentId = await ensureAgent(tenantId, key);
  // An agent answering its own message is a loop with one participant.
  if (agentId === viewer.id) return;

  // In the room before it is asked about the room. `onConflictDoNothing`
  // rather than `addChannelMembers`, because the writer's own right to be here
  // was established above and this must not audit a "member added" line every
  // time somebody types a tag.
  await db
    .insert(chatMembers)
    .values({ channelId, userId: agentId })
    .onConflictDoNothing();

  const agent = await agentViewer(tenantId, key);
  const conversationId = await threadFor(agent, channel);

  const asker = viewer.nameLocal || viewer.name;
  const zh = (agent.locale ?? "zh-CN").startsWith("zh");
  const question = [
    `${asker} 在频道 #${channel.name} 里 @了你（${AGENT_LABELS[key].nameLocal}）。`,
    channel.topic ? `频道说明：${channel.topic}` : null,
    "",
    "原话：",
    input.body,
    "",
    "怎么回：",
    /* The two rules that came out of watching it do this wrong. It called
       send_message *and* answered, so every tag produced two messages; and it
       wrote a status report — "已回复 #频道。做了什么：…" — because it thought
       it was talking to an operator rather than to the room. */
    "- 不要调用 send_message。你写的回答会被自动发到这个频道里，再发一次就是两条。",
    "- 像同事在群里说话那样直接说内容，不要写“已回复”“做了什么”这类汇报格式。",
    "- 先用 read_channel 看看上下文。用中文，简短。",
    `- 需要别的同事接手时，在回答里 @ 它（${AGENT_KEYS.filter((k) => k !== key)
      .map((k) => agentTag(k))
      .join(" / ")}）；不要 @ 你自己。`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  let answer = "";
  let spokeItself = false;
  let failure: string | null = null;
  for await (const event of runAgent({
    viewer: agent,
    conversationId,
    content: question,
    module: "chat",
    // The room it was tagged in, so "this channel" means something. Re-checked
    // inside every tool against the *agent's* membership, not the asker's.
    context: { module: "chat", channelId },
  })) {
    if (event.type === "delta") answer += event.text;
    else if (event.type === "error") failure = event.message;
    else if (event.type === "tool" && event.status === "running") {
      /* Everything said before a tool call is the model talking to itself —
         "I'll check the channel context first." — and it was ending up in the
         channel ahead of the actual answer. Only what it says after the last
         tool it ran is the reply. */
      answer = "";
    } else if (event.type === "tool" && event.name === "send_message" && event.status === "ok") {
      // Told not to, did anyway. Its words are already in a channel; posting
      // the turn's text on top of them is the duplicate this guards against.
      spokeItself = true;
    }
  }

  const text = answer.trim().slice(0, MAX_REPLY);

  /*
   * Silence is a failure worth saying out loud.
   *
   * A tag that produces nothing at all looks exactly like a tag that was never
   * read — and the two have very different fixes. The commonest cause is the
   * OpenRouter account being out of credit, which is an admin's job, not a
   * mystery for whoever typed the tag.
   */
  if (!spokeItself) {
    const body = text
      ? text
      : zh
        ? `@${asker} 我暂时答不上来${failure ? `：${failure}` : "。"}`
        : `@${asker} I could not answer just now${failure ? `: ${failure}` : "."}`;

    await postMessage(agent, channelId, body, {
      agent: key,
      /** Which tag pulled it in, so the thread can be read back later. */
      answeringMention: true,
      hop: input.hop,
      askedBy: viewer.id,
      ...(text ? {} : { failed: true }),
    });
  }

  await audit(agent, "agent.mention.reply", {
    objectType: "channel",
    objectId: channelId,
    module: "chat",
    meta: { agent: key, askedBy: viewer.id, hop: input.hop, failed: !text, spokeItself },
  });

  // Whatever it just said may tag somebody else. That is the collaboration the
  // studio asked for; `spoken` and the hop count are what keep it finite. Its
  // own `send_message` does not go through here, so the chain follows what the
  // turn said either way.
  if (text) {
    await dispatchAgentMentions({
      viewer: agent,
      channelId,
      body: text,
      spoken: [...input.spoken, key],
      hop: input.hop + 1,
      budget: input.budget,
    });
  }
}

/**
 * One thread per agent per channel, reused.
 *
 * An agent that starts a fresh conversation on every tag forgets what it said
 * ten minutes ago in the same room, which reads as three different employees
 * wearing the same name. `runAgent` already carries the last twenty messages
 * of a conversation, so keeping one per channel is all the memory it needs.
 */
async function threadFor(agent: Viewer, channel: Channel): Promise<string> {
  const title = `#${channel.name}`.slice(0, 200);

  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, agent.id),
        eq(conversations.title, title),
        isNull(conversations.archivedAt),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (existing) return existing.id;

  const id = newId("cnv");
  await db.insert(conversations).values({ id, userId: agent.id, title, module: "chat" });
  return id;
}
