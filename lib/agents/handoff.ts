import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifications, scripts, topics, videoProjects } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { canEditProject } from "@/lib/video/access";
import { createWorkProject, ensureScriptProject, projectFor, projectForTopic, resolveTopicRef, visibleProject } from "@/lib/projects/service";
import { briefText, formatHints } from "@/lib/projects/topic";
import { AGENT_KEYS, parseAgentMentions, type AgentKey } from "./catalog";
import { agentViewer, ensureAgentChannel, postAsAgent, tag } from "./index";
import type { Handoff } from "./mentions";

/**
 * Script agent → Video agent, once a script is approved.
 *
 * The gate is the approval itself, and it is not this file's: `decideApproval`
 * only gets here after a named person who did not write the script approved
 * those exact words and the script locked. Nothing here can approve anything.
 *
 * What the hand-off does, deliberately no more:
 *   1. finds the script's project, or starts one around it
 *      (`ensureScriptProject`) — everything lives under a project, and a
 *      bare video project beside a loose script was a cut no project page
 *      knew about. Started as the script's owner, so the script and the
 *      video are shared with the studio by somebody allowed to;
 *   2. the Script agent tags the Video agent in #制作, with the links, and
 *      the message carries the hand-off itself — the script and the project,
 *      by id — so the chat can draw what was handed over;
 *   3. the Video agent is started on it with those ids in hand, after the
 *      approval has returned, and answers with what happens next.
 *
 * Step 3 used to be a canned line posted as the Video agent. It read as an
 * answer but nobody had asked the employee anything, so the next time it was
 * tagged in #制作 it had no idea which project it had "said" it would cut.
 *
 * It does not start the director. A fresh project has no footage, and
 * `requestDirector` on an empty bin is an error; the work starts when footage
 * lands, which transcribes it by itself (`lib/video/service.ts`).
 */
export async function handOffToVideo(approver: Viewer, scriptId: string, versionNo: number, approvalId: string) {
  const [script] = await db
    .select({ id: scripts.id, title: scripts.title, ownerId: scripts.ownerId, topicId: scripts.topicId })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, approver.tenantId)))
    .limit(1);
  if (!script) return null;

  // The backlog card moves to "Handed to Video" now, not when the script was
  // first drafted: approved words are what the editor works from.
  if (script.topicId) {
    await db
      .update(topics)
      .set({ stage: "handed", updatedAt: new Date() })
      .where(and(eq(topics.id, script.topicId), eq(topics.tenantId, approver.tenantId)));
  }

  // The owner if they are still here; otherwise whoever approved it, so the
  // project still has somebody who can open it.
  const owner = (script.ownerId && (await viewerById(script.ownerId))) || approver;
  const work = await ensureScriptProject(owner, scriptId);
  if (!work?.videoProjectId) return null;
  const projectId = work.videoProjectId;

  const tenantId = approver.tenantId;
  const approverName = approver.nameLocal || approver.name;
  const scriptHref = `/script/${scriptId}`;
  const projectHref = `/video?project=${projectId}`;
  const workHref = `/projects/${work.id}`;
  const approval = { scriptId, versionNo, approvalId, projectId, workProjectId: work.id, approvedBy: approver.id };
  const { dispatchAgentMentions, handoffMeta, later } = await import("./mentions");

  const handoff: Handoff = {
    from: "script",
    to: "video",
    artifacts: [
      { kind: "work_project", id: work.id, title: work.title, href: workHref },
      { kind: "script", id: scriptId, title: script.title, href: scriptHref },
      { kind: "video_project", id: projectId, href: projectHref },
    ],
    verified: true,
    scriptId,
    projectId,
    workProjectId: work.id,
    notes: [
      `脚本第 ${versionNo} 版已由 ${approverName} 审批通过并锁定，剪辑按这一版来。`,
      `项目《${work.title}》${work.created ? "刚建好" : "已经有了"}，视频项目在里面${owner.id === approver.id ? "" : `，归 ${owner.nameLocal || owner.name}`}。素材放进时间线后会自动转写字幕。`,
    ],
  };

  const body = [
    `${tag("video")} 《${script.title}》第 ${versionNo} 版已由 ${approverName} 审批通过并锁定，交给你了。`,
    "",
    `- [打开项目](${workHref})`,
    `- [打开脚本](${scriptHref})`,
  ].join("\n");
  await postAsAgent(tenantId, "script", "production", body, { mentions: ["video"], handoff: handoffMeta(handoff), approval });

  /* The Video agent answers the hand-off itself, with the script and the
     project in hand — after the response, because it is a model call and the
     person pressing Approve should not wait for it. Its answer carries the
     buttons the canned reply used to. */
  const [from, channelId] = await Promise.all([agentViewer(tenantId, "script"), ensureAgentChannel(tenantId, "production")]);
  later(() =>
    dispatchAgentMentions({
      viewer: from,
      channelId,
      body,
      handoff,
      hop: 1,
      spoken: ["script"],
      origin: approverName,
      replyMeta: {
        /* The work its buttons hand on. "让剪辑师出粗剪" is pressed in #制作
           or on Home, neither of which is the project's chat, and the line
           it posts is only a sentence: 剪辑师 was started with no project,
           and every cutting tool answered "no video project is open". The
           press reads this back, checks it and hands it on
           (`pressedHandoff`). Not `handoff`, which the chat draws as a chip
           under this reply. */
        work: { to: "video", scriptId, projectId, task: `按锁定的第 ${versionNo} 版脚本出一版粗剪` },
        /* The hand-off ends on something to press rather than on a sentence.
           Both are the ordinary card kinds: one posts a line as whoever pressed
           it, the other is a link. The project itself is the "打开项目"
           button the chat draws from the reply's `meta.project`; and when the
           bin is empty the dispatcher swaps these for "上传素材" and
           "先用素材库画面" (`clipsAsk` in mentions.ts), since "the footage is
           in the project" would not be true. */
        actions: [
          {
            id: "rough-cut",
            label: "让剪辑师出粗剪",
            labelEn: "Ask for a first cut",
            kind: "say",
            body: `${tag("video")} 《${script.title}》的素材已经在项目里了，按锁定的第 ${versionNo} 版脚本先出一版粗剪。${workHref}`,
            tone: "primary",
          },
          {
            id: "read-script",
            label: "看脚本",
            labelEn: "Read the script",
            kind: "open",
            href: scriptHref,
            tone: "quiet",
          },
        ],
      },
    }),
  );

  // The person whose script it is hears about it even if they are not
  // watching #制作.
  if (script.ownerId && script.ownerId !== approver.id) {
    await db.insert(notifications).values({
      id: newId("ntf"),
      userId: script.ownerId,
      kind: "approval",
      title: `《${script.title}》已通过，交给视频助理`,
      body: `${approverName} 审批通过了第 ${versionNo} 版。项目《${work.title}》里可以开剪了。`,
      href: workHref,
      module: "video",
    });
  }

  await audit(approver, "agent.handoff", {
    module: "script",
    objectType: "script",
    objectId: scriptId,
    meta: { ...approval, from: "script", to: "video" },
  });

  return projectId;
}

