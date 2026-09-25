import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { listPeople } from "@/lib/chat/service";
import { workProjectDetail } from "@/lib/projects/service";
import { scriptWriting } from "@/lib/script/writing";
import { ProjectScreen } from "@/components/projects/ProjectScreen";

export const metadata = { title: "项目 · Project" };

/** One project: its steps, what it has made, and its own conversation. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [project, people] = await Promise.all([workProjectDetail(viewer, id, zh), listPeople(viewer)]);
  if (!project) notFound();
  /* Whether 编剧 is writing into its script now, with the mark's time limit
     applied here rather than in the browser, whose clock may differ. */
  const writing = project.script ? (await scriptWriting(viewer.tenantId, project.script.id)).writing : false;
  return (
    <ProjectScreen
      project={project}
      zh={zh}
      writing={writing}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name, avatarUrl: p.avatarUrl, title: p.title, email: p.email }))}
    />
  );
}
