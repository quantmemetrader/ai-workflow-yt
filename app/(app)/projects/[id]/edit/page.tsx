import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { listProjectFiles } from "@/lib/projects/files";
import { editorBrief } from "@/lib/projects/brief";
import { editorData } from "@/lib/video/editor-data";
import { answeringModel } from "@/lib/ai/models";
import { env } from "@/lib/env";
import { HEAVY_JOBS_PAUSED } from "@/lib/jobs/heavy";
import { VideoScreen } from "@/components/video/VideoScreen";
import { ScriptBrief } from "@/components/video/ScriptBrief";
import { Card, Empty, PageBody } from "@/components/projects/kit";

export const metadata = { title: "剪辑 · Edit" };

/**
 * A project's 剪辑 page: the cutting desk for its cut, filling the room under
 * the project's tabs.
 *
 * Step 3 of the project — getting the host's clips in is part of it, so the
 * band across the top (`VideoScreen`'s `embedded.band`) says which of the
 * presses is next: upload the clips, let 剪辑师 cut, render, then download
 * and go to 发布. The desk's right column carries the approved script and the
 * project's files (`ScriptBrief`), because the person cutting was the one who
 * had no way to tell which version was approved.
 */
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();

  if (!viewer.modules.includes("video") || !p.video) {
    return (
      <PageBody>
        <Card icon="film" title={zh ? "剪辑" : "Edit"} sub={zh ? "这一步由剪辑师和有剪辑权限的同事来做" : "The editor and colleagues with editing access do this step"}>
          <Empty icon="lock" text={!p.video ? (zh ? "这个项目还没有剪辑台。" : "This project has no cut yet.") : zh ? "你没有剪辑权限，请联系管理员开通。" : "You don't have access to editing — ask an admin."} />
        </Card>
      </PageBody>
    );
  }

  const [d, brief, files] = await Promise.all([editorData(viewer, p.video.id), editorBrief(viewer, p.script?.id ?? null, zh), listProjectFiles(viewer, p.id)]);
  if (!d.project) {
    return (
      <PageBody>
        <Card icon="film" title={zh ? "剪辑" : "Edit"}>
          <Empty icon="lock" text={zh ? "你还不能打开这个项目的剪辑台，请项目负责人把你加进来。" : "You can't open this project's cut yet — ask its owner to add you."} />
        </Card>
      </PageBody>
    );
  }

  return (
    <VideoScreen
      embedded={{
        projectId: p.id,
        brief: <ScriptBrief projectId={p.id} zh={zh} brief={brief} files={files} />,
      }}
      projects={d.projects}
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
}
