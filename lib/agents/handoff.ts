import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifications, scripts, topics, videoProjects } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { projectFromScript } from "@/lib/video/service";
import { parseAgentMentions } from "./catalog";
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
 *   1. makes (or finds) the script's video project — owned by the script's
 *      owner, because projects are private to their owner and the people
 *      doing the work have to be able to open it;
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
  const projectId = await projectFromScript(owner, scriptId);

  const tenantId = approver.tenantId;
  const approverName = approver.nameLocal || approver.name;
  const scriptHref = `/script/${scriptId}`;
  const projectHref = `/video?project=${projectId}`;
  const approval = { scriptId, versionNo, approvalId, projectId, approvedBy: approver.id };
  const { dispatchAgentMentions, handoffMeta, later } = await import("./mentions");

  const handoff: Handoff = {
    from: "script",
    to: "video",
    artifacts: [
      { kind: "script", id: scriptId, title: script.title, href: scriptHref },
      { kind: "video_project", id: projectId, href: projectHref },
    ],
    verified: true,
    scriptId,
    projectId,
    notes: [
      `脚本第 ${versionNo} 版已由 ${approverName} 审批通过并锁定，剪辑按这一版来。`,
      `视频项目已经建好${owner.id === approver.id ? "" : `，归 ${owner.nameLocal || owner.name}`}。素材放进时间线后会自动转写字幕。`,
      "项目里还没有素材就先说清楚：素材一到你就按脚本开剪，现在不要空跑一键成片。",
    ],
  };

  const body = [
    `${tag("video")} 《${script.title}》第 ${versionNo} 版已由 ${approverName} 审批通过并锁定，交给你了。`,
    "",
    `- [打开脚本](${scriptHref})`,
    `- [打开视频项目](${projectHref})`,
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
           it, the other is a link. */
        actions: [
          {
            id: "open-project",
            label: "打开项目",
            labelEn: "Open the project",
            kind: "open",
            href: projectHref,
            tone: "primary",
          },
          {
            id: "rough-cut",
            label: "让剪辑师出粗剪",
            labelEn: "Ask for a first cut",
            kind: "say",
            body: `${tag("video")} 《${script.title}》的素材已经在项目里了，按锁定的第 ${versionNo} 版脚本先出一版粗剪。${projectHref}`,
            tone: "quiet",
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
      body: `${approverName} 审批通过了第 ${versionNo} 版。视频项目已建好。`,
      href: projectHref,
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
 * somebody with Video: a video project is theirs to start work on. Anything
 * that does not check out is no hand-off at all: the line is still posted,
 * as typed words would be.
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

  return {
    from: "human",
    to,
    artifacts: [
      { kind: "script", id: script.id, title: script.title, href: `/script/${script.id}` },
      { kind: "video_project", id: project.id, href: `/video?project=${project.id}` },
    ],
    verified: true,
    ...(typeof w.task === "string" && w.task ? { task: w.task.slice(0, 300) } : {}),
    scriptId: script.id,
    projectId: project.id,
  };
}
