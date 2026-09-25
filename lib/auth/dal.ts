import "server-only";
import { cache } from "react";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, toArray, toDate } from "@/lib/db/client";
import type { Module } from "@/lib/db/schema";
import { subjectsFor } from "@/lib/authz/subjects";
import { readSessionToken, sessionId } from "./session";

/**
 * The data access layer. Every server component, action and route handler asks
 * *this* who the caller is — nothing trusts a prop, a header or the proxy.
 *
 * It is deliberately one query. Session, person, entitlements and teams used to
 * be three round trips, and a round trip to the database is the most expensive
 * thing a page here does; `cache()` then makes it one query per request no
 * matter how many components ask.
 */
export type { Viewer } from "./types";
import { workRoleOf, type Viewer } from "./types";

/** Raw rows are untyped: see `toDate` / `toArray` in lib/db/client. */
type Row = {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  name_local: string | null;
  avatar_url: string | null;
  title: string | null;
  work_role: string | null;
  role: Viewer["role"];
  locale: Viewer["locale"];
  status: string;
  is_agent: boolean;
  deleted_at: Date | null;
  modules: unknown;
  team_ids: unknown;
  last_seen_at: unknown;
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const token = await readSessionToken();
  if (!token) return null;

  const { rows } = await db.execute<Row>(sql`
    select u.id, u.tenant_id, u.email, u.name, u.name_local, u.avatar_url, u.title, u.work_role,
           u.role, u.locale, u.status, u.is_agent, u.deleted_at, s.last_seen_at,
           coalesce((select array_agg(e.module) from entitlements e where e.user_id = u.id), '{}') as modules,
           coalesce((select array_agg(tm.team_id) from team_members tm where tm.user_id = u.id), '{}') as team_ids
      from sessions s
      join users u on u.id = s.user_id
     where s.id = ${sessionId(token)} and s.expires_at > now()
     limit 1
  `);

  const row = rows[0];
  // Anything other than `active` is not a viewer, not just `suspended`: an
  // account an admin has moved back to `invited` still has live session rows,
  // and an allow-list is the only version of this check that stays correct
  // when a status is added to the enum.
  if (!row || row.deleted_at || row.status !== "active") return null;
  // An agent acts through jobs (`viewer-by-id.ts`), never through a browser.
  // A session row for one can only have been made by mistake or on purpose.
  if (row.is_agent) return null;

  const teamIds = toArray(row.team_ids);
  const lastSeen = toDate(row.last_seen_at);
  const hourAgo = Date.now() - 3_600_000;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    nameLocal: row.name_local,
    avatarUrl: row.avatar_url,
    title: row.title,
    workRole: workRoleOf(row.work_role),
    role: row.role,
    locale: row.locale,
    modules: toArray<Module>(row.modules),
    teamIds,
    subjects: subjectsFor({ id: row.id, tenantId: row.tenant_id, role: row.role }, teamIds),
    isAdmin: row.role === "owner" || row.role === "admin",
    staleSeen: !lastSeen || lastSeen.getTime() < hourAgo,
  };
});

/** Use in pages and layouts. Sends a signed-out visitor to the login screen. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Use before rendering any module surface. A person without the module does
 * not get a locked page — the module does not exist for them. */
export async function requireModule(module: Module): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.modules.includes(module)) redirect("/");
  return viewer;
}
