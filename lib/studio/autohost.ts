import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, settings } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { workProjectDetail } from "@/lib/projects/service";
import { oneGo } from "@/lib/projects/one-go";
import { addClip } from "@/lib/video/service";
import { talkingHost } from "@/lib/studio/service";
import { scriptWriting } from "@/lib/script/writing";

/**
 * AI 自动生成 (10 Oct): a finished reel from the script alone, nothing filmed
 * for it. The script is read in the host's cloned voice, her face is made to
 * say it (one clip of her, looped forward and back if the script is longer),
 * that take goes into the project's bin as its footage, and the same
 * director that cuts filmed takes cuts this one: silences, punch-ins, b-roll
 * and generated stills over the talking, captions, render.
 */
const HOST_SETTING = "studio.host";

export type HostDefault = { fileId: string; name: string; kind: "image" | "video" } | null;

export async function hostDefault(): Promise<HostDefault> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, HOST_SETTING)).limit(1);
  const v = row?.value as { fileId?: string; name?: string; kind?: string } | null;
  return v?.fileId ? { fileId: v.fileId, name: v.name ?? "", kind: v.kind === "image" ? "image" : "video" } : null;
}

export async function rememberHost(viewer: Viewer, host: NonNullable<HostDefault>): Promise<void> {
  await db
    .insert(settings)
    .values({ key: HOST_SETTING, value: host, updatedBy: viewer.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: host, updatedBy: viewer.id, updatedAt: new Date() } });
}

export async function autoHostVideo(
  viewer: Viewer,
  input: { projectId: string; hostFileId: string; voiceId: string; engine: string | null; aspect: "9:16" | "16:9" | "1:1" },
  onProgress: (f: number, stage: string) => void = () => {},
): Promise<{ takeFileId: string; videoProjectId: string; way: string }> {
  const p = await workProjectDetail(viewer, input.projectId, true, 1);
  if (!p?.video) throw new Error("找不到这个项目");
  if (!p.script) throw new Error("这个项目还没有脚本，先写好脚本");
  /* A project started a moment ago: 文案 is still writing the first draft. Wait for it (up to eight minutes). */
  const t0 = Date.now();
  while ((await scriptWriting(viewer.tenantId, p.script.id)).writing) {
    onProgress(0.01, "等文案写稿");
    if (Date.now() - t0 > 8 * 60_000) throw new Error("文案的初稿等了 8 分钟还没好，稍后再试");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const beats = await db
    .select({ voiceover: scriptBeats.voiceover, naturalSound: scriptBeats.naturalSound })
    .from(scriptBeats)
    .where(eq(scriptBeats.scriptId, p.script.id))
    .orderBy(asc(scriptBeats.ord));
  const text = beats
    .filter((b) => !b.naturalSound && b.voiceover.trim())
    .map((b) => b.voiceover.trim())
    .join("\n\n");
  if (text.length < 10) throw new Error("脚本里还没有口播文字");
  if (text.length > 4800) throw new Error(`脚本有 ${text.length} 字，一次最多 4800 字；先精简，或分成两条视频`);

  onProgress(0.03, "配音");
  const take = await talkingHost(viewer, { hostFileId: input.hostFileId, text, voiceId: input.voiceId, engine: input.engine }, (f) => onProgress(0.03 + f * 0.62, f < 0.1 ? "配音" : "对口型"));

  onProgress(0.68, "放进素材箱");
  await addClip(viewer, p.video.id, take.fileId);

  onProgress(0.72, "交给剪辑师");
  const res = await oneGo(viewer, input.projectId, { narrate: "off", aspect: input.aspect, prompt: p.brief ?? undefined });
  if (!res.ok) throw new Error(res.error);
  onProgress(0.8, "剪辑和渲染中");
  return { takeFileId: take.fileId, videoProjectId: res.videoProjectId, way: res.way };
}
