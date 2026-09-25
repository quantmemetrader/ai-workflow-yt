import "server-only";
import { after } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, chatChannels, chatMembers, chatMessages, conversations, users, workProjects } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import type { Module } from "@/lib/db/schema";
import { runAgent } from "@/lib/ai/agent";
import { idsIn, type Artifact, type ArtifactKind, type ToolContext } from "@/lib/ai/tools/types";
import { postMessage } from "@/lib/chat/service";
import {
  AGENT_KEYS,
  AGENT_LABELS,
  agentKeyFromEmail,
  parseAgentMentions,
  splitMentions,
  type AgentKey,
} from "./catalog";
import { agentViewer, ensureAgent } from "./index";

/**
 * Tagging an AI employee, and what happens next.
 *
 * The agents could already talk to each other — `handoff.ts` posts `@视频助理`
 * when a 脚本 is approved — but nothing ever *read* a mention, so a person
 * typing the same thing got silence. This is the missing half: a message is
 * scanned for tags, and each agent tagged answers in the channel.
 *
 * Five rules, and they are the whole design:
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
 *   4. **Nothing is said that did not happen.** Every reply is checked before
 *      it is posted (`verifyReply`): an id it quotes has to have come back
 *      from a tool this turn, or from the message it is answering, and has to
 *      exist; "just finished, saved to the library" has to have a receipt
 *      from a tool that really wrote something. 策划 once answered "有什么新的
 *      策划案" with a script it had "just finished" under an id copied from the
 *      channel's, having called three reads; 剪辑师 went looking, and the
 *      studio watched two employees contradict each other.
 *   5. **A hand-off is a structure, not an `@` in the text.** An `@colleague`
 *      in a reply only reaches the colleague when this turn made something to
 *      hand over, and then it carries the ids, checked, into the colleague's
 *      turn. An `@` with nothing behind it is written back as a plain name.
 *      Asking a colleague to do something is `assign_task`
 *      (`lib/ai/tools/team.ts`), which is itself a checked hand-off.
 */

/** How far a tag may travel: the message, its answer, and one hand-off
 *  from that answer (编剧 finishing and tagging 剪辑师). Not further: the
 *  third level was 剪辑师 and 策划 answering each other about work nobody
 *  asked for. */
export const MAX_HOPS = 1;

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

/** One thing handed over, as the chat draws it under the message. */
export type HandoffArtifact = { kind: ArtifactKind; id: string; title?: string; href?: string };

/**
 * Work passing from one pair of hands to another, checked.
 *
 * Built only from receipts (what a tool really made this turn), from an
 * explicit `assign_task`, or by a screen that looked the ids up itself — never
 * from the text of a reply. `from`, `to`, `artifacts` and `verified` are what
 * the posted message carries as `meta.handoff` (`handoffMeta`) and the chat
 * draws its chip from; the rest is for the colleague's turn.
 */
export type Handoff = {
  from: AgentKey | "human";
  to: AgentKey;
  artifacts: HandoffArtifact[];
  verified: true;
  /** What they are asked to do, when it is an assignment. */
  task?: string;
  /** The script and the video project to work in, when there are ones. */
  scriptId?: string;
  projectId?: string;
  workProjectId?: string;
  /** Anything else the colleague should know, one line each. */
  notes?: string[];
};

/** What a hand-off stores on the message: exactly the shape the chat reads. */
export const handoffMeta = (h: Handoff) => ({ from: h.from, to: h.to, artifacts: h.artifacts, verified: true as const });

/** Where a person opens each kind of thing, so a hand-off can link it. */
export function hrefFor(kind: ArtifactKind, id: string): string | undefined {
  switch (kind) {
    case "script":
      return `/script/${id}`;
    case "video_project":
      return `/video?project=${id}`;
    case "work_project":
      return `/projects/${id}`;
    case "article":
      return `/article?id=${id}`;
    default:
      return undefined;
  }
}

export type MentionDispatch = {
  /** Who wrote the message: a person, or an agent answering one. */
  viewer: Viewer;
  channelId: string;
  body: string;
  /**
   * A checked hand-off. When set, only `handoff.to` is dispatched, whatever
   * the text tags, and its turn starts with what was handed over.
   */
  handoff?: Handoff;
  /** Added to the `meta` of each reply this dispatch produces — the buttons
   * under an employee's answer to an approval, say. */
  replyMeta?: Record<string, unknown>;
  /** Agents that have already spoken in this branch. */
  spoken?: AgentKey[];
  hop?: number;
  /** Answers left to the whole chain, shared by every branch of it. Internal:
   * a caller starts a chain, it does not budget one. */
  budget?: { left: number };
  /** The person who started the chain, by name: whom a colleague further
   * down asks when something is missing. Internal. */
  origin?: string | null;
};

