import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders, publishPosts, scriptBeats, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { viewerById } from "@/lib/auth/viewer-by-id";
import type { Viewer } from "@/lib/auth/types";
import { grantOwner } from "@/lib/authz/rebac";
import { presignDownload, putObject, storageKey } from "@/lib/storage/r2";
import { inheritProjectAudience } from "@/lib/video/render";
import { listProjectFiles, tagProjectFile } from "@/lib/projects/files";
import { agentViewer } from "@/lib/agents";
import { postMessage } from "@/lib/chat/service";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage } from "@/lib/ai/ledger";
import { humanize } from "@/lib/text/human";
import { toSimplified } from "@/lib/text/simplified";

/**
 * 封面: the cover a finished video is posted with (owner, 2 Oct: "better
 * thumbnails"). Three candidates per render, each a frame from the video
 * with a title over it, in the render's aspect; a 9:16 render also gets one
 * 16:9 for the platforms that want a wide one.
 *
 * Frames rather than generated pictures: a cover that shows the video's own
 * footage is honest, loads fast, and is what the studio's best-performing
 * posts look like. The title is what sells it, so 撰稿人 writes three, each
 * at most twelve characters and a different hook; the frames are picked by
 * ffmpeg's `thumbnail` filter, which skips black, blur and slates.
 *
 * One ffmpeg per candidate on the box (the worker, `video.cover`), never in
 * a request. The covers are filed with the project (role `cover`), so they
 * show on the 发布 step, download, and go out with the post as the video's
 * thumbnail on the platforms that take one.
 */

const TITLE_PROMPT = `你是工作室最会写封面标题的运营。给一条短视频写 3 个封面标题，每个最多 12 个汉字，分两行最好（用「|」标出换行位置，比如「三天回本|靠的不是人」）。

要求：
- 三个角度不同：一个说结果或数字，一个反常识，一个提问或悬念。
- 像真人写的，不像 AI：不用“揭秘、震惊、必看、重磅、颠覆”，不用感叹号堆砌，不用破折号。
- 只用口播稿里有的事实，不编数字。
- 一律简体中文。

只输出 JSON：{"titles":["...","...","..."]}`;

export type Cover = { fileId: string; title: string; aspect: string; width: number; height: number };

function run(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg took too long"));
    }, timeoutMs);
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim().split("\n").pop() || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * The face the title is set in: the Simplified Chinese Bold cut as one file
 * (the static OTF `scripts/fetch-cjk-font.sh` fetches for the renderer),
 * else the system's Noto Sans CJK SC by name. A fontconfig style in the
 * name ("…:style=Bold") cannot be passed: drawtext reads the colon as one of
 * its own options, and escaping it made fontconfig match a font with no
 * Chinese glyphs at all (boxes, 2 Oct).
 */
const FONT_FILES = [
  path.join(process.cwd(), "remotion/public/fonts/NotoSansCJKsc-Bold.otf"),
  path.join(process.cwd(), "remotion/public/fonts/NotoSansCJKsc-Black.otf"),
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
];
function fontArg(): string {
  const file = FONT_FILES.find((f) => existsSync(f));
  return file ? `fontfile='${file}'` : "font='Noto Sans CJK SC'";
}

/** Characters ffmpeg's drawtext would read as syntax. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

/** Two lines at most: at the 「|」 the writer marked, else at the middle of a long title. */
function lines(title: string): string[] {
  const t = title.replace(/\s+/g, "").slice(0, 17);
  if (t.includes("|")) return t.split("|").filter(Boolean).slice(0, 2);
  if (t.length <= 7) return [t];
  const cut = Math.ceil(t.length / 2);
  return [t.slice(0, cut), t.slice(cut)];
}

/** Three frames spread over the middle of the video, each the best of its three seconds. */
async function pickFrames(src: string, durationMs: number, dir: string): Promise<string[]> {
  const secs = Math.max(2, durationMs / 1000);
  const out: string[] = [];
  const spots = [0.2, 0.45, 0.7].map((f) => Math.max(0.5, Math.min(secs - 1, secs * f)));
  for (let i = 0; i < spots.length; i++) {
    const frame = path.join(dir, `frame-${i}.png`);
    try {
      await run(["-ss", spots[i].toFixed(2), "-t", "3", "-i", src, "-vf", "thumbnail=60", "-frames:v", "1", frame]);
      if ((await stat(frame)).size > 1000) out.push(frame);
    } catch (err) {
      console.warn("[cover] frame skipped:", err instanceof Error ? err.message : err);
    }
  }
  if (!out.length) {
    const frame = path.join(dir, "frame-first.png");
    await run(["-i", src, "-frames:v", "1", frame]);
    out.push(frame);
  }
  return out;
}

/**
 * One cover: the frame cropped to the aspect, a dark band over the lower
 * part, the title in white Noto Sans CJK SC Bold with a soft shadow, and a
 * short yellow bar above it.
 */
