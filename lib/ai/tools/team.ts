import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, scripts, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import type { ToolDef } from "@/lib/ai/openrouter";
import { AGENT_KEYS, AGENT_LABELS, agentFromTag, agentKeyFromEmail, agentTag, type AgentKey } from "@/lib/agents/catalog";
import { ensureAgentChannel } from "@/lib/agents";
import { latestPlan } from "@/lib/agents/proposals";
import type { Handoff, HandoffArtifact } from "@/lib/agents/mentions";
import { postMessage } from "@/lib/chat/service";
import { listWorkProjects, reachableThroughProjects, visibleProject, type WorkProjectRow } from "@/lib/projects/service";
import { id as asId, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * The team: what it planned, what it is making, and handing work to it.
 *
 * Asked "有什么新的策划案上传了", 策划 had nothing to answer with. The plan it
 * posts every morning was a line of chat to it, the projects the studio is
 * working on were not reachable by any tool at all, and the only way it could
 * get a colleague to do something was to write "@剪辑师" in a reply — which,
 * with nothing behind it, sent 剪辑师 after a script that did not exist.
 *
 * So three tools, for every employee and every person's assistant:
 *
 *   - `read_plan` reads today's plan as a plan: each to-do with whom it is
 *     for, and plainly marked as an assignment rather than work done.
 *   - `list_projects` lists the projects — each one's script and video
 *     project — so "what are we making" has an answer with ids in it.
 *   - `assign_task` is how anyone asks a colleague to do something. It posts
 *     the request in the channel as a checked hand-off and starts the
 *     colleague on it, with the project's script and video project in hand.
 *     "@策划 让编剧写个脚本" becomes 策划 calling this, and 编剧 writing it.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_plan",
      description:
        "Today's plan from 策划 (the newest one posted): the focus, every to-do with the colleague it is assigned to, and whether anyone has pressed its hand-off buttons. A to-do is an assignment, not finished work — use list_scripts or list_projects to see what actually exists.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description:
        "The studio's projects, most recently active first. Each project is one video: its own chat, its script (with its status) and its video project, with their ids; a finished one (status done) also says when it was published, on which platforms and with which links. Give a query to find one by name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words from the project's name. Optional." },
          limit: { type: "number", description: "Default 15, most 40." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "assign_task",
      description:
        "Hand a piece of work to a colleague: research 研究员, planning 策划, script 编剧, video 剪辑师, article 撰稿人. Posts the request in this channel (or in the project's own chat when project_id is given) tagging them, and they start on it straight away with the project's script and video project in hand. Use it whenever someone asks you to get a colleague to do something, or when the work is theirs and not yours. Returns a receipt; afterwards say in one sentence whom you handed it to, without @-ing them again.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", enum: [...AGENT_KEYS], description: "Who does it." },
          task: {
            type: "string",
            description: "What to do, specifically enough to start now: the subject, the length, the platform, anything the person asked for. In Chinese.",
          },
          project_id: { type: "string", description: "The project it belongs to (wp_…, from list_projects). Optional." },
        },
        required: ["to", "task"],
      },
    },
  },
];

/** Today in Hong Kong, the calendar the plan is dated by. */
const hkToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const ownerName = (owner: string) =>
  AGENT_KEYS.includes(owner as AgentKey) ? AGENT_LABELS[owner as AgentKey].nameLocal : "人";

/**
 * The person this turn works for, if there is one: whoever asked (the
 * assistant stream and every turn of a chain a person started carry them as
 * `asker`), or the viewer itself when that is a person's own assistant.
 * Null when an employee started the chain and nobody is behind it.
 *
 * Projects are picked by this person's rule, not the employee's. The
 * employee runs as itself and setProjectAccess makes it a member of every
 * private project's chat and an editor of its script, so "can the employee
 * reach it" is the wrong test: by it a guest could list the studio's
 * projects through 策划, and anyone could hand 编剧 a private project's
 * script to rewrite. And the employee's own rule was too narrow for the
 * people inside: it never sees a private project, so its owner asking from
 * #制作 heard "no such project". (What a channel answer may *list* is
 * narrower still: `projectsFor`.)
 */
