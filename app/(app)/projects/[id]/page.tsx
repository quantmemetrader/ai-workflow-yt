import { ProjectScreenPage } from "@/components/projects/ProjectScreenPage";

export const metadata = { title: "项目概览" };

/** One project's overview: its five steps as blocks, and its own conversation. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectScreenPage id={id} view="overview" />;
}