/**
 * The checked work a pressed button hands on, when its message carries some.
 *
 * A "say" button posts a line as the person who pressed it, and that is all
 * a line is: a sentence. The approval's "让剪辑师出粗剪" is about one script
 * and one video project, and a sentence in #制作 does not open either — the
 * same dead end `sendScriptToVideoAction` fixed by passing its hand-off. So
 * the message the button sits under keeps the two ids and whom they are
 * for (`meta.work`, written by `handOffToVideo` above, never by a client),
 * and the press turns them into a hand-off to that colleague, once the line
 * tags them and both ids are checked to still be in the presser's studio
 * and still belong together. As on the script page's "交给剪辑师", only for
 * somebody with Video — and only for somebody who may edit that video
 * project (`canEditProject`): projects are private to their owner until
 * shared, and a press starts 剪辑师 cutting in it on the presser's say-so,
 * which is no more than they could ask for inside the project themselves.
 * Anything that does not check out is no hand-off at all: the line is still
 * posted, as typed words would be.
 */
export async function pressedHandoff(viewer: Viewer, meta: unknown, line: string): Promise<Handoff | null> {
  const work = (meta as { work?: unknown } | null)?.work;
  if (!work || typeof work !== "object") return null;
  if (!viewer.modules.includes("video")) return null;
  const w = work as Record<string, unknown>;
  const scriptId = typeof w.scriptId === "string" && w.scriptId.length <= 64 ? w.scriptId : null;
  const projectId = typeof w.projectId === "string" && w.projectId.length <= 64 ? w.projectId : null;
  const to = parseAgentMentions(line)[0];
  if (!scriptId || !projectId || !to || w.to !== to) return null;

  const [[script], [project]] = await Promise.all([
    db
      .select({ id: scripts.id, title: scripts.title })
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
      .limit(1),
    db
      .select({ id: videoProjects.id, scriptId: videoProjects.scriptId })
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt)))
      .limit(1),
  ]);
  if (!script || !project || project.scriptId !== script.id) return null;
  if (!(await canEditProject(viewer, project.id))) return null;

  /* The project the two belong to, when this person may see it, so the
     colleague's turn — and its reply's "打开项目" — is inside it. */
  const wp = await projectFor(viewer, { videoProjectId: project.id });
  return {
    from: "human",
    to,
    artifacts: [
      ...(wp ? [{ kind: "work_project" as const, id: wp.id, title: wp.title, href: `/projects/${wp.id}` }] : []),
      { kind: "script", id: script.id, title: script.title, href: `/script/${script.id}` },
      { kind: "video_project", id: project.id, href: `/video?project=${project.id}` },
    ],
    verified: true,
    ...(typeof w.task === "string" && w.task ? { task: w.task.slice(0, 300) } : {}),
    scriptId: script.id,
    projectId: project.id,
    ...(wp ? { workProjectId: wp.id } : {}),
  };
}

