import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import {
  autoEditRunning,
  availableFootage,
  availablePictures,
  listAudio,
  listCaptions,
  listClips,
  listExports,
  listGraphics,
  listProjects,
  listTimeline,
  scriptsForPicker,
  transcriptionRunning,
  type ProjectRow,
} from "@/lib/video/service";
import { voicesForUi } from "@/lib/video/tts";

/**
 * Everything the cutting desk (`VideoScreen`) draws for one cut, read at
 * once: the studio's cuts, the pickers, and — when a cut is named and this
 * person may read it — its bin, timeline, captions, graphics, renders (each
 * with its small preview copy), audio and what is running on it.
 *
 * Shared by `/video` and a project's 剪辑 page (`/projects/[id]/edit`), which
 * draw the same desk.
 */
export async function editorData(viewer: Viewer, wanted: string | null | undefined) {
  const [projects, footage, pictures, scripts] = await Promise.all([
    listProjects(viewer),
    availableFootage(viewer),
    availablePictures(viewer),
    scriptsForPicker(viewer),
  ]);
  /* A link to a cut that has since been deleted, or that this person cannot
     read, lands on the library rather than on an error. */
  const project: ProjectRow | null = (wanted ? projects.find((p) => p.id === wanted) : undefined) ?? null;

  const [clips, items, captions, graphics, exports, audio, transcribing, autoEditing, proxies] = project
    ? await Promise.all([
        listClips(viewer, project.id),
        listTimeline(viewer, project.id),
        listCaptions(viewer, project.id),
        listGraphics(viewer, project.id),
        listExports(viewer, project.id),
        listAudio(viewer, project.id),
        transcriptionRunning(viewer, project.id),
        autoEditRunning(viewer, project.id),
        /* Which small preview copy belongs to which render: read beside
           `listExports` rather than widened into it, because that row is the
           deliverable and is read by callers with no player in them. */
        db
          .select({ exportId: videoExports.id, proxyFileId: videoExports.proxyFileId })
          .from(videoExports)
          .where(and(eq(videoExports.projectId, project.id), eq(videoExports.tenantId, viewer.tenantId))),
      ])
    : [[], [], [], [], [], [], false, false, []];

  const proxyByExport = new Map(proxies.map((p) => [p.exportId, p.proxyFileId]));
  const renders = exports.map((e) => ({ ...e, proxyFileId: proxyByExport.get(e.id) ?? null }));

  /* The voices, only with a cut open; cached in the module (`lib/video/tts`). */
  const voices = project ? await voicesForUi().catch(() => []) : [];

  return { projects, footage, pictures, scripts, project, clips, items, captions, graphics, renders, audio, transcribing, autoEditing, voices };
}
