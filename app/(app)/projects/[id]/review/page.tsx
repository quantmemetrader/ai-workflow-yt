import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { onlyTheSharedPage, projectForPage } from "@/lib/projects/page-data";
import { accountsStale, POST_TTL_MS, projectReviewData } from "@/lib/review/service";
import { ReviewScreen } from "@/components/review/ReviewScreen";
import { canEditProject } from "@/lib/video/access";

export const metadata = { title: "复盘" };

/** 5 复盘: the numbers once it is out, the accounts, and the researcher's review. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("chat");
  const { id } = await params;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, id, zh);
  if (!p) notFound();
  onlyTheSharedPage(p);
  const data = await projectReviewData(viewer, id);
  if (!data) notFound();
  const published = Boolean(data.published) || data.status === "done";
  /* 移除 and 刷新数据 are for the people who may change the project, not for
     a colleague it was shared with to view (QA, 2 Oct). */
  const canWork = viewer.role !== "guest" && !p.linkOnly && (p.canManage || !p.video || (await canEditProject(viewer, p.video.id).catch(() => false)));
  const postsStale = data.posts.some((x) => x.url && (!x.at || Date.now() - Date.parse(x.at) > POST_TTL_MS) && !x.error);
  return (
    <ReviewScreen
      projectId={id}
      zh={zh}
      published={published}
      posts={data.posts}
      accounts={data.accounts}
      review={data.review}
      canWork={canWork}
      stale={accountsStale(data.accounts) || postsStale}
    />
  );
}
