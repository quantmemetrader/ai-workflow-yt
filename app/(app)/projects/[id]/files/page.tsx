import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, videoClips } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { onlyTheSharedPage, projectForPage } from "@/lib/projects/page-data";
import { listProjectFiles, projectTag } from "@/lib/projects/files";
import { ProjectFiles } from "@/components/projects/files/ProjectFiles";

export const metadata = { title: "文件" };

/**
 * Every file of one project in its boxes — 最终版视频, AI 成片, 素材,
 * 参考资料, 其他 — with one drop zone to add more. The client: "uploading
 * files, and generally managing files become easier", and the video maker
 * has to find the files a script was written from.
 */
export default async function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();
  onlyTheSharedPage(p);

  const list = await listProjectFiles(viewer, p.id);
  const ids = list.map((f) => f.id);
  /* Which ones were put in this project by hand (so 移出项目 means
     something), and which sit in the cut's bin (taken out in the editor). */
  const [tagRows, binRows] = ids.length
    ? await Promise.all([
        db.select({ id: files.id, tags: files.tags }).from(files).where(inArray(files.id, ids)),
        p.video ? db.select({ fileId: videoClips.fileId }).from(videoClips).where(and(eq(videoClips.projectId, p.video.id), inArray(videoClips.fileId, ids))) : Promise.resolve([]),
      ])
    : [[], []];
  const tagged = new Set(tagRows.filter((r) => r.tags.includes(projectTag(p.id))).map((r) => r.id));
  const inBin = new Set(binRows.map((r) => r.fileId));

  /* New files are seen by whoever can see the project. */
  const access =
    p.access.mode === "everyone"
      ? ({ mode: "everyone" } as const)
      : p.access.mode === "groups"
        ? ({ mode: "groups", groups: p.access.groups ?? [] } as const)
        : p.access.mode === "people"
          ? ({ mode: "people", userIds: p.access.userIds ?? [] } as const)
          : ({ mode: "private" } as const);

  return (
    <ProjectFiles
      projectId={p.id}
      zh={zh}
      access={access}
      hasCut={Boolean(p.video)}
      hasScript={Boolean(p.script)}
      files={list.map((f) => ({ ...f, tagged: tagged.has(f.id), inBin: inBin.has(f.id) }))}
    />
  );
}
