import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  approvals,
  scriptBeats,
  scriptComments,
  scriptFolders,
  scriptSuggestions,
  relationTuples,
  scriptVersions,
  scripts,
  seriesCache,
  topics,
  users,
  workProjects,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { ProjectSource, SourceEvidence } from "@/lib/projects/topic";
import { scriptWriting } from "@/lib/script/writing";
import { grantOwner } from "@/lib/authz/rebac";
import type { Viewer } from "@/lib/auth/dal";
import { handOffToVideo } from "@/lib/agents/handoff";

/**
 * Script (spec §4.4).
 *
 * The module exists to produce one authorised version that Video can trust, so
 * three rules run through everything here:
 *
 *   1. **A locked script is immutable.** Once `lockedVersion` is set, the
 *      beats table stops being editable and every write path refuses. The
 *      version's `checksum` is what the approval record names, so "the
 *      approved script" is a thing that can be verified rather than asserted.
 *   2. **Duration is estimated, never invented.** `spokenSeconds` comes from a
 *      character-rate model that is stated on screen, and a beat marked
 *      natural sound contributes its own timing rather than a reading rate.
 *   3. **Suggestions carry their evidence.** A house-style note a writer
 *      cannot argue with is one they will stop reading.
 */

/* ------------------------------------------------------------- duration */

/**
 * How long a line takes to say.
 *
 * Two rates, because Cantonese and English are not spoken at the same speed
 * and a script written in both would otherwise be mis-timed in one of them.
 * The figures are conservative broadcast rates: 4.5 Chinese characters per
 * second, and 2.6 English words per second. Both are stated in the editor so
 * a writer knows what the number means rather than trusting it blindly.
 *
 * CJK characters are counted individually and everything else by whitespace
 * word, which is also how a mixed line comes out roughly right.
 */
export const CJK_PER_SECOND = 4.5;
export const WORDS_PER_SECOND = 2.6;

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/gu;

export function spokenSeconds(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  const rest = text.replace(CJK, " ");
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return cjk / CJK_PER_SECOND + words / WORDS_PER_SECOND;
}

export function wordCount(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  const words = text
    .replace(CJK, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return cjk + words;
}

/* ------------------------------------------------------------ reading it */

export type ScriptRow = typeof scripts.$inferSelect;
export type BeatRow = typeof scriptBeats.$inferSelect;

export type ScriptListItem = {
  id: string;
  title: string;
  status: ScriptRow["status"];
  version: number;
  folderId: string | null;
  targetChannel: string | null;
  aspect: string | null;
  ownerId: string | null;
  ownerName: string | null;
  /** The owner's own picture; null draws their default (`lib/avatars/default`). */
  ownerAvatar: string | null;
  updatedAt: Date;
  /** The project this script is the script of, when it is in one. */
  projectId: string | null;
  projectTitle: string | null;
  /** Where the project's topic came from ("晨报信号", "选题储备", a person's name). */
  sourceLabel: string | null;
  /** The backlog topic it was written from, when there is one. */
  topicTitle: string | null;
};

/**
 * The library (Script-Library).
 *
 * Scripts are tenant-wide for anyone holding the module, which is what the
 * artboard's "filtered to scripts you can read" line means today: the studio
 * writes together. Per-script sharing goes through the same ReBAC tuples the
 * Files module uses when it is asked for; until then the filter that matters
 * is the module entitlement, and it is checked by the caller.
 */
export async function listScripts(
  viewer: Viewer,
  opts: { folderId?: string | null; status?: ScriptRow["status"]; query?: string } = {},
): Promise<ScriptListItem[]> {
  const where = [eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)];
  if (opts.folderId !== undefined) {
    where.push(opts.folderId === null ? isNull(scripts.folderId) : eq(scripts.folderId, opts.folderId));
  }
  if (opts.status) where.push(eq(scripts.status, opts.status));
  if (opts.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    where.push(sql`(${scripts.title} ilike ${q} or coalesce(${scripts.titleLocal}, '') ilike ${q})`);
  }

  /* Loaded here rather than at the top: the projects service imports this
     one (`createScript`), and a cycle between the two is what
     `lib/script/writing.ts` also steers clear of. */
  const { projectsVisibleTo } = await import("@/lib/projects/service");
  const rows = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      titleLocal: scripts.titleLocal,
      status: scripts.status,
      version: scripts.version,
      folderId: scripts.folderId,
      targetChannel: scripts.targetChannel,
      aspect: scripts.aspect,
      ownerId: scripts.ownerId,
      ownerName: users.name,
      ownerNameLocal: users.nameLocal,
      ownerAvatar: users.avatarUrl,
      updatedAt: scripts.updatedAt,
      projectId: workProjects.id,
      projectTitle: workProjects.title,
      /* A person's own project is labelled with their name, which says
         nothing about where the topic came from; only the other kinds. */
      sourceLabel: sql<string | null>`case when (${workProjects.source} ->> 'kind') = 'person' then null else ${workProjects.source} ->> 'label' end`,
      topicName: topics.name,
      topicNameLocal: topics.nameLocal,
    })
    .from(scripts)
    .leftJoin(users, eq(users.id, scripts.ownerId))
    /* Where each script came from, so a row can say it: its project (and
       what that project's topic came from) and the backlog topic. Only a
       project this person may see: the script itself is the studio's, but a
       private project's name and id are its members' — outside it the row
       stays and simply names no project. */
    .leftJoin(workProjects, and(eq(workProjects.scriptId, scripts.id), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .leftJoin(topics, and(eq(topics.id, scripts.topicId), eq(topics.tenantId, scripts.tenantId)))
    .where(and(...where))
    .orderBy(desc(scripts.updatedAt), workProjects.createdAt)
    .limit(300);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* A script in two projects (the old picker allowed it) is still one row. */
  const seen = new Set<string>();
  const out: ScriptListItem[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      title: (zh && r.titleLocal) || r.title,
      status: r.status,
      version: r.version,
      folderId: r.folderId,
      targetChannel: r.targetChannel,
      aspect: r.aspect,
      ownerId: r.ownerId,
      ownerName: (zh && r.ownerNameLocal) || r.ownerName,
      ownerAvatar: r.ownerAvatar ?? null,
      updatedAt: r.updatedAt,
      projectId: r.projectId ?? null,
      projectTitle: r.projectTitle ?? null,
      sourceLabel: r.sourceLabel ?? null,
      topicTitle: (zh && r.topicNameLocal) || r.topicName || null,
    });
  }
  return out;
}

