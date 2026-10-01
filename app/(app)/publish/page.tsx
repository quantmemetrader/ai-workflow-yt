import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { listPeople } from "@/lib/chat/service";
import { listChannels, listLog, listPosts, stateCounts } from "@/lib/publish/service";
import { PublishScreen } from "@/components/publish/PublishScreen";
import { listByType } from "@/lib/files/lenses";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { publishPlatformName, readPublication } from "@/lib/projects/publication";
import type { MarkedPublication } from "@/components/publish/PublishScreen";

/** Whether each sign-in has run out, read here on the server so a card's
 * pill does not flip colour on hydration (QA, 2 Oct: an expired sign-in
 * still showed 可发布). */
function withExpiry<T extends { tokenExpiresAt: Date | null }>(list: T[]): (T & { tokenExpired: boolean })[] {
  const now = Date.now();
  return list.map((c) => ({ ...c, tokenExpired: c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() <= now }));
}

/** Projects marked 已发布 on their own page, which this module never sent, so
 * 发布记录 was empty while 蒸馏之战 had gone out (QA, 2 Oct). Only projects
 * this viewer may open, newest first. */
async function markedPublications(viewer: Awaited<ReturnType<typeof requireModule>>, zh: boolean): Promise<MarkedPublication[]> {
  const rows = await db
    .select({ id: workProjects.id, title: workProjects.title, published: sql<unknown>`${workProjects.source} -> 'published'` })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), sql`${workProjects.source} ? 'published'`, projectsVisibleTo(viewer)))
    .orderBy(desc(sql`${workProjects.source} -> 'published' ->> 'at'`))
    .limit(40);
  return rows.flatMap((r) => {
    const pub = readPublication({ published: r.published });
    if (!pub) return [];
    const places = pub.platforms.length ? pub.platforms : [{ key: "other", url: null }];
    return places.map((pl) => ({ projectId: r.id, title: r.title, at: pub.at, platform: pl.key, platformName: publishPlatformName(pl.key, zh), url: pl.url, byName: pub.byName }));
  });
}

export const metadata = { title: "发布" };

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

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [channels, posts, log, counts, people, videos, marked] = await Promise.all([
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
    markedPublications(viewer, zh).catch(() => []),
  ]);


  return (
    <PublishScreen
      marked={marked}
      channels={withExpiry(channels)}
      posts={posts}
      log={log}
      counts={counts}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name }))}
      viewerId={viewer.id}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      videos={videos.map((v) => ({ id: v.file.id, name: v.file.name, durationMs: v.file.durationMs, at: v.file.createdAt.toISOString() }))}
    />
  );
}
