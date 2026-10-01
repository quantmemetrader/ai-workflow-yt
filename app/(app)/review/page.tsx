import { requireViewer } from "@/lib/auth/dal";
import { accountViews, accountsStale, publishedProjects } from "@/lib/review/service";
import { allVideos } from "@/lib/review/videos";
import { StudioReview } from "@/components/review/StudioReview";

export const metadata = { title: "账号数据" };

/**
 * 账号数据: the studio's accounts, every video on them with its numbers, and
 * every published project. Each project's own 复盘 tab is where a review is
 * written; each video has its own page (`/review/video/<key>`).
 */
export default async function StudioReviewPage() {
  const viewer = await requireViewer();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [accounts, rows, videos] = await Promise.all([accountViews(viewer.tenantId), publishedProjects(viewer), allVideos(viewer)]);
  return <StudioReview zh={zh} accounts={accounts} rows={rows} videos={videos} canWork={viewer.role !== "guest"} stale={accountsStale(accounts)} hasChannels={viewer.modules.includes("research")} />;
}
