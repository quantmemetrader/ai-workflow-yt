"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { channelBySlug, createChannel, markRead, postMessage } from "@/lib/chat/service";

/** Post to a channel. Authorisation is re-checked here: a server action is a
 * public endpoint, whatever the UI around it looked like. */
/** A message is stored and shown to everyone in the channel; the composer's
 * own limit is not a limit. */
const MAX_BODY = 16_000;
const MAX_SLUG = 60;

export async function sendChannelMessage(slug: string, body: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof slug !== "string" || !slug || slug.length > MAX_SLUG) {
    return { error: "Channel not found" };
  }
  if (typeof body !== "string" || !body.trim()) return { error: "Nothing to send" };
  if (body.length > MAX_BODY) return { error: "That message is too long" };

  const channel = await channelBySlug(viewer, slug);
  if (!channel) return { error: "Channel not found" };

  await postMessage(viewer, channel.id, body);
  revalidatePath(`/chat/c/${slug}`);
  return {};
}

export async function markChannelRead(slug: string) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return;
  if (typeof slug !== "string" || !slug || slug.length > MAX_SLUG) return;
  const channel = await channelBySlug(viewer, slug);
  if (channel) await markRead(viewer, channel.id);
}

/** Creates a channel and hands back where to go. */
export async function createChannelAction(name: string, isPrivate = false) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  if (typeof name !== "string" || !name.trim()) return { error: "A channel needs a name" };
  if (name.length > 200) return { error: "That name is too long for a channel" };

  try {
    const channel = await createChannel(viewer, { name, isPrivate: Boolean(isPrivate) });
    revalidatePath("/chat", "layout");
    return { slug: channel.slug };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create that channel" };
  }
}
