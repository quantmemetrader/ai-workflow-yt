/**
 * Who is asking.
 *
 * In its own file because two very different things need it: request code,
 * which reads it from a session cookie, and the worker, which reads it by id
 * long after the request is gone. `dal.ts` imports `next/navigation` and
 * cannot be loaded by a plain Node process at all, so the *type* lives here
 * where both can reach it.
 */
import type { Module } from "@/lib/db/schema";
import { isProductionKey, type ProductionKey } from "@/lib/agents/catalog";

export type Viewer = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  nameLocal: string | null;
  avatarUrl: string | null;
  title: string | null;
  role: "owner" | "admin" | "member" | "guest";
  /**
   * Which job this person does in the studio — one of the employee keys —
   * and so which Home they land on (`lib/home/roles.ts`). Null is "not
   * set": owners and admins get the overview, members a Home worked out
   * from their modules. Not `role`, which is what they are allowed to do.
   */
  workRole: ProductionKey | null;
  locale: "zh-CN" | "zh-HK" | "en" | null;
  /** Exactly the modules this person holds. The rail renders this list and
   * nothing else (spec §4.1). */
  modules: Module[];
  teamIds: string[];
  /** Subjects to match ReBAC tuples against: self, teams, and — unless they
   * are a guest — the tenant. */
  subjects: string[];
  isAdmin: boolean;
  /** Set when this request should refresh "last seen"; done after the response
   * rather than in the middle of rendering. */
  staleSeen: boolean;
};

/**
 * `users.work_role` as a Viewer holds it.
 *
 * The column is free text; only an employee key is a work role. Anything
 * else (a value typed by hand into the database, a key since retired) reads
 * as "not set" rather than as a Home with no layout — and so does 法务 or
 * 财务, who are colleagues in chat but not a job on the production line
 * (`PRODUCTION_KEYS`). Here, beside the type,
 * because both readers of a viewer need it and neither may import the other.
 */
export function workRoleOf(value: string | null | undefined): ProductionKey | null {
  return isProductionKey(value) ? value : null;
}
