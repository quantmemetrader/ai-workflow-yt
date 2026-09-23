"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptFolders, scripts, users } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { BudgetStop } from "@/lib/ai/ledger";
import {
  actOnSuggestion,
  addComment,
  createFolder,
  createScript,
  cutVersion,
  decideApproval,
  ownScript,
  removeScript,
  requestApproval,
  restoreVersion,
  saveBeats,
  scriptFromTopic,
  unlock,
} from "@/lib/script/service";
import { checkConformance, draftFromBrief, rewriteSelection } from "@/lib/script/ai";
import { writeScript } from "@/lib/script/from-research";

/**
 * Everything the Script screens can do.
 *
 * Two rules run through the file:
 *
 *   — **A server action is a public endpoint.** Every one of these re-reads
 *     the viewer, re-checks the module, and resolves any id it was given to a
 *     row in the caller's own studio before touching anything.
 *   — **A locked script is read-only.** The check lives in
 *     `lib/script/service.ts` so it cannot be forgotten here, and the actions
 *     that would edit one simply fail.
 */

async function writer(): Promise<Viewer | null> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("script")) return null;
  return viewer;
}

function done<T>(result: T, scriptId?: string): T {
  revalidatePath("/script");
  if (scriptId) revalidatePath(`/script/${scriptId}`);
  return result;
}

/** A model call that the budget stopped is a message, not a crash. */
function asMessage(err: unknown): string {
  if (err instanceof BudgetStop) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

// ----------------------------------------------------------- the library

export async function createScriptAction(form: FormData) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "A script needs a title." };
  if (title.length > 300) return { error: "That title is too long." };

  const seconds = Number(form.get("targetSeconds"));
  const points = String(form.get("mandatoryPoints") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const folderId = String(form.get("folderId") ?? "") || null;
  if (folderId) {
    // The folder itself, not a script already in it: a folder made a moment
    // ago is empty, and the check used to refuse the first script in it.
    const [folder] = await db
      .select({ id: scriptFolders.id })
      .from(scriptFolders)
      .where(and(eq(scriptFolders.id, folderId), eq(scriptFolders.tenantId, viewer.tenantId)))
      .limit(1);
    if (!folder) return done({ error: "That folder does not exist." });
  }

  const id = await createScript(viewer, {
    title,
    folderId,
    angle: String(form.get("angle") ?? "") || null,
    targetChannel: String(form.get("targetChannel") ?? "") || null,
    aspect: String(form.get("aspect") ?? "") || null,
    targetSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
    language: String(form.get("language") ?? "") || null,
    subtitleLanguage: String(form.get("subtitleLanguage") ?? "") || null,
    mandatoryPoints: points,
  });

  await audit(viewer, "script.create", { objectType: "script", objectId: id, module: "script" });
  return done({ ok: true, id }, id);
}

export async function createFolderAction(name: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof name !== "string" || !name.trim()) return { error: "A folder needs a name." };
  const id = await createFolder(viewer, name);
  return done({ ok: true, id });
}

/** The Topic backlog's hand-off, which used to end in an alert box. */
export async function scriptFromTopicAction(topicId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "You do not have the Script module." };
  if (typeof topicId !== "string" || !topicId) return { error: "Not allowed" };

  const id = await scriptFromTopic(viewer, topicId);
  if (!id) return { error: "That topic does not exist." };

  await audit(viewer, "script.fromTopic", { objectType: "script", objectId: id, module: "script", meta: { topicId } });
  revalidatePath("/research/backlog");
  return done({ ok: true, id }, id);
}

/**
 * Research to a written script in one press: the brief from the topic and
 * the chips, the draft from the brief with the collected headlines as facts.
 */
