import { requireModule } from "@/lib/auth/dal";
import { WorkspaceSidebar } from "@/components/canvas/WorkspaceSidebar";
import { sidebarData } from "@/lib/chat/sidebar";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* One source for the sidebar's rows; the sidebar refreshes them itself (lib/chat/sidebar.ts). */
  const data = await sidebarData(viewer);
  return (
    <>
      <WorkspaceSidebar
        studio={data.studio}
        locale={viewer.locale ?? "zh-CN"}
        channels={data.channels}
        conversations={data.conversations}
        projects={data.projects}
        people={data.people}
        me={{
          id: viewer.id,
          name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
          avatarUrl: viewer.avatarUrl,
          status: viewer.title ?? (zh ? "在线" : "Online"),
        }}
        now={new Date().toISOString()}
      />
      {children}
    </>
  );
}
