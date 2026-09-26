"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { TRANSITIONS } from "@/lib/video/presets";
import { restoreProject, snapshotProject, type ProjectSnapshot } from "@/lib/video/history";
import { createPost } from "@/lib/publish/service";
import { db } from "@/lib/db/client";
import { videoExports, videoProjects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  addCaption,
  addClip,
  addTimelineItem,
  captionsFromText,
  captionsFromTrack,
  createProject,
  deleteProject,
  isAspect,
  listTimeline,
  moveTimelineItem,
  addGraphic,
  removeCaption,
  requestAutoEdit,
  splitTimelineItem,
  removeGraphic,
  setLook,
  updateGraphic,
  removeClip,
  removeTimelineItem,
  addMusic,
  removeTrack,
  requestExport,
  requestDirector,
  linkScript,
  projectFromScript,
  requestTranscription,
  requestVoiceOver,
  updateTrack,
  updateCaption,
  updateProject,
  updateTimelineItem,
} from "@/lib/video/service";
import { projectAccess, projectRelation, shareProject, unshareProject, type AccessTarget } from "@/lib/video/access";

async function editor() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("video")) return null;
  return viewer;
}

const refresh = () => revalidatePath("/video");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const ms = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 86_400_000 ? Math.round(n) : null;
};

export async function createProjectAction(title: string, scriptId: string | null) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  try {
    const projectId = await createProject(viewer, String(title ?? "").slice(0, 300), id(scriptId));
    refresh();
    return { id: projectId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create that" };
  }
}

export async function updateProjectAction(projectId: string, input: { title?: string; notes?: string }) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  await updateProject(viewer, projectId, input);
  refresh();
  return {};
}

export async function deleteProjectAction(projectId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  await deleteProject(viewer, projectId);
  refresh();
  return {};
}

