/**
 * Make a whole video from a brief, and check what came out.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/director-check.ts
 *
 * Uses footage already in the file store (the two NASA clips the zero-to-one
 * script uploads), builds a project, asks the director for the video, and
 * waits on the worker. Prints every step as the worker reports it.
 */
import { and, eq, isNull, desc } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { files, users, videoExports, videoGraphics, videoProjects, timelineItems, captions } from "../lib/db/schema";
import { viewerById } from "../lib/auth/viewer-by-id";
import { addClip, createProject, requestDirector } from "../lib/video/service";
import type { DirectorState } from "../lib/video/director";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { putObjectConfirmed, storageKey } from "../lib/storage/r2";
import { grantOwner } from "../lib/authz/rebac";
import { newId } from "../lib/ids";

const EMAIL = process.env.OWNER_EMAIL ?? "rahulsinghhh2312@gmail.com";
/* `--file <path>` uploads a local clip and cuts that instead of the NASA
   pair; `--aspect 9:16` picks the frame. Everything after them is the brief. */
const argv = process.argv.slice(2);
const fileAt = argv.indexOf("--file");
const LOCAL = fileAt >= 0 ? argv[fileAt + 1] : null;
const aspectAt = argv.indexOf("--aspect");
const ASPECT = aspectAt >= 0 ? argv[aspectAt + 1] : "16:9";
const paceAt = argv.indexOf("--pace");
const PACE = paceAt >= 0 ? argv[paceAt + 1] : "channel";
const words = argv.filter((_, i) => i !== fileAt && i !== fileAt + 1 && i !== aspectAt && i !== aspectAt + 1 && i !== paceAt && i !== paceAt + 1);
const BRIEF =
  words.join(" ") ||
  "Make a tight YouTube cut from the interview for 16:9. Open on a hook, put the speaker's name on as a lower third early, punch in on the strongest line, cut to the b-roll clip when what she says matches it, put a big number on screen if one is actually said, and end on an end card that says Follow for part two.";

async function main() {
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL)).limit(1);
  if (!owner) throw new Error(`no user ${EMAIL}`);
  const viewer = await viewerById(owner.id);
  if (!viewer) throw new Error("no viewer");

  let picked: { id: string; name: string }[];
  if (LOCAL) {
    const name = path.basename(LOCAL);
    const body = await readFile(LOCAL);
    const size = (await stat(LOCAL)).size;
    const id = newId("fil");
    const key = storageKey(viewer.tenantId, id, name);
    const stored = await putObjectConfirmed(key, body, "video/mp4");
    await db.insert(files).values({
      id,
      tenantId: viewer.tenantId,
      folderId: null,
      folderPath: [],
      name,
      kind: "video",
      mime: "video/mp4",
      sizeBytes: size,
      storageKey: key,
      checksum: stored.etag,
      ownerId: viewer.id,
      updatedBy: viewer.id,
    });
    await grantOwner(viewer.id, { type: "file", id });
    picked = [{ id, name }];
    console.log("uploaded", name, `${(size / 1e6).toFixed(1)}MB`);
  } else {
    const wanted = ["interview.mp4", "broll-40s.mp4"];
    const footage = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt));
    picked = wanted.map((n) => footage.find((f) => f.name === n)).filter((f): f is { id: string; name: string } => Boolean(f));
    if (picked.length !== 2) throw new Error(`need ${wanted.join(" and ")} in Files; run scripts/video-zero-to-one.mjs first`);
  }

  const projectId = await createProject(viewer, `Director check ${new Date().toISOString().slice(11, 16)}`, null);
  for (const f of picked) await addClip(viewer, projectId, f.id);
  console.log("project", projectId, "with", picked.map((p) => p.name).join(", "));

  const started = Date.now();
  await requestDirector(viewer, projectId, { brief: BRIEF, aspect: ASPECT, render: true, pace: PACE });
  console.log("queued. brief:", BRIEF);

  let lastNote = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const [row] = await db.select({ director: videoProjects.director, title: videoProjects.title }).from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
    const d = (row?.director ?? {}) as DirectorState;
    const note = `${d.state} · ${d.step ?? ""} · ${d.note ?? ""}`;
    if (note !== lastNote) {
      console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s]`, note);
      lastNote = note;
    }
    if (d.state === "done" || d.state === "failed") {
      console.log("\nresult:", JSON.stringify(d.result ?? d.error, null, 2));
      console.log("title:", row?.title);
      const items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId));
      const gfx = await db.select().from(videoGraphics).where(eq(videoGraphics.projectId, projectId)).orderBy(videoGraphics.startMs);
      const cues = await db.select().from(captions).where(eq(captions.projectId, projectId));
      console.log(`cuts ${items.length}, captions ${cues.length}, graphics:`);
      for (const g of gfx) console.log(`  ${(g.startMs / 1000).toFixed(1)}–${(g.endMs / 1000).toFixed(1)}s ${g.kind}: ${g.text}${g.sub ? " / " + g.sub : ""} ${JSON.stringify(g.options).slice(0, 90)}`);
      const [proj] = await db.select({ preset: videoProjects.captionPreset, accent: videoProjects.accent }).from(videoProjects).where(eq(videoProjects.id, projectId));
      console.log("look:", proj);
      const langs = await db.select({ language: captions.language }).from(captions).where(eq(captions.projectId, projectId));
      console.log("caption tracks:", [...new Set(langs.map((l) => l.language))].join(", "), "keywords on", cues.filter((c) => c.keywords?.length).length, "lines");
      const exps = await db.select().from(videoExports).where(eq(videoExports.projectId, projectId));
      for (const e of exps) console.log("export", e.state, e.fileId, e.durationMs, e.sizeBytes, e.error ?? "");
      break;
    }
    if (Date.now() - started > 45 * 60_000) throw new Error("gave up after 45 minutes");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