/** The counts above the library list: All / Briefs / Drafting / Awaiting / Locked. */
export async function libraryCounts(viewer: Viewer, folderId?: string | null) {
  const { rows } = await db.execute<{ status: string; n: string }>(sql`
    select status::text as status, count(*)::int as n
      from scripts
     where tenant_id = ${viewer.tenantId}
       and deleted_at is null
       ${folderId === undefined ? sql`` : folderId === null ? sql`and folder_id is null` : sql`and folder_id = ${folderId}`}
     group by 1
  `);

  const by: Record<string, number> = {};
  let all = 0;
  for (const r of rows) {
    by[r.status] = Number(r.n);
    all += Number(r.n);
  }
  return { all, brief: by.brief ?? 0, drafting: by.drafting ?? 0, awaiting: by.awaiting_approval ?? 0, locked: by.locked ?? 0 };
}

export async function listFolders(viewer: Viewer) {
  const { rows } = await db.execute<{ id: string; name: string; name_local: string | null; n: string }>(sql`
    select f.id, f.name, f.name_local, count(s.id)::int as n
      from script_folders f
      left join scripts s on s.folder_id = f.id and s.deleted_at is null
     where f.tenant_id = ${viewer.tenantId} and f.deleted_at is null
     group by f.id, f.name, f.name_local
     order by f.name asc
  `);
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return rows.map((r) => ({ id: r.id, name: (zh && r.name_local) || r.name, count: Number(r.n) }));
}

export type VersionRow = {
  id: string;
  versionNo: number;
  checksum: string;
  wordCount: number;
  spokenSeconds: number | null;
  conformance: number | null;
  guideVersion: string | null;
  readingLevel: string | null;
  mandatoryCovered: number;
  note: string | null;
  model: string | null;
  createdAt: Date;
  authorName: string | null;
  authorNameLocal: string | null;
};

export type SuggestionRow = typeof scriptSuggestions.$inferSelect;

export type ApprovalRow = {
  id: string;
  state: "requested" | "approved" | "rejected" | "withdrawn";
  versionNo: number | null;
  checksum: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  note: string | null;
  approverId: string | null;
  requestedBy: string;
  decidedBy: string | null;
};

export type ScriptCommentRow = {
  id: string;
  beatOrd: number | null;
  versionNo: number | null;
  body: string;
  createdAt: Date;
  resolvedAt: Date | null;
  /** Who wrote it, and their own picture, so it is drawn with their face. */
  authorId: string | null;
  authorName: string | null;
  authorNameLocal: string | null;
  authorAvatar: string | null;
};

/**
 * The topic a script is written from, for the Brief tab's card (the
 * artboard's "From the topic backlog" and "Research carried over") and the
 * folding strip above the Draft's beats.
 *
 * Built from the backlog topic (heat, the chart's points, who adopted it,
 * the headlines) and from the project's snapshot (why now, the hook, the
 * evidence rows with their own numbers), whichever of the two exist.
 */