/** The to-dos of a plan card (`meta.plan.list`), read defensively. */
function planItems(meta: unknown): { text: string; owner: AgentKey }[] {
  const list = (meta as { plan?: { list?: unknown } } | null)?.plan?.list;
  if (!Array.isArray(list)) return [];
  return list.flatMap((t) => {
    const item = t as { text?: unknown; owner?: unknown };
    const text = typeof item.text === "string" ? item.text.trim().slice(0, 240) : "";
    const owner = typeof item.owner === "string" && (AGENT_KEYS as readonly string[]).includes(item.owner) ? (item.owner as AgentKey) : null;
    return text && owner ? [{ text, owner }] : [];
  });
}

/**
 * The project a plan card's "交给编剧" press puts the draft in.
 *
 * The morning plan lives in #研究日报, which is no project's chat, and its
 * button only posted "@编剧 <the to-do>". 编剧 then wrote the script loose
 * in the library — no project, no video project — and 剪辑师, handed that,
 * had nowhere to cut and said it was cutting anyway. Now the press finds
 * the project that to-do already has (started from the same plan item on
 * the Script page or Home: the same `proposal:plan:` key) or starts one —
 * titled by the to-do's 《…》, the studio's to see, its script empty — and
 * hands 编剧 that project, so the draft is written into its script.
 *
 * Only when the plan gives 编剧 exactly one to-do: a button that carries
 * two or three is several projects, and each `write_script` 编剧 makes
 * then starts its own (`lib/ai/tools/script.ts`). And "交给剪辑师" on the
 * same plan hands 剪辑师 the project the script to-do went into, if one was
 * started: the plan's footage to-do is for that video.
 *
 * Starting a project needs Chat, which pressing a card already does.
 */
export async function planHandoff(viewer: Viewer, meta: unknown, actionId: string): Promise<Handoff | null> {
  const to = actionId.startsWith("hand-") ? (actionId.slice(5) as AgentKey) : null;
  if (to !== "script" && to !== "video") return null;
  const items = planItems(meta);
  const scriptItems = items.filter((i) => i.owner === "script");
  if (scriptItems.length !== 1) return null;
  const scriptItem = scriptItems[0];

  const resolved = await resolveTopicRef(viewer, { kind: "proposal", text: scriptItem.text, source: "plan" }).catch(() => null);
  if (!resolved) return null;
  const found = await projectForTopic(viewer, { topicId: resolved.projectTopicId, key: resolved.source.key, title: resolved.title, kind: resolved.source.kind });
  let project = found ? await visibleProject(viewer, found.id) : null;

  if (to === "video") {
    /* 剪辑师 is only ever handed a project that exists: the plan's footage
       to-do alone is not a project, and inventing one from its wording
       ("收集…画面") would be a project nobody asked for. */
    const videoItem = items.find((i) => i.owner === "video");
    if (!project?.videoProjectId || !videoItem) return null;
    return {
      from: "human",
      to: "video",
      artifacts: [
        { kind: "work_project", id: project.id, title: project.title, href: `/projects/${project.id}` },
        ...(project.scriptId ? [{ kind: "script" as const, id: project.scriptId, href: `/script/${project.scriptId}` }] : []),
        { kind: "video_project", id: project.videoProjectId, href: `/video?project=${project.videoProjectId}` },
      ],
      verified: true,
      task: videoItem.text,
      ...(project.scriptId ? { scriptId: project.scriptId } : {}),
      projectId: project.videoProjectId,
      workProjectId: project.id,
    };
  }

  let created = false;
  if (!project) {
    const hints = formatHints(resolved.source.format);
    const made = await createWorkProject(viewer, {
      title: resolved.title,
      brief: briefText(resolved.source, resolved.title),
      source: resolved.source,
      topicId: resolved.projectTopicId,
      script: { topicId: resolved.scriptTopicId, angle: resolved.source.angle ?? null, mandatoryPoints: resolved.mandatoryPoints, aspect: hints.aspect, targetSeconds: hints.seconds },
    });
    project = await visibleProject(viewer, made.id);
    created = true;
  }
  if (!project?.scriptId) return null;
  return {
    from: "human",
    to: "script",
    artifacts: [
      { kind: "work_project", id: project.id, title: project.title, href: `/projects/${project.id}` },
      { kind: "script", id: project.scriptId, title: project.title, href: `/script/${project.scriptId}` },
    ],
    verified: true,
    task: scriptItem.text,
    scriptId: project.scriptId,
    ...(project.videoProjectId ? { projectId: project.videoProjectId } : {}),
    workProjectId: project.id,
    notes: [
      created
        ? `为这条待办新建了项目《${project.title}》：把脚本写进这个项目自己的脚本（write_script 会自动写进去），不要另建。`
        : `这条待办已经有项目《${project.title}》：把脚本写进这个项目自己的脚本，不要另建。`,
    ],
  };
}
