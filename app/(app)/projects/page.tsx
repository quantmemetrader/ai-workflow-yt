import { requireModule } from "@/lib/auth/dal";
import { listWorkProjects } from "@/lib/projects/service";
import { ProjectsList } from "@/components/projects/ProjectsList";

export const metadata = { title: "项目 · Projects" };

/** Every project the person may see, newest activity first. */
export default async function ProjectsPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await listWorkProjects(viewer, 200);
  return (
    <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <ProjectsList zh={zh} rows={rows.map((r) => ({ id: r.id, title: r.title, status: r.status, mode: r.mode, updatedAt: r.updatedAt, mine: r.createdBy === viewer.id, access: r.access }))} />
    </div>
  );
}
