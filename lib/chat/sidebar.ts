import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { listConversations, listPeople } from "@/lib/chat/service";
import { listWorkProjects, visibleProject } from "@/lib/projects/service";
import { distinctNames } from "@/lib/chat/people";

/**
 * What the chat sidebar shows, in one place: the layout renders it once and the sidebar asks for it again
 * every half minute and whenever the page on the right says something changed.
 *
 * Organised the way the studio works (15 Oct: "no need for group chats; projects, like Claude / Codex, to
 * organise different chats"): projects, each with this person's chats filed under it; then the chats not in
 * any project; then colleagues for direct messages. Group chats are no longer listed.
 */
export async function sidebarData(viewer: Viewer) {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [people, conversations, tenant, recentProjects] = await Promise.all([
    listPeople(viewer),
    listConversations(viewer, 80),
    db.select({ name: tenants.name, nameLocal: tenants.nameLocal }).from(tenants).where(eq(tenants.id, viewer.tenantId)).limit(1),
    listWorkProjects(viewer, 14).catch(() => []),
  ]);
  const others = people.filter((p) => p.id !== viewer.id);
  const label = distinctNames(others.map((p) => ({ id: p.id, name: zh && p.nameLocal ? p.nameLocal : p.name, email: p.email, title: p.title })));

  /* Projects: the ones this person's chats are filed under, then the studio's most recently active. */
  const projects = new Map<string, { id: string; title: string; status: string; updatedAt: string }>();
  const filedIds = [...new Set(conversations.map((c) => c.projectId).filter((x): x is string => Boolean(x)))];
  const filed = await Promise.all(filedIds.map((id) => visibleProject(viewer, id).catch(() => null)));
  const lastChat = new Map<string, string>();
  for (const c of conversations) if (c.projectId && !lastChat.has(c.projectId)) lastChat.set(c.projectId, c.updatedAt.toISOString());
  for (const p of filed) if (p) projects.set(p.id, { id: p.id, title: p.title, status: "active", updatedAt: lastChat.get(p.id) ?? "" });
  for (const p of recentProjects) if (p.status !== "archived" && !projects.has(p.id) && projects.size < 16) projects.set(p.id, { id: p.id, title: p.title, status: p.status, updatedAt: p.updatedAt });
  const visible = new Set(projects.keys());

  return {
    studio: (zh && tenant[0]?.nameLocal) || tenant[0]?.name || "腾亚创变",
    channels: [] as { id: string; slug: string; name: string; isPrivate: boolean; unread: number }[],
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString(), projectId: c.projectId && visible.has(c.projectId) ? c.projectId : null })),
    people: others.map((p) => ({ id: p.id, name: label.get(p.id) ?? (zh && p.nameLocal ? p.nameLocal : p.name), avatarUrl: p.avatarUrl, presence: p.presence, isGuest: p.isGuest, unread: p.unread })),
    projects: [...projects.values()].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
  };
}
export type SidebarData = Awaited<ReturnType<typeof sidebarData>>;