async function compose(frame: string, title: string, aspect: "9:16" | "16:9", out: string): Promise<{ width: number; height: number }> {
  const tall = aspect === "9:16";
  const W = tall ? 1080 : 1280;
  const H = tall ? 1920 : 720;
  const ls = lines(title);
  const longest = Math.max(...ls.map((l) => l.length));
  const size = tall ? (longest > 6 ? 118 : 136) : longest > 8 ? 76 : 92;
  const gap = Math.round(size * 1.18);
  const bottomPad = tall ? 300 : 56;
  /* The block of lines ends `bottomPad` above the bottom edge. */
  const baseY = H - bottomPad - size - (ls.length - 1) * gap;
  const text = ls
    .map((l, i) => `drawtext=${fontArg()}:text='${esc(l)}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${baseY + i * gap}:shadowcolor=black@0.55:shadowx=4:shadowy=5:borderw=2:bordercolor=black@0.25`)
    .join(",");
  const bandTop = baseY - Math.round(size * 0.9);
  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    `drawbox=x=0:y=${bandTop - 40}:w=iw:h=ih-${bandTop - 40}:color=black@0.42:t=fill`,
    `drawbox=x=(iw-120)/2:y=${bandTop - 18}:w=120:h=12:color=#ffcf33@1:t=fill`,
    text,
  ].join(",");
  await run(["-i", frame, "-vf", vf, "-frames:v", "1", "-q:v", "2", out]);
  return { width: W, height: H };
}

