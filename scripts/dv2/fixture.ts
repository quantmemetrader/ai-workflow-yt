/**
 * The director v2 fixture: one project's rows, read once, written to a file.
 *
 *   cd /home/ubuntu/wt/dv2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/fixture.ts [--project prj_…] [--out /tmp/dv2_lab/fixture/zhengliu.json] \
 *     [--raw /home/ubuntu/raw/zhengliu.mp4] [--whisper /tmp/dv2_lab/fixture/zhengliu.whisper.json]
 *
 * SELECT only. The seven workstreams and the lab read this file and never
 * the database: the brief, both caption tracks with their word timings, the
 * v1 timeline and graphics rows (the faults the grader must find are in
 * them), the bin's clips with their file ids, the raw take's path on the
 * box, and — when a whisper JSON of the raw take is beside it — the source-
 * time words, which is what the cut planner works on. Caption words are in
 * *timeline* time (the v1 cut); `sourceWords` are in *source* time; the
 * `timeline` pieces map one onto the other.
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, pool } from "../../lib/db/client";
import {
  captions,
  fileMeta,
  files,
  tenants,
  timelineItems,
  videoClips,
  videoExports,
  videoGraphics,
  videoProjects,
  workProjects,
} from "../../lib/db/schema";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PROJECT = arg("--project", "prj_01m3f0qxd4a841wxh22g93cdcx");
const OUT = arg("--out", "/tmp/dv2_lab/fixture/zhengliu.json");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const WHISPER = arg("--whisper", path.join(path.dirname(OUT), `${path.basename(OUT, ".json")}.whisper.json`));

async function exists(p: string): Promise<boolean> {
  return Boolean(await stat(p).catch(() => null));
}

async function main() {
  const [project] = await db.select().from(videoProjects).where(eq(videoProjects.id, PROJECT)).limit(1);
  if (!project) throw new Error(`no video project ${PROJECT}`);

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, project.tenantId))
    .limit(1);

  const [work] = await db
    .select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, scriptId: workProjects.scriptId })
    .from(workProjects)
    .where(eq(workProjects.videoProjectId, PROJECT))
    .limit(1);

  const clipRows = await db
    .select({ clip: videoClips, file: files })
    .from(videoClips)
    .leftJoin(files, eq(files.id, videoClips.fileId))
    .where(eq(videoClips.projectId, PROJECT))
    .orderBy(asc(videoClips.addedAt));

  const fileIds = clipRows.map((r) => r.clip.fileId);
  const metaRows = fileIds.length ? await db.select().from(fileMeta).where(inArray(fileMeta.fileId, fileIds)) : [];
  const metaByFile = new Map(metaRows.map((m) => [m.fileId, m.meta]));

  const timeline = await db.select().from(timelineItems).where(eq(timelineItems.projectId, PROJECT)).orderBy(asc(timelineItems.ord));

  const cueRows = await db
    .select()
    .from(captions)
    .where(eq(captions.projectId, PROJECT))
    .orderBy(asc(captions.language), asc(captions.startMs), asc(captions.ord));

  const graphicRows = await db
    .select({ g: videoGraphics, file: files })
    .from(videoGraphics)
    .leftJoin(files, eq(files.id, videoGraphics.fileId))
    .where(eq(videoGraphics.projectId, PROJECT))
    .orderBy(asc(videoGraphics.startMs), asc(videoGraphics.ord));

  const exportRows = await db
    .select({
      id: videoExports.id,
      state: videoExports.state,
      aspect: videoExports.aspect,
      fileId: videoExports.fileId,
      proxyFileId: videoExports.proxyFileId,
      durationMs: videoExports.durationMs,
      createdAt: videoExports.createdAt,
      finishedAt: videoExports.finishedAt,
    })
    .from(videoExports)
    .where(eq(videoExports.projectId, PROJECT))
    .orderBy(desc(videoExports.createdAt))
    .limit(3);

  /* The raw take: the first clip in the bin that is not a stock import is
     the studio's own footage. Its file row names it; the path is where the
     lab keeps a local copy of it. */
  const source = clipRows.find((r) => !/^stock\b/i.test(r.clip.label) && !/^stock\b/i.test(r.file?.name ?? "")) ?? clipRows[0];

  const director = (project.director ?? {}) as Record<string, unknown>;
  const { log: _log, ...directorSansLog } = director;
  void _log;

  const byLanguage: Record<string, unknown[]> = {};
  for (const c of cueRows) {
    (byLanguage[c.language] ??= []).push({
      id: c.id,
      ord: c.ord,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      keywords: c.keywords ?? [],
      words: c.words ?? null,
    });
  }

  let sourceWords: unknown = null;
  if (await exists(WHISPER)) {
    const raw = JSON.parse(await readFile(WHISPER, "utf8")) as {
      text?: string;
      languageCode?: string;
      languageProbability?: number;
      durationSecs?: number;
      words?: { text: string; start: number; end: number; type?: string }[];
    };
    sourceWords = {
      path: WHISPER,
      languageCode: raw.languageCode ?? null,
      languageProbability: raw.languageProbability ?? null,
      durationSecs: raw.durationSecs ?? null,
      text: raw.text ?? "",
      words: (raw.words ?? [])
        .filter((w) => (w.type ?? "word") === "word" && w.text?.trim())
        .map((w) => ({ text: w.text, start: w.start, end: w.end })),
    };
  } else {
    console.warn(`no whisper JSON at ${WHISPER}; the fixture carries caption words only`);
  }

  const fixture = {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      tenantId: project.tenantId,
      tenantName: tenant?.name ?? null,
      tenantSettings: tenant?.settings ?? {},
      workProjectId: work?.id ?? null,
      workProjectTitle: work?.title ?? null,
      channelId: work?.channelId ?? null,
      scriptId: project.scriptId ?? work?.scriptId ?? null,
      title: project.title,
      captionPreset: project.captionPreset,
      accent: project.accent,
      notes: project.notes,
      masterFileId: project.masterFileId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    brief: typeof director.brief === "string" ? director.brief : "",
    director: directorSansLog,
    source: source
      ? {
          path: RAW,
          pathExists: await exists(RAW),
          clipId: source.clip.id,
          fileId: source.clip.fileId,
          label: source.clip.label,
          name: source.file?.name ?? null,
          mime: source.file?.mime ?? null,
          storageKey: source.file?.storageKey ?? null,
          sizeBytes: source.file?.sizeBytes ?? null,
          durationMs: source.clip.durationMs ?? source.file?.durationMs ?? null,
          width: source.clip.width ?? source.file?.width ?? null,
          height: source.clip.height ?? source.file?.height ?? null,
          fileMeta: metaByFile.get(source.clip.fileId) ?? {},
        }
      : null,
    clips: clipRows.map((r) => ({
      id: r.clip.id,
      fileId: r.clip.fileId,
      label: r.clip.label,
      durationMs: r.clip.durationMs,
      width: r.clip.width,
      height: r.clip.height,
      peaksError: r.clip.peaksError,
      addedAt: r.clip.addedAt,
      file: r.file
        ? {
            name: r.file.name,
            mime: r.file.mime,
            kind: r.file.kind,
            storageKey: r.file.storageKey,
            sizeBytes: r.file.sizeBytes,
            durationMs: r.file.durationMs,
            width: r.file.width,
            height: r.file.height,
            posterKey: r.file.posterKey,
            tags: r.file.tags,
          }
        : null,
      fileMeta: metaByFile.get(r.clip.fileId) ?? {},
    })),
    timeline: timeline.map((t) => ({
      id: t.id,
      clipId: t.clipId,
      kind: t.kind,
      ord: t.ord,
      inMs: t.inMs,
      outMs: t.outMs,
      text: t.text,
      holdMs: t.holdMs,
      transition: t.transition,
      transitionMs: t.transitionMs,
      options: t.options,
    })),
    captions: byLanguage,
    graphics: graphicRows.map(({ g, file }) => ({
      id: g.id,
      kind: g.kind,
      text: g.text,
      sub: g.sub,
      startMs: g.startMs,
      endMs: g.endMs,
      ord: g.ord,
      fileId: g.fileId,
      icon: g.icon,
      placement: g.placement,
      scale: g.scale,
      options: g.options,
      file: file ? { name: file.name, mime: file.mime, storageKey: file.storageKey, width: file.width, height: file.height } : null,
    })),
    exports: exportRows,
    sourceWords,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fixture, null, 2));

  const cueCount = Object.entries(byLanguage)
    .map(([lang, rows]) => `${lang} ${rows.length}`)
    .join(", ");
  const wordCount = sourceWords ? (sourceWords as { words: unknown[] }).words.length : 0;
  console.log(
    [
      `wrote ${OUT}`,
      `project ${project.id} · ${project.title} · tenant ${project.tenantId}`,
      `brief ${fixture.brief.length} chars, clips ${clipRows.length}, timeline ${timeline.length} pieces, captions ${cueCount}, graphics ${graphicRows.length}, exports ${exportRows.length}`,
      `source ${fixture.source?.name ?? "?"} (${fixture.source?.durationMs ?? "?"} ms) at ${RAW}${fixture.source?.pathExists ? "" : " (missing on this box)"}`,
      `source words ${wordCount}${wordCount ? ` from ${WHISPER}` : ""}`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
