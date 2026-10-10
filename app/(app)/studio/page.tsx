import { requireModule } from "@/lib/auth/dal";
import { HOST_ENGINES, VIDEO_MODELS } from "@/lib/studio/service";
import { localGeneratorUp } from "@/lib/video/stock";
import { ensureKeys } from "@/lib/keys/store";
import { StudioScreen } from "@/components/studio/StudioScreen";

export const metadata = { title: "配音和生成" };

/** 配音和生成: voice-over, voice cloning and AI video, for anyone holding Video. */
export default async function StudioPage() {
  const viewer = await requireModule("video");
  await ensureKeys();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const local = await localGeneratorUp();
  return <StudioScreen zh={zh} models={VIDEO_MODELS} engines={HOST_ENGINES} imageLocal={local.up} falReady={Boolean(process.env.FAL_KEY)} isAdmin={viewer.role === "owner" || viewer.role === "admin"} />;
}
