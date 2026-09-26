import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import { projectsVisibleTo } from "@/lib/projects/service";
import { NOTE_MAX, cleanLink, isPublishPlatform, publishPlatformName, readPublication, type Publication, type PublishedPlace } from "@/lib/projects/publication";

/**
 * Marking a project published, undoing it, and reading it back.
 *
 * The record's shape and where it lives are in `lib/projects/publication.ts`
 * (`work_projects.source -> 'published'`). Both writes are one UPDATE each,
 * status and record together, so a project can never read 已发布 with no
 * record behind it or keep a record after it was put back in progress.
 */

/**
 * Who may mark a project published (and undo it): anybody who can see it and
 * works in the studio — the person who uploads is often the editor or the
 * host, not whoever started it — but not a guest, unless it is their own.
 * The same people the project page offers the button to (`canPublish` on
 * `ProjectDetail`); the actions check it again.
 */
export function mayPublish(viewer: Pick<Viewer, "id" | "isAdmin" | "role">, createdBy: string): boolean {
  return viewer.isAdmin || createdBy === viewer.id || viewer.role !== "guest";
}

export type PublishInput = { platforms?: { key?: unknown; url?: unknown }[]; note?: unknown };

/** One project this person may see, with what publishing it needs. */
async function projectToPublish(viewer: Viewer, id: string) {
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, status: workProjects.status, createdBy: workProjects.createdBy, videoProjectId: workProjects.videoProjectId, source: workProjects.source })
    .from(workProjects)
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .limit(1);
  return row ?? null;
}

/**
 * Mark a project published: status "done", and the record of where it went.
 *
 * What the page sends is cleaned here: platforms from the fixed list, once
 * each; links only http(s) (a link that is not one is refused, not stored);
 * the note cut to length. No platform at all is allowed — the owner may just
 * want it off the in-progress lists.
 */
