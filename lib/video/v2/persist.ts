import type { Credits, CutReport } from "@/lib/video/v2/types";
import type { CutawaySpec, FramingSegment, LayoutPlan } from "@/lib/video/layout";

/**
 * Writing the design down: rows for the editor and the render, the run's
 * record on the project.
 *
 * Two halves. `toRows` is pure: a layout plan in, `video_graphics` rows
 * out, deterministic (ids come from the plan's own ids, so the same plan
 * twice writes the same rows). `persistDesign` and `translateCuesV2` are
 * the thin wrappers that touch the database, and they import it lazily so
 * the lab can load this module without `DATABASE_URL`.
 *
 * Rows are written so that *today's* renderer and editor keep working
 * before W4's templates and W5's compositor land: a cutaway is a `broll`
 * row with `options.clipId` and `sourceInMs` (what `render.ts` reads now)
 * plus the v2 keys beside them (`layout`, `cropX`, `runId`, `asset`,
 * `credit`, `still`); a sourced still is an `image` row with its `fileId`;
 * a snap push is a `punch` row as well as a framing segment; the v2 kinds
 * (`hook`, `counter`, …) carry their props in `options` and draw as a
 * centred line until the templates arrive. Every row that came from a
 * fetched asset carries `options.asset` (the record) and `options.credit`
 * (the editor's existing key), so the 素材来源 panel and the end card can
 * be rebuilt from the rows alone.
 *
 * The run's record goes in `video_projects.director` (jsonb, rewritten per
 * run, no migration): `cut` (W1's report), `assets[]`, `credits {line,
 * block}`, `v2 {framing, runs, stats, notesZh}`.
 */

export type GraphicRowInsert = {
  id: string;
  projectId: string;
  kind: string;
  text: string;
  sub?: string | null;
  startMs: number;
  endMs: number;
  ord: number;
  fileId?: string | null;
  icon?: string | null;
  placement: string;
  scale: number;
  options: Record<string, unknown>;
};

const V2_KINDS = new Set(["hook", "counter", "compare", "list", "entity", "chip", "headline", "term", "diagram", "stinger"]);

/** A stable row id from a plan id: `gfx_` + the plan id with the characters the id column is happy with. */
export function rowId(planId: string): string {
  return `gfx_v2_${planId.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 48)}`;
}

/**
 * The plan as `video_graphics` rows.
 *
 * `clipIds` maps an asset's file id to the bin clip the wrapper added for
 * it (each asset once); without one the cutaway row still carries the
 * file id and the renderer of the day skips it rather than failing.
 */
export function toRows(plan: LayoutPlan, projectId: string, clipIds: Map<string, string> = new Map()): GraphicRowInsert[] {
  const rows: GraphicRowInsert[] = [];
  const push = (row: Omit<GraphicRowInsert, "ord" | "projectId">) => rows.push({ ...row, projectId, ord: rows.length });

  for (const g of plan.graphics) {
    const p = g.props;
    const text = String(p.text ?? (Array.isArray(p.lines) ? (p.lines as string[]).join(" | ") : ""));
    const sub = p.sub !== undefined && p.sub !== null ? String(p.sub) : null;
    const placement = g.zone === "corner" ? (g.kind === "header" ? "top-left" : "top-right") : g.zone === "lower" ? (g.kind === "lower-third" ? "bottom-left" : "bottom-center") : "center";
    const options: Record<string, unknown> = { ...p, zone: g.zone, v2: V2_KINDS.has(g.kind) || undefined };
    delete options.text;
    delete options.sub;
    /* A logo or an article image rides as the row's file, so the render can fetch it the usual way. */
    const pictured = (p.logo ?? p.image) as { asset?: { fileId?: string; credit?: string } } | null | undefined;
    const fileId = pictured?.asset?.fileId ?? null;
    if (pictured?.asset) {
      options.asset = pictured.asset;
      options.credit = pictured.asset.credit ?? (pictured as { credit?: string }).credit ?? null;
    }
    push({ id: rowId(g.id), kind: g.kind, text: text.slice(0, 200), sub: sub ? sub.slice(0, 200) : null, startMs: g.startMs, endMs: g.endMs, fileId, icon: null, placement, scale: 30, options });
  }

  for (const c of plan.cutaways) push(cutawayRow(c, clipIds));

  for (const push_ of plan.pushes) {
    push({
      id: rowId(`punch:${push_.sentenceId}:${push_.startMs}`),
      kind: "punch",
      text: "punch in",
      startMs: push_.startMs,
      endMs: push_.endMs,
      placement: "center",
      scale: 30,
      options: { zoom: push_.to, snap: true, why: "金句" },
    });
  }
  return rows;
}

