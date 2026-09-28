"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { isPublishPlatform } from "@/lib/projects/publication";
import { tagProjectFile, untagProjectFile } from "@/lib/projects/files";
import { addPublishedPlace, projectForPublish, removePublishedPlace, savePublishDraft, writeCaptions } from "@/lib/projects/publish-page";
import type { PublishDraft } from "@/lib/projects/publish-rows";
import { createPost, requestApproval, setOverride, listPosts } from "@/lib/publish/service";

/**
 * The 发布 page's presses (`components/projects/PublishStep.tsx`).
 *
 * Each re-reads the viewer and the project (a server action is a public
 * endpoint). Posting through a connected channel still goes the Publish
 * module's one way — a post, a request for a named person's approval, and
 * only their 批准 queues the send (lib/publish/service.ts).
 */
async function member() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat") || viewer.role === "guest") return null;
  return viewer;
}

const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const zhOf = (locale: string | null | undefined) => (locale ?? "zh-CN").startsWith("zh");

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}/publish`);
}

/** Put uploaded or picked videos in the project's 最终版 box. */
export async function markFinalAction(projectId: string, fileIds: string[]) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  const p = await projectForPublish(viewer, String(projectId));
  if (!p) return { error: "Not found" };
  let n = 0;
  for (const f of (Array.isArray(fileIds) ? fileIds : []).slice(0, 20)) {
    const fid = id(f);
    if (fid && (await tagProjectFile(viewer, p.id, fid, "final"))) n += 1;
  }
  refresh(p.id);
  return { tagged: n };
}

/** Take a video out of the project's 最终版 box (the file stays in Files). */
export async function unmarkFinalAction(projectId: string, fileId: string) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  const p = await projectForPublish(viewer, String(projectId));
  const fid = id(fileId);
  if (!p || !fid) return { error: "Not found" };
  await untagProjectFile(viewer, p.id, fid);
  refresh(p.id);
  return {};
}

export async function savePublishDraftAction(projectId: string, draft: PublishDraft) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  return savePublishDraft(viewer, String(projectId), draft);
}

/** 撰稿人 writes titles and captions for the given rows. */
export async function writeCaptionsAction(projectId: string, keys: string[], script: string) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  return writeCaptions(viewer, String(projectId), Array.isArray(keys) ? keys.map(String) : [], typeof script === "string" ? script : "");
}

/** 「我已发布」 on one platform, with the post's link. */
export async function markPlacePublishedAction(projectId: string, key: string, url: string, fileId: string | null) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  if (!isPublishPlatform(key)) return { error: "Not found" };
  const res = await addPublishedPlace(viewer, String(projectId), { key, url, fileId: id(fileId) }, zhOf(viewer.locale));
  if ("error" in res) return { error: res.error };
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}

export async function unmarkPlaceAction(projectId: string, key: string) {
  const viewer = await member();
  if (!viewer) return { error: "Not allowed" };
  if (!isPublishPlatform(key)) return { error: "Not found" };
  const res = await removePublishedPlace(viewer, String(projectId), key, zhOf(viewer.locale));
  if ("error" in res) return { error: res.error };
  revalidatePath(`/projects/${projectId}`, "layout");
  return {};
}

/**
 * Post through the connected channels: one Publish post with the chosen
 * video, each channel's own title and caption as its override, sent to a
 * named person for approval. Nothing goes out until they press 批准.
 */
export async function sendChannelsForApprovalAction(
  projectId: string,
  input: { fileId: string | null; rows: { channelId: string; title: string; body: string }[]; approverId: string | null },
) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("publish") || viewer.role === "guest") return { error: "Not allowed" };
  const p = await projectForPublish(viewer, String(projectId));
  if (!p) return { error: "Not found" };
  const rows = (Array.isArray(input?.rows) ? input.rows : []).filter((r) => id(r?.channelId)).slice(0, 10);
  if (!rows.length) return { error: zhOf(viewer.locale) ? "先打开至少一个渠道" : "Turn on at least one channel" };
  const fileId = id(input.fileId);
  if (!fileId) return { error: zhOf(viewer.locale) ? "先选好要发的视频" : "Pick the video to post first" };
  try {
    const first = rows[0];
    const postId = await createPost(viewer, {
      title: (first.title || p.title).slice(0, 300),
      body: String(first.body ?? "").slice(0, 20_000),
      fileId,
      scriptId: p.scriptId,
      channelIds: rows.map((r) => r.channelId),
    });
    const post = (await listPosts(viewer, { scriptId: p.scriptId ?? "__none__", limit: 20 })).find((x) => x.id === postId);
    for (const tg of post?.targets ?? []) {
      const r = rows.find((x) => x.channelId === tg.channelId);
      if (r && r !== first) await setOverride(viewer, tg.id, { title: r.title.slice(0, 300) || null, body: r.body || null });
    }
    await requestApproval(viewer, postId, id(input.approverId), null);
    refresh(p.id);
    revalidatePath("/publish");
    return { postId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send it for approval" };
  }
}