export async function markPublished(viewer: Viewer, id: string, input: PublishInput, zh: boolean): Promise<{ publication: Publication } | { error: string }> {
  const t = (a: string, b: string) => (zh ? a : b);
  const p = await projectToPublish(viewer, id);
  if (!p) return { error: t("没有这个项目", "No such project") };
  if (!mayPublish(viewer, p.createdBy)) return { error: t("只有工作室成员可以标记发布", "Only studio members can mark it published") };

  const platforms: PublishedPlace[] = [];
  for (const raw of Array.isArray(input.platforms) ? input.platforms.slice(0, 20) : []) {
    if (!raw || !isPublishPlatform(raw.key) || platforms.some((x) => x.key === raw.key)) continue;
    const url = cleanLink(raw.url);
    if (url === undefined) return { error: t(`${publishPlatformName(raw.key, true)} 的链接格式不对`, `The ${publishPlatformName(raw.key, false)} link is not a web address`) };
    platforms.push({ key: raw.key, url });
  }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null;

  /* The cut that was out when it was marked, so "which version went up"
     has an answer later; none when it was marked done without a render. */
  const [render] = p.videoProjectId
    ? await db
        .select({ fileId: videoExports.fileId })
        .from(videoExports)
        .where(and(eq(videoExports.projectId, p.videoProjectId), eq(videoExports.state, "done"), sql`${videoExports.fileId} is not null`))
        .orderBy(desc(videoExports.createdAt))
        .limit(1)
    : [];

  const publication: Publication = {
    at: new Date().toISOString(),
    by: viewer.id,
    byName: viewer.nameLocal || viewer.name,
    platforms,
    note,
    fileId: render?.fileId ?? null,
  };
  const rows = await db
    .update(workProjects)
    .set({
      status: "done",
      /* A jsonb merge: the topic snapshot and a draft's writing mark stay. */
      source: sql`coalesce(${workProjects.source}, '{}'::jsonb) || jsonb_build_object('published', ${JSON.stringify(publication)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(and(eq(workProjects.id, p.id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)))
    .returning({ id: workProjects.id });
  if (!rows.length) return { error: t("没有这个项目", "No such project") };
  await audit(viewer, "project.publish", { module: "chat", objectType: "project", objectId: p.id, meta: { platforms: platforms.map((x) => x.key), links: platforms.filter((x) => x.url).length, rendered: Boolean(publication.fileId) } });
  return { publication };
}

/**
 * Undo 已发布: back to in progress, and the record removed, so it is on the
 * in-progress lists again and no "just published" list counts it.
 */
export async function unmarkPublished(viewer: Viewer, id: string, zh: boolean): Promise<{ ok: true } | { error: string }> {
  const t = (a: string, b: string) => (zh ? a : b);
  const p = await projectToPublish(viewer, id);
  if (!p) return { error: t("没有这个项目", "No such project") };
  if (!mayPublish(viewer, p.createdBy)) return { error: t("只有工作室成员可以撤回", "Only studio members can undo it") };
  const was = readPublication(p.source);
  await db
    .update(workProjects)
    .set({ status: "active", source: sql`${workProjects.source} - 'published'`, updatedAt: new Date() })
    .where(and(eq(workProjects.id, p.id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)));
  await audit(viewer, "project.unpublish", { module: "chat", objectType: "project", objectId: p.id, meta: { was: was ? { at: was.at, platforms: was.platforms.map((x) => x.key) } : null } });
  return { ok: true };
}

/**
 * The video library's badges: each published work project's record, by its
 * video project's id. Only projects this person may see — a private
 * project's links are its members' — and only live, published ones.
 */
export async function publicationsByVideo(viewer: Viewer, videoProjectIds: string[]): Promise<Record<string, Publication & { projectId: string }>> {
  const ids = [...new Set(videoProjectIds)].slice(0, 200);
  if (!ids.length) return {};
  const rows = await db
    .select({ id: workProjects.id, videoProjectId: workProjects.videoProjectId, published: sql<unknown>`${workProjects.source} -> 'published'` })
    .from(workProjects)
    .where(
      and(
        eq(workProjects.tenantId, viewer.tenantId),
        isNull(workProjects.deletedAt),
        eq(workProjects.status, "done"),
        inArray(workProjects.videoProjectId, ids),
        projectsVisibleTo(viewer),
      ),
    );
  const out: Record<string, Publication & { projectId: string }> = {};
  for (const r of rows) {
    const pub = readPublication({ published: r.published });
    if (pub && r.videoProjectId) out[r.videoProjectId] = { ...pub, projectId: r.id };
  }
  return out;
}

/** One place one project went: what the morning brief or 研究员 reads. */
export type PublishedRow = { projectId: string; title: string; videoProjectId: string | null; at: string; platform: string; url: string | null; byName: string };

/**
 * What the studio published in the last `days` days, newest first, one row
 * per platform (a project posted without naming a platform is one row with
 * platform "other"). For callers with no person behind them — the morning
 * brief's cron, 研究员 checking how the latest videos did — so it reads the
 * whole studio, as `projectFor` does when given only the studio's id.
 */
export async function recentPublications(tenantId: string, days = 14): Promise<PublishedRow[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const rows = await db
    .select({ id: workProjects.id, title: workProjects.title, videoProjectId: workProjects.videoProjectId, published: sql<unknown>`${workProjects.source} -> 'published'` })
    .from(workProjects)
    .where(
      and(
        eq(workProjects.tenantId, tenantId),
        isNull(workProjects.deletedAt),
        eq(workProjects.status, "done"),
        sql`(${workProjects.source} -> 'published' ->> 'at') >= ${since}`,
      ),
    )
    .orderBy(desc(sql`${workProjects.source} -> 'published' ->> 'at'`))
    .limit(100);
  return rows.flatMap((r) => {
    const pub = readPublication({ published: r.published });
    if (!pub) return [];
    const places = pub.platforms.length ? pub.platforms : [{ key: "other", url: null }];
    return places.map((pl) => ({ projectId: r.id, title: r.title, videoProjectId: r.videoProjectId, at: pub.at, platform: pl.key, url: pl.url, byName: pub.byName }));
  });
}
