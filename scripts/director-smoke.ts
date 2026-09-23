/**
 * The director, end to end, on a short clip — so a change to the pipeline
 * can be checked in a couple of minutes instead of the six a full take costs.
 *
 * Cuts 75s out of a stored master, puts it through the real upload path,
 * makes a project, drops the clip in and asks for the video, exactly as the
 * screen would. Prints the project id; watch logs/worker.log for the stages.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server \
 *     --import tsx scripts/director-smoke.ts <userId> <sourceFileId> [startSec] [lengthSec]
 */
import { createWriteStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { beginUpload, completeUpload } from "@/lib/files/service";
import { presignUpload, presignDownload } from "@/lib/storage/r2";
import { createProject, addClip, requestDirector } from "@/lib/video/service";

const BRIEF = `做成 Instagram Reels 那种快节奏竖版短片。每 2–4 秒换一次画面。讲到任何具体东西时整屏切到对应的图或空镜，说完立刻切回人像。超大号粗体中文字幕，关键词高亮，所有数字做满屏大数字。开头 3 秒最有冲击力的一句话做钩子。结尾片尾卡，底部「腾亚创变」水印。`;

function run(cmd: string, args: string[]) {
  return new Promise<void>((res, rej) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${code}: ${err.slice(-300)}`))));
  });
}

async function main() {
  const [userId, sourceFileId, startArg, lenArg] = process.argv.slice(2);
  if (!userId || !sourceFileId) throw new Error("usage: director-smoke.ts <userId> <sourceFileId> [startSec] [lengthSec]");
  const start = Number(startArg ?? 60), len = Number(lenArg ?? 75);

  const viewer = await viewerById(userId);
  if (!viewer) throw new Error(`no such user ${userId}`);
  const [src] = await db.select({ key: files.storageKey, name: files.name }).from(files).where(eq(files.id, sourceFileId)).limit(1);
  if (!src?.key) throw new Error(`no such file ${sourceFileId}`);

  // 1. the master, from R2 to disk — streamed, never held in memory
  const dl = await presignDownload(src.key);
  const url = typeof dl === "string" ? dl : (dl as { url: string }).url;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream("/tmp/smoke-src.mp4"));
  console.log(`  downloaded ${src.name}: ${((await stat("/tmp/smoke-src.mp4")).size / 1048576).toFixed(0)}MB`);

  // 2. a short piece, stream-copied so it takes a second
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(start), "-t", String(len), "-i", "/tmp/smoke-src.mp4", "-c", "copy", "-movflags", "+faststart", "/tmp/smoke-clip.mp4"]);
  const bytes = await readFile("/tmp/smoke-clip.mp4");
  console.log(`  clip: ${len}s from ${start}s, ${(bytes.byteLength / 1048576).toFixed(0)}MB`);

  // 3. through the real upload path
  const name = `烟雾测试 · ${len}s.mp4`;
  const { file, storageKey } = await beginUpload(viewer, { name, mime: "video/mp4", sizeBytes: bytes.byteLength });
  const up = await presignUpload(storageKey, "video/mp4");
  const put = await fetch(up.url, { method: "PUT", headers: up.headers, body: bytes });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
  await completeUpload(viewer, file.id, createHash("sha256").update(bytes).digest("hex"));
  console.log(`  uploaded as ${file.id}`);

  // 4. project, clip, director — the three things the screen does
  const created = await createProject(viewer, `烟雾测试 · ${len}s`, null);
  const projectId = typeof created === "string" ? created : (created as { id: string }).id;
  await addClip(viewer, projectId, file.id);
  await requestDirector(viewer, projectId, { brief: BRIEF, aspect: "9:16", render: true, pace: "hype" });
  console.log(`  director requested on ${projectId}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("  FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
