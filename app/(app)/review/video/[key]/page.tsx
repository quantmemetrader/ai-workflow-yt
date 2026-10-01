import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/dal";
import { videoDetail } from "@/lib/review/videos";
import { VideoDetail } from "@/components/review/VideoDetail";

export const metadata = { title: "视频数据" };

/** 账号数据 › one video: its numbers, its trend, and the same video on the other platforms. */
export default async function VideoPage({ params }: { params: Promise<{ key: string }> }) {
  const viewer = await requireViewer();
  const { key } = await params;
  const d = await videoDetail(viewer, decodeURIComponent(key));
  if (!d) notFound();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return <VideoDetail zh={zh} video={d.video} siblings={d.siblings} typical={d.typical} />;
}