/**
 * Work to do once the response has gone.
 *
 * `after` inside a request, so the runtime stays up for it; outside one — a
 * script, the worker — there is no response to wait for, so it simply runs.
 */
export function later(work: () => Promise<void>): void {
  const guarded = () =>
    work().catch((err) => {
      console.error("[agents] deferred work failed", err);
    });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

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
     was always an aside ("@策划 若需延伸…") rather than a hand-off. A checked
     hand-off names its one colleague itself. */
  const tagged = (input.handoff ? [input.handoff.to] : parseAgentMentions(input.body)).filter(
    (key) => !spoken.includes(key),
  );
  const wanted = hop > 0 ? tagged.slice(0, 1) : tagged;
  if (!wanted.length) return;

  const channel = await channelFor(input.viewer, input.channelId);
  if (!channel) return;

  /* The person at the start of the chain. A colleague further down who is
     missing something asks them, not the colleague who passed it on. */
  const origin =
    input.origin !== undefined
      ? input.origin
      : agentKeyFromEmail(input.viewer.email)
        ? null
        : input.viewer.nameLocal || input.viewer.name;

  for (const key of wanted) {
    if (budget.left <= 0) return;
    budget.left--;
    try {
      await answerOne({ ...input, hop, spoken, budget, origin }, key, channel);
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

/* ------------------------------------------------------------ checking */

/** What one turn of an employee actually did and saw, for checking its reply. */
export type ReplyFacts = {
  /** Who is speaking, so its own name is read as "I". */
  self: AgentKey;
  /** Receipts from tools that succeeded this turn. */
  receipts: Artifact[];
  /** Every studio id this turn was shown: in tool results, in the message it
   * is answering, in a hand-off, in the channel's description. */
  seen: ReadonlySet<string>;
};

export type ReplyVerdict = {
  ok: boolean;
  /** Ids in the reply that no tool returned this turn and nobody handed it. */
  unseen: string[];
  /** Ids in the reply that are not — or no longer — in this studio. */
  missing: string[];
  /** Claims of work done with no receipt of the matching kind behind them. */
  unbacked: { claim: string; kinds: ArtifactKind[] }[];
};

/**
 * Which table each checkable id lives in.
 *
 * Only the things a reply might claim to have made, or hand over, or point
 * at. An id with a prefix not listed here still has to have been seen this
 * turn; it just is not looked up.
 */
const CHECKABLE: Record<string, { table: string; soft: boolean }> = {
  scr: { table: "scripts", soft: true },
  prj: { table: "video_projects", soft: true },
  wp: { table: "work_projects", soft: true },
  art: { table: "articles", soft: true },
  fil: { table: "files", soft: true },
  top: { table: "topics", soft: false },
  rnd: { table: "video_exports", soft: false },
  cv: { table: "creator_videos", soft: false },
  chn: { table: "competitors", soft: false },
  ch: { table: "chat_channels", soft: false },
  usr: { table: "users", soft: false },
};

const prefixOf = (id: string) => id.slice(0, id.indexOf("_"));
const isCheckable = (id: string): boolean => Boolean(CHECKABLE[prefixOf(id)]);

/** Which receipt kinds an id's prefix stands for, for a claim about somebody
 * else's work that has to rest on something this turn looked at. */
const KIND_OF_PREFIX: Record<string, ArtifactKind[]> = {
  scr: ["script"],
  prj: ["video_project"],
  rnd: ["render", "video_project"],
  wp: ["work_project"],
  art: ["article"],
  top: ["topic"],
  fil: ["file"],
  chn: ["competitor"],
};

/**
 * The ids among these that exist in this studio and are not deleted.
 *
 * One small query per kind of id. The table names come from the fixed list
 * above, never from the text being checked; the ids go in as parameters.
 */
export async function existingIds(tenantId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const byPrefix = new Map<string, string[]>();
  for (const id of ids) {
    const p = prefixOf(id);
    if (!CHECKABLE[p]) continue;
    byPrefix.set(p, [...(byPrefix.get(p) ?? []), id]);
  }
  await Promise.all(
    [...byPrefix].map(async ([prefix, wanted]) => {
      const { table, soft } = CHECKABLE[prefix];
      const { rows } = await db.execute<{ id: string }>(sql`
        select id from ${sql.identifier(table)}
         where tenant_id = ${tenantId}
           and id in (${sql.join(
             wanted.map((w) => sql`${w}`),
             sql`, `,
           )})
           ${soft ? sql`and deleted_at is null` : sql``}
      `);
      for (const r of rows) found.add(r.id);
    }),
  );
  return found;
}

/**
 * Words that say an action was done.
 *
 * The old list only knew the editor's verbs ("已导出", "粗剪完成") and was only
 * consulted when no tool at all had run. 策划's "刚完成《AI模型蒸馏》脚本初稿，
 * 已存入脚本库" matched neither: three reads had run, and "刚完成", "已存入"
 * were not on it. Longest forms first, so "写好了" is read whole and the
 * check on what follows it sees "吗" and not "了".
 */
const CLAIM = new RegExp(
  [
    "(?:刚刚?|已经?|都已经?)(?:完成|写完|写好|写入|存入|存进|保存|提交|交给|交付|发给|生成|创建|新建|导入|导出|渲染|上传|加入|加进|放入|放进|添加|裁剪|剪好|剪完|做好|做完|改好|改完|更新|发布|对齐|移除|设置|起草)",
    "(?:粗剪|精剪|初稿|脚本|文章|视频|成片)(?:已经?|都)?(?:完成|好了|写好|做好|出来了)",
    "(?:写|剪|做|改|存|渲染|生成|导出|起草)(?:完|好)了",
    "(?:完成|存入|存进|保存|提交|生成|创建|导入|导出|渲染|上传|发布|更新|交给)了",
    "初稿已",
    "我(?:刚刚?|已经?)?写了",
    "写完|写好|存入|存进",
    "\\bI(?:'ve| have) (?:just |already )?(?:finished|written|saved|created|drafted|uploaded|exported|rendered|added|updated|made|cut|handed)\\b",
    "\\b(?:is|are|has been|have been) (?:now )?(?:done|finished|saved|created|written|rendered|exported|uploaded)\\b",
    "\\bjust (?:finished|wrote|saved|created|rendered|exported)\\b",
  ].join("|"),
  "gi",
);

/** Handing over is a claim any receipt backs: the work that was handed, or
 * the assignment that handed it. */
const HANDING = /交给|交付|发给|handed/i;

/** What a claim is about, from the words around it. No kind named means any
 * receipt will do. */
const KIND_WORDS: [RegExp, ArtifactKind[]][] = [
  [/脚本|剧本|初稿|分镜|script/i, ["script"]],
  [/文章|长文|稿件|稿子|article/i, ["article"]],
  [/粗剪|精剪|剪辑|剪好|剪完|渲染|导出|时间线|字幕|素材|画面|视频|成片|\bcut\b|render|video|timeline|caption/i, ["video_project", "render"]],
  [/选题|话题|关注|topic/i, ["topic"]],
  [/文档|文件|document|\bfile\b/i, ["file"]],
  [/项目|project/i, ["work_project", "video_project"]],
  [/对标|competitor/i, ["competitor"]],
];

/** Every name an employee goes by, including the ones the studio retired —
 * they are in old messages, and "视频助理已剪好" is about somebody else. */
const EMPLOYEE_NAMES: Record<AgentKey, string[]> = {
  research: [AGENT_LABELS.research.nameLocal, AGENT_LABELS.research.name, "研究助理", "调研助理"],
  planning: [AGENT_LABELS.planning.nameLocal, AGENT_LABELS.planning.name, "策划助理"],
  script: [AGENT_LABELS.script.nameLocal, AGENT_LABELS.script.name, "脚本助理"],
  video: [AGENT_LABELS.video.nameLocal, AGENT_LABELS.video.name, "视频助理"],
  article: [AGENT_LABELS.article.nameLocal, AGENT_LABELS.article.name, "文章助理"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Claim = {
  /** The words that make the claim, with a little around them. */
  claim: string;
  /** What it is about; empty means anything. */
  kinds: ArtifactKind[];
  /** Said of the speaker's own work, or of somebody else's. */
  mine: boolean;
  /** "已交给…": handing over, which any receipt backs — the work that was
   * handed, or the assignment that handed it. */
  handing: boolean;
};

/**
 * The places a reply says something was done, and by whom.
 *
 * Not every "写好" is a claim: "脚本还没写好" is its opposite, "写好后交给剪辑师"
 * and "等编剧写好" are plans, "写好了吗？" is a question, and "研究员今早发布了晨报"
 * is about somebody else. What is left is a statement of finished work, and
 * whether it is the speaker's — the only kind this turn's receipts can back —
 * or a colleague's, which has to rest on something this turn looked at.
 */
export function findClaims(text: string, self: AgentKey): Claim[] {
  const others = AGENT_KEYS.filter((k) => k !== self).flatMap((k) => EMPLOYEE_NAMES[k]);
  const allNames = AGENT_KEYS.flatMap((k) => EMPLOYEE_NAMES[k]);
  const otherRe = new RegExp(`${others.map(escape).join("|")}|他们|她们|他|她|大家|有人|同事|\\b(?:he|she|they)\\b`, "i");
  const namesRe = new RegExp(allNames.map(escape).join("|"), "gi");
  const claims: Claim[] = [];

  for (const m of text.matchAll(CLAIM)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;

    /* The sentence and the clause the words sit in. */
    const sentenceStart = Math.max(...["。", "！", "？", "!", "?", "\n"].map((p) => text.lastIndexOf(p, at - 1))) + 1;
    const nextStop = text.slice(end).search(/[。！？!?\n]/);
    const sentenceEnd = nextStop < 0 ? text.length : end + nextStop;
    const sentence = text.slice(sentenceStart, sentenceEnd);
    const clauseStart = Math.max(sentenceStart, ...["，", ",", "；", ";", "：", ":"].map((p) => text.lastIndexOf(p, at - 1) + 1));
    const clauseStop = text.slice(end).search(/[，,；;。！？!?\n]/);
    const clause = text.slice(clauseStart, clauseStop < 0 ? text.length : end + clauseStop + 1);
    const before = text.slice(clauseStart, at);
    const after = text.slice(end, end + 3);

    // Not done: "还没写好", "未完成", "没有存入".
    if (/[没未不别]|无法|尚未/.test(text.slice(Math.max(clauseStart, at - 3), at))) continue;
    // Later, or on a condition: "写好后", "写完再", "做完就", "…的话".
    if (/^(?:后|之后|以后|再|就|的话|吗|么|没|了吗|了没|了么)/.test(after)) continue;
    if (/等|如果|要是|一旦|假如|只要|\b(?:before|after|once|when|if)\b/i.test(before)) continue;
    // Asked, or offered: "写好了吗？", "我可以写好…", "请存入…".
    if (/[?？]\s*$/.test(clause)) continue;
    if (/请|要|会|将|准备|打算|可以|帮我|让|\b(?:will|would|can|could|should|going to)\b/i.test(text.slice(Math.max(clauseStart, at - 5), at))) continue;
    // Something that happened before this turn, said as such: "今早已发布".
    if (/今天?早上|今早|上午|昨天|昨晚|前天|之前|此前|早些时候|earlier|yesterday|this morning/i.test(before)) continue;

    const subject = text.slice(sentenceStart, at);
    // Quoted, not said: 你说的“已存入脚本库”.
    const count = (re: RegExp) => subject.match(re)?.length ?? 0;
    if (count(/[“「『]/g) > count(/[”」』]/g) || count(/"/g) % 2 === 1) continue;

    const mine = /我|\bI\b|\bwe\b|我们/i.test(subject) || !otherRe.test(subject);

    const plain = sentence.replace(namesRe, "");
    const handing = HANDING.test(m[0]);
    const kinds = handing ? [] : [...new Set(KIND_WORDS.filter(([re]) => re.test(plain)).flatMap(([, k]) => k))];
    claims.push({ claim: text.slice(Math.max(sentenceStart, at - 12), Math.min(sentenceEnd, end + 16)).trim(), kinds, mine, handing });
  }
  return claims;
}

/**
 * Whether a reply may be posted, given what its turn did and saw.
 *
 * The pure half of `verifyReply`, so it can be run against a real reply with
 * the database answer supplied: `exists` is the set of checkable ids that are
 * really there.
 */
export function judgeReply(text: string, facts: ReplyFacts, exists: ReadonlySet<string>): ReplyVerdict {
  const receiptIds = new Set(facts.receipts.map((r) => r.id.toLowerCase()));
  const ids = idsIn(text);
  const unseen = ids.filter((id) => !facts.seen.has(id) && !receiptIds.has(id));
  const missing = ids.filter((id) => isCheckable(id) && !exists.has(id));

  const seenKinds = new Set([...facts.seen].flatMap((id) => KIND_OF_PREFIX[prefixOf(id)] ?? []));
  const receiptKinds = new Set(facts.receipts.map((r) => r.kind));
  /* Work handed to the worker has begun, not finished: making a whole video
     is minutes away from being something anybody may call done. */
  const finished = new Set(facts.receipts.filter((r) => r.action !== "started").map((r) => r.kind));
  const unbacked = findClaims(text, facts.self)
    .filter((c) =>
      c.mine
        ? // Mine: a receipt this turn, of the kind the claim is about.
          c.handing
          ? facts.receipts.length === 0
          : c.kinds.length
            ? !c.kinds.some((k) => finished.has(k))
            : finished.size === 0
        : // Somebody else's: at least something of that kind was looked at.
          c.kinds.length > 0 && !c.kinds.some((k) => seenKinds.has(k) || receiptKinds.has(k)),
    )
    .map(({ claim, kinds }) => ({ claim, kinds }));

  return { ok: !unseen.length && !missing.length && !unbacked.length, unseen, missing, unbacked };
}

/**
 * Checks a reply before it is posted: every id in it seen this turn and
 * real, every claim of work done backed by a receipt.
 */
export async function verifyReply(text: string, facts: ReplyFacts, tenantId: string): Promise<ReplyVerdict> {
  const ids = idsIn(text);
  const exists = ids.some(isCheckable) ? await existingIds(tenantId, ids) : new Set<string>();
  return judgeReply(text, facts, exists);
}

/**
 * A reply with its `@colleague` tags turned back into plain names — all of
 * them, or all but the one colleague a checked hand-off is going to.
 *
 * An `@` in a reply is what makes a colleague start work, and the chip under
 * it says "交给剪辑师". 策划's "下一步交 @剪辑师 做粗剪", with nothing made, sent
 * 剪辑师 off to cut a script that did not exist.
 */
export function stripAgentMentions(text: string, keep: AgentKey | null = null): string {
  return splitMentions(text)
    .map((p) => (p.isTag && p.agent && p.agent !== keep ? p.text.replace(/^@/, "") : p.text))
    .join("");
}

const KIND_ZH: Record<ArtifactKind, string> = {
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

const ACTION_ZH: Record<Artifact["action"], string> = {
  created: "新建",
  updated: "修改",
  rendered: "渲染",
  started: "已开始，几分钟后完成",
  assigned: "已派出",
};

const receiptLine = (r: Artifact) =>
  `${KIND_ZH[r.kind]}${r.title ? `《${r.title}》` : ""} ${r.id}（${ACTION_ZH[r.action]}）`;

/** Kind words for an id nobody may quote, without quoting it. */
const thingOf = (id: string) => KIND_ZH[(KIND_OF_PREFIX[prefixOf(id)] ?? [])[0] as ArtifactKind] ?? "东西";

/** What went wrong, in a line each, for the second attempt and the record. */
function problems(v: ReplyVerdict, zh: boolean, withIds: boolean): string[] {
  const out: string[] = [];
  for (const id of v.missing) {
    out.push(
      zh
        ? `提到的${thingOf(id)} ${withIds ? `${id} ` : ""}在工作室里不存在（或已被删除）`
        : `the ${withIds ? `id ${id}` : "id quoted"} does not exist in this studio (or was deleted)`,
    );
  }
  for (const id of v.unseen.filter((i) => !v.missing.includes(i))) {
    out.push(
      zh
        ? `提到的 ${withIds ? id : "id"} 这一回合没有任何工具返回过，也不在对方的原话或交接里`
        : `${withIds ? id : "an id"} was not returned by any tool this turn, nor given in the message or hand-off`,
    );
  }
  for (const c of v.unbacked) {
    out.push(
      zh
        ? `说了“${c.claim}”，但这一回合没有成功执行对应的${c.kinds.length ? c.kinds.map((k) => KIND_ZH[k]).join("/") : ""}写入工具（没有回执）`
        : `said "${c.claim}", but no tool that writes${c.kinds.length ? ` a ${c.kinds.join("/")}` : ""} succeeded this turn (no receipt)`,
    );
  }
  return out;
}

/* ------------------------------------------------------------ one answer */

/** Which trade each employee works in, for the prompt and the round budget. */
const WORKS_IN: Record<AgentKey, Module> = {
  research: "research",
  planning: "research",
  script: "script",
  video: "video",
  article: "script",
};

type Chain = Required<Pick<MentionDispatch, "viewer" | "channelId" | "body" | "spoken" | "hop" | "budget">> &
  Pick<MentionDispatch, "handoff" | "replyMeta"> & { origin: string | null };

/** The block a colleague's turn opens with when work was handed to it. */
function handoffBlock(h: Handoff, origin: string | null): string {
  const from = h.from === "human" ? `人${origin ? `（${origin}）` : ""}` : AGENT_LABELS[h.from].nameLocal;
  return [
    "交接内容（系统已核实）：",
    `- 来自：${from}`,
    h.task ? `- 要你做的：${h.task}` : null,
    ...h.artifacts.map((a) => `- ${KIND_ZH[a.kind]}${a.title ? `《${a.title}》` : ""}：${a.id}${a.href ? `（${a.href}）` : ""}`),
    ...(h.notes ?? []).map((n) => `- ${n}`),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

async function answerOne(input: Chain, key: AgentKey, channel: Channel) {
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
  const fromAgent = agentKeyFromEmail(viewer.email);
  const zh = (agent.locale ?? "zh-CN").startsWith("zh");
  const handoff = input.handoff?.to === key ? input.handoff : undefined;
  const origin = input.origin;

  /* In a project's chat the employee works inside that project: its script
     and its video project are the ones open, so "no project is open" cannot
     happen and nothing lands anywhere else. A hand-off that names its own
     script and project wins: it is the specific thing being passed on. */
  const [inProject] = await db
    .select({ scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(eq(workProjects.channelId, channelId))
    .limit(1);
  const scriptId = handoff?.scriptId ?? inProject?.scriptId ?? undefined;
  const projectId = handoff?.projectId ?? inProject?.videoProjectId ?? undefined;

  const rules = fromAgent
    ? [
        /* A colleague brought it in. The editor, told "the script is saved
           as scr_…", tried to render it, then answered the planner "no such
           script — please confirm the id". Right, and no use to anybody. */
        handoff?.task
          ? "- 这是同事派给你的活（见上面的交接内容）。能用你的工具现在就做的，就直接做，做完说结果。"
          : null,
        handoff?.artifacts.length
          ? "- 交接里列出的东西系统已经核实存在，直接基于它做你的那一步。"
          : null,
        "- 同事提到的东西如果你找不到：先用工具查（list_scripts 带关键词、read_script、list_projects、read_plan），找到就用，并说清楚用的是哪一个（标题和 id）。",
        `- 真的没有：说清楚现在实际有什么，然后直接问${origin ?? "提出需求的人"}要不要让编剧来写。不要回头让同事“请确认”“提供正确 ID”——同事改不了这件事，人才能拍板。`,
        "- 不要 @ 任何同事，也不要再往下派活。",
      ]
    : [
        /* Employees were answering "收到，马上开工" and then doing nothing: a
           promise, not work. If a tool can do it now, the turn does it. */
        "- 能用你的工具现在就做的事，就直接做（比如粗剪、写脚本、查数据），做完再说结果；不要只说“收到，马上开工”。做不了才说缺什么。",
        /* Watching it run: 研究员 answered a question and tagged two
           colleagues in passing; 剪辑师 went off to make a project nobody
           asked for. */
        "- 有人问你问题、要你的建议，就回答问题，不要 @ 任何同事。提到别的同事，写名字就好。",
        "- 要让同事做事（提问的人要你交给某人，或者这件事本来就是同事的活）：调用 assign_task，写清楚要做什么。系统会通知对方、带上上下文，对方会马上开始。只在回答里写 @ 不会通知任何人。",
        "- 你用工具做成了自己这一步、下一步按流程属于某位同事时，可以在回答里 @ 那一位（一次最多一位），系统会把你这一回合做成的东西核实后交给它。什么都没做成，就不要 @。",
      ];

  const question = [
    `${asker} 在频道 #${channel.name} 里${handoff ? "把一件事交给了你" : "@了你"}（${AGENT_LABELS[key].nameLocal}）。`,
    channel.topic ? `频道说明：${channel.topic}` : null,
    "",
    "原话：",
    input.body,
    "",
    handoff ? handoffBlock(handoff, origin) : null,
    handoff ? "" : null,
    "怎么回：",
    /* It wrote a status report — "已回复 #频道。做了什么：…" — because it
       thought it was talking to an operator rather than to the room. */
    "- 你写的回答会被自动发到这个频道里。像同事在群里说话那样直接说内容，不要写“已回复”“做了什么”这类汇报格式。",
    "- 先用 read_channel 看看上下文。用中文，简短。",
    ...rules,
    "- 只说你这一回合真的用工具做成的事。没做的、没有工具做的，一律不要说“已完成”“已存入”“已交给”。回答里的 id 只能是这一回合工具返回的、或者上面原话和交接里给的。系统会在发出前逐条核对，对不上的回答不会发出。",
  ]
    .filter((line) => line !== null)
    .join("\n");

  /* What the turn did and saw, across every attempt in it: work done on the
     first attempt is still done if the reply about it has to be rewritten. */
  const receipts: Artifact[] = [];
  const seen = new Set<string>([
    ...idsIn(question),
    ...(handoff?.artifacts.map((a) => a.id.toLowerCase()) ?? []),
    channelId.toLowerCase(),
    ...(scriptId ? [scriptId.toLowerCase()] : []),
    ...(projectId ? [projectId.toLowerCase()] : []),
  ]);
  const facts: ReplyFacts = { self: key, receipts, seen };

  /* Colleagues this turn hands work to through `assign_task`. Their turns
     wait until this reply is posted, so the channel reads in order. */
  const deferred: (() => Promise<void>)[] = [];
  const team: NonNullable<ToolContext["team"]> = {
    hop: input.hop,
    spoken: input.spoken,
    budget: input.budget,
    assigned: [],
    origin,
    later: (work) => deferred.push(work),
  };

  const context: Omit<ToolContext, "viewer"> = {
    module: "chat",
    channelId,
    ...(projectId ? { projectId } : {}),
    ...(scriptId ? { scriptId } : {}),
    /* A colleague's say-so with nothing checked behind it is a reason to
       look things up, not to start work. Every hand-off this file makes now
       carries its checked contents, so this is the guard, not the rule. */
    readOnly: input.hop >= 1 && !handoff,
    team,
  };

  /* One turn of the employee: what it said, and what its tools did. Every
     attempt is kept, so the thread can be put straight afterwards. */
  type Attempt = { id: string | null; answer: string; rejected?: string[] };
  const turns: Attempt[] = [];
  const turn = async (content: string) => {
    let answer = "";
    let failure: string | null = null;
    let tools = 0;
    let id: string | null = null;
    for await (const event of runAgent({
      viewer: agent,
      conversationId,
      content,
      module: WORKS_IN[key],
      // The room it was tagged in, so "this channel" means something. Re-checked
      // inside every tool against the *agent's* membership, not the asker's.
      context,
    })) {
      if (event.type === "message") id = event.id;
      else if (event.type === "delta") answer += event.text;
      else if (event.type === "error") failure = event.message;
      else if (event.type === "tool" && event.status === "running") {
        /* Everything said before a tool call is the model talking to itself;
           only what it says after the last tool it ran is the reply. */
        answer = "";
        tools++;
      } else if (event.type === "tool") {
        for (const seenId of event.resultIds ?? []) seen.add(seenId);
        if (event.status === "ok" && event.artifacts?.length) receipts.push(...event.artifacts);
      }
    }
    const record: Attempt = { id, answer };
    turns.push(record);
    return { answer, failure, tools, record };
  };

  /* Whatever happens from here, a colleague this turn assigned work to has
     a posted request waiting for it, and is started (the `finally` below). */
  let onward: Handoff | null = null;
  let body = "";
  try {
    const first = await turn(question);
    let { answer, failure } = first;
    let posted: Attempt = first.record;

    /* Worked, then said nothing: the turn ended on a tool call. One more turn
       to say what it found, instead of posting "I could not answer". */
    if (!answer.trim() && first.tools > 0 && !failure) {
      const more = await turn(
        zh ? "（系统提示）把你刚才用工具查到或做到的结果，用两三句话直接告诉提问的人。没有结果就说明缺什么。" : "(System) In two or three sentences, tell the person what your tools just found or did. If nothing, say what is missing.",
      );
      if (more.answer.trim()) ({ answer, failure, record: posted } = more);
    }

    /*
     * Checked before it is said.
     *
     * A reply that quotes an id nothing returned, or one that does not exist,
     * or says it finished something no tool wrote, goes back once with exactly
     * what is wrong and exactly what the turn has receipts for. If the second
     * attempt is no better, the channel gets a plain sentence saying so rather
     * than either version.
     */
    let text = answer.trim().slice(0, MAX_REPLY);
    let withheld: string[] | null = null;
    if (text) {
      const verdict = await verifyReply(text, facts, tenantId);
      if (!verdict.ok) {
        posted.rejected = problems(verdict, zh, false);
        const again = await turn(
          zh
            ? [
                "（系统核实）你刚才的回答没有发出，因为：",
                ...problems(verdict, true, true).map((p) => `- ${p}`),
                `你这一回合的回执：${receipts.length ? receipts.map(receiptLine).join("；") : "无——这一回合你没有写入、创建或修改任何东西"}。`,
                "重新回答：只说工具真的返回了或真的做成了的事；只引用回执里或工具结果里出现过的 id；要说某个东西不存在，就说“找不到”，不要写那个 id。没做的事就说没做，说清楚现在实际有什么、谁能做。不要 @ 同事。",
                fromAgent ? null : "如果这件事该同事去做，现在就调用 assign_task 交给他们，再说一句交给了谁。",
              ]
                .filter((l) => l !== null)
                .join("\n")
            : [
                "(System check) Your reply was not posted, because:",
                ...problems(verdict, false, true).map((p) => `- ${p}`),
                `Your receipts this turn: ${receipts.length ? receipts.map((r) => `${r.kind} ${r.id} (${r.action})`).join("; ") : "none — you created or changed nothing this turn"}.`,
                "Answer again: say only what tools returned or did; quote only ids from your receipts or tool results; to say something does not exist, say you could not find it without writing its id. Do not @ colleagues.",
                fromAgent ? null : "If a colleague should do it, call assign_task now and then say whom you handed it to.",
              ]
                .filter((l) => l !== null)
                .join("\n"),
        );
        const second = again.answer.trim().slice(0, MAX_REPLY);
        const recheck = second ? await verifyReply(second, facts, tenantId) : null;
        if (recheck?.ok) {
          text = second;
          failure = again.failure;
          posted = again.record;
        } else {
          if (recheck) again.record.rejected = problems(recheck, zh, false);
          withheld = problems(recheck ?? verdict, zh, false);
          const addressee = fromAgent || parseAgentMentions(`@${asker}`).length ? `${asker}，` : `@${asker} `;
          const did = receipts.length
            ? zh
              ? `这一轮我实际做了：${receipts.map(receiptLine).join("；")}。`
              : `What I actually did this turn: ${receipts.map((r) => `${r.kind} ${r.id} (${r.action})`).join("; ")}.`
            : zh
              ? "这一轮我没有做任何改动。"
              : "I changed nothing this turn.";
          text = zh
            ? `${addressee}抱歉，我刚才要说的内容核对不上（${withheld.slice(0, 2).join("；")}），先不下结论，免得说错。${did}需要我做什么，请直接告诉我。`
            : `${addressee}Sorry, what I was about to say did not check out (${withheld.slice(0, 2).join("; ")}), so I am not saying it. ${did} Tell me what you need and I will do it.`;
          failure = null;
          posted = { id: null, answer: text };
        }
      }
    }

    /*
     * Who, if anyone, this reply hands on to.
     *
     * Only when the turn made something (a receipt that is not itself an
     * assignment — those have handed on already), only one colleague, only
     * one not already in this branch or just assigned, and only while the
     * chain has a hop and an answer left. Every other `@colleague` is written
     * back as a plain name, so the text says who without starting anybody.
     */
    const work = receipts.filter((r) => r.kind !== "assignment");
    const canHandOn = !withheld && work.length > 0 && input.hop + 1 <= MAX_HOPS && input.budget.left > 0;
    const target = canHandOn
      ? (parseAgentMentions(text).find((k) => k !== key && !input.spoken.includes(k) && !team.assigned.includes(k)) ?? null)
      : null;
    text = stripAgentMentions(text, target);

    onward = target
      ? {
          from: key,
          to: target,
          artifacts: work.map((r) => ({ kind: r.kind, id: r.id, ...(r.title ? { title: r.title } : {}), ...(hrefFor(r.kind, r.id) ? { href: hrefFor(r.kind, r.id) } : {}) })),
          verified: true,
          scriptId: work.find((r) => r.kind === "script")?.id ?? scriptId,
          projectId: work.find((r) => r.kind === "video_project")?.id ?? projectId,
        }
      : null;

    /*
     * Silence is a failure worth saying out loud.
     *
     * A tag that produces nothing at all looks exactly like a tag that was never
     * read — and the two have very different fixes. The commonest cause is the
     * OpenRouter account being out of credit, which is an admin's job, not a
     * mystery for whoever typed the tag. An employee is addressed by name, not
     * tagged, so the apology does not set it off again.
     */
    body = text
      ? text
      : fromAgent || parseAgentMentions(`@${asker}`).length
        ? zh
          ? `${asker}，我暂时答不上来${failure ? `：${failure}` : "。"}`
          : `${asker}, I could not answer just now${failure ? `: ${failure}` : "."}`
        : zh
          ? `@${asker} 我暂时答不上来${failure ? `：${failure}` : "。"}`
          : `@${asker} I could not answer just now${failure ? `: ${failure}` : "."}`;

    await postMessage(agent, channelId, body, {
      ...(input.replyMeta ?? {}),
      agent: key,
      /** Which tag pulled it in, so the thread can be read back later. */
      answeringMention: true,
      hop: input.hop,
      askedBy: viewer.id,
      ...(receipts.length ? { receipts } : {}),
      ...(onward ? { handoff: handoffMeta(onward) } : {}),
      ...(withheld ? { withheld: true } : {}),
      ...(text ? {} : { failed: true }),
    });

    /*
     * The thread says what the channel says.
     *
     * `runAgent` replays an employee's own earlier replies to it on the next
     * tag. A reply that was checked and not posted stayed in the thread as it
     * was written — so next time the employee "remembered" finishing a script
     * nobody ever saw. Each attempt is rewritten to what actually happened.
     */
    for (const t of turns) {
      if (!t.id) continue;
      const content =
        t === posted
          ? body
          : t.rejected
            ? zh
              ? `（这条回答没有发出：系统核对未通过——${t.rejected.join("；")}。）`
              : `(This reply was not posted: it failed the check — ${t.rejected.join("; ")}.)`
            : null;
      if (content !== null && content !== t.answer) {
        await db.update(agentMessages).set({ content }).where(eq(agentMessages.id, t.id));
      }
    }
    if (withheld) {
      /* The plain sentence that was posted instead belongs in the thread too,
         as the last thing this employee said here. */
      await db.insert(agentMessages).values({ id: newId("am"), conversationId, role: "assistant", content: body, status: "complete", speaker: key });
    }

    await audit(agent, "agent.mention.reply", {
      objectType: "channel",
      objectId: channelId,
      module: "chat",
      meta: {
        agent: key,
        askedBy: viewer.id,
        hop: input.hop,
        failed: !text,
        receipts: receipts.length,
        ...(withheld ? { withheld } : {}),
        ...(onward ? { handedTo: onward.to } : {}),
      },
    });
  } finally {
    /* Colleagues it assigned work to, now that its reply is in the channel.
       Each one in turn, and one failing does not stop the next. */
    for (const work of deferred) {
      try {
        await work();
      } catch (err) {
        console.error(`[agents] ${key}'s assignment could not start`, err);
      }
    }
  }

  /* And the colleague its finished work goes to, with the work itself —
     checked ids, not a sentence to re-read. `spoken` and the hop count are
     what keep it finite. */
  if (onward) {
    await dispatchAgentMentions({
      viewer: agent,
      channelId,
      body,
      handoff: onward,
      spoken: [...input.spoken, key],
      hop: input.hop + 1,
      budget: input.budget,
      origin,
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
