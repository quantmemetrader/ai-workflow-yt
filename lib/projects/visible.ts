import "server-only";
import { sql } from "drizzle-orm";
import { workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";

/**
 * Which projects this person may see: their own, the studio-wide ones
 * (not for guests), the ones shared with a group they are in, the ones
 * naming them. Owners and admins see all of the studio's.
 *
 * The one rule, in its own module so that readers outside
 * `lib/projects/service.ts` — the chat's video cards, which say "打开项目"
 * only for a project the reader may open — can ask it without importing
 * the whole service (which itself imports the chat, and a cycle is how a
 * page renders half a module).
 */
export function projectsVisibleTo(viewer: Viewer) {
  if (viewer.isAdmin) return sql`true`;
  return sql`(${workProjects.createdBy} = ${viewer.id}
    or (${workProjects.access} ->> 'mode' = 'everyone' and ${viewer.role} <> 'guest')
    or (${workProjects.access} ->> 'mode' = 'groups' and (${workProjects.access} -> 'groups') ? ${viewer.role})
    or (${workProjects.access} ->> 'mode' = 'groups' and ${viewer.role} = 'owner' and (${workProjects.access} -> 'groups') ? 'admin')
    or (${workProjects.access} ->> 'mode' = 'people' and (${workProjects.access} -> 'userIds') ? ${viewer.id}))`;
}

/**
 * A project this person may open by its link, on top of `projectsVisibleTo`:
 * link sharing (「有链接的人可查看 / 可编辑」, `access.link`) lets anyone in
 * the studio (not guests) who was sent the link open it, like a Google Doc.
 * For opening one project only: lists keep `projectsVisibleTo`, so a
 * private project never shows up for people who were not sent it.
 */
export function projectOpenableBy(viewer: Viewer) {
  if (viewer.isAdmin) return sql`true`;
  return sql`(${projectsVisibleTo(viewer)} or (${workProjects.access} ->> 'link' in ('view', 'edit') and ${viewer.role} <> 'guest'))`;
}
