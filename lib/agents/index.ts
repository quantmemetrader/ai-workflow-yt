import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { entitlements, users, type Module } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { createChannel, postMessage } from "@/lib/chat/service";

/**
 * The studio's AI employees.
 *
 * Each one is a user row with `is_agent` set (see `users.isAgent`), so it acts
 * through exactly the tools and services a person does, with only the modules
 * granted here. That is the whole permission story: an agent can do what its
 * entitlements let a person do, and nothing a request could not.
 *
 * They are created on first use, so a fresh database, a new studio or a reset
 * tenant never needs a separate seeding step to get them back.
 */
export type AgentKey = "research" | "script" | "video";

type AgentDef = {
  /** `.invalid` (RFC 2606): an address that can never receive mail, so no
   * reset link or invite can ever reach anybody through it. */
  email: string;
  name: string;
  nameLocal: string;
  title: string;
  modules: Module[];
};

export const AGENTS: Record<AgentKey, AgentDef> = {
  research: {
    email: "research@agents.invalid",
    name: "Research agent",
    nameLocal: "研究助理",
    title: "AI 员工 · 研究",
    modules: ["chat", "research"],
  },
  script: {
    email: "script@agents.invalid",
    name: "Script agent",
    nameLocal: "脚本助理",
    title: "AI 员工 · 脚本",
    modules: ["chat", "script", "research"],
  },
  video: {
    email: "video@agents.invalid",
    name: "Video agent",
    nameLocal: "视频助理",
    title: "AI 员工 · 视频",
    modules: ["chat", "video", "script", "files"],
  },
};

/** Where the agents talk. Public channels, so everyone in the studio sees
 * the work happen without being added to anything. */
export const AGENT_CHANNELS = {
  digest: {
    name: "研究日报",
    topic: "研究助理每天早上 8:00（香港时间）发布：昨日趋势，和今天值得讨论的一个选题。",
    owner: "research",
  },
  production: {
    name: "制作",
    topic: "脚本通过审批后，脚本助理在这里把它交给视频助理。",
    owner: "script",
  },
} as const satisfies Record<string, { name: string; topic: string; owner: AgentKey }>;

export type AgentChannel = keyof typeof AGENT_CHANNELS;

/** The agent's user id in this studio, creating it the first time. */
export async function ensureAgent(tenantId: string, key: AgentKey): Promise<string> {
  const def = AGENTS[key];
  const [existing] = await db
    .select({ id: users.id, isAgent: users.isAgent })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, def.email)))
    .limit(1);

  let id = existing?.id;
  if (existing && !existing.isAgent) {
    // Somebody holds this address as a person. Never promote them into an
    // agent, and never act as them.
    throw new Error(`${def.email} belongs to a person, not the ${key} agent`);
  }
  if (!id) {
    id = newId("usr");
    await db
      .insert(users)
      .values({
        id,
        tenantId,
        email: def.email,
        name: def.name,
        nameLocal: def.nameLocal,
        title: def.title,
        role: "member",
        // Active so a job can act as it (`viewerById`); it still cannot sign
        // in, because sign-in refuses `is_agent` and it has no password.
        status: "active",
        isAgent: true,
        locale: "zh-HK",
      })
      .onConflictDoNothing({ target: [users.tenantId, users.email] });
    // Two first uses at once: whichever row won is the agent.
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, def.email)))
      .limit(1);
    id = row.id;
  }

  await db
    .insert(entitlements)
    .values(def.modules.map((module) => ({ userId: id!, module })))
    .onConflictDoNothing();
  return id;
}

/** The agent as a viewer: what every tool and service takes. */
export async function agentViewer(tenantId: string, key: AgentKey): Promise<Viewer> {
  const id = await ensureAgent(tenantId, key);
  const viewer = await viewerById(id);
  if (!viewer) throw new Error(`The ${key} agent is disabled in this studio`);
  return viewer;
}

/** The channel's id, creating it (as its agent) the first time. */
export async function ensureAgentChannel(tenantId: string, which: AgentChannel): Promise<string> {
  const def = AGENT_CHANNELS[which];
  const owner = await agentViewer(tenantId, def.owner);
  const channel = await createChannel(owner, { name: def.name, topic: def.topic });
  return channel.id;
}

/**
 * Post into an agent channel as an agent.
 *
 * `mentions` names the agents being addressed. It is kept in the message's
 * `meta` rather than parsed back out of the text, so the day agents act on
 * being tagged (P2) there is nothing to guess.
 */
export async function postAsAgent(
  tenantId: string,
  from: AgentKey,
  where: AgentChannel,
  body: string,
  meta: Record<string, unknown> & { mentions?: AgentKey[] } = {},
): Promise<string | null> {
  const [viewer, channelId] = await Promise.all([agentViewer(tenantId, from), ensureAgentChannel(tenantId, where)]);
  const mentionIds = meta.mentions?.length
    ? await Promise.all(meta.mentions.map((m) => ensureAgent(tenantId, m)))
    : [];
  return postMessage(viewer, channelId, body, {
    ...meta,
    agent: from,
    ...(mentionIds.length ? { mentionUserIds: mentionIds } : {}),
  });
}

/** How an agent is written when it is tagged in a message. */
export const tag = (key: AgentKey) => `@${AGENTS[key].nameLocal}`;