export type ScriptTopic = {
  title: string;
  why: string | null;
  hook: string | null;
  angle: string | null;
  format: string | null;
  risk: string | null;
  strength: number | null;
  from: { kind: string; label: string; href: string | null };
  /** Backlog topics only: the chart's numbers. */
  heat: number | null;
  change14d: number | null;
  /** The chart's values, oldest first, for the sparkline. */
  points: number[];
  /** First and last day the chart covers ("2026-08-29"). */
  range: [string, string] | null;
  flagged: boolean;
  flagReason: string | null;
  adoptedAt: string | null;
  ownerName: string | null;
  dueDate: string | null;
  stage: string | null;
  evidence: SourceEvidence[];
  articles: { title: string; url: string; domain: string; at: string }[];
  project: { id: string; title: string } | null;
};

/** Everything the Brief, Draft, Versions and Approval tabs read. */
export type ScriptDetail = {
  script: ScriptRow;
  beats: BeatRow[];
  versions: VersionRow[];
  suggestions: SuggestionRow[];
  approvals: ApprovalRow[];
  comments: ScriptCommentRow[];
  /** With the id and own picture, so the owner is drawn with their face. */
  owner: { id: string; name: string; nameLocal: string | null; avatarUrl: string | null } | null;
  live: Measurement;
  locked: boolean;
  topic: ScriptTopic | null;
  /** 编剧 is writing a draft into it right now (started from the topic). */
  writing: boolean;
};

/** The topic card's data for one script (`ScriptTopic`), or null when it has none. */
export async function scriptTopic(viewer: Viewer, row: Pick<ScriptRow, "id" | "topicId" | "title">): Promise<{ topic: ScriptTopic | null; writing: boolean }> {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* The project the script was started for, when this person may see it.
     Its brief and its topic snapshot (why, hook, angle, evidence) are the
     project's, and a private project keeps them to its members even though
     the script's own words are the studio's. (Imported here, not at the
     top, for the reason `listScripts` gives.) */
  const { projectsVisibleTo } = await import("@/lib/projects/service");
  const [project] = await db
    .select({ id: workProjects.id, title: workProjects.title, brief: workProjects.brief, source: workProjects.source, topicId: workProjects.topicId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), eq(workProjects.scriptId, row.id), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .orderBy(asc(workProjects.createdAt))
    .limit(1);
  const src = (project?.source as ProjectSource | null) ?? null;
  const candidates = [row.topicId, project?.topicId, src?.topicId].filter((x): x is string => typeof x === "string" && x.length > 0);
  const [topic] = candidates.length
    ? await db
        .select({
          topic: topics,
          ownerName: users.name,
          ownerNameLocal: users.nameLocal,
          /* When it was adopted or kept: the choice itself, from the log the
             board writes. `updated_at` moves with every chart refresh. */
          chosenAt: sql<string | Date | null>`(select max(e.at) from topic_events e where e.topic_id = "topics"."id" and e.action in ('adopt', 'save'))`,
        })
        .from(topics)
        .leftJoin(users, eq(users.id, topics.ownerId))
        .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.id, candidates)))
        .limit(1)
    : [];
  if (!project && !topic) return { topic: null, writing: false };

  const [series] = topic
    ? await db
        .select({ points: seriesCache.points, articles: seriesCache.articles })
        .from(seriesCache)
        .where(and(eq(seriesCache.query, topic.topic.query), eq(seriesCache.window, "3m")))
        .limit(1)
    : [];
  const points = (series?.points ?? []).slice(-60);
  const t = topic?.topic;
  const brief = (project?.brief ?? "").replace(/@\S+/g, "").replace(/\[[A-Z]\d{1,2}\]\s*|（证据\d+）/g, "").trim();
  const card: ScriptTopic = {
    title: project?.title ?? ((zh && t?.nameLocal) || t?.name || row.title),
    why: src?.why ?? (t?.summary ? t.summary.slice(0, 300) : null) ?? (brief ? brief.split("\n")[0].slice(0, 300) : null),
    hook: src?.hook ?? null,
    angle: src?.angle ?? t?.angles?.[0] ?? null,
    format: src?.format ?? null,
    risk: src?.risk ?? (t?.flagged ? t.flagReason : null) ?? null,
    strength: typeof src?.strength === "number" ? src.strength : null,
    from: {
      kind: src?.kind ?? (t ? "backlog" : "person"),
      label: src?.label ?? (t ? (zh ? "选题储备" : "Topic backlog") : (zh ? "项目" : "Project")),
      href: project ? `/projects/${project.id}` : t ? "/research/backlog" : null,
    },
    /* A topic whose chart was never read (one just kept from an idea) has
       a heat of 0 that means "not measured"; the card then leads with
       where it came from rather than with a zero. */
    heat: t && (t.lastFetchedAt !== null || t.heat > 0) ? t.heat : null,
    change14d: t && (t.lastFetchedAt !== null || t.heat > 0) ? t.change14d : null,
    points: points.map((p) => p.v),
    range: points.length > 1 ? [points[0].d, points[points.length - 1].d] : null,
    flagged: t?.flagged ?? false,
    flagReason: t?.flagReason ?? null,
    adoptedAt: t && (t.status === "adopted" || t.status === "saved") ? new Date(topic?.chosenAt ?? t.createdAt).toISOString() : null,
    ownerName: topic ? (zh && topic.ownerNameLocal) || topic.ownerName || null : null,
    dueDate: t?.dueDate ?? null,
    stage: t?.stage ?? null,
    evidence: (src?.evidence ?? []).slice(0, 6),
    articles: (series?.articles ?? []).slice(0, 6),
    project: project ? { id: project.id, title: project.title } : null,
  };
  /* Writing by any live project on the script, not only the oldest one read
     above: the pulse and the flow panel answer the same way. */
  return { topic: card, writing: (await scriptWriting(viewer.tenantId, row.id)).writing };
}

