import { requireViewer } from "@/lib/auth/dal";
import { accountViews, accountsStale, publishedProjects } from "@/lib/review/service";
import { StudioReview } from "@/components/review/StudioReview";
import { PublishTabs } from "@/components/publish/PublishTabs";

export const metadata = { title: "账号数据 · Account data" };

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
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <PublishTabs zh={zh} canPublish={viewer.modules.includes("publish")} />
      <StudioReview zh={zh} accounts={accounts} rows={rows} canWork={viewer.role !== "guest"} stale={accountsStale(accounts)} hasChannels={viewer.modules.includes("research")} />
    </div>
  );
}
