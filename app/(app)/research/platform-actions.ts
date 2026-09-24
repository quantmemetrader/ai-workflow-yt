"use server";

import { getViewer } from "@/lib/auth/dal";
import { isPlatformKey, platformHot, type PlatformHot } from "@/lib/research/platforms";

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
