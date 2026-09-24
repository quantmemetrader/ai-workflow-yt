import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { listPeople } from "@/lib/chat/service";
import { workProjectDetail } from "@/lib/projects/service";
import { ProjectScreen } from "@/components/projects/ProjectScreen";

export const metadata = { title: "项目 · Project" };

/** One project: its steps, what it has made, and its own conversation. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [project, people] = await Promise.all([workProjectDetail(viewer, id, zh), listPeople(viewer)]);
  if (!project) notFound();
  return (
    <ProjectScreen
      project={project}
      zh={zh}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name, avatarUrl: p.avatarUrl, title: p.title, email: p.email }))}
    />
  );
}
