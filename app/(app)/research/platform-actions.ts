"use server";

import { getViewer } from "@/lib/auth/dal";
import { isPlatformKey, platformHot, type PlatformHot } from "@/lib/research/platforms";
import { judgeHot, type Judged } from "@/lib/research/judge";

/**
 * One platform's hot list, for the Trends strip when somebody picks it.
 *
 * A server action rather than part of the page render because five of the
 * eight platforms are metered reads, and a page that pays for all five on
 * every open is a page nobody can afford to refresh. Cached for half an hour
 * behind this, so the second person to pick 抖音 pays nothing.
 */
export async function platformHotAction(platform: string): Promise<PlatformHot | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return { error: "Not allowed" };
  if (!isPlatformKey(platform)) return { error: "No such platform" };
  return platformHot(platform);
}

/**
 * 研究员's reading of that list against this channel — which rows are the
 * studio's business and why. Asked for separately so the list is on screen
 * while the judgement is being made.
 */
export async function judgeHotAction(platform: string): Promise<{ judged: Judged } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return { error: "Not allowed" };
  if (!isPlatformKey(platform)) return { error: "No such platform" };
  const hot = await platformHot(platform);
  if (!hot.rows.length) return { judged: {} };
  return { judged: await judgeHot(viewer.tenantId, platform, hot.rows, hot.fetchedAt) };
}
