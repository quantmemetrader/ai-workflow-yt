import { redirect } from "next/navigation";
import { projectFor } from "@/lib/projects/service";
import { publicationsByVideo } from "@/lib/projects/published";
import { publishedDay } from "@/lib/projects/publication";
import { ProjectBar } from "@/components/projects/ProjectBar";
import { requireModule } from "@/lib/auth/dal";
import { proposalsFor } from "@/lib/agents/proposals";
import { answeringModel } from "@/lib/ai/models";
import { editorData } from "@/lib/video/editor-data";
import { videoFolders } from "@/lib/video/folders";
import { env } from "@/lib/env";
import { VideoScreen } from "@/components/video/VideoScreen";
import { HEAVY_JOBS_PAUSED } from "@/lib/jobs/heavy";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";

export const metadata = { title: "视频剪辑" };

/**
 * Video Edit (spec §4.5), as an assembly module.
 *
 * The project is in the URL so a cut is a link somebody can send. Everything
 * else is derived: the bin, the timeline, the captions and the renders all
 * belong to whichever project that names (`editorData`, which a project's
 * 剪辑 page reads too).
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
  /* A cut that belongs to a project is edited on the project's 剪辑 page;
     old links (chat cards, hand-offs) land there. */
  if (wanted) {
    const owner = await projectFor(viewer, { videoProjectId: wanted });
    if (owner) redirect(`/projects/${owner.id}/edit`);
  }
  const d = await editorData(viewer, wanted);

  /* A cut whose poster is a file that has since been deleted asked for its
     thumbnail on every load and got a 404 each time (QA, 2 Oct:
     fil_01m3myg20j4s66gfgh2ghagazs, fil_01m3m2x7d148cmdnnqmppyp21x). Those
     cards draw the "no footage" tile instead of asking. */
  const posterIds = [...new Set(d.projects.map((p) => p.posterFileId).filter((x): x is string => Boolean(x)))];
  const gone = posterIds.length
    ? new Set(
        (
          await db
            .select({ id: files.id })
            .from(files)
            .where(and(eq(files.tenantId, viewer.tenantId), inArray(files.id, posterIds), isNotNull(files.deletedAt)))
            .catch(() => [] as { id: string }[])
        ).map((r) => r.id),
      )
    : new Set<string>();
  const projects = gone.size ? d.projects.map((p) => (p.posterFileId && gone.has(p.posterFileId) ? { ...p, posterFileId: null } : p)) : d.projects;

  /* Which cuts went out: each video project's work project, when it is
     marked 已发布, with where it went and the day (formatted here, so the
     card and the server's HTML agree). */
  const zhDates = (viewer.locale ?? "zh-CN").startsWith("zh");
  const published = Object.fromEntries(
    Object.entries(await publicationsByVideo(viewer, projects.map((p) => p.id))).map(([videoId, pub]) => [videoId, { projectId: pub.projectId, platforms: pub.platforms, at: pub.at, day: publishedDay(pub.at, zhDates) }]),
  );

  /* What the page's own employee thinks should be made next, read from
     what already exists — this morning's plan, the backlog, the audience. */
  const proposals = await proposalsFor(viewer, "video");
  /* One folder per project, for the list (not needed with a cut open). */
  const folders = wanted ? undefined : await videoFolders(viewer).catch(() => undefined);

  /* The project bar, only for a project this person may see. */
  const inProject = d.project ? await projectFor(viewer, { videoProjectId: d.project.id }) : null;
  const view = (
    <VideoScreen
      proposals={proposals}
      projects={projects}
      folders={folders}
      published={published}
      project={d.project}
      clips={d.clips}
      items={d.items}
      captions={d.captions}
      graphics={d.graphics}
      autoEditing={d.autoEditing}
      exports={d.renders}
      footage={d.footage}
      pictures={d.pictures}
      scripts={d.scripts}
      audio={d.audio}
      voices={d.voices}
      transcribing={d.transcribing}
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
