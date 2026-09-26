"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scripts } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { ensureAgentChannel } from "@/lib/agents";
import { AGENT_KEYS, agentTag, type AgentKey } from "@/lib/agents/catalog";
import { dispatchAgentMentions, handoffMeta, type Handoff } from "@/lib/agents/mentions";
import { postMessage } from "@/lib/chat/service";
import { ensureScriptProject } from "@/lib/projects/service";
import { audit } from "@/lib/audit";

const MAX_TEXT = 600;

/** Where the hand-offs go. The slug is the channel's own name. */
const PRODUCTION_SLUG = "制作";

/**
 * Start a proposed piece of work, from wherever it was proposed.
 *
 * One press on a maker's page — Script, Articles, Video — and the employee
 * for that page is told, in #制作, as the person who pressed. Exactly what
 * typing `@编剧 …` in the channel does, and through the same door: the same
 * `postMessage`, the same mention dispatch, the same permission checks. The
 * page is a shortcut for typing, and deliberately nothing more.
 */
export async function startProposalAction(owner: AgentKey, text: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (!AGENT_KEYS.includes(owner)) return { error: "No such colleague" };
  const task = typeof text === "string" ? text.trim().slice(0, MAX_TEXT) : "";
  if (!task) return { error: "Nothing to start" };

  const channelId = await ensureAgentChannel(viewer.tenantId, "production");
  const body = `${agentTag(owner)} ${task}`;
  await postMessage(viewer, channelId, body, { proposal: { owner } });
  revalidatePath(`/chat/c/${PRODUCTION_SLUG}`);
  revalidatePath("/home");

  after(async () => {
    try {
      await dispatchAgentMentions({ viewer, channelId, body });
    } catch (err) {
      console.error("[proposals] the colleague could not be reached", err);
    }
  });

  await audit(viewer, "agent.proposal.start", { module: "chat", meta: { owner, task: task.slice(0, 120) } });
  return { channelSlug: PRODUCTION_SLUG };
}

/**
 * A script, straight to 剪辑师.
 *
 * *"script can send to ai directly to start processing video."* The button
 * on a script used to make the project and open it, and then the person
 * had to go and ask for the cut. Now it makes the project — the same
 * `projectFromScript`, owned by the same person — and tells 剪辑师 in #制作
 * that the script is ready, with the link. The employee answers there and
 * starts as soon as there is footage to start on.
 *
 * The message carries the hand-off itself — the script and the project, by
 * id — and 剪辑师 is started with the same, so its turn opens inside that
 * project. It used to get the sentence only, and in #制作, which is not a
 * project's chat, every cutting tool answered "no video project is open".
 *
 * The video project is the one inside the script's project, which is
 * started around the script when it has none (`ensureScriptProject`):
 * everything lives under a project, and a bare video project beside a
 * loose script was an edit no project page knew about.
 */
export async function sendScriptToVideoAction(scriptId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("video") || !viewer.modules.includes("chat")) {
    return { error: "Not allowed" };
  }
  if (typeof scriptId !== "string" || scriptId.length > 64) return { error: "No such script" };

  const [script] = await db
    .select({ id: scripts.id, title: scripts.title })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return { error: "No such script" };

  let work: Awaited<ReturnType<typeof ensureScriptProject>>;
  try {
    work = await ensureScriptProject(viewer, scriptId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not make the project" };
  }
  if (!work?.videoProjectId) return { error: "Could not make the project" };
  const projectId = work.videoProjectId;

  const href = `/video?project=${projectId}`;
  const channelId = await ensureAgentChannel(viewer.tenantId, "production");
  const handoff: Handoff = {
    from: "human",
    to: "video",
    artifacts: [
      { kind: "work_project", id: work.id, title: work.title, href: `/projects/${work.id}` },
      { kind: "script", id: scriptId, title: script.title, href: `/script/${scriptId}` },
      { kind: "video_project", id: projectId, href },
    ],
    verified: true,
    task: `按《${script.title}》的脚本做视频。`,
    scriptId,
    projectId,
    workProjectId: work.id,
  };
  const body = [
    `${agentTag("video")} 《${script.title}》的脚本准备好了，请开始做视频。`,
    `- [打开项目](/projects/${work.id})`,
    `- [打开脚本](/script/${scriptId})`,
    "素材一进时间线就会自动转写；按脚本的段落来剪。",
  ].join("\n");
  await postMessage(viewer, channelId, body, { handoff: handoffMeta(handoff), via: "script-page" });
  revalidatePath(`/chat/c/${PRODUCTION_SLUG}`);
  revalidatePath("/home");

  after(async () => {
    try {
      await dispatchAgentMentions({ viewer, channelId, body, handoff });
    } catch (err) {
      console.error("[script] 剪辑师 could not be reached", err);
    }
  });

  await audit(viewer, "agent.handoff", {
    module: "script",
    objectType: "script",
    objectId: scriptId,
    meta: { projectId, workProjectId: work.id, from: "script", to: "video", by: "page" },
  });
  return { projectId, channelSlug: PRODUCTION_SLUG };
}
