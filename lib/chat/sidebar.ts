import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { listChannels, listConversations, listPeople } from "@/lib/chat/service";
import { listWorkProjects, projectChannelIds } from "@/lib/projects/service";
import { distinctNames } from "@/lib/chat/people";

/**
 * What the chat sidebar shows, in one place: the layout renders it once and
 * the sidebar asks for it again every half minute and whenever something on
 * the right says it changed (13 Oct: the left list and the open conversation
 * drifted apart until a reload).
 */
export async function sidebarData(viewer: Viewer) {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [channels, people, conversations, tenant, projectChannels, projects] = await Promise.all([
    listChannels(viewer),
    listPeople(viewer),
    listConversations(viewer, 40),
    db.select({ name: tenants.name, nameLocal: tenants.nameLocal }).from(tenants).where(eq(tenants.id, viewer.tenantId)).limit(1),
    projectChannelIds(viewer.tenantId),
    listWorkProjects(viewer, 12).catch(() => []),
  ]);
  const hidden = new Set(projectChannels);
  const others = people.filter((p) => p.id !== viewer.id);
  const label = distinctNames(others.map((p) => ({ id: p.id, name: zh && p.nameLocal ? p.nameLocal : p.name, email: p.email, title: p.title })));
  return {
    studio: (zh && tenant[0]?.nameLocal) || tenant[0]?.name || "腾亚创变",
    channels: channels
      .filter((c): c is typeof c & { slug: string } => Boolean(c.slug) && !hidden.has(c.id))
      .map((c) => ({ id: c.id, slug: c.slug, name: c.name, isPrivate: c.isPrivate, unread: c.unread })),
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
    people: others.map((p) => ({ id: p.id, name: label.get(p.id) ?? (zh && p.nameLocal ? p.nameLocal : p.name), avatarUrl: p.avatarUrl, presence: p.presence, isGuest: p.isGuest, unread: p.unread })),
    /* Projects, newest activity first: the conversations a studio actually works in (13 Oct: "organise chats by project"). */
    projects: projects.filter((p) => p.status !== "archived").slice(0, 12).map((p) => ({ id: p.id, title: p.title, status: p.status })),
  };
}
export type SidebarData = Awaited<ReturnType<typeof sidebarData>>;
