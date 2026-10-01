import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { tabStates } from "@/lib/projects/tabs";
import { ProjectHeader } from "@/components/projects/ProjectHeader";

/**
 * Every page of one project: the header and its tabs (`ProjectHeader`) over
 * whichever page is open. `projectForPage` is cached per request, so the
 * page under it reads the same project without a second trip.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();
  return (
    <div data-project-frame="" style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#f6f5f2" }}>
      <ProjectHeader
        zh={zh}
        p={{ id: p.id, title: p.title, status: p.status, canManage: p.canManage, mine: p.mine, linkOnly: p.linkOnly, access: p.access, published: p.published?.platforms ?? [], tabs: tabStates(p) }}
      />
      <div data-project-body="" style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>{children}</div>
    </div>
  );
}
