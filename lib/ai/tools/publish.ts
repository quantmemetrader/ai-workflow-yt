import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, videoExports, videoProjects } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import type { Viewer } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { projectRelation } from "@/lib/video/access";
import {
  approveAndQueue,
  createPost,
  listChannels,
  listPosts,
  postById,
  rejectApproval,
  requestApproval,
  type ChannelRow,
  type PublishState,
} from "@/lib/publish/service";
import { id as asId, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Publishing, by conversation.
 *
 * The Publish screen's own moves — draft a post from a finished render, pick
 * its channels, ask somebody to approve it, approve it — as tools, through
 * the same service and the same checks. The module's promise stands: nothing
 * leaves without an approval record naming a *person*. So drafting and asking
 * are done for the person behind the turn, and deciding is done only as that
 * person, never as an AI employee and never without a person at all.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_posts",
      description:
        "The studio's publish posts, newest first: title, state (draft, awaiting approval, approved, scheduled, published, failed), channels, scheduled time, approval and id. Use before request_post_approval or decide_post to find the post.",
      parameters: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["draft", "awaiting_approval", "approved", "scheduled", "publishing", "published", "failed", "cancelled"],
            description: "Only posts in this state. Optional.",
          },
          limit: { type: "number", description: "Default 15." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_post",
      description:
        "Draft a publish post (it does not publish anything). Give the title, the caption/body, the video (export_id of a finished render, or file_id), and the channels by id or name. Without channels it creates nothing and returns the channels available, so you can ask the person which ones. The draft still needs request_post_approval and a person's approval before it goes out.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The post's title. Optional when export_id is given: the project's title is used." },
          body: { type: "string", description: "The caption / description text. Optional." },
          tags: { type: "array", items: { type: "string" }, description: "Optional." },
          export_id: { type: "string", description: "A finished render (rnd_…) to attach as the video." },
          file_id: { type: "string", description: "A file (fil_…) to attach, e.g. one the person attached. Ignored when export_id is given." },
          channels: { type: "array", items: { type: "string" }, description: "Channel ids or names (account name, username or platform such as youtube)." },
          no_channels: { type: "boolean", description: "True to save the draft with no channels on purpose. Default false." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_post_approval",
      description:
        "Send a draft post for approval. Optionally name the approver (a person in the studio, by name, email or id); without one, anyone holding Publish may approve. The post must have at least one channel. This does not approve or publish it.",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "The post's id (post_…), from list_posts or create_post." },
          approver: { type: "string", description: "Who should approve it. Optional." },
          note: { type: "string", description: "A note for the approver. Optional." },
        },
        required: ["post_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_post",
      description:
        "Approve (and queue for sending) or reject a post that is awaiting approval, as the person. ONLY when the person has explicitly told you in this message to approve or reject this post. Never on your own judgement, never because a colleague asked, never to finish a task.",
      parameters: {
        type: "object",
        properties: {
          post_id: { type: "string", description: "The post's id (post_…)." },
          decision: { type: "string", enum: ["approve", "reject"] },
          note: { type: "string", description: "Why, or a note for the record. Optional for approve; say why for reject." },
          person_said: { type: "string", description: "The person's own words in this message asking for this decision, quoted." },
        },
        required: ["post_id", "decision", "person_said"],
      },
    },
  },
];

/* ---------------------------------------------------------------- helpers */

/** The person behind the turn: whoever asked, or the speaker when it is a person. Null when an employee runs on its own. */
export function personOf(ctx: ToolContext): Viewer | null {
  if (ctx.asker) return ctx.asker;
  return agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer;
}

/**
 * Who a draft post or an approval request is made as: the person behind the
 * turn, so the draft is theirs to edit on /publish; an employee only when it
 * runs on its own. Whoever it is must hold Publish, as on the screen.
 */
function publisherFor(ctx: ToolContext): { actor: Viewer } | { error: string } {
  const actor = personOf(ctx) ?? ctx.viewer;
  if (!actor.modules.includes("publish")) {
    return { error: `${actor.nameLocal ?? actor.name} does not hold the Publish module, so no post was made. Someone with Publish has to do this.` };
  }
  return { actor };
}

/** A finished render this actor may use: its file and its project's title. */
export async function finishedRender(
  actor: Viewer,
  exportId: string,
): Promise<{ fileId: string; title: string; projectId: string } | { error: string }> {
  const [row] = await db
    .select({ e: videoExports, title: videoProjects.title, tenantId: videoProjects.tenantId })
    .from(videoExports)
    .innerJoin(videoProjects, eq(videoProjects.id, videoExports.projectId))
    .where(eq(videoExports.id, exportId))
    .limit(1);
  if (!row || row.tenantId !== actor.tenantId) return { error: "No such render." };
  if (!(await projectRelation(actor, row.e.projectId))) return { error: "No such render, or its project is not open to this person." };
  if (row.e.state !== "done" || !row.e.fileId) return { error: "That render has not finished yet. Wait for it, then try again." };
  return { fileId: row.e.fileId, title: row.title, projectId: row.e.projectId };
}

