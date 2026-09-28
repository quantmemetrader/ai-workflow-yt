import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { Card, PageBody } from "@/components/projects/kit";

/** Placeholder until this page is built. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();
  return (
    <PageBody>
      <Card icon="spark" title="files" sub={zh ? "这一页正在搭建" : "This page is being built"} />
    </PageBody>
  );
}
