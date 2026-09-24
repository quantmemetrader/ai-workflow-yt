import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { listChannels, listConversations, listPeople } from "@/lib/chat/service";
import { WorkspaceSidebar } from "@/components/canvas/WorkspaceSidebar";
import { projectChannelIds } from "@/lib/projects/service";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [channels, people, conversations, tenant, projectChannels] = await Promise.all([
    listChannels(viewer),
    listPeople(viewer),
    /* This person's own agent history. It was written from the first day and
       listed nowhere, so every thread was one closed panel away from gone. */
    listConversations(viewer, 40),
    // The studio's name belongs to the studio, not to a string in the layout.
    db.select({ name: tenants.name, nameLocal: tenants.nameLocal }).from(tenants).where(eq(tenants.id, viewer.tenantId)).limit(1),
    projectChannelIds(viewer.tenantId),
  ]);
  /* A project's chat lives on the project's page, not in this list. */
  const hidden = new Set(projectChannels);

  return (
    <>
      <WorkspaceSidebar
        studio={(zh && tenant[0]?.nameLocal) || tenant[0]?.name || "腾亚创变"}
        locale={viewer.locale ?? "zh-CN"}
        channels={channels
          .filter((c): c is typeof c & { slug: string } => Boolean(c.slug) && !hidden.has(c.id))
          .map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            isPrivate: c.isPrivate,
            unread: c.unread,
          }))}
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
        }))}
        people={people.map((p) => ({
          id: p.id,
          name: zh && p.nameLocal ? p.nameLocal : p.name,
          avatarUrl: p.avatarUrl,
          presence: p.presence,
          isGuest: p.isGuest,
          unread: p.unread,
        }))}
        me={{
          name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
          avatarUrl: viewer.avatarUrl,
          status: viewer.title ?? (zh ? "在线" : "Online"),
        }}
      />
      {children}
    </>
  );
}
