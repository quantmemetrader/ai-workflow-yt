import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { notifications, scripts } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { projectFromScript } from "@/lib/video/service";
import { postAsAgent, tag } from "./index";

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
 *   2. the Script agent tags the Video agent in #制作, with the links;
 *   3. the Video agent answers with what happens next.
 *
 * It does not start the director. A fresh project has no footage, and
 * `requestDirector` on an empty bin is an error; the work starts when footage
 * lands, which transcribes it by itself (`lib/video/service.ts`).
 */
export async function handOffToVideo(approver: Viewer, scriptId: string, versionNo: number, approvalId: string) {
  const [script] = await db
    .select({ id: scripts.id, title: scripts.title, ownerId: scripts.ownerId })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, approver.tenantId)))
    .limit(1);
  if (!script) return null;

  // The owner if they are still here; otherwise whoever approved it, so the
  // project still has somebody who can open it.
  const owner = (script.ownerId && (await viewerById(script.ownerId))) || approver;
  const projectId = await projectFromScript(owner, scriptId);

  const tenantId = approver.tenantId;
  const approverName = approver.nameLocal || approver.name;
  const scriptHref = `/script/${scriptId}`;
  const projectHref = `/video?project=${projectId}`;
  const handoff = { scriptId, versionNo, approvalId, projectId, approvedBy: approver.id };

  await postAsAgent(
    tenantId,
    "script",
    "production",
    [
      `${tag("video")} 《${script.title}》第 ${versionNo} 版已由 ${approverName} 审批通过并锁定，交给你了。`,
      "",
      `- [打开脚本](${scriptHref})`,
      `- [打开视频项目](${projectHref})`,
    ].join("\n"),
    { mentions: ["video"], handoff },
  );

  await postAsAgent(
    tenantId,
    "video",
    "production",
    [
      `${tag("script")} 收到。《${script.title}》的[视频项目](${projectHref})已经建好${owner.id === approver.id ? "" : `，归 ${owner.nameLocal || owner.name}`}。`,
      "",
      `把素材放进时间线，我会自动转写字幕；剪辑按锁定的第 ${versionNo} 版脚本来。`,
    ].join("\n"),
    {
      mentions: ["script"],
      handoff,
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
    meta: { ...handoff, from: "script", to: "video" },
  });

  return projectId;
}
