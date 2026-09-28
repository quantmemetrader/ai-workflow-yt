import { requireViewer } from "@/lib/auth/dal";
import { accountViews, accountsStale, publishedProjects } from "@/lib/review/service";
import { StudioReview } from "@/components/review/StudioReview";

export const metadata = { title: "作品复盘 · Review" };

/**
 * 作品复盘, studio-wide: the four accounts and every published project with
 * its latest numbers. Each project's own 复盘 tab is where a review is
 * written; this is the list of them. It replaces 内容表现 under trend
 * research — the review comes after publishing, not inside research.
 */
export default async function StudioReviewPage() {
  const viewer = await requireViewer();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [accounts, rows] = await Promise.all([accountViews(viewer.tenantId), publishedProjects(viewer)]);
  return <StudioReview zh={zh} accounts={accounts} rows={rows} canWork={viewer.role !== "guest"} stale={accountsStale(accounts)} hasChannels={viewer.modules.includes("research")} />;
}
