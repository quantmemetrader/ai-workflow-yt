import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, scripts, users, videoClips, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { notProxy } from "@/lib/files/service";

/**
 * A project's files, in the four boxes its pages show them in.
 *
 *   clip       素材      what the host filmed (the cut's bin, `video_clips`)
 *   reference  参考资料  examples, notes, briefs the script is written from
 *                        (the script's `source_file_ids`, or tagged)
 *   render     AI 成片   what the editor rendered (`video_exports`)
 *   final      最终版    the film the team re-edited on their own machine and
 *                        uploaded back to post (tagged) — the client: "after
 *                        AI made the video they will fix it up a bit"
 *   other      其他      anything else put in the project (tagged)
 *
 * The tags are plain strings on `files.tags`: `wp:<projectId>` says which
 * project a file was put in, `role:<role>` which box. Clips and renders need
 * no tag — the video tables already say so — but a clip uploaded through the
 * project files page is tagged too, so it shows before it reaches the bin.
 * One file can sit in several projects; nothing is copied.
 */
export const PROJECT_FILE_ROLES = ["clip", "reference", "render", "final", "other"] as const;
export type ProjectFileRole = (typeof PROJECT_FILE_ROLES)[number];

export const ROLE_LABEL: Record<ProjectFileRole, { zh: string; en: string }> = {
  clip: { zh: "素材", en: "Footage" },
  reference: { zh: "参考资料", en: "References" },
  render: { zh: "AI 成片", en: "AI renders" },
  final: { zh: "最终版视频", en: "Final videos" },
  other: { zh: "其他", en: "Other" },
};

export const projectTag = (projectId: string) => `wp:${projectId}`;
export const roleTag = (role: ProjectFileRole) => `role:${role}`;

export function isProjectFileRole(v: unknown): v is ProjectFileRole {
  return typeof v === "string" && (PROJECT_FILE_ROLES as readonly string[]).includes(v);
}

/**
 * Put a file in a project's box: add `wp:<id>` and set its one `role:` tag
 * (moving it out of any other box). The caller has checked the person may
 * work on the project; the file must be one they can read.
 */
export async function tagProjectFile(viewer: Viewer, projectId: string, fileId: string, role: ProjectFileRole): Promise<boolean> {
  const [row] = await db
    .select({ id: files.id, tags: files.tags })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!row) return false;
  const tags = row.tags.filter((t) => !t.startsWith("role:"));
  if (!tags.includes(projectTag(projectId))) tags.push(projectTag(projectId));
  tags.push(roleTag(role));
  await db.update(files).set({ tags, updatedAt: new Date(), updatedBy: viewer.id }).where(eq(files.id, fileId));
  return true;
}

/** Take a file out of a project (its tags only; the file stays in Files). */
export async function untagProjectFile(viewer: Viewer, projectId: string, fileId: string): Promise<void> {
  await db
    .update(files)
    .set({ tags: sql`array_remove(${files.tags}, ${projectTag(projectId)})`, updatedAt: new Date(), updatedBy: viewer.id })
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId)));
}

export type ProjectFile = {
  id: string;
  name: string;
  mime: string | null;
  kind: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  role: ProjectFileRole;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Every file of a project this person may read, each in one box, newest
 * first. A file in two boxes (a render dragged back into the bin) is listed
 * once, in the first of: final, render, clip, reference, other — a tag the
 * team set wins over what the video tables imply.
 */
export async function listProjectFiles(viewer: Viewer, projectId: string): Promise<ProjectFile[]> {
  const [p] = await db
    .select({ id: workProjects.id, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)))
    .limit(1);
  if (!p) return [];

  const implied = new Map<string, ProjectFileRole>();
  const imply = (id: string | null | undefined, role: ProjectFileRole) => {
    if (id && !implied.has(id)) implied.set(id, role);
  };
  if (p.videoProjectId) {
    const [exportsRows, clips, cut] = await Promise.all([
      db.select({ fileId: videoExports.fileId }).from(videoExports).where(eq(videoExports.projectId, p.videoProjectId)).orderBy(desc(videoExports.createdAt)),
      db.select({ fileId: videoClips.fileId }).from(videoClips).where(eq(videoClips.projectId, p.videoProjectId)),
      db.select({ master: videoProjects.masterFileId }).from(videoProjects).where(eq(videoProjects.id, p.videoProjectId)).limit(1),
    ]);
    for (const e of exportsRows) imply(e.fileId, "render");
    imply(cut[0]?.master, "render");
    for (const c of clips) imply(c.fileId, "clip");
  }
  if (p.scriptId) {
    const [s] = await db.select({ ids: scripts.sourceFileIds }).from(scripts).where(eq(scripts.id, p.scriptId)).limit(1);
    for (const id of s?.ids ?? []) imply(id, "reference");
  }

  const tagged = sql`${projectTag(projectId)} = any(${files.tags})`;
  const ids = [...implied.keys()];
  const rows = await db
    .select({ file: files, ownerName: users.name, ownerNameLocal: users.nameLocal, ownerAvatar: users.avatarUrl })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(and(eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer), notProxy(), ids.length ? sql`(${tagged} or ${inArray(files.id, ids)})` : tagged))
    .orderBy(desc(files.createdAt));

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return rows.map(({ file: f, ownerName, ownerNameLocal, ownerAvatar }) => {
    const tag = f.tags.find((t) => t.startsWith("role:"))?.slice(5);
    const inThis = f.tags.includes(projectTag(projectId));
    const role: ProjectFileRole = inThis && isProjectFileRole(tag) ? tag : (implied.get(f.id) ?? "other");
    return {
      id: f.id,
      name: f.name,
      mime: f.mime,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
      durationMs: f.durationMs,
      width: f.width,
      height: f.height,
      role,
      ownerId: f.ownerId,
      ownerName: (zh && ownerNameLocal) || ownerName,
      ownerAvatar,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  });
}