/** One script with everything the Brief, Draft, Versions and Approval tabs need. */
export async function scriptDetail(viewer: Viewer, scriptId: string): Promise<ScriptDetail | null> {
  const [row] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);

  if (!row) return null;

  const [beats, versions, suggestions, approvalRows, comments, owner, about] = await Promise.all([
    db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord)),
    db
      .select({
        id: scriptVersions.id,
        versionNo: scriptVersions.versionNo,
        checksum: scriptVersions.checksum,
        wordCount: scriptVersions.wordCount,
        spokenSeconds: scriptVersions.spokenSeconds,
        conformance: scriptVersions.conformance,
        guideVersion: scriptVersions.guideVersion,
        readingLevel: scriptVersions.readingLevel,
        mandatoryCovered: scriptVersions.mandatoryCovered,
        note: scriptVersions.note,
        model: scriptVersions.model,
        createdAt: scriptVersions.createdAt,
        authorName: users.name,
        authorNameLocal: users.nameLocal,
      })
      .from(scriptVersions)
      .leftJoin(users, eq(users.id, scriptVersions.authorId))
      .where(eq(scriptVersions.scriptId, scriptId))
      .orderBy(desc(scriptVersions.versionNo)),
    db
      .select()
      .from(scriptSuggestions)
      .where(and(eq(scriptSuggestions.scriptId, scriptId), eq(scriptSuggestions.state, "open")))
      .orderBy(asc(scriptSuggestions.beatOrd)),
    db
      .select({
        id: approvals.id,
        state: approvals.state,
        versionNo: approvals.versionNo,
        checksum: approvals.checksum,
        requestedAt: approvals.requestedAt,
        decidedAt: approvals.decidedAt,
        note: approvals.note,
        approverId: approvals.approverId,
        requestedBy: approvals.requestedBy,
        decidedBy: approvals.decidedBy,
      })
      .from(approvals)
      .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId)))
      .orderBy(desc(approvals.requestedAt)),
    db
      .select({
        id: scriptComments.id,
        beatOrd: scriptComments.beatOrd,
        versionNo: scriptComments.versionNo,
        body: scriptComments.body,
        createdAt: scriptComments.createdAt,
        resolvedAt: scriptComments.resolvedAt,
        authorId: scriptComments.authorId,
        authorName: users.name,
        authorNameLocal: users.nameLocal,
        authorAvatar: users.avatarUrl,
      })
      .from(scriptComments)
      .leftJoin(users, eq(users.id, scriptComments.authorId))
      .where(eq(scriptComments.scriptId, scriptId))
      .orderBy(asc(scriptComments.createdAt)),
    row.ownerId
      ? db
          .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, avatarUrl: users.avatarUrl })
          .from(users)
          .where(eq(users.id, row.ownerId))
          .limit(1)
      : Promise.resolve([]),
    scriptTopic(viewer, row).catch((err) => {
      console.error("[script] the topic card could not be read", err);
      return { topic: null, writing: false };
    }),
  ]);

  return {
    script: row,
    beats,
    versions,
    suggestions,
    approvals: approvalRows,
    comments,
    owner: owner[0] ?? null,
    /** What the conformance sidebar shows for the draft as it stands now,
     * rather than for the last version written. */
    live: measure(beats, row),
    locked: row.lockedVersion !== null,
    topic: about.topic,
    writing: about.writing,
  };
}

/* ------------------------------------------------------------ measuring */

export type Measurement = {
  wordCount: number;
  spokenSeconds: number;
  targetSeconds: number | null;
  /** Signed difference from target, in seconds. Null when there is no target. */
  drift: number | null;
  /** Inside the brief's tolerance. Null when there is no target. */
  onTarget: boolean | null;
  beats: number;
};

/** Everything the editor's header and sidebar can say without a model call. */
export function measure(beats: Pick<BeatRow, "voiceover" | "naturalSound" | "spokenSeconds">[], script: Pick<ScriptRow, "targetSeconds" | "tolerancePercent">): Measurement {
  let seconds = 0;
  let words = 0;

  for (const b of beats) {
    words += wordCount(b.voiceover);
    // A beat the writer timed by hand wins over the estimate: they have seen
    // the footage and the model has not.
    if (b.spokenSeconds !== null) seconds += b.spokenSeconds;
    else if (!b.naturalSound) seconds += spokenSeconds(b.voiceover);
  }

  const target = script.targetSeconds;
  const drift = target === null ? null : seconds - target;
  const onTarget =
    target === null || drift === null ? null : Math.abs(drift) <= (target * script.tolerancePercent) / 100;

  return { wordCount: words, spokenSeconds: seconds, targetSeconds: target, drift, onTarget, beats: beats.length };
}

