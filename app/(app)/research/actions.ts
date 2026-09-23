"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { topics, users } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import {
  createTopic,
  decide,
  exportComparison,
  planTopic,
  moveTopicStage,
  seriesFor,
  type Window,
} from "@/lib/research/service";
import { suggestAngles } from "@/lib/research/angles";
import { enqueue } from "@/lib/jobs/queue";

/** Every action re-reads the viewer and re-checks the module: a server action
 * is a public endpoint whatever the screen around it looked like. */
async function researcher() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return null;
  return viewer;
}

/** A topic id off the wire is not a topic. Nothing that takes one may touch a
 * row until it is confirmed to belong to the caller's own studio. */
async function ownTopic(tenantId: string, topicId: unknown): Promise<string | null> {
  if (typeof topicId !== "string" || !topicId || topicId.length > 64) return null;
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, tenantId)))
    .limit(1);
  return row?.id ?? null;
}

/** `Window` is only a TypeScript promise at an action boundary. */
function isWindow(value: unknown): value is Window {
  return value === "1m" || value === "3m" || value === "6m";
}

export async function decideAction(topicId: string, action: "adopt" | "reject" | "save") {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (action !== "adopt" && action !== "reject" && action !== "save") {
    return { error: "Not allowed" };
  }

  try {
    await decide(viewer, topicId, action);
    revalidatePath("/research");
    revalidatePath("/research/backlog");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record that" };
  }
}

export async function planAction(
  topicId: string,
  input: { ownerId?: string | null; targetChannel?: string | null; dueDate?: string | null },
) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!(await ownTopic(viewer.tenantId, topicId))) return { error: "Topic not found" };

  // `planTopic` spreads this straight into the update, so each field is checked
  // here. An unchecked ownerId would let the backlog point at an account in
  // another studio.
  if (input.ownerId) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.ownerId), eq(users.tenantId, viewer.tenantId)))
      .limit(1);
    if (!owner) return { error: "Nobody here has that name" };
  }
  if (input.targetChannel != null && String(input.targetChannel).length > 120) {
    return { error: "That channel name is too long" };
  }
  if (input.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.dueDate))) {
    return { error: "A due date looks like 2026-09-30" };
  }

  await planTopic(viewer, topicId, {
    ownerId: input.ownerId ?? null,
    targetChannel: input.targetChannel ?? null,
    dueDate: input.dueDate ?? null,
  });
  revalidatePath("/research/backlog");
  return {};
}

/** Queues a fetch for a phrase nobody has looked at yet. Returns immediately —
 * the sources answer in their own time, and the screen says "collecting". */
export async function addSeriesAction(query: string, window: Window) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!isWindow(window)) return { error: "Not allowed" };
  if (typeof query !== "string") return { error: "Type a phrase first" };
  const trimmed = query.trim();
  if (!trimmed) return { error: "Type a phrase first" };
  if (trimmed.length > 80) return { error: "That phrase is too long to search" };

  await seriesFor(viewer, [trimmed], window);
  revalidatePath("/research/compare");
  return {};
}

/** "Export the comparison to the database as a research report" (brief §4.3). */
export async function exportComparisonAction(queries: string[], window: Window, region: string) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!viewer.modules.includes("files")) {
    return { error: "Exporting writes a report into Files, which you do not have." };
  }
  if (!isWindow(window)) return { error: "Not allowed" };
  if (!Array.isArray(queries)) return { error: "Pick at least one series" };

  // The report is built from these strings, and every uncached one queues an
  // outbound fetch, so they are bounded before anything is written.
  const wanted = queries
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= 80)
    .slice(0, 5);
  if (!wanted.length) return { error: "Pick at least one series" };

  const place = String(region ?? "").trim().slice(0, 40) || "HK";

  try {
    const file = await exportComparison(viewer, wanted, window, place);
    revalidatePath("/files");
    return { fileId: file.id, name: file.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not export" };
  }
}

/** Watch a new topic. The dashboard is empty until the studio says what it
 * cares about — this is how they say it. */
export async function addTopicAction(query: string, name?: string, category?: string | null) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (typeof query !== "string") return { error: "A topic needs a phrase to watch" };
  if (name != null && (typeof name !== "string" || name.length > 200)) {
    return { error: "That name is too long" };
  }
  if (category != null && (typeof category !== "string" || category.length > 60)) {
    return { error: "That category is too long" };
  }

  try {
    const topic = await createTopic(viewer, { query, name, category });
    revalidatePath("/research");
    return { id: topic.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that topic" };
  }
}

/**
 * Ask the model for angles on a topic, from the headlines already collected.
 *
 * The detail pane has always said to ask the agent for these; now the button
 * that says so does it, and what comes back is written to the topic so the
 * next person to open it sees the same list.
 */
export async function suggestAnglesAction(topicId: string) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!(await ownTopic(viewer.tenantId, topicId))) return { error: "Topic not found" };

  try {
    const res = await suggestAngles(viewer, topicId);
    if ("error" in res) return res;
    revalidatePath("/research");
    return { angles: res.angles };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The model could not be reached." };
  }
}

const STAGES = ["adopted", "briefing", "scripting", "handed"] as const;

/** Moves a card between the backlog's lanes. */
export async function moveStageAction(topicId: string, stage: string) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!(STAGES as readonly string[]).includes(stage)) return { error: "Unknown stage" };
  if (typeof topicId !== "string" || topicId.length > 64) return { error: "Bad request" };

  try {
    await moveTopicStage(viewer, topicId, stage as (typeof STAGES)[number]);
    revalidatePath("/research/backlog");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not move that" };
  }
}

/**
 * Re-read the creator's own channel and rewrite the voice note.
 *
 * Queued: the channel is a few hundred videos and a model call, and the
 * screen says "syncing" while the worker is at it.
 */
export async function syncCreatorAction() {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  await enqueue({
    tenantId: viewer.tenantId,
    type: "creator.sync",
    module: "research",
    createdBy: viewer.id,
    dedupeKey: "creator.sync",
    priority: 8,
  });
  revalidatePath("/research");
  return {};
}
