import { ProjectScreenPage } from "@/components/projects/ProjectScreenPage";

export const metadata = { title: "选题 · Topic" };

/** Step 1: the topic — why now, the hook, the evidence, and the researcher to ask. */
export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectScreenPage id={id} view="topic" />;
}