function cutawayRow(c: CutawaySpec, clipIds: Map<string, string>): Omit<GraphicRowInsert, "ord" | "projectId"> {
  const base = {
    startMs: c.startMs,
    endMs: c.endMs,
    placement: "full",
    options: {
      layout: c.layout,
      cropX: c.cropX,
      still: c.still,
      runId: c.runId ?? null,
      sourceInMs: c.sourceInMs,
      asset: c.asset,
      credit: c.credit,
      score: c.score,
      why: c.reasonZh.slice(0, 80),
      beatId: c.beatId,
      enter: c.still ? "zoom" : undefined,
    } as Record<string, unknown>,
  };
  if (c.still) {
    return { id: rowId(c.id), kind: "image", text: c.label.slice(0, 60), fileId: c.asset.fileId, icon: null, scale: 90, ...base };
  }
  const clipId = clipIds.get(c.asset.fileId) ?? null;
  return { id: rowId(c.id), kind: "broll", text: c.label.slice(0, 60), fileId: null, icon: null, scale: 34, ...base, options: { ...base.options, clipId, fileId: c.asset.fileId } };
}

/** What the run leaves on `video_projects.director` beside the state machine's own keys. */
export type DirectorV2Record = {
  cut?: CutReport | null;
  assets: Credits["assets"];
  credits: { line: string; block: string };
  v2: {
    version: 2;
    at: string;
    framing: FramingSegment[];
    runs: LayoutPlan["runs"];
    renderHints: LayoutPlan["renderHints"];
    stats: LayoutPlan["stats"];
    lint: { rule: string; atMs: number; detailZh: string }[];
    notesZh: string;
  };
};

export function directorRecord(plan: LayoutPlan, credits: Credits, cut: CutReport | null | undefined, lint: DirectorV2Record["v2"]["lint"], notesZh: string): DirectorV2Record {
  return {
    cut: cut ?? null,
    assets: credits.assets,
    credits: { line: credits.line, block: credits.block },
    v2: { version: 2, at: new Date().toISOString(), framing: plan.cutZooms, runs: plan.runs, renderHints: plan.renderHints, stats: plan.stats, lint, notesZh },
  };
}

/* ------------------------------------------------------------- IO wrappers */

/**
 * Write the rows and the record.
 *
 * One delete, one multi-row insert (chunked at 200 so a long video does
 * not build a statement the driver refuses), one update of the project's
 * director record merged over whatever the state machine has written.
 * The design replaces what the cut placed, as v1 does: a second lower
 * third on top of the first is not a design.
 */
export async function persistDesign(projectId: string, rows: GraphicRowInsert[], record: DirectorV2Record): Promise<void> {
  const [{ db }, { videoGraphics, videoProjects }, { eq, sql }] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/schema"), import("drizzle-orm")]);
  await db.delete(videoGraphics).where(eq(videoGraphics.projectId, projectId));
  for (let at = 0; at < rows.length; at += 200) {
    await db.insert(videoGraphics).values(rows.slice(at, at + 200));
  }
  await db
    .update(videoProjects)
    .set({ director: sql`coalesce(${videoProjects.director}, '{}'::jsonb) || ${JSON.stringify(record)}::jsonb`, updatedAt: new Date() })
    .where(eq(videoProjects.id, projectId));
}

export type TranslatedLine = { i: number; second: string; keywords: string[] };

/**
 * The second-language track and the keywords, written in three statements.
 *
 * v1 wrote 165 rows one at a time to Neon (about four minutes of the
 * eight). Here: one delete of the old second track, one multi-row insert
 * of the new one, one `UPDATE … FROM (VALUES …)` for the keywords. The
 * translation itself is the caller's (three batches in parallel, see
 * `director.ts`); this only writes.
 */
export async function writeTranslation(
  projectId: string,
  cues: { id: string; startMs: number; endMs: number; ord: number; text: string }[],
  other: string,
  lines: TranslatedLine[],
  newId: (prefix: "beat") => string,
): Promise<{ inserted: number; keyworded: number }> {
  const [{ db }, { captions }, { and, eq, sql }] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/schema"), import("drizzle-orm")]);
  await db.delete(captions).where(and(eq(captions.projectId, projectId), eq(captions.language, other)));

  const inserts = lines
    .filter((l) => l.second && cues[l.i])
    .map((l) => {
      const c = cues[l.i];
      return { id: newId("beat"), projectId, startMs: c.startMs, endMs: c.endMs, text: l.second, language: other, ord: c.ord };
    });
  for (let at = 0; at < inserts.length; at += 200) await db.insert(captions).values(inserts.slice(at, at + 200));

  const keyworded = lines.filter((l) => cues[l.i] && l.keywords.length);
  if (keyworded.length) {
    /*
     * One statement: UPDATE captions SET keywords = v.kw FROM (VALUES (id,
     * array[…]::text[]), …) v WHERE captions.id = v.id. Each keyword is its
     * own parameter inside an `array[]` constructor: a JavaScript array
     * given to the `sql` tag as one value is expanded to a tuple
     * (`($2, $3)::text[]`), which Postgres refuses.
     */
    const values = keyworded.map((l) => sql`(${cues[l.i].id}, array[${sql.join(l.keywords.map((k) => sql`${k}`), sql`, `)}]::text[])`);
    await db.execute(sql`update captions set keywords = v.kw from (values ${sql.join(values, sql`, `)}) as v(id, kw) where captions.id = v.id`);
  }
  return { inserted: inserts.length, keyworded: keyworded.length };
}