export async function writeScriptAction(input: {
  topicId?: string | null;
  subject?: string | null;
  angle?: string | null;
  channel?: string | null;
  aspect?: string | null;
  seconds?: number | null;
  language?: string | null;
  subtitleLanguage?: string | null;
}) {
  const viewer = await writer();
  if (!viewer) return { error: "You do not hold the Script module." };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const topicId = str(input.topicId, 64) || null;
  try {
    const res = await writeScript(viewer, {
      topicId,
      subject: str(input.subject, 300) || null,
      angle: str(input.angle, 400) || null,
      channel: str(input.channel, 60) || null,
      aspect: str(input.aspect, 5) || null,
      seconds: Number.isFinite(Number(input.seconds)) && Number(input.seconds) > 0 ? Number(input.seconds) : null,
      language: str(input.language, 40) || null,
      subtitleLanguage: str(input.subtitleLanguage, 40) || null,
    });
    if (!res.ok) return { error: res.error };
    // `writeScript` writes the audit line itself.
    revalidatePath("/research");
    revalidatePath("/research/backlog");
    return done({ ok: true, id: res.id, beats: res.beats, note: res.note }, res.id);
  } catch (err) {
    return { error: asMessage(err) };
  }
}

export async function deleteScriptAction(scriptId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  await removeScript(viewer, id);
  await audit(viewer, "script.delete", { objectType: "script", objectId: id, module: "script" });
  return done({ ok: true });
}

// ------------------------------------------------------------- the brief

export async function saveBriefAction(scriptId: unknown, form: FormData) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  const seconds = Number(form.get("targetSeconds"));
  const tolerance = Number(form.get("tolerancePercent"));
  const points = String(form.get("mandatoryPoints") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const [current] = await db.select({ locked: scripts.lockedVersion }).from(scripts).where(eq(scripts.id, id)).limit(1);
  if (current?.locked !== null) return { error: "That script is locked." };

  await db
    .update(scripts)
    .set({
      title: String(form.get("title") ?? "").trim().slice(0, 300) || undefined,
      angle: String(form.get("angle") ?? "") || null,
      targetChannel: String(form.get("targetChannel") ?? "") || null,
      aspect: String(form.get("aspect") ?? "") || null,
      targetSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
      tolerancePercent: Number.isFinite(tolerance) && tolerance >= 0 ? Math.min(50, tolerance) : 5,
      language: String(form.get("language") ?? "") || null,
      subtitleLanguage: String(form.get("subtitleLanguage") ?? "") || null,
      mandatoryPoints: points,
      briefUpdatedBy: viewer.id,
      briefUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scripts.id, id));

  return done({ ok: true }, id);
}

// -------------------------------------------------------------- the draft

type BeatInput = { visual?: unknown; voiceover?: unknown; subtitle?: unknown; naturalSound?: unknown };

export async function saveDraftAction(scriptId: unknown, beats: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };
  if (!Array.isArray(beats)) return { error: "Not allowed" };

  const clean = (beats as BeatInput[]).slice(0, 200).map((b) => ({
    visual: typeof b.visual === "string" ? b.visual : "",
    voiceover: typeof b.voiceover === "string" ? b.voiceover : "",
    subtitle: typeof b.subtitle === "string" ? b.subtitle : "",
    naturalSound: b.naturalSound === true,
  }));

  const res = await saveBeats(viewer, id, clean);
  if (!res) return { error: "That script is locked." };
  return done({ ok: true, beats: res.beats }, id);
}

export async function generateDraftAction(scriptId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  try {
    // The draft that is there becomes a version first, so "Generate from
    // brief" can never be the thing that loses somebody's afternoon.
    await cutVersion(viewer, id, { note: "before regenerating from the brief" });
    const res = await draftFromBrief(viewer, id);
    if ("error" in res) return done(res, id);
    await audit(viewer, "script.generate", { objectType: "script", objectId: id, module: "script", meta: { model: res.model } });
    return done(res, id);
  } catch (err) {
    return { error: asMessage(err) };
  }
}

export async function checkConformanceAction(scriptId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  try {
    return done(await checkConformance(viewer, id), id);
  } catch (err) {
    return { error: asMessage(err) };
  }
}

