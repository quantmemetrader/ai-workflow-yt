import "server-only";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, captions, files, folders, timelineItems, videoClips, videoGraphics, videoProjects } from "@/lib/db/schema";
import { putFileConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { downloadObject, inheritProjectAudience } from "@/lib/video/render";
import { localTake } from "@/lib/video/v2/cache";
import { toSrt } from "@/lib/video/service";
import { planDraft, type PlanInput, type ProbedMedia } from "@/lib/video/capcut/plan";
import { buildDraft, type DraftApp } from "@/lib/video/capcut/draft";
import { readme } from "@/lib/video/capcut/readme";
import { toFcpxml } from "@/lib/video/capcut/fcpxml";

/**
 * The `video.capcut` job: a project out of this app as a 剪映 / CapCut draft
 * folder, zipped with its media, plus an SRT per caption language and an
 * FCPXML for the editors that read one.
 *
 * A job rather than a request because it has to pull the footage out of the
 * store (a 600 MB take is normal here) and, for a short cut of a long take,
 * write the used stretches out as their own files; minutes on a slow link,
 * and a deploy in the middle must not lose it.
 *
 * It writes nothing to the project and no `video_exports` row: an export row
 * is a render, and everything downstream of one (covers, the publish copy,
 * the preview player, "changed since the last render") expects an MP4. The
 * zip is an ordinary file in the requester's home folder, the job's result
 * carries its id, and the editor reads the job.
 */

export type CapcutResult = { fileId: string; name: string; sizeBytes: number; durationMs: number; notes: string[] };

export type CapcutOptions = {
  /** 剪映专业版 or CapCut: decides the draft's platform stamp and top-level keys (`DraftApp`). */
  app: DraftApp;
  aspect: "16:9" | "9:16" | "1:1";
  /** The caption language that goes on the main subtitle track; the others go on their own tracks. */
  captionLanguage: string;
};

const SIZES = { "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 } } as const;

/** Handles either side of a used stretch, so a trim can still be opened out in 剪映. */
const HANDLE_MS = 3000;

export async function exportCapcut(input: {
  projectId: string;
  requestedBy: string | null;
  options: CapcutOptions;
  onProgress?: (fraction: number) => Promise<void> | void;
  /**
   * Where the zip goes. Default: into the file store as the requester's
   * file. The validation script passes a local directory instead, so a real
   * project can be exported for checking without writing a row or an object.
   */
  outDir?: string;
}): Promise<CapcutResult> {
  const progress = (f: number) => input.onProgress?.(Math.max(0, Math.min(1, f)));
  const [project] = await db.select().from(videoProjects).where(and(eq(videoProjects.id, input.projectId), isNull(videoProjects.deletedAt))).limit(1);
  if (!project) throw new Error("这个剪辑已经被删除了。");

  const work = await mkdtemp(path.join(tmpdir(), "aura-capcut-"));
  try {
    const rows = await loadRows(project.id);
    if (!rows.items.length) throw new Error("时间线上还没有内容，无法导出。");
    await progress(0.03);

    /* ---- every file the rows point at, on local disk, once each ---------- */
    const srcDir = path.join(work, "src");
    await mkdir(srcDir, { recursive: true });
    const local = new Map<string, string>();
    const wanted = new Map<string, { id: string; name: string; storageKey: string | null; sizeBytes: number | null; mime: string | null }>();
    for (const f of rows.files) wanted.set(f.id, f);
    let pulled = 0;
    for (const f of wanted.values()) {
      if (!f.storageKey) continue;
      /* Big footage goes through the director's take cache: the same 600 MB
         master is very often already on this box from the cut or the render. */
      const isVideo = /^video\//.test(f.mime ?? "") || /\.(mp4|mov|m4v|mkv|webm)$/i.test(f.name);
      const dest = isVideo
        ? await localTake({ id: f.id, name: f.name, storageKey: f.storageKey, sizeBytes: f.sizeBytes }, downloadObject)
        : await (async () => {
            const p = path.join(srcDir, `${f.id}${safeExt(f.name, f.mime)}`);
            await downloadObject(f.storageKey!, p);
            return p;
          })();
      local.set(f.id, dest);
      pulled += 1;
      await progress(0.03 + 0.42 * (pulled / Math.max(1, wanted.size)));
    }

    /* A file ffprobe cannot read (an SVG logo, a broken upload) is left out
       and named in the notes rather than failing the whole draft. */
    const probed = new Map<string, ProbedMedia>();
    const unreadable: string[] = [];
    for (const [id, p] of local) {
      const got = await probe(p).catch(() => null);
      if (got) probed.set(id, got);
      else unreadable.push(wanted.get(id)?.name ?? id);
    }

    /* ---- the plan: which file each segment uses, and where --------------- */
    const size = SIZES[input.options.aspect];
    const planInput: PlanInput = {
      title: project.title,
      width: size.w,
      height: size.h,
      accent: project.accent,
      captionLanguage: input.options.captionLanguage,
      items: rows.items,
      captions: rows.captions,
      graphics: rows.graphics,
      tracks: rows.tracks,
      clips: rows.clips,
      fileNames: new Map([...wanted.values()].map((f) => [f.id, f.name])),
      fileMimes: new Map([...wanted.values()].map((f) => [f.id, f.mime])),
      probed,
      handleMs: HANDLE_MS,
      face: faceOf(project.director),
    };
    const plan = planDraft(planInput);
    for (const name of unreadable) plan.notes.push(`「${name}」读取不了，没有导出。`);
    await progress(0.5);

    /* ---- the draft folder ------------------------------------------------- */
    const folderName = draftFolderName(project.title);
    const root = path.join(work, "out");
    const draftDir = path.join(root, folderName);
    await mkdir(path.join(draftDir, "materials"), { recursive: true });

    // Media: a whole file copied, or a used stretch written out as its own.
    let done = 0;
    for (const m of plan.media) {
      const dest = path.join(draftDir, m.rel);
      if (m.make.kind === "copy") {
        await copyFile(local.get(m.make.fileId)!, dest);
      } else if (m.make.kind === "window") {
        await ffmpeg(windowArgs(local.get(m.make.fileId)!, m.make.startMs, m.make.lengthMs, m.make.hasAudio, dest));
      } else {
        await ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=${size.w}x${size.h}`, "-frames:v", "1", "-y", dest]);
      }
      // A stretch is re-measured: the encoder ends on a frame, not on the millisecond asked for.
      if (m.make.kind === "window") {
        const p = await probe(dest);
        m.durationMs = Math.min(m.durationMs, p.durationMs || m.durationMs);
      }
      done += 1;
      await progress(0.5 + 0.35 * (done / Math.max(1, plan.media.length)));
    }

    const built = buildDraft({
      app: input.options.app,
      name: folderName,
      width: size.w,
      height: size.h,
      fps: 30,
      videos: plan.media.filter((m) => m.type === "video").map((m) => ({ key: m.key, rel: m.rel, name: m.name, kind: m.kind === "photo" ? "photo" : "video", durationMs: m.durationMs, width: m.width, height: m.height })),
      audios: plan.media.filter((m) => m.type === "audio").map((m) => ({ key: m.key, rel: m.rel, name: m.name, durationMs: m.durationMs })),
      tracks: plan.tracks,
      pathOf: materialPath,
    });
    const contentJson = JSON.stringify(built.content);
    /* The same bytes under every name a build is known to read: 剪映 up to
       5.9 and Windows 剪映 10 read `draft_content.json`; 剪映 6+ on the Mac
       and CapCut read `draft_info.json` (a folder holding only the old name
       opens there as "草稿内容已损坏", pyJianYingDraft #198); some CapCut
       Windows builds prefer `template-2.tmp` (capcut-cli's version notes). */
    for (const name of ["draft_info.json", "draft_content.json", "template-2.tmp"]) {
      await writeFile(path.join(draftDir, name), contentJson, "utf8");
    }
    await writeFile(path.join(draftDir, "draft_meta_info.json"), JSON.stringify(built.meta), "utf8");
    for (const rel of built.files) {
      if (!(await stat(path.join(draftDir, rel)).catch(() => null))) throw new Error(`capcut: ${rel} is referenced but was not written`);
    }

    /* ---- the fallbacks: SRT per language, FCPXML, and how to open it ----- */
    const extras = path.join(root, "备用文件");
    await mkdir(extras, { recursive: true });
    const languages = [...new Set(rows.captions.map((c) => c.language))];
    for (const lang of languages) {
      const lines = rows.captions.filter((c) => c.language === lang).sort((a, b) => a.startMs - b.startMs);
      await writeFile(path.join(extras, `字幕_${lang}.srt`), toSrt(lines.map((c) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, text: c.text, language: c.language }))), "utf8");
    }
    await writeFile(path.join(extras, "时间线.fcpxml"), toFcpxml({ title: project.title, width: size.w, height: size.h, plan, folderName }), "utf8");
    await writeFile(path.join(root, "使用说明.txt"), readme({ app: input.options.app, title: project.title, folderName, notes: plan.notes, languages }), "utf8");
    await progress(0.88);

    const zipName = `${project.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "video"} · ${input.options.app === "capcut" ? "CapCut 草稿" : "剪映草稿"}.zip`;
    const zipPath = path.join(work, "draft.zip");
    await zip(root, zipPath);
    const zipStat = await stat(zipPath);

    if (input.outDir) {
      await mkdir(input.outDir, { recursive: true });
      await copyFile(zipPath, path.join(input.outDir, "draft.zip"));
      return { fileId: "", name: zipName, sizeBytes: zipStat.size, durationMs: Math.round(built.durationUs / 1000), notes: plan.notes };
    }

    const ownerId = input.requestedBy ?? project.ownerId;
    if (!ownerId) throw new Error("This export has nobody to belong to");
    const [home] = await db
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(and(eq(folders.ownerId, ownerId), isNull(folders.parentId), eq(folders.name, "__home")))
      .limit(1);
    const fileId = newId("fil");
    const key = storageKey(project.tenantId, fileId, zipName);
    const stored = await putFileConfirmed(zipPath, key, "application/zip");
    await db.insert(files).values({
      id: fileId,
      tenantId: project.tenantId,
      folderId: home?.id ?? null,
      folderPath: home?.path ?? [],
      name: zipName,
      kind: "archive",
      mime: "application/zip",
      sizeBytes: zipStat.size,
      storageKey: key,
      checksum: stored.etag,
      // Marked as made here, the way a proxy is, so it is told apart from an upload.
      tags: ["capcut-draft"],
      ownerId,
      updatedBy: ownerId,
    });
    await grantOwner(ownerId, { type: "file", id: fileId });
    await inheritProjectAudience(project.id, fileId, ownerId).catch(() => {});
    await progress(1);
    return { fileId, name: zipName, sizeBytes: zipStat.size, durationMs: Math.round(built.durationUs / 1000), notes: plan.notes };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * How a material's path is written into the JSON.
 *
 * The draft names its files by absolute path, and where the person unzips
 * the folder is not known here. 剪映 writes files it keeps inside a draft as
 * `##_draftpath_placeholder_<id>_##/…` and substitutes the draft's own folder
 * when it opens it; that is what this writes, so the media resolve wherever
 * the folder lands. An install that does not substitute it shows the clips
 * as offline with a 重新链接 button, and pointing that at the `materials`
 * folder once links every clip (the readme says so).
 */
export function materialPath(rel: string): string {
  return `##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##/${rel}`;
}

/** The folder's name, which is what 剪映's draft list shows. */
export function draftFolderName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || "腾亚导出";
}

/* ------------------------------------------------------------ the rows */

async function loadRows(projectId: string) {
  const items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord));
  const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, projectId));
  const captionRows = await db.select().from(captions).where(eq(captions.projectId, projectId)).orderBy(asc(captions.startMs));
  const graphics = await db.select().from(videoGraphics).where(eq(videoGraphics.projectId, projectId)).orderBy(asc(videoGraphics.startMs), asc(videoGraphics.ord));
  const tracks = await db.select().from(audioTracks).where(and(eq(audioTracks.projectId, projectId), eq(audioTracks.state, "ready")));

  const clipById = new Map(clips.map((c) => [c.id, c]));
  const usedClipIds = new Set<string>();
  for (const i of items) if (i.kind === "clip" && i.clipId) usedClipIds.add(i.clipId);
  for (const g of graphics) {
    const id = String((g.options as Record<string, unknown> | null)?.clipId ?? "");
    if (g.kind === "broll" && id) usedClipIds.add(id);
  }
  const fileIds = new Set<string>();
  for (const id of usedClipIds) {
    const c = clipById.get(id);
    if (c) fileIds.add(c.fileId);
  }
  for (const g of graphics) if (g.fileId && !g.fileId.startsWith("local:")) fileIds.add(g.fileId);
  for (const t of tracks) if (t.fileId) fileIds.add(t.fileId);

  const fileRows = fileIds.size
    ? await db
        .select({ id: files.id, name: files.name, storageKey: files.storageKey, sizeBytes: files.sizeBytes, mime: files.mime })
        .from(files)
        .where(and(inArray(files.id, [...fileIds]), isNull(files.deletedAt)))
    : [];
  return {
    items,
    clips,
    captions: captionRows,
    graphics,
    tracks,
    files: fileRows.map((f) => ({ ...f, sizeBytes: f.sizeBytes === null ? null : Number(f.sizeBytes) })),
  };
}

/** Where the director found the face in its take, when it did: the centre a portrait crop of a landscape take keeps. */
function faceOf(director: unknown): { fileId: string; cx: number; cy: number } | null {
  const v2 = (director as { v2?: { render?: { fileId?: unknown }; renderHints?: { face?: { box?: number[] } } } } | null)?.v2;
  const face = v2?.renderHints?.face?.box;
  const fileId = v2?.render?.fileId;
  if (typeof fileId !== "string" || !Array.isArray(face) || face.length < 4 || face.some((n) => typeof n !== "number")) return null;
  return { fileId, cx: face[0] + face[2] / 2, cy: face[1] + face[3] / 2 };
}

/* ------------------------------------------------------------- media */

function safeExt(name: string, mime: string | null): string {
  const byMime: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac" };
  const fromName = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return byMime[(mime ?? "").split(";")[0].trim()] ?? (fromName || ".bin");
}

export function probe(file: string): Promise<ProbedMedia> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration:stream_tags=rotate:stream_side_data=rotation", "-of", "json", file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.stderr.on("data", (c) => {
      if (err.length < 2000) err += String(c);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffprobe could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe could not read ${path.basename(file)}: ${err.trim().slice(0, 300)}`));
      type Stream = { codec_type?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] };
      const parsed = JSON.parse(out || "{}") as { format?: { duration?: string }; streams?: Stream[] };
      const v = parsed.streams?.find((s) => s.codec_type === "video");
      const a = parsed.streams?.find((s) => s.codec_type === "audio");
      const rotation = Math.abs(Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0)) % 180;
      // A phone clip filmed upright is stored sideways with a rotation flag; 剪映 shows it upright.
      const [w, h] = rotation === 90 ? [v?.height ?? 0, v?.width ?? 0] : [v?.width ?? 0, v?.height ?? 0];
      const seconds = Number(parsed.format?.duration ?? v?.duration ?? a?.duration ?? 0);
      resolve({ hasVideo: Boolean(v), hasAudio: Boolean(a), width: w, height: h, durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0 });
    });
  });
}

/** One used stretch of a take as its own file: H.264 at a visually lossless quality, so it edits like the master. */
function windowArgs(source: string, startMs: number, lengthMs: number, hasAudio: boolean, dest: string): string[] {
  return [
    "-ss", (startMs / 1000).toFixed(3),
    "-i", source,
    "-t", (lengthMs / 1000).toFixed(3),
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags", "+faststart", "-y", dest,
  ];
}

function ffmpeg(args: string[]): Promise<void> {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats", ...args], 30 * 60_000);
}

/**
 * The folder zipped as it stands. Footage is stored, not deflated — it is
 * already compressed and deflating a gigabyte of H.264 costs minutes for a
 * fraction of a percent — and names are written as UTF-8 with the flag that
 * says so, which is what makes the Chinese folder name come out right in
 * macOS Archive Utility and Windows Explorer.
 */
function zip(dir: string, dest: string): Promise<void> {
  return run("zip", ["-r", "-q", "-X", "-UN=UTF8", "-n", ".mp4:.mov:.m4v:.mp3:.m4a:.aac:.png:.jpg:.jpeg:.webp:.gif", dest, "."], 30 * 60_000, dir);
}

function run(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], cwd, env: { ...process.env, LC_ALL: "C.UTF-8" } });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 4000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish within ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} could not start: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      // Stopped from outside (a deploy): the worker puts the job back as it was.
      else if ((cmd === "ffmpeg" && code === 255) || (code === null && signal)) reject(Object.assign(new Error(`${cmd} was stopped by a restart`), { interrupted: true }));
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 1000)}`));
    });
  });
}