/* ------------------------------------------------------------- writing */

/** A brand-new script, from a brief. */
export async function createScript(
  viewer: Viewer,
  input: {
    title: string;
    folderId?: string | null;
    topicId?: string | null;
    angle?: string | null;
    targetChannel?: string | null;
    aspect?: string | null;
    targetSeconds?: number | null;
    language?: string | null;
    subtitleLanguage?: string | null;
    mandatoryPoints?: string[];
    sourceFileIds?: string[];
  },
) {
  const id = newId("scr");
  await db.insert(scripts).values({
    id,
    tenantId: viewer.tenantId,
    folderId: input.folderId ?? null,
    topicId: input.topicId ?? null,
    title: input.title.trim().slice(0, 300),
    angle: input.angle ?? null,
    targetChannel: input.targetChannel ?? null,
    aspect: input.aspect ?? null,
    targetSeconds: input.targetSeconds ?? null,
    language: input.language ?? null,
    subtitleLanguage: input.subtitleLanguage ?? null,
    mandatoryPoints: input.mandatoryPoints ?? [],
    sourceFileIds: input.sourceFileIds ?? [],
    ownerId: viewer.id,
    briefUpdatedBy: viewer.id,
    briefUpdatedAt: new Date(),
    status: "brief",
  });

  /* The writer owns it, as a relation rather than only as a column.
     `ownerId` says who made it; the tuple is what lets them share it, and what
     "Shared with me" reads. Files has worked this way from the start; scripts
     carried the column and not the tuple, which is why that scope returned
     nothing by construction. */
  await grantOwner(viewer.id, { type: "script", id });
  return id;
}

/**
 * Scripts somebody else has shared with this person.
 *
 * Read from the same `relation_tuples` the Files module uses, matched against
 * the viewer's subjects — themselves, their teams, and the tenant. Their own
 * scripts are excluded: "shared with me" that includes everything you wrote is
 * a list nobody can use.
 */
export async function sharedScriptIds(viewer: Viewer): Promise<string[]> {
  const rows = await db
    .select({ objectId: relationTuples.objectId })
    .from(relationTuples)
    .where(
      and(
        eq(relationTuples.objectType, "script"),
        inArray(relationTuples.subjectId, viewer.subjects),
        or(isNull(relationTuples.expiresAt), gt(relationTuples.expiresAt, new Date())),
      ),
    );
  return [...new Set(rows.map((r) => r.objectId))];
}

/**
 * The hand-off the Topic backlog board has been missing.
 *
 * The board's "hand to Script" has been marking topics ready and telling the
 * producer the module was not built. This is the other end of that wire: the
 * topic's own name, angle, channel and summary become a brief, and the topic
 * moves to `handed` so the board stops asking.
 */
export async function scriptFromTopic(viewer: Viewer, topicId: string) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)))
    .limit(1);

  if (!topic) return null;

  // A topic that has already been handed over keeps its script rather than
  // spawning a second one every time somebody presses the button.
  const [existing] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.topicId, topicId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (existing) return existing.id;

  const id = await createScript(viewer, {
    title: topic.name,
    topicId: topic.id,
    targetChannel: topic.targetChannel,
    angle: topic.angles[0] ?? null,
    // The topic's own summary and angles are the brief's starting point, and
    // the flag travels with it: a sensitive topic does not become safe by
    // being written up.
    mandatoryPoints: topic.angles.slice(0, 5),
  });

  if (topic.summary || topic.flagged) {
    await db
      .update(scripts)
      .set({ titleLocal: topic.nameLocal })
      .where(eq(scripts.id, id));
  }

  /* In Script now, so "Scripting" on the board; "Handed to Video" is for
     when the approved script goes to the edit. */
  await db
    .update(topics)
    .set({ stage: "scripting", updatedAt: new Date() })
    .where(and(eq(topics.id, topicId), inArray(topics.stage, ["adopted", "briefing"])));
  return id;
}

/** Guard for every write: a locked script is read-only. */
async function assertUnlocked(viewer: Viewer, scriptId: string): Promise<ScriptRow | null> {
  const [row] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!row || row.lockedVersion !== null) return null;
  return row;
}

/** Replaces the working draft's beats wholesale. The editor sends the beats it
 * has; anything missing from the list is gone. */
