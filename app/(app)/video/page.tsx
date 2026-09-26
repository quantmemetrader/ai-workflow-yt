import { projectFor } from "@/lib/projects/service";
import { ProjectBar } from "@/components/projects/ProjectBar";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { proposalsFor } from "@/lib/agents/proposals";
import { answeringModel } from "@/lib/ai/models";
import {
  availableFootage,
  availablePictures,
  listAudio,
  listCaptions,
  listGraphics,
  autoEditRunning,
  listClips,
  listExports,
  listProjects,
  listTimeline,
  scriptsForPicker,
  transcriptionRunning,
} from "@/lib/video/service";
import { env } from "@/lib/env";
import { voices as listVoices } from "@/lib/video/elevenlabs";
import { VideoScreen } from "@/components/video/VideoScreen";
import { HEAVY_JOBS_PAUSED } from "@/lib/jobs/heavy";

export const metadata = { title: "视频剪辑 · Video Edit" };

/**
 * Video Edit (spec §4.5), as an assembly module.
 *
 * The project is in the URL so a cut is a link somebody can send. Everything
 * else is derived: the bin, the timeline, the captions and the renders all
 * belong to whichever project that names.
 *
 * With no project named, the screen opens on its 项目 tab, which is the list.
 * It used to fall through to whichever cut was edited last, so pressing Video
 * in the rail dropped you into somebody else's timeline and the studio's other
 * projects were a tab away — the wrong way round for a shop that has one going
 * per client. The list is a tab rather than a screen of its own, so the tab bar
 * is the same in both states; the props below are simply empty until a cut is
 * named, and the editing tabs wait for one.
 */
export default async function VideoPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const viewer = await requireModule("video");
  const { project: wanted } = await searchParams;

  const [projects, footage, pictures, scripts] = await Promise.all([
    listProjects(viewer),
    availableFootage(viewer),
    availablePictures(viewer),
    scriptsForPicker(viewer),
  ]);
  /* A link to a cut that has since been deleted, or that this person cannot
     read, lands on the library rather than on an error. */
  const project = (wanted ? projects.find((p) => p.id === wanted) : undefined) ?? null;

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
        /*
         * Which small preview copy belongs to which render.
         *
         * Read beside `listExports` rather than widened into it: that row is
         * the *deliverable*, and it is read by callers with no player in them.
         * The proxy only matters to the one screen that watches the cut, and
         * it rides along here for free — the query goes out with the other
         * eight and is scoped to this studio the same way they are.
         */
        db
          .select({ exportId: videoExports.id, proxyFileId: videoExports.proxyFileId })
          .from(videoExports)
          .where(and(eq(videoExports.projectId, project.id), eq(videoExports.tenantId, viewer.tenantId))),
      ])
    : [[], [], [], [], [], [], false, false, []];

  const proxyByExport = new Map(proxies.map((p) => [p.exportId, p.proxyFileId]));
  const renders = exports.map((e) => ({ ...e, proxyFileId: proxyByExport.get(e.id) ?? null }));

  /*
   * The voices the studio can use. Read here rather than in the browser: the
   * key never leaves the server, and a list that is the same for everybody
   * should not be fetched once per person who opens the tab. The library has
   * no audio on it, so it does not pay for this at all.
   */
  const voices = project && env.elevenlabs.configured ? await cachedVoices() : [];

  /* What the page's own employee thinks should be made next, read from
     what already exists — this morning's plan, the backlog, the audience. */
  const proposals = await proposalsFor(viewer, "video");

  /* The project bar, only for a project this person may see. */
  const inProject = project ? await projectFor(viewer, { videoProjectId: project.id }) : null;
  const view = (
    <VideoScreen
      proposals={proposals}
      projects={projects}
      project={project}
      clips={clips}
      items={items}
      captions={captions}
      graphics={graphics}
      autoEditing={autoEditing}
      exports={renders}
      footage={footage}
      pictures={pictures}
      scripts={scripts}
      audio={audio}
      voices={voices}
      transcribing={transcribing}
      transcriptionConfigured={env.elevenlabs.configured}
      heavyPaused={HEAVY_JOBS_PAUSED}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
    />
  );
  if (!inProject) return view;
  /* A project's editor opens inside the project: its bar on top. */
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ProjectBar project={inProject} active="editor" zh={(viewer.locale ?? "zh-CN").startsWith("zh")} />
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>{view}</div>
    </div>
  );
}

/*
 * The voice list, once an hour for the whole server.
 *
 * It was fetched from ElevenLabs on every render of this page — a round trip
 * to a vendor before the editor could draw, for a list that changes when
 * somebody adds a voice, which is never.
 */
let voiceCache: { at: number; rows: Awaited<ReturnType<typeof listVoices>> } | null = null;
async function cachedVoices() {
  if (voiceCache && Date.now() - voiceCache.at < 3_600_000) return voiceCache.rows;
  const rows = await listVoices().catch(() => voiceCache?.rows ?? []);
  voiceCache = { at: Date.now(), rows };
  return rows;
}