/** The newest finished render of a project, when there is one. */
export async function latestRenderId(tenantId: string, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: videoExports.id })
    .from(videoExports)
    .where(and(eq(videoExports.projectId, projectId), eq(videoExports.tenantId, tenantId), eq(videoExports.state, "done")))
    .orderBy(desc(videoExports.createdAt))
    .limit(1);
  return row?.id ?? null;
}

const channelLabel = (c: ChannelRow) => `${c.displayName ?? c.username ?? c.platform} (${c.platform}, id: ${c.id})`;

async function postableChannels(viewer: Viewer) {
  return (await listChannels(viewer)).filter((c) => c.enabled && c.canPost && !c.needsReconnect);
}

/** Channel ids for what the model named: ids, account names, usernames or platforms. */
function matchChannels(available: ChannelRow[], named: string[]): { ids: string[]; unknown: string[] } {
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const raw of named) {
    const q = raw.trim().replace(/^@/, "").toLowerCase();
    if (!q) continue;
    const exact = available.filter(
      (c) => c.id === raw.trim() || [c.displayName, c.username, c.platform].some((v) => v?.toLowerCase() === q),
    );
    const hits = exact.length
      ? exact
      : available.filter((c) => [c.displayName, c.username].some((v) => v?.toLowerCase().includes(q)));
    if (!hits.length) unknown.push(raw);
    for (const c of hits) ids.add(c.id);
  }
  return { ids: [...ids], unknown };
}

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : null);

