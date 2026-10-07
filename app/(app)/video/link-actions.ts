"use server";

import { getViewer } from "@/lib/auth/dal";
import { linkJobStates, linkTarget, queueLinkImports } from "@/lib/media/link-jobs";

/** 从链接导入视频: queue the links for this project (wp_… or prj_…), one job each. */
export async function queueLinksAction(projectId: unknown, text: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (typeof projectId !== "string" || !/^(wp|prj)_[0-9a-z]+$/i.test(projectId) || typeof text !== "string") return { error: "找不到这个项目" };
  const target = await linkTarget(viewer, projectId);
  if (!target) return { error: "你不能往这个项目里加素材" };
  const queued = await queueLinkImports(viewer, text.slice(0, 4000), target);
  if (!queued.length) return { error: "没找到视频链接。支持 Instagram、抖音、小红书、TikTok、YouTube、微博、视频号、B站。" };
  return { queued };
}

/** Where this person's link imports stand. */
export async function linkStatesAction(jobIds: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  return { states: await linkJobStates(viewer, Array.isArray(jobIds) ? jobIds.map(String) : []) };
}