export async function saveBeats(
  viewer: Viewer,
  scriptId: string,
  beats: { visual: string; voiceover: string; subtitle: string; naturalSound?: boolean; spokenSeconds?: number | null }[],
) {
  const script = await assertUnlocked(viewer, scriptId);
  if (!script) return null;

  const now = new Date();
  let running = 0;

  const rows = beats.slice(0, 200).map((b, i) => {
    const start = Math.round(running);
    const seconds = b.spokenSeconds ?? (b.naturalSound ? null : spokenSeconds(b.voiceover));
    running += seconds ?? 0;
    return {
      id: newId("beat"),
      scriptId,
      ord: i,
      startSeconds: start,
      visual: b.visual.slice(0, 5000),
      voiceover: b.voiceover.slice(0, 20000),
      subtitle: b.subtitle.slice(0, 20000),
      naturalSound: b.naturalSound ?? false,
      spokenSeconds: seconds,
      updatedBy: viewer.id,
      updatedAt: now,
    };
  });

  await db.transaction(async (tx) => {
    await tx.delete(scriptBeats).where(eq(scriptBeats.scriptId, scriptId));
    if (rows.length) await tx.insert(scriptBeats).values(rows);
    await tx
      .update(scripts)
      .set({ updatedAt: now, ...(script.status === "brief" && rows.length ? { status: "drafting" as const } : {}) })
      .where(eq(scripts.id, scriptId));
  });

  return { beats: rows.length };
}