export async function rewriteAction(selection: unknown, instruction: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof selection !== "string" || !selection.trim()) return { error: "Select some text first." };
  if (typeof instruction !== "string" || !instruction.trim()) return { error: "Say what to change." };

  try {
    return await rewriteSelection(viewer, selection, instruction);
  } catch (err) {
    return { error: asMessage(err) };
  }
}

export async function suggestionAction(suggestionId: unknown, action: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof suggestionId !== "string") return { error: "Not allowed" };
  if (action !== "accepted" && action !== "rejected" && action !== "moved") return { error: "Not allowed" };

  const res = await actOnSuggestion(viewer, suggestionId, action);
  revalidatePath("/script", "layout");
  return res;
}

// ------------------------------------------------------------- versions

export async function cutVersionAction(scriptId: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  const res = await cutVersion(viewer, id, { note: typeof note === "string" ? note.slice(0, 300) : null });
  if (!res) return { error: "There is nothing to save, or the script is locked." };
  return done({ ok: true, versionNo: res.versionNo }, id);
}

export async function restoreVersionAction(scriptId: unknown, versionNo: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1) return { error: "Not allowed" };

  // The current draft is kept as its own version first: restoring v3 over v4
  // must not be the thing that destroys v4's unsaved edits.
  await cutVersion(viewer, id, { note: "before restoring an earlier version" });
  const res = await restoreVersion(viewer, id, n);
  if (!res) return { error: "That version does not exist, or the script is locked." };

  await audit(viewer, "script.restore", { objectType: "script", objectId: id, module: "script", meta: { versionNo: n } });
  return done({ ok: true }, id);
}

// ------------------------------------------------------------ approvals

export async function requestApprovalAction(scriptId: unknown, approverId: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };
  if (typeof approverId !== "string" || !approverId) return { error: "Choose who should approve it." };
  if (approverId === viewer.id) return { error: "A script cannot be approved by the person who wrote it." };

  const [approver] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, approverId), eq(users.tenantId, viewer.tenantId), eq(users.status, "active"), eq(users.isAgent, false)))
    .limit(1);
  if (!approver) return { error: "That person is not in this studio." };

  const res = await requestApproval(viewer, id, approverId, typeof note === "string" ? note.slice(0, 500) : undefined);
  if (!res) return { error: "There is nothing to approve yet, or the script is locked." };

  await audit(viewer, "script.approval.request", {
    objectType: "script",
    objectId: id,
    module: "script",
    meta: { approverId, versionNo: res.versionNo },
  });
  return done({ ok: true, versionNo: res.versionNo }, id);
}

/**
 * Approve and lock, or send back.
 *
 * The two rules that make this worth having — the approver is not the author,
 * and the version has not changed since it was asked for — are enforced in
 * `decideApproval`, against the version's checksum.
 */
export async function decideApprovalAction(approvalId: unknown, decision: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof approvalId !== "string") return { error: "Not allowed" };
  if (decision !== "approved" && decision !== "rejected") return { error: "Not allowed" };

  const res = await decideApproval(viewer, approvalId, decision, typeof note === "string" ? note.slice(0, 500) : undefined);
  if ("error" in res) return res;

  await audit(viewer, `script.approval.${decision}`, {
    objectType: "approval",
    objectId: approvalId,
    module: "script",
    meta: { versionNo: res.versionNo },
  });
  revalidatePath("/script", "layout");
  return res;
}

export async function unlockAction(scriptId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };

  await unlock(viewer, id);
  await audit(viewer, "script.unlock", { objectType: "script", objectId: id, module: "script" });
  return done({ ok: true }, id);
}

export async function commentAction(scriptId: unknown, body: unknown, beatOrd?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownScript(viewer, scriptId);
  if (!id) return { error: "Not allowed" };
  if (typeof body !== "string" || !body.trim()) return { error: "Write something first." };

  const ord = Number(beatOrd);
  await addComment(viewer, id, body, Number.isInteger(ord) ? ord : null);
  return done({ ok: true }, id);
}
