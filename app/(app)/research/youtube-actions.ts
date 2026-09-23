"use server";

import { getViewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { channelsForPhrase, type BeatChannel } from "@/lib/research/youtube";

/**
 * Finding channels and videos worth knowing about.
 *
 * The competitor board could only ever show channels somebody had already
 * typed a channel id into a form for — which asks the studio to already know
 * who it is competing with. These are the two questions it could not answer:
 * who is making videos about this subject, and what is this country watching
 * today.
 *
 * Both are read on demand rather than on a schedule. A search costs 100 of the
 * key's 10,000 daily units, so it happens when somebody asks and not once an
 * hour for a panel nobody opened.
 */
async function researcher() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return null;
  return viewer;
}

export async function discoverChannelsAction(
  phrase: string,
  opts: { days?: number; regionCode?: string } = {},
): Promise<{ channels: BeatChannel[] } | { error: string }> {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!env.youtube.configured) {
    return { error: "No YouTube key is configured on this deployment." };
  }

  const q = String(phrase ?? "").trim().slice(0, 120);
  if (q.length < 2) return { error: "Type a phrase to look for." };

  try {
    const channels = await channelsForPhrase(q, {
      days: clampDays(opts.days),
      regionCode: opts.regionCode,
    });
    await audit(viewer, "research.youtube.discover", { module: "research", meta: { phrase: q, found: channels.length } });
    // Twelve is what the panel draws; the rest is a longer list nobody reads.
    return { channels: channels.slice(0, 12) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "YouTube could not be reached." };
  }
}

/** A window a person would actually ask for, and one YouTube will accept. */
function clampDays(days: number | undefined): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(365, Math.max(1, Math.round(days as number)));
}
