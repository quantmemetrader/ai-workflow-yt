"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { cleanLink, isPublishPlatform } from "@/lib/projects/publication";
import {
  addPostLink,
  handReviewToResearch,
  linkAccountPost,
  refreshAccounts,
  refreshProjectPosts,
  removePost,
  saveManualAccount,
  saveManualPost,
  writeReview,
} from "@/lib/review/service";
import { platformOfUrl, type AccountPost, type AccountStats, type Stats } from "@/lib/review/types";
import { num } from "@/lib/review/platforms";

/**
 * The 复盘 page's presses. Anyone who can see the project can read its
 * numbers again or type them in; a guest only looks.
 */
async function worker() {
  const v = await getViewer();
  if (!v || v.role === "guest") return null;
  return v;
}

const again = (projectId?: string) => {
  if (projectId) revalidatePath(`/projects/${projectId}/review`);
  revalidatePath("/review");
};

function statsFrom(raw: Record<string, unknown>): Stats {
  const n = (k: string) => {
    const v = num(typeof raw[k] === "string" ? (raw[k] as string).trim() : raw[k]);
    return v === null || v < 0 ? null : v;
  };
  const c = n("completion");
  return { plays: n("plays"), likes: n("likes"), comments: n("comments"), shares: n("shares"), collects: n("collects"), completion: c === null ? null : c > 1 ? Math.min(c, 100) / 100 : c };
}

/** Read the accounts again (and this project's posts). `force` skips the cache. */
export async function refreshReviewAction(projectId: string | null, force = false): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  await refreshAccounts(v, { force });
  if (projectId) {
    const r = await refreshProjectPosts(v, projectId, { force });
    if (r.error) return r;
  }
  again(projectId ?? undefined);
  return {};
}

export async function addPostLinkAction(projectId: string, rawUrl: string, rawPlatform?: string): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  const url = cleanLink(rawUrl);
  if (!url) return { error: "这不是一个网址" };
  const platform = rawPlatform && isPublishPlatform(rawPlatform) ? rawPlatform : platformOfUrl(url);
  if (!platform) return { error: "认不出是哪个平台的链接，请选一下平台" };
  const r = await addPostLink(v, projectId, url, platform);
  again(projectId);
  return r;
}

export async function linkAccountPostAction(projectId: string, platform: string, post: AccountPost): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  if (!isPublishPlatform(platform)) return { error: "平台不对" };
  const r = await linkAccountPost(v, projectId, platform, { id: String(post.id), title: String(post.title).slice(0, 120), url: cleanLink(post.url) ?? null, at: post.at, stats: statsFrom(post.stats as unknown as Record<string, unknown>) });
  again(projectId);
  return r;
}

export async function saveManualPostAction(projectId: string, platform: string, rawUrl: string | null, raw: Record<string, unknown>): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  if (!isPublishPlatform(platform)) return { error: "平台不对" };
  const url = rawUrl ? cleanLink(rawUrl) : null;
  if (url === undefined) return { error: "这不是一个网址" };
  const stats = statsFrom(raw);
  if (Object.values(stats).every((x) => x === null)) return { error: "至少填一个数字" };
  const r = await saveManualPost(v, projectId, platform, url, stats);
  again(projectId);
  return r;
}

export async function removePostAction(projectId: string, platform: string, url: string | null): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  await removePost(v, projectId, platform, url);
  again(projectId);
  return {};
}

export async function saveManualAccountAction(platform: string, raw: Record<string, unknown>): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  const n = (k: string) => num(typeof raw[k] === "string" ? (raw[k] as string).trim() : raw[k]);
  const stats: AccountStats = { followers: n("followers"), likes: n("likes"), works: n("works"), views: null };
  if (stats.followers === null && stats.likes === null && stats.works === null) return { error: "至少填一个数字" };
  try {
    await saveManualAccount(v, platform, stats);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  again();
  return {};
}

export async function writeReviewAction(projectId: string): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  const r = await writeReview(v, projectId);
  again(projectId);
  return r.error ? { error: r.error } : {};
}

export async function handReviewAction(projectId: string): Promise<{ error?: string }> {
  const v = await worker();
  if (!v) return { error: "没有权限" };
  const r = await handReviewToResearch(v, projectId);
  again(projectId);
  return r;
}
