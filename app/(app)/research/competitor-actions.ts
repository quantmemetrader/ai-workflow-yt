"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { addCompetitor, removeCompetitor } from "@/lib/social/service";
import { enqueue } from "@/lib/jobs/queue";
import { env } from "@/lib/env";

/**
 * Watching somebody else's channel.
 *
 * Public figures only, read through TikHub, which sees what the platform shows
 * anybody with a browser. There is no login and nothing here is scraped:
 * Schedule A3(1) forbids that, and this is the vendor the studio pays so it
 * does not have to.
 */
async function researcher() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return null;
  return viewer;
}

export async function addCompetitorAction(input: {
  platform: string;
  externalId: string;
  handle: string;
  displayName: string;
  note: string;
}) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!env.tikhub.configured) {
    return { error: "No outside-world key is configured on this deployment, so nobody else's channel can be read." };
  }

  const platform = String(input.platform ?? "youtube");
  if (!["youtube", "tiktok", "instagram", "xiaohongshu", "wechat"].includes(platform)) {
    return { error: "No such platform" };
  }

  const externalId = String(input.externalId ?? "").trim().slice(0, 120);
  if (!externalId) return { error: "A channel id or handle is needed" };

  try {
    await addCompetitor(viewer, {
      platform,
      externalId,
      handle: String(input.handle ?? "").slice(0, 120) || null,
      displayName: String(input.displayName ?? "").slice(0, 200) || null,
      note: String(input.note ?? "").slice(0, 500) || null,
    });

    // Read it now rather than at the next hourly round: somebody who has just
    // added a channel wants to see it.
    await enqueue({
      tenantId: viewer.tenantId,
      type: "social.syncCompetitors",
      module: "research",
      createdBy: viewer.id,
      dedupeKey: "social.syncCompetitors",
      priority: 4,
    });

    revalidatePath("/research");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function removeCompetitorAction(competitorId: string) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (typeof competitorId !== "string" || !competitorId || competitorId.length > 64) {
    return { error: "Not found" };
  }
  await removeCompetitor(viewer, competitorId);
  revalidatePath("/research");
  return {};
}

export async function syncCompetitorsAction() {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  await enqueue({
    tenantId: viewer.tenantId,
    type: "social.syncCompetitors",
    module: "research",
    createdBy: viewer.id,
    dedupeKey: "social.syncCompetitors",
    priority: 4,
  });
  return {};
}
