"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { createWorkProject, setProjectStatus } from "@/lib/projects/service";
import { postMessage } from "@/lib/chat/service";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { parseAgentMentions } from "@/lib/agents/catalog";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
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
  revalidatePath("/", "layout");
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