async function spokenText(scriptId: string | null): Promise<string> {
  if (!scriptId) return "";
  const rows = await db.select({ v: scriptBeats.voiceover }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  return rows.map((r) => r.v.trim()).filter(Boolean).join("\n").slice(0, 3500);
}

/** 撰稿人's three titles for the cover; the project's title alone when the model fails. */
async function coverTitles(tenantId: string, ownerId: string, projectTitle: string, spoken: string): Promise<string[]> {
  const fallback = [projectTitle.replace(/[：:].*$/, "").slice(0, 12)];
  try {
    const writer = await agentViewer(tenantId, "article", ownerId);
    await assertBudget(writer);
    const out = await complete({
      model: modelFor.agent("article") ?? modelFor.assistant(),
      temperature: 0.8,
      maxTokens: 400,
      user: writer.id,
      messages: [
        { role: "system", content: TITLE_PROMPT },
        { role: "user", content: `视频：《${projectTitle}》\n口播稿：\n${spoken || "（没有口播稿，按标题写）"}` },
      ],
    });
    await recordUsage({ viewer: writer, module: "publish", model: out.model, provider: out.provider ?? "openrouter", promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId }).catch(() => {});
    const json = /\{[\s\S]*\}/.exec(out.text.replace(/<think>[\s\S]*?<\/think>/g, ""))?.[0];
    const parsed = json ? (JSON.parse(json) as { titles?: unknown }) : {};
    const titles = (Array.isArray(parsed.titles) ? parsed.titles : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => humanize(toSimplified(t.trim())).replace(/[—–!！。]+$/g, "").slice(0, 17))
      .slice(0, 3);
    return titles.length ? titles : fallback;
  } catch (err) {
    console.warn("[cover] titles fell back to the project title:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Makes the covers for a finished render and files them with the project.
 * Once per render (`dedupeKey` on the job); 重做封面 on the 发布 step queues
 * it again with `again`, which replaces the earlier set.
 */
export async function makeCovers(exportId: string, opts: { again?: boolean } = {}): Promise<{ covers: Cover[]; why?: string }> {
  const [ex] = await db.select({ projectId: videoExports.projectId, fileId: videoExports.fileId, state: videoExports.state, aspect: videoExports.aspect, durationMs: videoExports.durationMs }).from(videoExports).where(eq(videoExports.id, exportId)).limit(1);
  if (!ex || ex.state !== "done" || !ex.fileId) return { covers: [], why: "no finished render" };
  const [vp] = await db.select({ tenantId: videoProjects.tenantId, scriptId: videoProjects.scriptId }).from(videoProjects).where(eq(videoProjects.id, ex.projectId)).limit(1);
  const [wp] = await db.select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, createdBy: workProjects.createdBy }).from(workProjects).where(and(eq(workProjects.videoProjectId, ex.projectId), isNull(workProjects.deletedAt))).limit(1);
  if (!vp || !wp?.createdBy) return { covers: [], why: "not in a project" };
  const [video] = await db.select({ key: files.storageKey, durationMs: files.durationMs }).from(files).where(eq(files.id, ex.fileId)).limit(1);
  if (!video?.key) return { covers: [], why: "the render has no file" };
  const owner = await viewerById(wp.createdBy);
  if (!owner) return { covers: [], why: "nobody to make them for" };
  if (!opts.again) {
    const have = (await listProjectFiles(owner, wp.id).catch(() => [])).filter((f) => f.role === "cover");
    if (have.length) return { covers: [], why: "the project already has covers" };
  }

  const aspect: "9:16" | "16:9" = ex.aspect === "9:16" ? "9:16" : "16:9";
  const dir = await mkdtemp(path.join(tmpdir(), "cover-"));
  try {
    const src = await presignDownload(video.key, { expiresIn: 3600 });
    const [frames, titles] = await Promise.all([
      pickFrames(src, ex.durationMs ?? video.durationMs ?? 30_000, dir),
      coverTitles(vp.tenantId, owner.id, wp.title, await spokenText(vp.scriptId)),
    ]);
    const [home] = await db.select({ id: folders.id, path: folders.path }).from(folders).where(and(eq(folders.ownerId, owner.id), isNull(folders.parentId), eq(folders.name, "__home"))).limit(1);

    const plan: { frame: string; title: string; aspect: "9:16" | "16:9" }[] = titles.map((title, i) => ({ frame: frames[i % frames.length], title, aspect }));
    if (aspect === "9:16") plan.push({ frame: frames[0], title: titles[0], aspect: "16:9" });

    const covers: Cover[] = [];
    for (let i = 0; i < plan.length; i++) {
      const { frame, title, aspect: a } = plan[i];
      const out = path.join(dir, `cover-${i}.jpg`);
      try {
        const size = await compose(frame, title, a, out);
        const bytes = await readFile(out);
        const fileId = newId("fil");
        const clean = title.replace("|", "");
        const name = `封面 ${i + 1} · ${clean} · ${a}.jpg`;
        const key = storageKey(vp.tenantId, fileId, name);
        await putObject(key, bytes, "image/jpeg");
        await db.insert(files).values({
          id: fileId,
          tenantId: vp.tenantId,
          folderId: home?.id ?? null,
          folderPath: home?.path ?? [],
          name,
          kind: "image",
          mime: "image/jpeg",
          sizeBytes: bytes.length,
          storageKey: key,
          checksum: `cover-${exportId}-${i}-${Date.now()}`,
          width: size.width,
          height: size.height,
          ownerId: owner.id,
          updatedBy: owner.id,
        });
        await grantOwner(owner.id, { type: "file", id: fileId });
        await inheritProjectAudience(ex.projectId, fileId, owner.id).catch(() => {});
        await tagProjectFile(owner, wp.id, fileId, "cover").catch(() => false);
        covers.push({ fileId, title: clean, aspect: a, ...size });
      } catch (err) {
        console.warn(`[cover] candidate ${i} failed:`, err instanceof Error ? err.message : err);
      }
    }
    if (!covers.length) return { covers, why: "no cover could be drawn" };

    /* A post already written for this render (撰稿人 may have been quicker) gets the first cover. */
    await db
      .update(publishPosts)
      .set({ coverFileId: covers[0].fileId })
      .where(and(eq(publishPosts.fileId, ex.fileId), isNull(publishPosts.coverFileId), isNull(publishPosts.deletedAt)))
      .catch(() => {});

    /* 剪辑师 says so in the project's chat. */
    try {
      const editor = await agentViewer(vp.tenantId, "video", owner.id);
      await postMessage(editor, wp.channelId, `《${wp.title}》的封面做好了 ${covers.length} 张：${[...new Set(covers.map((c) => c.title))].map((t) => `「${t}」`).join("、")}。在「发布」一步里选一张；不满意可以点「重做封面」。`, { agent: "video", covers: covers.map((c) => c.fileId) });
    } catch (err) {
      console.warn("[cover] could not tell the project:", err instanceof Error ? err.message : err);
    }
    return { covers };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A project's covers, newest first, as the 发布 step lists them. */
export async function coversFor(viewer: Viewer, workProjectId: string): Promise<Cover[]> {
  const rows = (await listProjectFiles(viewer, workProjectId).catch(() => [])).filter((f) => f.role === "cover");
  return rows
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((r) => {
      const m = /^封面 \d+ · (.+) · (9:16|16:9)\.jpg$/.exec(r.name);
      return { fileId: r.id, title: m?.[1] ?? r.name, aspect: m?.[2] ?? (r.width && r.height && r.height > r.width ? "9:16" : "16:9"), width: r.width ?? 0, height: r.height ?? 0 };
    });
}

/** The newest finished render of a video project, for 重做封面. */
export async function latestExportId(videoProjectId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: videoExports.id })
    .from(videoExports)
    .where(and(eq(videoExports.projectId, videoProjectId), eq(videoExports.state, "done"), sql`${videoExports.fileId} is not null`))
    .orderBy(sql`${videoExports.createdAt} desc`)
    .limit(1);
  return row?.id ?? null;
}
