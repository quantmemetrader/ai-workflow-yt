import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { listPeople } from "@/lib/chat/service";
import { listChannels, listLog, listPosts, stateCounts } from "@/lib/publish/service";
import { PublishScreen } from "@/components/publish/PublishScreen";
import { PublishTabs } from "@/components/publish/PublishTabs";
import { listByType } from "@/lib/files/lenses";

export const metadata = { title: "发布 · Publish" };

/**
 * Publish (spec §4.6).
 *
 * Live: the channel board is the studio's own connections read from the
 * vendor, the caption is the master text plus per-channel overrides, the queue
 * is real approval records, and the log is every attempt with the platform's
 * own answer kept intact.
 *
 * Nothing here calls a platform. Approving queues `publish.send`; the worker
 * sends (§6).
 */
export default async function PublishPage() {
  const viewer = await requireModule("publish");

  const [channels, posts, log, counts, people, videos] = await Promise.all([
    listChannels(viewer),
    listPosts(viewer),
    listLog(viewer),
    stateCounts(viewer),
    // Who a post can be sent to for approval. Everyone in the studio: the
    // Admin module will narrow this to people who hold `publish`, and until it
    // exists a name that cannot approve is better than no names at all.
    listPeople(viewer),
    // A post's 视频 box picks from the studio's recent videos (renders included).
    listByType(viewer, "videos", 60).catch(() => []),
  ]);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <PublishTabs zh={zh} canPublish />
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
    <PublishScreen
      channels={channels}
      posts={posts}
      log={log}
      counts={counts}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name }))}
      viewerId={viewer.id}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      videos={videos.map((v) => ({ id: v.file.id, name: v.file.name, durationMs: v.file.durationMs, at: v.file.createdAt.toISOString() }))}
    />
      </div>
    </div>
  );
}
