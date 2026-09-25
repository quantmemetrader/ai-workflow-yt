import "server-only";
import { sql } from "drizzle-orm";
import { db, toArray } from "@/lib/db/client";
import type { Module } from "@/lib/db/schema";
import { subjectsFor } from "@/lib/authz/subjects";
import { workRoleOf, type Viewer } from "./types";

/**
 * The viewer a background job is acting for.
 *
 * Its own module, away from `dal.ts`, for a reason worth stating: `dal.ts`
 * imports `redirect` from `next/navigation`, which reaches React's client
 * context. That is right for a page and fatal for the worker — a plain Node
 * process importing it dies at startup with `React.createContext is not a
 * function`, and every job on the machine stops. This has nothing a request
 * has, so it belongs nowhere near request code.
 *
 * A job runs long after the request that queued it, with no cookie and no
 * session, and several of them need a viewer: to check the tenant, to write an
 * audit row naming a person, and to bill a model call to somebody.
 *
 * The wrong way to solve that is to serialise the viewer into the job payload,
 * which freezes their permissions at the moment they pressed the button — an
 * entitlement revoked in between would still be honoured an hour later. So the
 * job carries only the id, and this reads what is true *now*. An account since
 * suspended or deleted gets null, and the job fails rather than acting for
 * somebody who is no longer there.
 */
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
  deleted_at: Date | null;
  modules: unknown;
  team_ids: unknown;
};

export async function viewerById(userId: string): Promise<Viewer | null> {
  const { rows } = await db.execute<Row>(sql`
    select u.id, u.tenant_id, u.email, u.name, u.name_local, u.avatar_url, u.title, u.work_role,
           u.role, u.locale, u.status, u.deleted_at,
           coalesce((select array_agg(e.module) from entitlements e where e.user_id = u.id), '{}') as modules,
           coalesce((select array_agg(tm.team_id) from team_members tm where tm.user_id = u.id), '{}') as team_ids
      from users u
     where u.id = ${userId}
     limit 1
  `);

  const row = rows[0];
  if (!row || row.deleted_at || row.status !== "active") return null;

  const teamIds = toArray(row.team_ids);
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
    // Nothing is waiting on this render, so nothing needs touching.
    staleSeen: false,
  };
}
