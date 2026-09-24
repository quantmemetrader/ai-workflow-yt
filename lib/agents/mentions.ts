import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, conversations, users } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import type { Module } from "@/lib/db/schema";
import { runAgent } from "@/lib/ai/agent";
import { postMessage } from "@/lib/chat/service";
import { AGENT_LABELS, agentKeyFromEmail, agentTag, parseAgentMentions, type AgentKey } from "./catalog";
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

/** How far a tag may travel: the message, its answer, and one hand-off
 *  from that answer (编剧 finishing and tagging 剪辑师). Not further: the
 *  third level was 剪辑师 and 策划 answering each other about work nobody
 *  asked for. */
const MAX_HOPS = 1;

/**
 * How many answers one tag may cost, in total, across the whole chain.
 *
 * Depth alone is not a bound. An answer may tag two agents, each of whose
 * answers may tag another, so "three hops" is up to fifteen model calls — and
 * watching it run, one tag produced eight. Four is a conversation: a hand-off,
 * a reply, and a round of it. Past that the studio is paying for the agents to
 * talk among themselves.
 */
const MAX_REPLIES = 3;

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

  /* A person may tag three colleagues at once. An agent's answer hands off
     to at most one: a reply that tags two is a meeting, and the second tag
     was always an aside ("@策划 若需延伸…") rather than a hand-off. */
  const tagged = parseAgentMentions(input.body).filter((key) => !spoken.includes(key));
  const wanted = hop > 0 ? tagged.slice(0, 1) : tagged;
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

/**
 * Who a reply without a tag is for.
 *
 * "@剪辑师 make a five-second stock clip" → 剪辑师 asks "about what?" → the
 * person types "AI chip". That answer used to reach nobody, because nothing
 * in it was tagged, and the conversation died. A message with no tag,
 * written right after an employee spoke in the same channel (within half an
 * hour, nobody else in between), is that employee's to answer.
 */
const REPLY_WINDOW_MS = 30 * 60_000;

export async function replyTarget(channelId: string, authorId: string): Promise<AgentKey | null> {
  const recent = await db
    .select({ authorId: chatMessages.authorId, email: users.email, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.authorId))
    .where(and(eq(chatMessages.channelId, channelId), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(3);
  /* The newest is the message just posted; the one before it decides. */
  const [latest, before] = recent;
  if (!latest || latest.authorId !== authorId || !before) return null;
  const key = agentKeyFromEmail(before.email);
  if (!key) return null;
  if (latest.createdAt.getTime() - before.createdAt.getTime() > REPLY_WINDOW_MS) return null;
  return key;
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

/** Which trade each employee works in, for the prompt and the round budget. */
/** Words that say an action was done. Checked only when no tool ran. */
const CLAIMS = /已(经)?(导出|渲染|上传|加入|放入|放进|添加|加进|裁剪|剪好|做好|生成|创建|新建|发布|保存)|exported|rendered|uploaded|added (it|them)? ?to|placed (it )?in|cropped|created|published|saved/i;

const WORKS_IN: Record<AgentKey, Module> = {
  research: "research",
  planning: "research",
  script: "script",
  video: "video",
  article: "script",
};

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
    /* Employees were answering "收到，马上开工" and then doing nothing: a
       promise, not work. If a tool can do it now, the turn does it. */
    "- 能用你的工具现在就做的事，就直接做（比如粗剪、写脚本、查数据），做完再说结果；不要只说“收到，马上开工”。做不了才说缺什么。",
    /* Watching it run: 研究员 answered a question and tagged two colleagues
       in passing; 剪辑师 went off to make a project nobody asked for; 策划
       announced a cut it had no tool to make. Three rules from that. */
    "- 只说你这一回合真的用工具做完的事。没做的、没有工具做的，一律不要说“已完成”“已更新”“已强化”；说清楚谁能做、还缺什么。",
    "- 有人问你问题、要你的建议，就回答问题，不要 @ 任何同事。提到别的同事，写名字就好，不要加 @——加了 @ 它就会真的开工。",
    `- 只有两种情况在回答里 @ 同事：提问的人明确要你交给它；或者你用工具做完了自己那一步，下一步按流程属于它（脚本写完交 ${agentTag("video")}）。一次最多 @ 一位。不要 @ 你自己。`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  /* One turn of the employee, returning what it said and whether it used
     a single tool to do what it says it did. */
  const turn = async (content: string) => {
    let answer = "";
    let spokeItself = false;
    let failure: string | null = null;
    let tools = 0;
    for await (const event of runAgent({
      viewer: agent,
      conversationId,
      content,
      module: WORKS_IN[key],
      // The room it was tagged in, so "this channel" means something. Re-checked
      // inside every tool against the *agent's* membership, not the asker's.
      context: { module: "chat", channelId },
    })) {
      if (event.type === "delta") answer += event.text;
      else if (event.type === "error") failure = event.message;
      else if (event.type === "tool" && event.status === "running") {
        /* Everything said before a tool call is the model talking to itself;
           only what it says after the last tool it ran is the reply. */
        answer = "";
        tools++;
      } else if (event.type === "tool" && event.name === "send_message" && event.status === "ok") {
        spokeItself = true;
      }
    }
    return { answer, spokeItself, failure, tools };
  };

  let { answer, spokeItself, failure, tools } = await turn(question);

  /*
   * Said it, did not do it.
   *
   * 剪辑师 answered "@剪辑师 make a five-second crypto clip" with footage it
   * found, a timeline it built and a file it exported, and called no tool at
   * all: nothing existed. A reply that claims an action with no tool behind
   * it is sent back once to actually do the work; if it still has not, the
   * channel is told plainly that nothing was done.
   */
  if (tools === 0 && !spokeItself && CLAIMS.test(answer)) {
    const again = await turn(
      zh
        ? "（系统提示）你刚才的回复说做了操作（找素材、放进时间线、导出、上传之类），但这一轮你没有调用任何工具，所以其实什么都没发生。现在真的调用工具去做；做不了就直说缺什么。不要说你做了没做的事。"
        : "(System) Your last reply said you did things (found footage, put it on the timeline, exported, uploaded), but you called no tool, so nothing happened. Call the tools now and actually do it; if you cannot, say what is missing. Never say you did something you did not do.",
    );
    if (again.tools > 0 || !CLAIMS.test(again.answer)) {
      ({ answer, spokeItself, failure, tools } = again);
    } else {
      answer = zh
        ? `@${asker} 抱歉，我上面说的操作其实没有执行（这一轮没有调用任何工具），项目和文件都没有变化。请再说一次要做什么，我会真的去做。`
        : `@${asker} Sorry: what I described was not actually done (I called no tool this turn), so nothing changed in the project or files. Ask again and I will do it for real.`;
      failure = null;
    }
  }
  void tools;

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
