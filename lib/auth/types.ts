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

export type Viewer = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  nameLocal: string | null;
  avatarUrl: string | null;
  title: string | null;
  role: "owner" | "admin" | "member" | "guest";
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