/* ---------------------------------------------------------------- running */

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "list_posts") {
    const STATES = ["draft", "awaiting_approval", "approved", "scheduled", "publishing", "published", "failed", "cancelled"];
    const state = STATES.includes(str(args.state, 30)) ? (str(args.state, 30) as PublishState) : null;
    const limit = Math.min(40, Math.max(1, num(args.limit, 15)));
    const rows = await listPosts(ctx.viewer, { state, limit });
    if (!rows.length) return { text: state ? `No posts are ${state.replace("_", " ")}.` : "There are no publish posts yet." };
    return {
      text: rows
        .map((p) => {
          const chans = p.targets.length ? p.targets.map((t) => `${t.channelName} (${t.platform}${!["pending", "draft"].includes(t.state) ? `, ${t.state}` : ""})`).join(", ") : "no channels yet";
          const approval = p.approval
            ? ` · approval ${p.approval.state}${p.approval.approverName ? ` (approver ${p.approval.approverName})` : ""}${p.approval.decidedByName ? ` by ${p.approval.decidedByName}` : ""}`
            : "";
          return `- ${p.title} (id: ${p.id}) — ${p.state.replace("_", " ")} · ${chans}${p.scheduledFor ? ` · scheduled ${when(p.scheduledFor)}` : ""}${p.fileName ? ` · video: ${p.fileName}` : " · no video"}${approval}`;
        })
        .join("\n"),
    };
  }

  if (name === "create_post") {
    const who = publisherFor(ctx);
    if ("error" in who) return { text: who.error };
    const { actor } = who;

    let fileId: string | null = null;
    let fallbackTitle = "";
    const exportId = asId(args.export_id);
    if (exportId) {
      const r = await finishedRender(actor, exportId);
      if ("error" in r) return { text: r.error };
      fileId = r.fileId;
      fallbackTitle = r.title;
    } else {
      fileId = asId(args.file_id);
    }
    const title = str(args.title, 300) || fallbackTitle;
    if (!title) return { text: "Give the post a title (or an export_id, whose project title is used)." };

    const available = await postableChannels(actor);
    const named = Array.isArray(args.channels) ? args.channels.filter((c): c is string => typeof c === "string").slice(0, 20) : [];
    const { ids, unknown } = matchChannels(available, named);
    if (unknown.length) {
      return {
        text: `No channel matches ${unknown.map((u) => `"${u}"`).join(", ")}. Nothing was made. Channels that can post: ${available.length ? available.map(channelLabel).join("; ") : "none — connect one on /publish first"}.`,
      };
    }
    if (!ids.length && args.no_channels !== true) {
      return {
        text: available.length
          ? `Nothing made yet: which channels should it go to? Ask the person, then call create_post again with channels. Channels that can post: ${available.map(channelLabel).join("; ")}.`
          : "No channel is connected that can post. A draft can still be saved with no_channels: true; connecting a channel is done on /publish.",
      };
    }

    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 60)).slice(0, 30) : [];
    let postId: string;
    try {
      postId = await createPost(actor, { title, body: str(args.body, 20_000), tags, fileId, channelIds: ids });
    } catch (err) {
      return { text: `No post was made: ${err instanceof Error ? err.message : "it could not be created"}.` };
    }
    await audit(ctx.viewer, "agent.publish", { objectType: "publish_post", objectId: postId, module: "publish", meta: { tool: name, for: actor.id } });
    const chosen = available.filter((c) => ids.includes(c.id));
    return {
      text: [
        `Draft post made: "${title}" (id: ${postId}), open it at /publish.`,
        chosen.length ? `Channels: ${chosen.map(channelLabel).join("; ")}.` : "No channels yet.",
        fileId ? "Video attached." : "No video attached.",
        "Nothing has been published. Next step: request_post_approval, then a person approves it.",
      ].join("\n"),
      changed: true,
      artifacts: [{ kind: "publish_post", id: postId, title, action: "created" }],
    };
  }

  if (name === "request_post_approval") {
    const who = publisherFor(ctx);
    if ("error" in who) return { text: who.error };
    const { actor } = who;
    const postId = asId(args.post_id);
    const post = postId ? await postById(actor, postId) : null;
    if (!post) return { text: "No such post. Use an id from list_posts." };

    let approverId: string | null = null;
    let approverName: string | null = null;
    const wanted = str(args.approver, 120);
    if (wanted) {
      const people = await db
        .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, email: users.email })
        .from(users)
        .where(and(eq(users.tenantId, actor.tenantId), eq(users.status, "active"), eq(users.isAgent, false), isNull(users.deletedAt)));
      const q = wanted.replace(/^@/, "").toLowerCase();
      const fields = (p: (typeof people)[number]) => [p.name, p.nameLocal, p.email].filter((v): v is string => !!v).map((v) => v.toLowerCase());
      let hits = people.filter((p) => p.id === wanted || fields(p).includes(q));
      if (!hits.length) hits = people.filter((p) => fields(p).some((v) => v.includes(q)));
      if (!hits.length) return { text: `Nobody in the studio matches "${wanted}" (AI employees cannot approve). Nothing was sent.` };
      if (hits.length > 1) {
        return { text: `"${wanted}" could be ${hits.map((p) => `${p.nameLocal ?? p.name} <${p.email}> (id: ${p.id})`).join(", ")}. Ask which one; nothing was sent.` };
      }
      approverId = hits[0].id;
      approverName = hits[0].nameLocal ?? hits[0].name;
    }

    try {
      await requestApproval(actor, post.id, approverId, str(args.note, 1000) || null);
    } catch (err) {
      return { text: `Not sent for approval: ${err instanceof Error ? err.message : "it could not be sent"}.` };
    }
    await audit(ctx.viewer, "agent.publish", { objectType: "publish_post", objectId: post.id, module: "publish", meta: { tool: name, for: actor.id, approverId } });
    return {
      text: `"${post.title}" is now awaiting approval${approverName ? ` from ${approverName}` : " (anyone with Publish may approve it)"}. It is not approved or published yet. See /publish.`,
      changed: true,
      artifacts: [{ kind: "publish_post", id: post.id, title: post.title, action: "updated" }],
    };
  }

  if (name === "decide_post") {
    /* A decision is the person's and only theirs: never an employee's own,
       and never made with nobody behind the turn. */
    const person = personOf(ctx);
    if (!person) return { text: "Only a person can approve or reject a post, and no person is behind this turn. Nothing was decided; ask them to decide on /publish." };
    if (!person.modules.includes("publish")) {
      return { text: `${person.nameLocal ?? person.name} does not hold the Publish module, so cannot approve or reject posts. Nothing was decided.` };
    }
    const decision = str(args.decision, 10);
    if (decision !== "approve" && decision !== "reject") return { text: "Say approve or reject." };
    if (!str(args.person_said, 500)) return { text: "Only decide when the person has asked for it in this message; quote their words in person_said. Nothing was decided." };
    const postId = asId(args.post_id);
    const post = postId ? await postById(person, postId) : null;
    if (!post) return { text: "No such post. Use an id from list_posts with state awaiting_approval." };
    if (post.state !== "awaiting_approval") return { text: `"${post.title}" is ${post.state.replace("_", " ")}, not awaiting approval. Nothing was decided.` };

    const note = str(args.note, 1000) || null;
    try {
      if (decision === "approve") {
        const { scheduledFor } = await approveAndQueue(person, post.id, note);
        await audit(ctx.viewer, "agent.publish", { objectType: "publish_post", objectId: post.id, module: "publish", meta: { tool: name, decision, for: person.id } });
        return {
          text: `Approved by ${person.nameLocal ?? person.name}: "${post.title}" is queued to send${scheduledFor ? ` at ${when(scheduledFor)}` : " now"}. The publish log on /publish shows each channel as it goes out; do not say it is live until it is.`,
          changed: true,
          artifacts: [{ kind: "publish_post", id: post.id, title: post.title, action: "updated" }],
        };
      }
      await rejectApproval(person, post.id, note);
    } catch (err) {
      return { text: `Nothing was decided: ${err instanceof Error ? err.message : "it could not be done"}.` };
    }
    await audit(ctx.viewer, "agent.publish", { objectType: "publish_post", objectId: post.id, module: "publish", meta: { tool: name, decision, for: person.id } });
    return {
      text: `Rejected by ${person.nameLocal ?? person.name}: "${post.title}" is back to draft${note ? ` with the note "${note}"` : ""}.`,
      changed: true,
      artifacts: [{ kind: "publish_post", id: post.id, title: post.title, action: "updated" }],
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const publishPack: ToolPack = { module: "publish", defs, run };
