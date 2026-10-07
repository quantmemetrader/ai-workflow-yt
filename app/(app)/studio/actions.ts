"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { enqueue } from "@/lib/jobs/queue";
import { cloneVoice, speakToFile, studioVoices, VIDEO_MODELS } from "@/lib/studio/service";

async function maker() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("video")) return null;
  return viewer;
}
const fail = (err: unknown, fallback: string) => ({ error: err instanceof Error ? err.message : fallback });

export async function studioVoicesAction() {
  const viewer = await maker();
  if (!viewer) return { error: "你没有视频模块的权限" };
  return studioVoices();
}

export async function speakAction(text: unknown, voiceId: unknown) {
  const viewer = await maker();
  if (!viewer) return { error: "你没有视频模块的权限" };
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { error: "先写下要读的文字" };
  if (t.length > 5000) return { error: "一次最多 5000 字，分几段生成" };
  if (typeof voiceId !== "string") return { error: "请选一个声音" };
  try {
    return await speakToFile(viewer, { text: t, voiceId });
  } catch (err) {
    return fail(err, "没生成成功，请再试一次");
  }
}

export async function cloneVoiceAction(name: unknown, fileIds: unknown) {
  const viewer = await maker();
  if (!viewer) return { error: "你没有视频模块的权限" };
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "给新声音起个名字" };
  const ids = Array.isArray(fileIds) ? fileIds.filter((x): x is string => typeof x === "string" && /^fil_[0-9a-z]+$/i.test(x)) : [];
  if (!ids.length) return { error: "先上传声音样本" };
  try {
    return await cloneVoice(viewer, { name: n, fileIds: ids });
  } catch (err) {
    return fail(err, "没克隆成功，请再试一次");
  }
}

export async function generateVideoAction(input: { prompt: unknown; model: unknown; aspect: unknown; seconds: unknown; imageFileId?: unknown }) {
  const viewer = await maker();
  if (!viewer) return { error: "你没有视频模块的权限" };
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < 4) return { error: "写一句画面描述：谁、在哪、在做什么、什么镜头" };
  if (!process.env.FAL_KEY) return { error: "还没有设置 fal.ai 密钥。管理员在「员工管理 › 渠道与凭据」里填上后就能生成。" };
  const model = VIDEO_MODELS.some((m) => m.id === input.model) ? (input.model as string) : VIDEO_MODELS[0].id;
  const aspect = input.aspect === "9:16" || input.aspect === "1:1" ? input.aspect : "16:9";
  const seconds = input.seconds === 10 || input.seconds === "10" ? 10 : 5;
  const imageFileId = typeof input.imageFileId === "string" && /^fil_[0-9a-z]+$/i.test(input.imageFileId) ? input.imageFileId : null;
  const job = await enqueue({ tenantId: viewer.tenantId, type: "media.generateVideo", module: "video", payload: { prompt, model, aspect, seconds, imageFileId }, createdBy: viewer.id, priority: 6 });
  return { jobId: job.id };
}

export async function studioJobsAction(jobIds: unknown) {
  const viewer = await maker();
  if (!viewer) return { error: "你没有视频模块的权限" };
  const ids = (Array.isArray(jobIds) ? jobIds : []).filter((x): x is string => typeof x === "string").slice(0, 20);
  if (!ids.length) return { jobs: [] };
  const rows = await db
    .select({ id: jobs.id, status: jobs.status, progress: jobs.progress, error: jobs.error, result: jobs.result })
    .from(jobs)
    .where(and(inArray(jobs.id, ids), eq(jobs.tenantId, viewer.tenantId), eq(jobs.createdBy, viewer.id)));
  return { jobs: rows.map((r) => ({ id: r.id, status: String(r.status), progress: Number(r.progress) || 0, error: r.error, result: r.result as { fileId?: string; name?: string } | null })) };
}