/** sha-256 over the beats, which is what an approval names. */
export function checksumOf(beats: { ord: number; visual: string; voiceover: string; subtitle: string; naturalSound: boolean }[]) {
  const canonical = beats
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((b) => [b.ord, b.naturalSound ? 1 : 0, b.visual, b.voiceover, b.subtitle].join("\x00"))
    .join("\x01");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Snapshots the working draft as a numbered version.
 *
 * Immutable from here: `beats` is JSON, and `checksum` is what the approval
 * record points at. Two people saving at once are serialised by taking the
 * next version number inside the transaction rather than reading it first.
 */
export async function cutVersion(
  viewer: Viewer,
  scriptId: string,
  opts: { note?: string | null; model?: string | null; conformance?: number | null; guideVersion?: string | null; readingLevel?: string | null } = {},
) {
  const script = await assertUnlocked(viewer, scriptId);
  if (!script) return null;

  return db.transaction(async (tx) => {
    const beats = await tx.select().from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
    if (!beats.length) return null;

    const snapshot = beats.map((b) => ({
      ord: b.ord,
      startSeconds: b.startSeconds,
      visual: b.visual,
      voiceover: b.voiceover,
      subtitle: b.subtitle,
      naturalSound: b.naturalSound,
    }));

    const m = measure(beats, script);
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(version_no), 0) + 1 as next from script_versions where script_id = ${scriptId}`,
    );
    const versionNo = Number(rows[0]?.next ?? 1);

    const id = newId("sv");
    await tx.insert(scriptVersions).values({
      id,
      scriptId,
      versionNo,
      beats: snapshot,
      checksum: checksumOf(snapshot),
      wordCount: m.wordCount,
      spokenSeconds: m.spokenSeconds,
      conformance: opts.conformance ?? null,
      guideVersion: opts.guideVersion ?? null,
      readingLevel: opts.readingLevel ?? null,
      mandatoryCovered: coveredCount(script.mandatoryPoints, beats),
      note: opts.note ?? null,
      authorId: viewer.id,
      model: opts.model ?? null,
    });

    await tx.update(scripts).set({ version: versionNo, updatedAt: new Date() }).where(eq(scripts.id, scriptId));
    return { id, versionNo };
  });
}

/** How many of the brief's mandatory points appear anywhere in the draft.
 * Substring matching on purpose: the point is to notice an omission, not to
 * grade the writer's phrasing. */
function coveredCount(points: string[], beats: Pick<BeatRow, "voiceover" | "subtitle" | "visual">[]): number {
  if (!points.length) return 0;
  const hay = beats.map((b) => `${b.voiceover}\n${b.subtitle}\n${b.visual}`).join("\n").toLowerCase();
  return points.filter((p) => p.trim() && hay.includes(p.trim().toLowerCase())).length;
}

/** Puts a version back in the editor. The old one is not destroyed; restoring
 * v3 over v4 means the next cut is v5. */
export async function restoreVersion(viewer: Viewer, scriptId: string, versionNo: number) {
  const script = await assertUnlocked(viewer, scriptId);
  if (!script) return null;

  const [version] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, versionNo)))
    .limit(1);
  if (!version) return null;

  return saveBeats(
    viewer,
    scriptId,
    version.beats.map((b) => ({
      visual: b.visual,
      voiceover: b.voiceover,
      subtitle: b.subtitle,
      naturalSound: b.naturalSound,
    })),
  );
}

/* ------------------------------------------------------------ approving */

/** Asks a named person to approve the current version. Cuts one first if the
 * draft has moved on since the last. */
export async function requestApproval(viewer: Viewer, scriptId: string, approverId: string, note?: string) {
  const script = await assertUnlocked(viewer, scriptId);
  if (!script) return null;

  const cut = await cutVersion(viewer, scriptId, { note: note ?? null });
  const [latest] = await db
    .select({ versionNo: scriptVersions.versionNo, checksum: scriptVersions.checksum })
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, scriptId))
    .orderBy(desc(scriptVersions.versionNo))
    .limit(1);
  if (!latest) return null;

  // An earlier request on this script is superseded rather than left open, so
  // an approver never has two versions of the same script waiting.
  await db
    .update(approvals)
    .set({ state: "withdrawn", decidedAt: new Date(), decidedBy: viewer.id })
    .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "requested")));

  const id = newId("apr");
  await db.insert(approvals).values({
    id,
    tenantId: viewer.tenantId,
    objectType: "script",
    objectId: scriptId,
    checksum: latest.checksum,
    versionNo: latest.versionNo,
    requestedBy: viewer.id,
    approverId,
    note: note ?? null,
  });

  await db.update(scripts).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(scripts.id, scriptId));
  return { approvalId: id, versionNo: cut?.versionNo ?? latest.versionNo };
}

/**
 * Approve and lock, or send back.
 *
 * Two rules the spec is explicit about (§4.4):
 *   — the approver must not be the author of the version being approved;
 *   — approving locks *that* version, by checksum, so a later edit cannot
 *     inherit the approval.
 */
export async function decideApproval(
  viewer: Viewer,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string,
) {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.tenantId, viewer.tenantId), eq(approvals.state, "requested")))
    .limit(1);
  if (!row || row.objectType !== "script") return { error: "That approval is not waiting." };

  const [version] = await db
    .select({ authorId: scriptVersions.authorId, checksum: scriptVersions.checksum, versionNo: scriptVersions.versionNo })
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, row.objectId), eq(scriptVersions.versionNo, row.versionNo ?? -1)))
    .limit(1);
  if (!version) return { error: "The version this approval names no longer exists." };

  if (version.authorId === viewer.id) {
    return { error: "A version cannot be approved by the person who wrote it." };
  }
  if (version.checksum !== row.checksum) {
    return { error: "This version has changed since approval was requested. Ask for it again." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(approvals)
      .set({ state: decision, decidedBy: viewer.id, decidedAt: new Date(), note: note ?? row.note })
      .where(eq(approvals.id, approvalId));

    await tx
      .update(scripts)
      .set(
        decision === "approved"
          ? { status: "locked" as const, lockedVersion: version.versionNo, updatedAt: new Date() }
          : { status: "drafting" as const, updatedAt: new Date() },
      )
      .where(eq(scripts.id, row.objectId));
  });

  /* The hand-off to the Video agent. After the commit, because an approval is
     the record and the hand-off is what follows from it: a chat or project
     write failing must never un-approve a script somebody signed off. */
  if (decision === "approved") {
    await handOffToVideo(viewer, row.objectId, version.versionNo, approvalId).catch((err) =>
      console.error("[script] hand-off to video failed", err),
    );
  }

  return { ok: true, versionNo: version.versionNo, locked: decision === "approved" };
}

/** Unlocks a script so it can be worked on again. Deliberately explicit: it
 * clears the lock *and* the approval, because an unlocked script is no longer
 * the thing anybody approved. */
export async function unlock(viewer: Viewer, scriptId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(scripts)
      .set({ status: "drafting", lockedVersion: null, updatedAt: new Date() })
      .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)));
    await tx
      .update(approvals)
      .set({ state: "withdrawn", decidedBy: viewer.id, decidedAt: new Date() })
      .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "approved")));
  });
  return { ok: true };
}

/** The locked version, which is the only thing Video is ever handed. */
export async function lockedVersion(viewer: Viewer, scriptId: string) {
  const [row] = await db
    .select({ lockedVersion: scripts.lockedVersion })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row?.lockedVersion) return null;

  const [version] = await db
    .select()
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, row.lockedVersion)))
    .limit(1);
  return version ?? null;
}

/** Approvals waiting on this person, for the rail badge and the library's
 * "Waiting on approval" filter. */
export async function pendingApprovals(viewer: Viewer) {
  return db
    .select({
      id: approvals.id,
      objectId: approvals.objectId,
      versionNo: approvals.versionNo,
      requestedAt: approvals.requestedAt,
      title: scripts.title,
      requesterName: users.name,
    })
    .from(approvals)
    .innerJoin(scripts, eq(scripts.id, approvals.objectId))
    .leftJoin(users, eq(users.id, approvals.requestedBy))
    .where(
      and(
        eq(approvals.tenantId, viewer.tenantId),
        eq(approvals.objectType, "script"),
        eq(approvals.state, "requested"),
        eq(approvals.approverId, viewer.id),
      ),
    )
    .orderBy(asc(approvals.requestedAt));
}

/* ---------------------------------------------------------- suggestions */

export async function actOnSuggestion(
  viewer: Viewer,
  suggestionId: string,
  action: "accepted" | "rejected" | "moved",
) {
  const [s] = await db
    .select()
    .from(scriptSuggestions)
    .innerJoin(scripts, eq(scripts.id, scriptSuggestions.scriptId))
    .where(and(eq(scriptSuggestions.id, suggestionId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!s) return { error: "Not allowed" };
  if (s.scripts.lockedVersion !== null) return { error: "That script is locked." };

  const sug = s.script_suggestions;

  // Accepting is the only one that touches the words, and only when the
  // suggestion actually proposes a replacement.
  if (action === "accepted" && sug.before && sug.after && sug.beatOrd !== null) {
    const [beat] = await db
      .select()
      .from(scriptBeats)
      .where(and(eq(scriptBeats.scriptId, sug.scriptId), eq(scriptBeats.ord, sug.beatOrd)))
      .limit(1);

    if (beat) {
      const apply = (text: string) => (text.includes(sug.before!) ? text.replace(sug.before!, sug.after!) : text);
      const voiceover = apply(beat.voiceover);
      const subtitle = apply(beat.subtitle);
      const visual = apply(beat.visual);
      await db
        .update(scriptBeats)
        .set({
          voiceover,
          subtitle,
          visual,
          spokenSeconds: beat.naturalSound ? beat.spokenSeconds : spokenSeconds(voiceover),
          updatedBy: viewer.id,
          updatedAt: new Date(),
        })
        .where(eq(scriptBeats.id, beat.id));
    }
  }

  await db
    .update(scriptSuggestions)
    .set({ state: action, actedBy: viewer.id, actedAt: new Date() })
    .where(eq(scriptSuggestions.id, suggestionId));

  return { ok: true };
}

/** Replaces this script's open suggestions with a fresh set. Called after the
 * conformance pass runs; a stale suggestion against words that have since
 * changed is worse than none. */
export async function replaceSuggestions(
  scriptId: string,
  items: {
    beatOrd: number | null;
    kind: typeof scriptSuggestions.$inferInsert.kind;
    label: string;
    before?: string | null;
    after?: string | null;
    rationale?: string | null;
  }[],
  model: string,
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(scriptSuggestions)
      .where(and(eq(scriptSuggestions.scriptId, scriptId), eq(scriptSuggestions.state, "open")));
    if (!items.length) return;
    await tx.insert(scriptSuggestions).values(
      items.slice(0, 50).map((s) => ({
        id: newId("sug"),
        scriptId,
        beatOrd: s.beatOrd,
        kind: s.kind,
        label: s.label.slice(0, 120),
        before: s.before ?? null,
        after: s.after ?? null,
        rationale: s.rationale ?? null,
        model,
      })),
    );
  });
}

/** The people who can be asked to approve: anyone in the studio but the
 * requester, since a version cannot be approved by its own author. */
export async function possibleApprovers(viewer: Viewer) {
  return db
    .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, avatarUrl: users.avatarUrl })
    .from(users)
    .where(
      and(
        eq(users.tenantId, viewer.tenantId),
        eq(users.status, "active"),
        sql`${users.role} in ('owner','admin','member')`,
        sql`${users.id} <> ${viewer.id}`,
      ),
    )
    .orderBy(asc(users.name));
}

/** Folders, for the library rail. */
export async function createFolder(viewer: Viewer, name: string) {
  const id = newId("fld");
  await db.insert(scriptFolders).values({
    id,
    tenantId: viewer.tenantId,
    name: name.trim().slice(0, 120),
    ownerId: viewer.id,
  });
  return id;
}

/** Bulk read for the editor's "Jump to a script" rail, grouped by status. */
export async function jumpList(viewer: Viewer, folderId: string | null) {
  const rows = await listScripts(viewer, { folderId: folderId ?? undefined });
  const groups: Record<string, ScriptListItem[]> = { drafting: [], awaiting_approval: [], brief: [], locked: [] };
  for (const r of rows) (groups[r.status] ??= []).push(r);
  return groups;
}

/** Everything a caller needs to know whether a script id is theirs. */
export async function ownScript(viewer: Viewer, scriptId: unknown): Promise<string | null> {
  if (typeof scriptId !== "string" || !scriptId || scriptId.length > 64) return null;
  const [row] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

export async function addComment(viewer: Viewer, scriptId: string, body: string, beatOrd: number | null) {
  const [script] = await db
    .select({ version: scripts.version })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return null;

  const id = newId("cmt");
  await db.insert(scriptComments).values({
    id,
    scriptId,
    beatOrd,
    versionNo: script.version,
    authorId: viewer.id,
    body: body.trim().slice(0, 5000),
  });
  return id;
}

/** Soft delete, matching the Files module's own behaviour. */
export async function removeScript(viewer: Viewer, scriptId: string) {
  await db
    .update(scripts)
    .set({ deletedAt: new Date() })
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)));
  return { ok: true };
}