export async function addClipAction(projectId: string, fileId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId) || !id(fileId)) return { error: "Not found" };
  try {
    const clipId = await addClip(viewer, projectId, fileId);
    refresh();
    // The id, so footage dropped on the editor can go straight onto the timeline.
    return { id: clipId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function removeClipAction(clipId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(clipId)) return { error: "Not found" };
  try {
    await removeClip(viewer, clipId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

export async function addItemAction(projectId: string, kind: string, clipId: string | null, text: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  if (kind !== "clip" && kind !== "title") return { error: "Not allowed" };
  try {
    const itemId = await addTimelineItem(viewer, projectId, {
      kind,
      clipId: id(clipId),
      text: String(text ?? "").slice(0, 500),
    });
    refresh();
    // The id, so a caller that dropped a clip at a position can walk it there.
    return { id: itemId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function updateItemAction(
  itemId: string,
  input: {
    inMs?: number;
    outMs?: number | null;
    text?: string;
    holdMs?: number;
    transition?: string;
    transitionMs?: number;
  },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(itemId)) return { error: "Not found" };

  const clean: {
    inMs?: number;
    outMs?: number | null;
    text?: string;
    holdMs?: number;
    transition?: string;
    transitionMs?: number;
  } = {};
  if (input.inMs !== undefined) {
    const v = ms(input.inMs);
    if (v === null) return { error: "That is not a time" };
    clean.inMs = v;
  }
  if (input.outMs !== undefined) {
    if (input.outMs === null) clean.outMs = null;
    else {
      const v = ms(input.outMs);
      if (v === null) return { error: "That is not a time" };
      clean.outMs = v;
    }
  }
  if (input.holdMs !== undefined) {
    const v = ms(input.holdMs);
    if (v === null) return { error: "That is not a time" };
    clean.holdMs = v;
  }
  if (input.text !== undefined) clean.text = String(input.text).slice(0, 500);
  if (input.transition !== undefined) {
    /* Refused rather than silently turned into a hard cut: somebody who asked
       for a wipe should be told there isn't one. */
    if (!(TRANSITIONS as readonly string[]).includes(String(input.transition))) {
      return { error: "That is not a transition" };
    }
    clean.transition = String(input.transition);
  }
  if (input.transitionMs !== undefined) {
    const v = ms(input.transitionMs);
    if (v === null) return { error: "That is not a time" };
    clean.transitionMs = v;
  }

  try {
    await updateTimelineItem(viewer, itemId, clean);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function moveItemAction(itemId: string, direction: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(itemId)) return { error: "Not found" };
  if (direction !== "up" && direction !== "down") return { error: "Not allowed" };
  try {
    await moveTimelineItem(viewer, itemId, direction);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not move that" };
  }
}

export async function removeItemAction(itemId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(itemId)) return { error: "Not found" };
  try {
    await removeTimelineItem(viewer, itemId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

export async function addCaptionAction(
  projectId: string,
  input: { startMs: number; endMs: number; text: string; language: string },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  const start = ms(input.startMs);
  const end = ms(input.endMs);
  if (start === null || end === null) return { error: "Those are not times" };
  try {
    await addCaption(viewer, projectId, {
      startMs: start,
      endMs: end,
      text: String(input.text ?? "").slice(0, 500),
      language: String(input.language ?? "zh-CN").slice(0, 16),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function updateCaptionAction(
  captionId: string,
  input: { startMs?: number; endMs?: number; text?: string },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(captionId)) return { error: "Not found" };

  const clean: { startMs?: number; endMs?: number; text?: string } = {};
  if (input.startMs !== undefined) {
    const v = ms(input.startMs);
    if (v === null) return { error: "That is not a time" };
    clean.startMs = v;
  }
  if (input.endMs !== undefined) {
    const v = ms(input.endMs);
    if (v === null) return { error: "That is not a time" };
    clean.endMs = v;
  }
  if (input.text !== undefined) clean.text = String(input.text).slice(0, 500);

  try {
    await updateCaption(viewer, captionId, clean);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function removeCaptionAction(captionId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(captionId)) return { error: "Not found" };
  try {
    await removeCaption(viewer, captionId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

/** Cut one clip in two at the playhead. `atMs` is a position in the source. */
export async function splitItemAction(itemId: string, atMs: number) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(itemId)) return { error: "Not found" };
  try {
    await splitTimelineItem(viewer, itemId, Number(atMs));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not split that" };
  }
}

/**
 * Make a first cut.
 *
 * The one button that does the whole job: dead air out from the measured word
 * timings, the model's read of what matters, captions re-timed onto the
 * result, graphics placed. It rewrites the timeline, so it says so.
 */
export async function autoEditAction(projectId: string, language: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  try {
    await requestAutoEdit(viewer, projectId, String(language || "zh-CN"));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that" };
  }
}

/* ------------------------------------------------------------- director */

/**
 * The whole video from a brief.
 *
 * Returns at once: the work is a job, and the screen polls the project's
 * director state while it runs. Everything it writes is one ⌘Z away, because
 * the editor snapshots the project before it starts.
 */
export async function directAction(
  projectId: string,
  input: { brief: string; aspect?: string; render?: boolean; pace?: string; narrate?: string; voiceId?: string },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  const brief = String(input.brief ?? "").trim();
  if (brief.length > 4000) return { error: "That brief is longer than a brief." };
  try {
    await requestDirector(viewer, projectId, {
      brief,
      aspect: typeof input.aspect === "string" ? input.aspect : "16:9",
      render: input.render !== false,
      pace: typeof input.pace === "string" ? input.pace : "channel",
      narrate: typeof input.narrate === "string" ? input.narrate : "auto",
      voiceId: typeof input.voiceId === "string" ? input.voiceId.slice(0, 64) : null,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that" };
  }
}

export async function linkScriptAction(projectId: string, scriptId: string | null) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  if (scriptId !== null && !id(scriptId)) return { error: "Not found" };
  try {
    await linkScript(viewer, projectId, scriptId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not link that" };
  }
}

/** From the Script screen: a cut for this script, made or found. */
export async function projectFromScriptAction(scriptId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "You do not hold the Video module." };
  if (!id(scriptId)) return { error: "Not found" };
  try {
    const projectId = await projectFromScript(viewer, scriptId);
    refresh();
    return { id: projectId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that" };
  }
}

/* ------------------------------------------------------------- graphics */

/**
 * Put a title, a lower third or an end card on the picture.
 *
 * Graphics are drawn by Remotion at render time and composited by FFmpeg, so
 * nothing here touches a renderer — it writes a row, and the export reads it.
 */
export async function addGraphicAction(
  projectId: string,
  input: {
    kind: string;
    text: string;
    sub?: string | null;
    startMs: number;
    endMs: number;
    fileId?: string | null;
    icon?: string | null;
    placement?: string | null;
    scale?: number | null;
    enter?: string | null;
    clipId?: string | null;
    sourceInMs?: number | null;
    zoom?: number | null;
  },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  const startMs = ms(input.startMs);
  const endMs = ms(input.endMs);
  if (startMs === null || endMs === null) return { error: "Those are not times" };
  try {
    const graphicId = await addGraphic(viewer, projectId, { ...input, startMs, endMs });
    refresh();
    return { id: graphicId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function updateGraphicAction(
  graphicId: string,
  input: {
    kind?: string;
    text?: string;
    sub?: string | null;
    startMs?: number;
    endMs?: number;
    enter?: string;
    placement?: string;
    scale?: number;
    zoom?: number;
    sourceInMs?: number;
  },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(graphicId)) return { error: "Not found" };
  const clean = { ...input };
  if (input.startMs !== undefined) {
    const v = ms(input.startMs);
    if (v === null) return { error: "That is not a time" };
    clean.startMs = v;
  }
  if (input.endMs !== undefined) {
    const v = ms(input.endMs);
    if (v === null) return { error: "That is not a time" };
    clean.endMs = v;
  }
  try {
    await updateGraphic(viewer, graphicId, clean);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

export async function removeGraphicAction(graphicId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(graphicId)) return { error: "Not found" };
  try {
    await removeGraphic(viewer, graphicId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

/** The caption preset and the one loud colour, for the whole project. */
export async function setLookAction(projectId: string, input: { captionPreset?: string; accent?: string }) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  try {
    await setLook(viewer, projectId, input);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

/** Split a block of text into captions across the length of the cut. A
 * starting point, and the screen says so. */
export async function splitCaptionsAction(projectId: string, text: string, language: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };

  const items = await listTimeline(viewer, projectId);
  const totalMs = items.reduce((n, i) => n + i.lengthMs, 0);

  try {
    const made = await captionsFromText(
      viewer,
      projectId,
      String(text ?? "").slice(0, 40_000),
      String(language ?? "zh-CN").slice(0, 16),
      totalMs,
    );
    refresh();
    return { made };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not split that" };
  }
}

export async function exportAction(
  projectId: string,
  input: { aspect: string; burnCaptions: boolean; captionLanguage: string; replaces?: string | null },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  if (!isAspect(input.aspect)) return { error: "No such aspect" };

  try {
    await requestExport(viewer, projectId, {
      aspect: input.aspect,
      burnCaptions: Boolean(input.burnCaptions),
      captionLanguage: String(input.captionLanguage ?? "zh-CN").slice(0, 16),
      replaces: input.replaces && id(input.replaces) ? input.replaces : null,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not queue that render" };
  }
}

/**
 * Captions from the cut's own audio.
 *
 * Queued, because it extracts the audio of the whole timeline, concatenates it
 * and uploads it, which on a long interview is minutes. The screen polls while
 * it runs rather than holding a request open.
 */
export async function transcribeAction(projectId: string, raw: string, diarize: boolean) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  /* zh-HK was the old default and is still in a tab somebody left open.
     There is one Chinese here now, so it folds into it. */
  const language = raw === "zh-HK" ? "zh-CN" : raw;
  if (!["zh-CN", "en"].includes(language)) return { error: "No such language" };

  try {
    await requestTranscription(viewer, projectId, language, Boolean(diarize));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that" };
  }
}

/* ----------------------------------------------------------------- audio */

export async function addMusicAction(projectId: string, fileId: string, gain: number) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId) || !id(fileId)) return { error: "Not found" };
  try {
    await addMusic(viewer, projectId, fileId, Number(gain));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function updateTrackAction(
  trackId: string,
  input: { gain?: number; startMs?: number; duckUnderSpeech?: boolean; label?: string },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(trackId)) return { error: "Not found" };

  const clean: { gain?: number; startMs?: number; duckUnderSpeech?: boolean; label?: string } = {};
  if (input.gain !== undefined) {
    const g = Number(input.gain);
    if (!Number.isFinite(g)) return { error: "That is not a level" };
    clean.gain = g;
  }
  if (input.startMs !== undefined) {
    const v = ms(input.startMs);
    if (v === null) return { error: "That is not a time" };
    clean.startMs = v;
  }
  if (input.duckUnderSpeech !== undefined) clean.duckUnderSpeech = Boolean(input.duckUnderSpeech);
  if (input.label !== undefined) clean.label = String(input.label).slice(0, 200);

  try {
    await updateTrack(viewer, trackId, clean);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function removeTrackAction(trackId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(trackId)) return { error: "Not found" };
  try {
    await removeTrack(viewer, trackId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

/** A voice-over, spoken from text by the chosen voice's engine (the studio's
 * own voices run on this server). Queued: synthesis and filing are the
 * worker's job, and the screen polls while it happens. */
export async function voiceOverAction(
  projectId: string,
  input: { text: string; voiceId: string; label: string; startMs: number; gain: number },
) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  if (typeof input.voiceId !== "string" || !input.voiceId) return { error: "Choose a voice" };

  try {
    await requestVoiceOver(viewer, projectId, {
      text: String(input.text ?? ""),
      voiceId: input.voiceId.slice(0, 64),
      label: String(input.label ?? ""),
      startMs: ms(input.startMs) ?? 0,
      gain: Number(input.gain) || 1,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that" };
  }
}

/** Captions cut from a finished voice-over's own timings (`captionsFromTrack`). */
export async function captionsFromTrackAction(trackId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(trackId)) return { error: "Not found" };
  try {
    const r = await captionsFromTrack(viewer, trackId);
    refresh();
    return { lines: r.lines };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not caption from that" };
  }
}

/* ------------------------------------------------------------------ undo */

/**
 * Undo, for a module whose every change is already saved.
 *
 * The browser's Back button is navigation: pressing it after an edit took
 * people to another page with the edit still made. These two actions are what
 * Back should have been — the editor keeps a stack of snapshots and puts one
 * back, including everything the assistant did in a turn.
 */
export async function snapshotAction(projectId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" as const };
  if (!id(projectId)) return { error: "Not found" as const };
  const snapshot = await snapshotProject(viewer, projectId);
  if (!snapshot) return { error: "Not found" as const };
  return { snapshot };
}

export async function undoAction(projectId: string, snapshot: ProjectSnapshot) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!id(projectId)) return { error: "Not found" };
  if (!snapshot || typeof snapshot !== "object" || snapshot.projectId !== projectId) {
    return { error: "That is not a state of this project" };
  }
  try {
    const ok = await restoreProject(viewer, projectId, snapshot);
    if (!ok) return { error: "Could not put that back" };
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not put that back" };
  }
}

/**
 * A finished cut, handed to Publish.
 *
 * This was the missing join between the two halves of the product: a render
 * landed in Files and the Publish composer stayed empty, so "we made a video"
 * and "we are posting a video" were two unrelated screens. The draft carries
 * the project's own title and the exported file; the caption, the channels and
 * the approval are still a person's job, which is the module's whole point.
 */
export async function sendToPublishAction(exportId: string) {
  const viewer = await editor();
  if (!viewer) return { error: "Not allowed" };
  if (!viewer.modules.includes("publish")) {
    return { error: "You do not hold the Publish module." };
  }
  if (!id(exportId)) return { error: "Not found" };

  const [row] = await db
    .select({ e: videoExports, title: videoProjects.title, tenantId: videoProjects.tenantId })
    .from(videoExports)
    .innerJoin(videoProjects, eq(videoProjects.id, videoExports.projectId))
    .where(eq(videoExports.id, exportId))
    .limit(1);

  if (!row || row.tenantId !== viewer.tenantId) return { error: "Not found" };
  if (!(await projectRelation(viewer, row.e.projectId))) return { error: "Not found" };
  if (row.e.state !== "done" || !row.e.fileId) {
    return { error: "That render has not finished yet." };
  }

  try {
    const postId = await createPost(viewer, {
      title: row.title,
      body: "",
      fileId: row.e.fileId,
      /* No channels yet on purpose: picking where it goes is a decision, and
         a draft that has quietly chosen five channels for you is how a post
         goes somewhere nobody meant. */
      channelIds: [],
    });
    revalidatePath("/publish");
    return { postId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start that post" };
  }
}

/* ----------------------------------------------------------------- access */

export async function projectAccessAction(projectId: string) {
  const viewer = await editor();
  if (!viewer || !id(projectId)) return { error: "Not allowed" };
  const access = await projectAccess(viewer, projectId);
  if (!access) return { error: "Not found" };
  return { access };
}

export async function shareProjectAction(projectId: string, target: string, relation: string) {
  const viewer = await editor();
  if (!viewer || !id(projectId)) return { error: "Not allowed" };
  try {
    await shareProject(viewer, projectId, String(target) as AccessTarget, relation === "editor" ? "editor" : "viewer");
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not share that" };
  }
}

export async function unshareProjectAction(projectId: string, subjectType: string, subjectId: string) {
  const viewer = await editor();
  if (!viewer || !id(projectId)) return { error: "Not allowed" };
  try {
    await unshareProject(viewer, projectId, String(subjectType).slice(0, 16), String(subjectId).slice(0, 128));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}