function personOf(ctx: ToolContext): Viewer | null {
  if (ctx.asker) return ctx.asker;
  return agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer;
}

/** The live project whose chat a channel is, with what a hand-off and the
 * project list need from it. */
async function projectInChannel(tenantId: string, channelId: string) {
  const [row] = await db
    .select({
      id: workProjects.id,
      title: workProjects.title,
      status: workProjects.status,
      mode: workProjects.mode,
      updatedAt: workProjects.updatedAt,
      channelId: workProjects.channelId,
      scriptId: workProjects.scriptId,
      videoProjectId: workProjects.videoProjectId,
      channelSlug: chatChannels.slug,
      createdBy: workProjects.createdBy,
      access: sql<string>`${workProjects.access} ->> 'mode'`,
    })
    .from(workProjects)
    .leftJoin(chatChannels, eq(chatChannels.id, workProjects.channelId))
    .where(and(eq(workProjects.channelId, channelId), eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The projects this turn may name, most recently active first.
 *
 * When the answer goes back to the person alone (their own assistant, or an
 * employee in the assistant stream: `privateReply`), the ones that person
 * may see (`personOf`).
 *
 * When an employee's answer is posted in a channel, what the room may hear
 * about: the employee's own reach (the studio-wide projects) plus the
 * project whose chat this is — and of those, only the ones the person who
 * asked may see. Listing by the person alone put every private project an
 * admin or a member could see into #制作, titles, ids and chat slugs, for
 * everyone reading #制作. `held` says some were left out, so the answer can
 * say where they are named instead of "there is no such project";
 * assign_task still takes such a project's id from the person.
 *
 * With nobody behind the turn, the employee's own, plus the project whose
 * chat it is answering in: it was made a member there, and "@策划 让编剧写"
 * inside a private project has to find the project it is in. Never every
 * private project it happens to be a member of, for the same reason.
 */
async function projectsFor(ctx: ToolContext, limit: number): Promise<{ rows: WorkProjectRow[]; held: boolean }> {
  const person = personOf(ctx);
  const employee = Boolean(agentKeyFromEmail(ctx.viewer.email));
  if (person && (!employee || ctx.privateReply)) return { rows: await listWorkProjects(person, limit), held: false };

  const [own, here] = await Promise.all([
    listWorkProjects(ctx.viewer, person ? 200 : limit),
    ctx.channelId ? projectInChannel(ctx.viewer.tenantId, ctx.channelId) : null,
  ]);
  const room: WorkProjectRow[] = here && !own.some((r) => r.id === here.id) ? [{ ...here, updatedAt: here.updatedAt.toISOString() }, ...own] : own;
  if (!person) return { rows: room.slice(0, limit), held: false };

  /* The person's own list, in its order, kept to what the room may hear. */
  const inRoom = new Set(room.map((r) => r.id));
  const mine = await listWorkProjects(person, 200);
  const rows = mine.filter((r) => inRoom.has(r.id));
  return { rows: rows.slice(0, limit), held: rows.length < mine.length };
}

/** A colleague from whatever the model wrote: the key, the name, the tag. */
function colleague(v: unknown): AgentKey | null {
  const s = str(v, 40).replace(/^@/, "");
  if (!s) return null;
  if (AGENT_KEYS.includes(s as AgentKey)) return s as AgentKey;
  return agentFromTag(s);
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "read_plan") {
    const plan = await latestPlan(ctx.viewer);
    if (!plan) return { text: "策划 has not posted a plan yet." };
    const today = hkToday();
    const focus = plan.body.match(/今天最重要：\**\s*(.+)/)?.[1]?.trim();
    const pressed = plan.done
      ? `${plan.done.by || "Somebody"} pressed its "${plan.done.actionId.startsWith("hand-") ? `交给${ownerName(plan.done.actionId.slice(5))}` : plan.done.actionId}" button${plan.done.at ? ` at ${plan.done.at.slice(0, 16).replace("T", " ")} UTC` : ""}. That handed those to-dos over; it does not mean they are finished.`
      : "Nobody has pressed its hand-off buttons yet.";
    return {
      text: [
        `Plan${plan.date ? ` for ${plan.date}` : ""}, posted by 策划 in #${plan.channelName} at ${plan.postedAt.toISOString().slice(0, 16).replace("T", " ")} UTC (message ${plan.messageId}).`,
        plan.date && plan.date !== today ? `Note: today in Hong Kong is ${today}; this is the newest plan there is, not today's.` : "",
        focus ? `Focus: ${focus}` : "",
        "To-dos — each is an assignment to the person named, not work already done:",
        ...plan.list.map((t, i) => `${i + 1}. ${ownerName(t.owner)} — ${t.text}${t.why ? ` (why: ${t.why})` : ""}`),
        pressed,
        "Whether anything was actually made: list_scripts and list_projects.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (name === "list_projects") {
    const limit = Math.min(40, Math.max(1, num(args.limit, 15)));
    const query = str(args.query, 80).toLowerCase();
    const { rows: all, held } = await projectsFor(ctx, 40);
    const rows = (query ? all.filter((r) => r.title.toLowerCase().includes(query)) : all).slice(0, limit);
    /* No count and no names: only that such projects exist and where they
       can be named, so "no such project" is not said of one that is. */
    const heldNote = held
      ? "Projects kept to some people are not listed in a channel: they are named in their own chat or in the person's own assistant, and assign_task still takes such a project's id when the person gives it."
      : "";
    if (!rows.length) {
      return {
        text: [
          query
            ? `No project is called anything like "${str(args.query, 80)}". There are ${all.length} project(s) in all.`
            : held
              ? "No project here is open to everyone in this room."
              : "The studio has no projects yet.",
          heldNote,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    /* Each project's script by name and state, so "is the script written"
       is answered here rather than by a second call per project. */
    const scriptIds = rows.map((r) => r.scriptId).filter((v): v is string => Boolean(v));
    const scriptRows = scriptIds.length
      ? await db
          .select({ id: scripts.id, title: scripts.title, status: scripts.status })
          .from(scripts)
          .where(and(inArray(scripts.id, scriptIds), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
      : [];
    const byId = new Map(scriptRows.map((s) => [s.id, s]));
    return {
      text: [
        ...rows.map((r) => {
          const sc = r.scriptId ? byId.get(r.scriptId) : undefined;
          /* Where a finished one went, as the owner marked it (「已发布」):
             so 研究员 asked "how did the last video do" knows the platform
             and the link to look at. */
          const pub = r.published;
          const went = pub
            ? ` · published ${pub.at.slice(0, 10)}${pub.platforms.length ? ` on ${pub.platforms.map((x) => (x.url ? `${x.key} (${x.url})` : x.key)).join(", ")}` : ""}${pub.note ? ` — note: ${pub.note.slice(0, 120)}` : ""}`
            : "";
          return [
            `- 《${r.title}》 (id: ${r.id}) — ${r.status}${r.mode !== "full" ? ` · ${r.mode}` : ""} · active ${r.updatedAt.slice(0, 10)}${went}`,
            `  script: ${sc ? `${sc.title} (id: ${sc.id}, ${sc.status})` : r.scriptId ? `${r.scriptId} (deleted)` : "none"} · video project: ${r.videoProjectId ?? "none"}${r.channelSlug ? ` · chat #${r.channelSlug}` : ""}`,
          ].join("\n");
        }),
        heldNote,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (name === "assign_task") {
    const to = colleague(args.to);
    if (!to) return { text: "Say who does it: research, planning, script, video or article." };
    const from: AgentKey | "human" = agentKeyFromEmail(ctx.viewer.email) ?? "human";
    if (to === from) return { text: "That is you. Do it with your own tools, or say what is missing." };
    const { MAX_HOPS, dispatchAgentMentions, hrefFor, later, stripAgentMentions } = await import("@/lib/agents/mentions");
    /* The task as it is posted under the one tag this hand-off is for. A
       second "@剪辑师" inside it would draw as a second hand-off that nobody
       made. */
    const task = stripAgentMentions(str(args.task, 600)).trim();
    if (!task) return { text: "Say what they should do, specifically enough to start now." };

    /* The same bound a tag has. This is a hand-off like any other: it counts
       as a hop and costs an answer, and a colleague who already spoke in this
       branch is not asked again — or three employees hold a meeting. */
    const team = ctx.team;
    const hop = team ? team.hop + 1 : from === "human" ? 0 : 1;
    if (hop > MAX_HOPS || (team && team.budget.left <= 0)) {
      return {
        text: `Not handed on: you were brought in by a colleague, and a chain of hand-offs stops here. Tell the person who asked that ${AGENT_LABELS[to].nameLocal} should do it; they can tag them.`,
      };
    }
    if (team?.spoken.includes(to) || team?.assigned.includes(to)) {
      return { text: `${AGENT_LABELS[to].nameLocal} is already on this. Say so instead of asking again.` };
    }

    /* Where: the named project's own chat; else the channel this is being
       asked in; else #制作, where the studio hands work over.

       Handing 编剧 a project is handing it that project's script to write
       into, so the project — named by id, or found from the channel — has
       to be one the person this is done for may see, by the rule the
       project list itself uses (`personOf`). Being in the tenant is not
       enough, and neither is the employee's own reach: the channel used to
       need no check at all, on the reasoning that the viewer was in that
       project's chat — true of the employee, who is in every project's
       chat, and not of whoever sent the channel id to the assistant stream.
       With nobody behind the turn, the employee's own rule, and the project
       whose chat it is answering in. */
    const person = personOf(ctx);
    const here = ctx.channelId ? await projectInChannel(ctx.viewer.tenantId, ctx.channelId) : null;
    const projectId = asId(args.project_id);
    let project: { id: string; title: string; channelId: string; scriptId: string | null; videoProjectId: string | null } | null = null;
    if (projectId) {
      project = person ? await visibleProject(person, projectId) : here?.id === projectId ? here : await visibleProject(ctx.viewer, projectId);
      if (!project) return { text: "There is no such project, or it is not open to you. list_projects gives the ids." };
    } else if (here) {
      if (person && !(await visibleProject(person, here.id))) {
        return { text: "This chat's project is not open to the person who asked, so nothing was handed on." };
      }
      project = here;
    }

    const channelId = project?.channelId ?? ctx.channelId ?? (await ensureAgentChannel(ctx.viewer.tenantId, "production"));
    const [channel] = await db
      .select({ name: chatChannels.name })
      .from(chatChannels)
      .where(and(eq(chatChannels.id, channelId), eq(chatChannels.tenantId, ctx.viewer.tenantId)))
      .limit(1);
    if (!channel) return { text: "That channel is not open to you, so nothing was handed on." };

    /* The script and the video project that go with it: the project's own
       when there is a project — never a screen's id beside it — and
       otherwise the ones open on screen. Those are posted as checked
       ("verified") and handed to a colleague to work in, so each has to
       exist in the studio and, when it belongs to projects, be reachable by
       the person through one of them. The video project used to go out
       with no check at all. */
    const scriptId = project ? project.scriptId : (ctx.scriptId ?? null);
    const videoWanted = project ? project.videoProjectId : (ctx.projectId ?? null);
    const [[scriptRow], [videoRow]] = await Promise.all([
      scriptId
        ? db
            .select({ id: scripts.id, title: scripts.title })
            .from(scripts)
            .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
            .limit(1)
        : [],
      videoWanted
        ? db
            .select({ id: videoProjects.id })
            .from(videoProjects)
            .where(and(eq(videoProjects.id, videoWanted), eq(videoProjects.tenantId, ctx.viewer.tenantId), isNull(videoProjects.deletedAt)))
            .limit(1)
        : [],
    ]);
    const onScreenOk = async (by: { scriptId?: string; videoProjectId?: string }) =>
      project !== null || !person || (await reachableThroughProjects(person, by));
    const script = scriptRow && (await onScreenOk({ scriptId: scriptRow.id })) ? scriptRow : undefined;
    const videoProjectId = videoRow && (await onScreenOk({ videoProjectId: videoRow.id })) ? videoRow.id : null;

    /* What goes with it: only things that exist, each with its link. */
    const artifacts: HandoffArtifact[] = [
      ...(project ? [{ kind: "work_project" as const, id: project.id, title: project.title, href: hrefFor("work_project", project.id) }] : []),
      ...(script ? [{ kind: "script" as const, id: script.id, title: script.title, href: hrefFor("script", script.id) }] : []),
      ...(videoProjectId ? [{ kind: "video_project" as const, id: videoProjectId, href: hrefFor("video_project", videoProjectId) }] : []),
    ];
    const body = [
      `${agentTag(to)} ${task}`,
      ...(project ? [`- 项目：[《${project.title}》](/projects/${project.id})`] : []),
      ...(script ? [`- [打开脚本](/script/${script.id})`] : []),
      ...(videoProjectId ? [`- [打开视频项目](/video?project=${videoProjectId})`] : []),
    ].join("\n");

    const handoff: Handoff = {
      from,
      to,
      artifacts,
      verified: true,
      task,
      ...(script ? { scriptId: script.id } : {}),
      ...(videoProjectId ? { projectId: videoProjectId } : {}),
      ...(project ? { workProjectId: project.id } : {}),
    };

    const messageId = await postMessage(ctx.viewer, channelId, body, {
      ...(from !== "human" ? { agent: from } : {}),
      handoff: { from, to, artifacts, verified: true },
      assignment: { task },
    });
    if (!messageId) return { text: "Nothing was posted, so nothing was handed on." };

    const start = () =>
      dispatchAgentMentions({
        viewer: ctx.viewer,
        channelId,
        body,
        handoff,
        hop,
        spoken: team ? [...team.spoken, ...(from !== "human" ? [from] : [])] : from !== "human" ? [from] : [],
        ...(team ? { budget: team.budget, origin: team.origin } : {}),
        /* The colleague's turn works for the same person, and checks what
           it picks against them too. */
        asker: person,
      });
    /* Inside an employee's turn, the colleague starts once its reply is
       posted; anywhere else, once the response has gone. */
    if (team) {
      team.assigned.push(to);
      team.later(start);
    } else {
      later(start);
    }

    await audit(ctx.viewer, "agent.assign", {
      objectType: "channel",
      objectId: channelId,
      module: "chat",
      meta: { from, to, task: task.slice(0, 160), messageId, hop, ...(project ? { project: project.id } : {}) },
    });

    return {
      text: `Handed to ${AGENT_LABELS[to].nameLocal} in #${channel.name} (message ${messageId}): "${task}". They start as soon as you have answered. Say in one sentence whom you handed it to; do not @ them again.`,
      changed: true,
      artifacts: [{ kind: "assignment", id: messageId, title: `${AGENT_LABELS[to].nameLocal}：${task.slice(0, 80)}`, action: "assigned" }],
    };
  }

  return { text: `Unknown tool ${name}.` };
}

/** Every employee and every person with Chat: planning and handing work over
 * is not one module's business. */
export const teamPack: ToolPack = { module: "chat", defs, run };
