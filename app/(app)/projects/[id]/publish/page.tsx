import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { onlyTheSharedPage, projectForPage } from "@/lib/projects/page-data";
import { listProjectFiles } from "@/lib/projects/files";
import { listByType } from "@/lib/files/lenses";
import { listChannels, listPosts } from "@/lib/publish/service";
import { listPeople } from "@/lib/chat/service";
import { projectForPublish, readPublishDraft } from "@/lib/projects/publish-page";
import { PublishStep, type PublishVideo } from "@/components/projects/PublishStep";

export const metadata = { title: "发布" };

/**
 * 4 发布: the AI's render to download, the team's own final cut uploaded
 * back, and where it goes — the studio's own 抖音 / 小红书 / 视频号 / B站 by
 * hand, and the connected channels through Publish.
 */
export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();
  onlyTheSharedPage(p);
  const canChannels = viewer.modules.includes("publish") && viewer.role !== "guest";

  const [row, renders, files, recent, channels, posts, people] = await Promise.all([
    projectForPublish(viewer, p.id),
    p.video
      ? db
          .select({ id: videoExports.id, fileId: videoExports.fileId, proxyFileId: videoExports.proxyFileId, subtitleFileId: videoExports.subtitleFileId, aspect: videoExports.aspect, durationMs: videoExports.durationMs, sizeBytes: videoExports.sizeBytes, createdAt: videoExports.createdAt })
          .from(videoExports)
          .where(and(eq(videoExports.projectId, p.video.id), eq(videoExports.state, "done"), sql`${videoExports.fileId} is not null`))
          .orderBy(desc(videoExports.createdAt))
          .limit(3)
      : Promise.resolve([]),
    listProjectFiles(viewer, p.id),
    listByType(viewer, "videos", 30).catch(() => []),
    canChannels ? listChannels(viewer).catch(() => []) : Promise.resolve([]),
    canChannels && p.script ? listPosts(viewer, { scriptId: p.script.id, limit: 20 }).catch(() => []) : Promise.resolve([]),
    canChannels ? listPeople(viewer) : Promise.resolve([]),
  ]);

  const isVideo = (mime: string | null, kind: string) => (mime ? mime.startsWith("video/") : kind === "video");
  const finals: PublishVideo[] = files
    .filter((f) => f.role === "final" && isVideo(f.mime, f.kind))
    .map((f) => ({ id: f.id, name: f.name, durationMs: f.durationMs, sizeBytes: f.sizeBytes, width: f.width, height: f.height, by: f.ownerName, at: f.createdAt }));
  const finalIds = new Set(finals.map((f) => f.id));
  const renderIds = new Set(renders.map((r) => r.fileId));
  const pickable: PublishVideo[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (finalIds.has(f.id) || renderIds.has(f.id) || !isVideo(f.mime, f.kind) || seen.has(f.id)) continue;
    seen.add(f.id);
    pickable.push({ id: f.id, name: f.name, durationMs: f.durationMs, sizeBytes: f.sizeBytes, width: f.width, height: f.height, by: f.ownerName, at: f.createdAt, where: f.role === "clip" ? "project-clip" : "project" });
  }
  for (const r of recent) {
    const f = r.file;
    if (finalIds.has(f.id) || renderIds.has(f.id) || seen.has(f.id)) continue;
    seen.add(f.id);
    pickable.push({ id: f.id, name: f.name, durationMs: f.durationMs, sizeBytes: f.sizeBytes, width: f.width, height: f.height, by: r.ownerName, at: f.createdAt.toISOString(), where: "files" });
  }

  return (
    <PublishStep
      zh={zh}
      projectId={p.id}
      title={p.title}
      status={p.status}
      canPublish={p.canPublish}
      canChannels={canChannels}
      viewerId={viewer.id}
      script={p.beats.map((b) => b.voiceover).filter(Boolean).join("\n")}
      renders={renders.map((r) => ({ id: r.id, fileId: r.fileId!, proxyFileId: r.proxyFileId, subtitleFileId: r.subtitleFileId, aspect: r.aspect, durationMs: r.durationMs, sizeBytes: r.sizeBytes, at: r.createdAt.toISOString() }))}
      rendering={p.render && (p.render.state === "queued" || p.render.state === "running") ? { progress: p.render.progress } : null}
      finals={finals}
      pickable={pickable}
      published={p.published}
      draft={readPublishDraft(row?.source)}
      channels={channels
        .filter((c) => c.enabled)
        .map((c) => ({ id: c.id, platform: c.platform, name: c.displayName ?? c.username ?? c.platform, canPost: c.canPost && !c.needsReconnect }))}
      posts={posts.map((x) => ({
        id: x.id,
        state: x.state,
        fileId: x.fileId,
        fileName: x.fileName,
        updatedAt: x.updatedAt.toISOString(),
        approval: x.approval ? { state: x.approval.state, requestedById: x.approval.requestedById, requestedByName: x.approval.requestedByName, approverName: x.approval.approverName } : null,
        targets: x.targets.map((tg) => ({ channelId: tg.channelId, platform: tg.platform, channelName: tg.channelName, state: tg.state, url: tg.platformUrl, error: tg.error })),
      }))}
      people={people.filter((x) => x.id !== viewer.id).map((x) => ({ id: x.id, name: (zh && x.nameLocal) || x.name }))}
    />
  );
}
