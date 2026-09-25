"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { createWorkProject, deleteProject, setProjectAccess, setProjectStatus } from "@/lib/projects/service";
import { postMessage } from "@/lib/chat/service";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { db } from "@/lib/db/client";
import { chatChannels, scripts, workProjects } from "@/lib/db/schema";
import { linkScript } from "@/lib/video/service";
import { share } from "@/lib/authz/rebac";
import { and, eq } from "drizzle-orm";

/** A title from what somebody typed: the tags and the filler taken out. */
function titleFrom(text: string): string {
  const clean = text
    .replace(/@\S+/g, " ")
    .replace(/^(请|帮我|麻烦|能不能|可以)?\s*(做|拍|写|剪|出)?(一个|一条|个|条)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || text).slice(0, 40);
}

/**
 * Start a project from a sentence, a pick, or a button, and say the first
 * thing in its chat. The employees tagged in that first message start at
 * once; one tagged alone (say 剪辑师 for a stock clip) makes a "direct"
 * project whose earlier steps are skipped.
 *
 * Quick on purpose: the model calls run after the response.
 */
export async function startProjectAction(input: { message?: string; title?: string; source?: { kind: string; label?: string; url?: string | null } | null }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 2000) : "";
  const title = (typeof input.title === "string" && input.title.trim()) || titleFrom(message);
  if (!title) return { error: "A project needs a name or a first message" };

  const tagged = message ? parseAgentMentions(message) : [];
  const mode = tagged.length === 1 && tagged[0] === "video" ? "direct:video" : "full";
  let created: { id: string; channelSlug: string };
  try {
    created = await createWorkProject(viewer, { title, brief: message || input.source?.label || null, mode, source: input.source ?? { kind: "person", label: viewer.nameLocal || viewer.name } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start the project" };
  }

  if (message) {
    const [p] = await db.select({ channelId: workProjects.channelId }).from(workProjects).where(eq(workProjects.id, created.id)).limit(1);
    await postMessage(viewer, p.channelId, message, {});
    if (tagged.length) {
      after(async () => {
        try {
          await dispatchAgentMentions({ viewer, channelId: p.channelId, body: message });
        } catch (err) {
          console.error("[projects] the first colleague could not be reached", err);
        }
      });
    }
  }
  /* No whole-app revalidation here: it re-rendered the shell before the
     page moved, which read as the site reloading. The caller navigates and
     then refreshes the sidebar quietly. */
  return { id: created.id };
}

export async function setProjectStatusAction(id: string, status: "active" | "done" | "archived") {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (!["active", "done", "archived"].includes(status)) return { error: "No such status" };
  await setProjectStatus(viewer, id, status);
  revalidatePath("/", "layout");
  return {};
}

/** Rename a project. */
export async function renameProjectAction(id: string, title: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const t = String(title ?? "").trim().slice(0, 80);
  if (!t) return { error: "A project needs a name" };
  await db.update(workProjects).set({ title: t, updatedAt: new Date() }).where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId)));
  revalidatePath("/", "layout");
  return {};
}

/** Who can see and work on a project. */
export async function setProjectAccessAction(id: string, access: { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  try {
    await setProjectAccess(viewer, String(id), access);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change who sees it" };
  }
  revalidatePath("/", "layout");
  return {};
}

export async function deleteProjectAction(id: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  try {
    await deleteProject(viewer, String(id));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete it" };
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * Use a script the studio already has for this project: it becomes the
 * project's script (and the video project's), shared with who can see the
 * project, and the chat's description names it for the employees.
 */
export async function chooseScriptAction(projectId: string, scriptId: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const [p] = await db.select().from(workProjects).where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId))).limit(1);
  if (!p) return { error: "No such project" };
  const [sc] = await db.select({ id: scripts.id, title: scripts.title }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!sc) return { error: "No such script" };
  await db.update(workProjects).set({ scriptId: sc.id, updatedAt: new Date() }).where(eq(workProjects.id, p.id));
  if (p.videoProjectId) await linkScript(viewer, p.videoProjectId, sc.id).catch(() => {});
  await share(viewer, { type: "script", id: sc.id }, "editor", { type: "tenant", id: viewer.tenantId }).catch(() => null);
  await db
    .update(chatChannels)
    .set({ topic: `这是项目《${p.title}》的对话，只谈这个项目。脚本：${sc.id}（/script/${sc.id}）。视频项目：${p.videoProjectId}（/video?project=${p.videoProjectId}）。写脚本就写进这个脚本；剪辑、找素材、渲染都用这个视频项目。不要新建别的。` })
    .where(eq(chatChannels.id, p.channelId));
  revalidatePath("/", "layout");
  return {};
}

/** Point the project at a topic already picked: its title and brief. */
export async function chooseTopicAction(projectId: string, input: { title: string; brief?: string; label?: string }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const title = String(input.title ?? "").trim().slice(0, 80);
  if (!title) return { error: "A topic needs a name" };
  await db
    .update(workProjects)
    .set({ title, brief: String(input.brief ?? "").slice(0, 1000) || title, source: { kind: "pick", label: input.label ?? "选题" }, updatedAt: new Date() })
    .where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId)));
  revalidatePath("/", "layout");
  return {};
}
