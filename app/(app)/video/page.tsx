import { requireModule } from "@/lib/auth/dal";
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
  const project = projects.find((p) => p.id === wanted) ?? projects[0] ?? null;

  const [clips, items, captions, graphics, exports, audio, transcribing, autoEditing] = project
    ? await Promise.all([
        listClips(viewer, project.id),
        listTimeline(viewer, project.id),
        listCaptions(viewer, project.id),
        listGraphics(viewer, project.id),
        listExports(viewer, project.id),
        listAudio(viewer, project.id),
        transcriptionRunning(viewer, project.id),
        autoEditRunning(viewer, project.id),
      ])
    : [[], [], [], [], [], [], false, false];

  /*
   * The voices the studio can use. Read here rather than in the browser: the
   * key never leaves the server, and a list that is the same for everybody
   * should not be fetched once per person who opens the tab.
   */
  const voices = env.elevenlabs.configured ? await cachedVoices() : [];

  return (
    <VideoScreen
      projects={projects}
      project={project}
      clips={clips}
      items={items}
      captions={captions}
      graphics={graphics}
      autoEditing={autoEditing}
      exports={exports}
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
