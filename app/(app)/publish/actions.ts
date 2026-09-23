"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import {
  approveAndQueue,
  connectChannelUrl,
  createPost,
  rejectApproval,
  requestApproval,
  retryTarget,
  setChannelEnabled,
  setOverride,
  setTargetOptions,
  setTargets,
  updatePost,
} from "@/lib/publish/service";
import { enqueue } from "@/lib/jobs/queue";
import { audit } from "@/lib/audit";

/**
 * Publish, from the screen.
 *
 * Every one of these re-reads the viewer and re-checks the module: a server
 * action is a public endpoint whatever the screen around it looked like, and
 * these actions put the studio's name on other people's platforms.
 *
 * None of them calls a platform. Approving queues a job; the worker sends.
 * That is spec §6, and it is also the only way a slow platform cannot hold a
 * request open long enough for somebody to press the button again.
 */
async function publisher() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("publish")) return null;
  return viewer;
}

function refresh() {
  revalidatePath("/publish");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);

export async function createPostAction(input: {
  title: string;
  body?: string;
  tags?: string[];
  fileId?: string | null;
  channelIds?: string[];
}) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };

  try {
    const postId = await createPost(viewer, {
      title: str(input.title, 300),
      body: str(input.body, 20_000),
      tags: Array.isArray(input.tags) ? input.tags.map((t) => str(t, 60)).filter(Boolean) : [],
      fileId: id(input.fileId),
      channelIds: Array.isArray(input.channelIds) ? input.channelIds.map(id).filter((c): c is string => !!c) : [],
    });
    refresh();
    return { id: postId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create that post" };
  }
}

export async function updatePostAction(
  postId: string,
  input: { title?: string; body?: string; tags?: string[]; scheduledFor?: string | null },
) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(postId)) return { error: "Not found" };

  // A date off the wire is a string until it parses.
  let scheduledFor: Date | null | undefined;
  if (input.scheduledFor !== undefined) {
    if (input.scheduledFor === null || input.scheduledFor === "") scheduledFor = null;
    else {
      const parsed = new Date(input.scheduledFor);
      if (Number.isNaN(parsed.getTime())) return { error: "That is not a date and time" };
      scheduledFor = parsed;
    }
  }

  try {
    await updatePost(viewer, postId, {
      ...(input.title !== undefined ? { title: str(input.title, 300) } : {}),
      ...(input.body !== undefined ? { body: str(input.body, 20_000) } : {}),
      ...(input.tags !== undefined
        ? { tags: (input.tags ?? []).map((t) => str(t, 60)).filter(Boolean) }
        : {}),
      ...(scheduledFor !== undefined ? { scheduledFor } : {}),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function setTargetsAction(postId: string, channelIds: string[]) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(postId)) return { error: "Not found" };

  try {
    await setTargets(
      viewer,
      postId,
      (Array.isArray(channelIds) ? channelIds : []).map(id).filter((c): c is string => !!c),
    );
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change the channels" };
  }
}

export async function setOverrideAction(
  targetId: string,
  input: { title?: string | null; body?: string | null },
) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(targetId)) return { error: "Not found" };

  try {
    await setOverride(viewer, targetId, {
      ...(input.title !== undefined ? { title: input.title === null ? null : str(input.title, 300) } : {}),
      ...(input.body !== undefined ? { body: input.body === null ? null : str(input.body, 20_000) } : {}),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function requestApprovalAction(postId: string, approverId: string | null, note: string) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(postId)) return { error: "Not found" };

  try {
    await requestApproval(viewer, postId, id(approverId), str(note, 1000) || null);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not ask for approval" };
  }
}

/**
 * Approve, and let the worker send it.
 *
 * The one place a post can leave this studio. `approveAndQueue` claims the
 * post's state in the statement that checks it, so two people pressing this at
 * the same moment queue one send between them.
 */
export async function approveAction(postId: string, note: string) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(postId)) return { error: "Not found" };

  try {
    const { scheduledFor } = await approveAndQueue(viewer, postId, str(note, 1000) || null);
    refresh();
    return { queued: true, scheduledFor: scheduledFor?.toISOString() ?? null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not approve that" };
  }
}

export async function rejectAction(postId: string, note: string) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(postId)) return { error: "Not found" };

  try {
    await rejectApproval(viewer, postId, str(note, 1000) || null);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send that back" };
  }
}

export async function retryTargetAction(targetId: string) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(targetId)) return { error: "Not found" };

  try {
    await retryTarget(viewer, targetId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not retry that" };
  }
}

export async function setChannelEnabledAction(channelId: string, enabled: boolean) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(channelId)) return { error: "Not found" };

  try {
    await setChannelEnabled(viewer, channelId, Boolean(enabled));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

/**
 * Start connecting one of the studio's own channels.
 *
 * Returns a consent link for the browser to open. Connecting a channel is
 * something only a manager should start — it grants a vendor the right to post
 * as the studio — so it is checked the same way approving a post is.
 */
export async function connectChannelAction(platform: string) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  // Connecting a channel grants a vendor the right to post as the studio, so
  // a guest with the Publish module may not start one.
  if (viewer.role === "guest") return { error: "Only a full member can connect a channel." };
  return connectChannelUrl(viewer, String(platform));
}

/**
 * The platform's own extras for one channel: YouTube's category, Instagram's
 * first comment, LinkedIn's visibility. Saved as chosen, and filtered to the
 * keys that platform actually asks for.
 */
export async function setTargetOptionsAction(targetId: string, options: Record<string, unknown>) {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };
  if (!id(targetId)) return { error: "Not found" };
  try {
    await setTargetOptions(viewer, targetId, options && typeof options === "object" ? options : {});
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

/** Ask the worker to re-read the channel board from the vendor. The button
 * says "Check now"; this is what it does. */
export async function syncChannelsAction() {
  const viewer = await publisher();
  if (!viewer) return { error: "Not allowed" };

  await enqueue({
    tenantId: viewer.tenantId,
    type: "social.syncChannels",
    module: "publish",
    createdBy: viewer.id,
    dedupeKey: "publish:sync-channels",
    priority: 4,
  });
  await audit(viewer, "publish.channels.sync", { module: "publish" });
  return {};
}
