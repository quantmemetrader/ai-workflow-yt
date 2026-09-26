import "server-only";
import { execFile } from "node:child_process";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, files, timelineItems, videoClips, videoGraphics, videoProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/auth/dal";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { presignDownload } from "@/lib/storage/r2";
import { toSimplified } from "@/lib/text/simplified";
import { VIDEO_CRAFT } from "@/lib/video/craft";
import { canKaraoke } from "@/lib/video/ass";
import {
  intersect,
  intersectExact,
  mapTime,
  mapTimeNear,
  mergeRanges,
  silenceNear,
  speechFromSilences,
  speechRanges,
  subtract,
  type Range,
} from "@/lib/video/ranges";
import { clock, fitSentencesToBudget, fitToBudget, targetFromBrief, totalMs, type OptionalDrop } from "@/lib/video/length";
import { alignWords, hanCount, joinWords, toSentences, toWords } from "@/lib/video/sentences";
import { detectSilencesForFile } from "@/lib/video/silences";
import { briefPhrases, decideRetakes, fillHoles, findRetakes, toRetake, type RetakeDecision } from "@/lib/video/retakes";
import { transcribeLocal } from "@/lib/video/whisper";
import { directorV2ForTenant } from "@/lib/video/v2/flag";
import type { CutPiece, CutReport, Retake, Sentence, Silence, Word } from "@/lib/video/v2/types";

/**
 * Uploaded clips in, a cut video out.
 *
 * This is the thing the module was missing. Everything else — the bin, the
 * timeline, the captions, the graphics — is a place to do one piece of the job
 * by hand. This does the whole job once, badly enough to argue with, which is
 * what a first cut is for.
 *
 * The order matters and each step only uses what the one before it *measured*:
 *
 *   1. **Transcribe.** Already done by `transcribeProject` — Scribe gives word
 *      timings, which every later step depends on.
 *   2. **Cut the dead air.** Gaps between words, found in the timings, not
 *      guessed. This is most of what makes a raw take watchable and it needs
 *      no model at all.
 *   3. **Ask the model what it is about.** One call, given the transcript and
 *      the house rules: where the interesting parts are, what the title is,
 *      who is speaking, where the chapters fall.
 *   4. **Write it down.** Timeline items, captions with their word timings
 *      kept, and graphics.
 *
 * Nothing invents footage, a number, a name or a claim. The model is given the
 * transcript and is told — in `VIDEO_CRAFT`, which it gets in full — that
 * everything on screen has to come from what was actually said.
 *
 * **Director v2** (`lib/video/v2/flag.ts`, off by default) replaces steps 2
 * and 3 with `planCut` at the bottom of this file: retakes found by rule,
 * pauses cut at measured silences, the model choosing by *sentence id* over
 * a transcript with the retakes already gone, and a coverage audit that puts
 * back anything dropped without a reason. Flag off, this function runs the
 * v1 path byte for byte.
 */

/** What the model is asked for, and the only shape it may answer in. */
const PLAN_PROMPT = `You are cutting a first pass of a YouTube video from a transcript.

You are given the transcript with timings. Answer with a single JSON object and
nothing else. Do not explain your reasoning. The first character of your answer
must be an opening brace.

{
  "title": "the video's title, under 60 characters, from what is actually said",
  "hook": { "startMs": 0, "endMs": 0 },
  "keep": [ { "startMs": 0, "endMs": 0, "why": "five words" } ],
  "chapters": [ { "atMs": 0, "label": "two or three words" } ],
  "speaker": "the name of whoever is speaking, or null if it is never said",
  "drop": [ { "startMs": 0, "endMs": 0, "why": "five words" } ]
}

Rules:
 - Every millisecond figure must fall inside the transcript's own range.
 - "hook" is the single strongest fifteen seconds or less. It is what the video
   opens on, so it has to make sense with no setup before it.
 - "keep" is the rest of the video in order, after the hook, as ranges. Leave
   out repeated takes, long digressions and anything the speaker corrects.
 - "drop" is what you deliberately removed and why, so a person can disagree.
 - "chapters" only where the subject genuinely changes. Three or four at most,
   and none at all is a fine answer for a short video.
 - Never invent a name, a number or a claim. If the speaker is never named,
   "speaker" is null.
 - If the transcript is too thin to cut, return every field empty rather than
   inventing structure.
 - When you are given a target length, it is the brief, not a suggestion. Add
   up your own hook and keep ranges and make them come to about that. Selecting
   is the job: a plan that keeps four minutes of a four-minute take is not a
   cut, it is the take.`;

export type Plan = {
  title: string | null;
  hook: { startMs: number; endMs: number } | null;
  keep: { startMs: number; endMs: number; why: string }[];
  chapters: { atMs: number; label: string }[];
  speaker: string | null;
  drop: { startMs: number; endMs: number; why: string }[];
};

export type AutoEditResult = {
  cuts: number;
  captions: number;
  graphics: number;
  removedMs: number;
  /** What it took out and why, for the person who has to agree with it. */
  drop: { startMs: number; endMs: number; why: string }[];
  /** The length that was asked for, and what came out. Null when nobody
   *  asked, which is the right answer for a long-form interview. */
  targetMs: number | null;
  lengthMs: number;
  title: string | null;
  note: string | null;
  /** Director v2 only: the full cut report, for `director.cut`. */
  cut?: CutReport;
};

export async function autoEdit(
  viewer: Viewer,
  projectId: string,
  opts: { language?: string; brief?: string | null; targetMs?: number | null; sourcePath?: string | null } = {},
): Promise<AutoEditResult> {
  const [project] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId)))
    .limit(1);
  if (!project) throw new Error("That project does not exist");

  const language = opts.language ?? "zh-CN";
  const rows = await db
    .select()
    .from(captions)
    .where(and(eq(captions.projectId, projectId), eq(captions.language, language)))
    .orderBy(asc(captions.startMs));

  if (rows.length === 0) {
    throw new Error("Transcribe the cut first — everything here is built on what was actually said.");
  }

  const words = rows.flatMap((r) => r.words ?? []);
  if (words.length === 0) {
    throw new Error(
      "These captions carry no word timings, so there is nothing to cut against. Run the transcription again.",
    );
  }

  /*
   * Where every cut currently sits on the timeline.
   *
   * This used to take the first clip in the bin and treat every kept range as
   * a position *inside that one clip*. With one clip on the timeline that is
   * the same thing; with two it is not, and it wrote cuts that began after the
   * end of the footage — which failed at render with "could not measure
   * seg-009.mp4" and no way to see why from the screen.
   */
  const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, projectId));
  if (clips.length === 0) throw new Error("There is no footage in the bin");
  const clipById = new Map(clips.map((c) => [c.id, c]));

  const existing = await db
    .select()
    .from(timelineItems)
    .where(eq(timelineItems.projectId, projectId))
    .orderBy(asc(timelineItems.ord));
  if (existing.length === 0) throw new Error("There is nothing on the timeline to cut");

  const placed = existing.reduce<
    { item: (typeof existing)[number]; atMs: number; lengthMs: number }[]
  >((acc, item) => {
    const clip = item.clipId ? clipById.get(item.clipId) : undefined;
    const outMs = item.outMs ?? clip?.durationMs ?? item.inMs + item.holdMs;
    const lengthMs =
      item.kind === "title" ? Math.max(1, item.holdMs) : Math.max(1, outMs - item.inMs);
    const previous = acc[acc.length - 1];
    acc.push({ item, atMs: previous ? previous.atMs + previous.lengthMs : 0, lengthMs });
    return acc;
  }, []);

  const lastMs = Math.round(words[words.length - 1].end * 1000);

  /*
   * How long this is supposed to be.
   *
   * The caller's number wins; otherwise it is whatever the producer wrote in
   * the brief ("45 到 58 秒", "2 to 3 minutes"). No number anywhere means no
   * budget — a long-form interview should not be trimmed because nobody said
   * not to. This was the gap: the brief said under a minute, nothing read it,
   * and the first pass came back at 2:53.
   */
  const targetMs = opts.targetMs ?? targetFromBrief(opts.brief);

  /*
   * Director v2 needs one take on the timeline: its silences are measured on
   * the source file and its sentences are in source time. A timeline built
   * from several clips (the assembled projects of one-go) stays on v1 until
   * Stage 3 moves those onto the media adapter.
   */
  const clipIds = new Set(placed.filter((p) => p.item.kind !== "title").map((p) => p.item.clipId ?? ""));
  const v2 = clipIds.size === 1 && !clipIds.has("") && (await directorV2ForTenant(viewer.tenantId));

  let plan: Plan = { title: null, hook: null, keep: [], chapters: [], speaker: null, drop: [] };
  let modelNote: string | null = null;
  let budgetNote: string | null = null;
  let cuts: Range[];
  let v2Report: CutReport | undefined;
  let v2Drops: AutoEditResult["drop"] = [];
  let plannedBy: string;

  if (v2) {
    /* ---- 1+2 (v2). the clean cut ---------------------------------------- */
    const clipId = [...clipIds][0];
    const clip = clipById.get(clipId);
    const [file] = clip?.fileId ? await db.select().from(files).where(eq(files.id, clip.fileId)).limit(1) : [];
    if (!file || !file.storageKey) throw new Error("The take's file is missing, so its silences cannot be measured");
    const storageKey = file.storageKey;

    const r = await cutV2({
      viewer,
      title: project.title,
      clipId,
      fileId: file.id,
      /* A local path when the caller has one (the director downloads the master
         for the render anyway); otherwise ffmpeg reads the presigned master. */
      source: opts.sourcePath ?? (await presignDownload(storageKey, { expiresIn: 1800 })),
      version: storageKey,
      localSource: Boolean(opts.sourcePath),
      languageCode: language.split("-")[0],
      words: placed.flatMap((p) =>
        p.item.kind === "title"
          ? []
          : words
              .filter((w) => w.start * 1000 >= p.atMs - 1 && w.end * 1000 <= p.atMs + p.lengthMs + 1)
              .map((w) => ({ text: w.text, startMs: Math.round(w.start * 1000 - p.atMs + p.item.inMs), endMs: Math.round(w.end * 1000 - p.atMs + p.item.inMs) })),
      ),
      brief: opts.brief ?? null,
      targetMs,
      totalMs: clip?.durationMs ?? null,
    });

    /* Source-time pieces back onto the timeline as it stands. */
    cuts = [];
    for (const piece of r.pieces) {
      for (const p of placed) {
        if (p.item.kind === "title" || p.item.clipId !== piece.clipId) continue;
        const from = Math.max(piece.inMs, p.item.inMs);
        const to = Math.min(piece.outMs, p.item.inMs + p.lengthMs);
        if (to - from < 120) continue;
        cuts.push({ startMs: p.atMs + (from - p.item.inMs), endMs: p.atMs + (to - p.item.inMs) });
      }
    }
    cuts = mergeRanges(cuts, 0);
    v2Report = r.report;
    v2Drops = r.drops;
    modelNote = r.note;
    plannedBy = "director-v2";
    plan = {
      title: r.title,
      hook: null,
      keep: [],
      chapters: r.chapters
        .map((c) => {
          const p = placed.find((x) => x.item.kind !== "title" && x.item.clipId === clipId && c.atMs >= x.item.inMs && c.atMs <= x.item.inMs + x.lengthMs);
          return p ? { atMs: p.atMs + (c.atMs - p.item.inMs), label: c.label } : null;
        })
        .filter((c): c is { atMs: number; label: string } => c !== null),
      speaker: r.speaker,
      drop: r.drops,
    };
  } else {
  /* ---- 1. the model's read of it ---------------------------------------- */

  const transcript = rows
    .map((r) => `[${Math.round(r.startMs / 1000)}s] ${r.text}`)
    .join("\n")
    .slice(0, 24_000);

  /*
   * The model is an improvement, not a dependency.
   *
   * Removing the dead air is arithmetic over measured word timings and is most
   * of what makes a raw take watchable. Choosing which parts are *interesting*
   * needs a model. Those are different jobs, and the first must not fail
   * because the second was slow — which is exactly what happened the first
   * time this ran: a free model took longer than the attempt timeout and the
   * whole cut failed, including the part that needed no model at all.
   *
   * So a model that times out, errors, or answers with nonsense leaves
   * `plan` empty, and the cut falls through to the silence trim with a line
   * saying so.
   */
  try {
    const out = await complete({
      model: modelFor.assistant(),
      temperature: 0.4,
      // Room for a reasoning model to think first; the thinking is discarded.
      maxTokens: 3000,
      messages: [
        { role: "system", content: `${VIDEO_CRAFT}\n\n---\n\n${PLAN_PROMPT}` },
        {
          role: "user",
          content: [
            `Project: ${project.title}`,
            `The cut runs to ${lastMs}ms.`,
            targetMs
              ? `Target length: about ${Math.round(targetMs / 1000)}s (${clock(targetMs)}). The source is ${clock(lastMs)}, so you are cutting it to roughly ${Math.round((100 * targetMs) / lastMs)}% of its length. Choose.`
              : "",
            opts.brief ? `\nWhat the producer asked for (follow it where the footage allows):\n${opts.brief.slice(0, 2000)}` : "",
            `\nTranscript:\n${transcript}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    await recordUsage({
      viewer,
      module: "video",
      provider: out.provider ?? "openrouter",
      model: out.model,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
      costMicros: out.costMicros,
      requestId: out.requestId,
    });

    plan = parsePlan(out.text, lastMs);
    if (plan.keep.length === 0 && plan.hook === null) {
      modelNote = "模型没有给出可用的剪辑方案，所以这一版只去掉了停顿——这已经是大部分工作。";
    }
  } catch (err) {
    modelNote = `模型暂时连不上（${err instanceof Error ? err.message.slice(0, 120) : "未知原因"}），所以这一版只去掉了停顿。再跑一次可以补上其余部分。`;
  }

  /* ---- 2. the cut ------------------------------------------------------- */

  /*
   * The model's ranges, bounded by measured speech.
   *
   * Left alone, a model returns round numbers — "keep 0 to 30000" — which cut
   * mid-word. Intersecting its ranges with the speech it can actually see
   * means the edit lands in silence even when the plan is approximate, and a
   * model that returns nothing usable falls back to the silence-trimmed take,
   * which is still better than the raw one.
   */
  const speech = mergeRanges(speechRanges(words));
  const wanted = plan.hook ? [plan.hook, ...plan.keep] : plan.keep;
  cuts = wanted.length ? intersect(wanted, speech) : speech;

  /*
   * The backstop.
   *
   * The model is told the budget and usually respects it. When it does not —
   * and with a long take it often does not — this cuts to time the way a
   * person would: the opening stays, the ending stays, the middle gives way.
   * Arithmetic over ranges, so unlike a second model call it cannot fail.
   */
  if (targetMs) {
    const before = totalMs(cuts);
    const fitted = fitToBudget(cuts[0] ?? null, cuts.slice(1), targetMs);
    if (fitted.dropped.length) {
      cuts = fitted.kept;
      budgetNote = `按简报的 ${clock(targetMs)} 剪：方案里有 ${clock(before)} 的内容，所以去掉了中间 ${fitted.dropped.length} 段，开头和结尾都保留了。`;
    } else if (fitted.overBy > 0) {
      budgetNote = `成片 ${clock(totalMs(cuts))}，简报要求 ${clock(targetMs)}。光开头和结尾就超了，所以没有删——请放宽时长或换素材。`;
    }
  }
  plannedBy = modelNote === null ? modelFor.assistant() : "silence only";
  }

  /* A kept range is a span of the *timeline*, and a span can straddle the join
     between two cuts — so each one becomes one new item per cut it covers,
     with the source in and out worked out from that cut's own in point. */
  const pieces: { source: (typeof existing)[number]; inMs: number; outMs: number }[] = [];
  /* v2's spans are already exact: two of them 120 ms apart are two spans with
     a shortened pause between, and merging them would put the pause back. */
  for (const span of v2 ? mergeRanges(cuts, 0) : mergeRanges(cuts)) {
    for (const p of placed) {
      const from = Math.max(span.startMs, p.atMs);
      const to = Math.min(span.endMs, p.atMs + p.lengthMs);
      if (to - from < 120) continue;
      pieces.push({
        source: p.item,
        inMs: p.item.inMs + (from - p.atMs),
        outMs: p.item.inMs + (to - p.atMs),
      });
    }
  }
  if (pieces.length === 0) throw new Error("that would leave nothing on the timeline");

  await db.delete(timelineItems).where(eq(timelineItems.projectId, projectId));

  const items = pieces.map((piece, i) => ({
    id: newId("shot"),
    projectId,
    kind: piece.source.kind,
    clipId: piece.source.clipId,
    ord: i * 10,
    inMs: Math.round(piece.inMs),
    outMs: Math.round(piece.outMs),
    text: piece.source.text,
    holdMs: piece.source.holdMs,
  }));
  if (items.length) await db.insert(timelineItems).values(items);

  const keptMs = cuts.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);

  /* ---- 3. captions, re-timed onto the cut ------------------------------- */

  /*
   * The captions were timed against the *source*, and the cut has removed
   * pieces of it, so every timing after the first removal is now wrong. Each
   * caption is moved to where its words ended up, and one that fell entirely
   * inside a removed piece is dropped along with it.
   */
  /*
   * A line lives or dies by its *words*, not by its endpoints.
   *
   * This used to map `startMs` and `endMs` and drop the line if either came
   * back null — and either comes back null whenever that instant fell inside a
   * trimmed silence, which for a line that begins just after a pause is most
   * of them. Whole sentences were disappearing from the cut with every word
   * still in it: the gaps the studio reported.
   *
   * Now the surviving words decide. If any of them are still on the timeline
   * the line stays, timed to the first and last of them, and its text is
   * rebuilt from exactly the words that are left so what is on screen is what
   * is heard. Only a line with nothing left goes.
   */
  const cjk = /[　-鿿豈-﫿]/.test(rows.map((r) => r.text).join(""));
  const join = (parts: string[]) => (cjk ? parts.join("") : parts.join(" ")).trim();

  const retimed = rows
    .map((r) => {
      const original = r.words ?? [];
      const words = original
        .map((w) => {
          /* v2 cuts inside measured silences, and whisper hangs a pause on
             the *start* of the word after it — so a word whose start sits in
             a trimmed pause but whose end is on the cut is a word that was
             kept, and it starts where the piece does. */
          const e = mapTime(w.end * 1000, cuts);
          const s = mapTime(w.start * 1000, cuts) ?? (v2 && e !== null ? mapTimeNear(w.start * 1000, cuts) : null);
          return s === null || e === null ? null : { start: s / 1000, end: e / 1000, text: w.text };
        })
        .filter((w): w is { start: number; end: number; text: string } => w !== null);

      if (original.length) {
        if (!words.length) return null;
        const startMs = Math.round(words[0].start * 1000);
        const endMs = Math.round(words[words.length - 1].end * 1000);
        if (endMs <= startMs) return null;
        // Only rewrite the text when the cut actually took words out of it;
        // an untouched line keeps its own punctuation and spacing.
        const text = words.length === original.length ? r.text : join(words.map((w) => w.text));
        return { id: r.id, startMs, endMs, words, text };
      }

      /* Typed by hand, so there are no word timings to go on. Snap both ends
         to the nearest surviving moment rather than dropping it. */
      const startMs = mapTimeNear(r.startMs, cuts);
      const endMs = mapTimeNear(r.endMs, cuts);
      if (startMs === null || endMs === null || endMs <= startMs) return null;
      return { id: r.id, startMs, endMs, words, text: r.text };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  for (const r of retimed) {
    await db
      .update(captions)
      .set({ startMs: r.startMs, endMs: r.endMs, words: r.words, text: r.text })
      .where(eq(captions.id, r.id));
  }
  // Anything whose words were all cut away has no place on the new timeline.
  const kept = new Set(retimed.map((r) => r.id));
  for (const r of rows) {
    if (!kept.has(r.id)) await db.delete(captions).where(eq(captions.id, r.id));
  }

  /* ---- 4. graphics ------------------------------------------------------ */

  await db.delete(videoGraphics).where(eq(videoGraphics.projectId, projectId));

  const graphics: (typeof videoGraphics.$inferInsert)[] = [];

  if (plan.speaker) {
    // Two seconds in, so it arrives after the viewer has seen the face rather
    // than over the first frame of it.
    graphics.push({
      id: newId("gfx"),
      projectId,
      kind: "lower-third",
      text: plan.speaker,
      sub: null,
      startMs: 2000,
      endMs: 6500,
      ord: 0,
    });
  }

  for (const [i, ch] of plan.chapters.slice(0, 4).entries()) {
    const at = mapTime(ch.atMs, cuts);
    if (at === null) continue;
    graphics.push({
      id: newId("gfx"),
      projectId,
      kind: "chapter",
      text: ch.label.slice(0, 60),
      sub: null,
      startMs: at,
      endMs: at + 2600,
      ord: i + 1,
    });
  }

  if (graphics.length) await db.insert(videoGraphics).values(graphics);

  /* ---- 5. the look ------------------------------------------------------ */

  /*
   * Word-by-word captions only where they are honest, which after a
   * transcription they are. A considered interview is still better served by
   * the whole-line preset, and that is a judgement the person makes — this
   * only picks the default that the timings support.
   */
  const preset = canKaraoke(retimed.map((r) => ({ ...r, text: "", words: r.words }))) ? "spoken" : "clean";

  await db
    .update(videoProjects)
    .set({
      captionPreset: preset,
      ...(plan.title && project.title.startsWith("Untitled") ? { title: plan.title.slice(0, 120) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(videoProjects.id, projectId));

  await audit(viewer, "video.autoedit", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
    // `plannedBy` rather than a model name: what matters in the log is whether
    // a person is looking at a model's judgement or at arithmetic.
    meta: {
      cuts: items.length,
      removedMs: lastMs - keptMs,
      targetMs,
      lengthMs: keptMs,
      plannedBy,
    },
  });

  return {
    cuts: items.length,
    captions: retimed.length,
    graphics: graphics.length,
    removedMs: Math.max(0, lastMs - keptMs),
    drop: v2 ? v2Drops.slice(0, 12) : plan.drop.slice(0, 8),
    title: plan.title,
    /* Both, when both happened: the model's excuse and the cut to time are
       different facts and a person needs to read the one that applies. */
    note: [modelNote, budgetNote].filter(Boolean).join(" ") || null,
    targetMs,
    lengthMs: keptMs,
    ...(v2Report ? { cut: v2Report } : {}),
  };
}

/* --------------------------------------------------------------- helpers */

/** The plan out of the answer, bounded, however the model wrapped it. */
function parsePlan(text: string, lastMs: number): Plan {
  const empty: Plan = { title: null, hook: null, keep: [], chapters: [], speaker: null, drop: [] };

  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const raw = candidate(fenced ? fenced[1] : body);
  if (!raw) return empty;

  const ms = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    // A model that answers in seconds is a model answering in seconds; past
    // the end of the cut it is answering in nothing, and is dropped.
    return n > lastMs ? null : Math.round(n);
  };

  const range = (v: unknown): { startMs: number; endMs: number } | null => {
    if (typeof v !== "object" || v === null) return null;
    const o = v as { startMs?: unknown; endMs?: unknown };
    const startMs = ms(o.startMs);
    const endMs = ms(o.endMs);
    return startMs !== null && endMs !== null && endMs > startMs ? { startMs, endMs } : null;
  };

  const o = raw as Record<string, unknown>;
  const why = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");

  return {
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 120) : null,
    hook: range(o.hook),
    keep: Array.isArray(o.keep)
      ? o.keep
          .map((k) => {
            const r = range(k);
            return r ? { ...r, why: why((k as { why?: unknown })?.why) } : null;
          })
          .filter((k): k is { startMs: number; endMs: number; why: string } => k !== null)
      : [],
    chapters: Array.isArray(o.chapters)
      ? o.chapters
          .map((c) => {
            const at = ms((c as { atMs?: unknown })?.atMs);
            const label = (c as { label?: unknown })?.label;
            return at !== null && typeof label === "string" && label.trim()
              ? { atMs: at, label: label.trim() }
              : null;
          })
          .filter((c): c is { atMs: number; label: string } => c !== null)
      : [],
    speaker: typeof o.speaker === "string" && o.speaker.trim() ? o.speaker.trim().slice(0, 80) : null,
    drop: Array.isArray(o.drop)
      ? o.drop
          .map((d) => {
            const r = range(d);
            return r ? { ...r, why: why((d as { why?: unknown })?.why) } : null;
          })
          .filter((d): d is { startMs: number; endMs: number; why: string } => d !== null)
      : [],
  };
}

/** The last complete `{…}` in a piece of text that looks like the plan. */
function candidate(text: string): Record<string, unknown> | null {
  for (let end = text.lastIndexOf("}"); end !== -1; end = text.lastIndexOf("}", end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") {
        depth--;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(i, end + 1)) as unknown;
            if (typeof value === "object" && value !== null && ("keep" in value || "hook" in value)) {
              return value as Record<string, unknown>;
            }
          } catch {
            // Not it; keep walking outwards.
          }
          break;
        }
      }
    }
  }
  return null;
}

/* ============================================================ director v2 */

/*
 * The v2 cut, in three layers:
 *
 *   - `planCut` (pure): sentences, silences, the retakes already decided and
 *     the model's parsed answer in; pieces and a `CutReport` out. The lab
 *     and W6's director call this directly.
 *   - `planMessagesV2` / `parsePlanV2` (pure): the one model call's prompt
 *     and its bounded answer.
 *   - `cutV2` (IO, below): measures silences, fills whisper's holes, finds
 *     retakes, asks the model twice at most (the ambiguous retakes; the
 *     plan), and calls `planCut`. `autoEdit` above uses it behind the flag.
 */

/**
 * What the v2 model call is asked for.
 *
 * Sentence ids, not milliseconds: the model has never been good at timings
 * (v1's round-second ranges cut mid-word) and does not need to be — the code
 * knows where every sentence starts and ends and where the silences are. It
 * sees the transcript with the retakes already removed, so it is not asked
 * to find them, and it is told that dropping is optional: a sentence it
 * cannot name a reason for stays. Chinese, because the takes are Chinese
 * and the reasons are shown to a Chinese-reading editor.
 */
export const PLAN_PROMPT_V2 = `你在给一条口播视频做粗剪。下面是按句子编号的完整文字稿（口误和重说已经删掉，停顿也会由程序自动去掉，你不用管这些）。

只回答一个 JSON 对象，不要解释，第一个字符必须是左花括号：

{
  "title": "视频标题，30 字以内，只用讲者说过的话；没有合适的就 null",
  "speaker": "讲者自报的姓名；没有说就 null",
  "coldOpen": "开场用哪一句的编号；照简报或就用第一句",
  "chapters": [ { "id": "s012", "label": "两到六个字" } ],
  "drop": [ { "id": "s034", "reason": "filler | off-topic | aside", "priority": 1, "why": "十个字以内" } ]
}

规则：
 - id 必须是稿子里出现的句子编号。
 - drop 是「可以删」的句子：filler 是空话（比如整句只是"对""好"这类过场）；off-topic 是跑题；aside 是打断论证的插话。
   priority 1 表示不删会影响观感，一定删；2 表示如果需要缩短时长可以删；3 表示还需要再缩短时才删。
 - 说不出理由的句子不要列，程序会把没有理由的删除恢复。含有简报点名的句子、数字、机构名的句子不要删。
 - 标了「重说后保留的一遍」的句子是口误重说后留下的干净版本，不是重复，不要删。
 - 不要为了凑时长删正文：时长超了，程序会报告，不会删句子。
 - chapters 只放在话题真正转折的地方，最多六个，短视频可以为空。
 - 不要编造姓名、数字或说法。`;

export type DropReason = "filler" | "off-topic" | "aside";

export type PlanV2 = {
  title: string | null;
  speaker: string | null;
  coldOpen: string | null;
  chapters: { id: string; label: string }[];
  drop: { id: string; reason: DropReason; priority: 1 | 2 | 3; why: string }[];
};

export const EMPTY_PLAN_V2: PlanV2 = { title: null, speaker: null, coldOpen: null, chapters: [], drop: [] };

/** The messages for the v2 plan call: the brief, the target and the transcript by sentence id with the retakes gone. */
export function planMessagesV2(input: {
  title: string;
  sentences: readonly Sentence[];
  retakes: readonly Retake[];
  brief: string | null;
  targetMs: number | null;
  totalMs: number;
}): { role: "system" | "user"; content: string }[] {
  const dropped = new Set(input.retakes.flatMap((r) => r.droppedSentenceIds));
  const kept = new Set(input.retakes.map((r) => r.keptSentenceId));
  const lines = input.sentences
    .filter((s) => !dropped.has(s.id))
    .map((s) => `${s.id} [${(s.startMs / 1000).toFixed(1)}s] ${sentenceTextAfterRetakes(s, input.retakes)}${kept.has(s.id) ? "　（重说后保留的一遍，不要删）" : ""}`)
    .join("\n")
    .slice(0, 30_000);
  return [
    { role: "system", content: `${VIDEO_CRAFT}\n\n---\n\n${PLAN_PROMPT_V2}` },
    {
      role: "user",
      content: [
        `项目：${input.title}`,
        `原片 ${clock(input.totalMs)}。`,
        input.targetMs ? `简报要求成片约 ${clock(input.targetMs)}；超出的话由程序报告，不要为此删句子。` : "",
        input.brief ? `\n制片的简报：\n${input.brief.slice(0, 2500)}` : "",
        `\n文字稿：\n${lines}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

/** A sentence's text with any part inside a retake's drop span left out. */
function sentenceTextAfterRetakes(s: Sentence, retakes: readonly Retake[]): string {
  const inDrop = (w: Word) => retakes.some((r) => (w.startMs + w.endMs) / 2 >= r.dropStartMs && (w.startMs + w.endMs) / 2 < r.dropEndMs);
  const kept = s.words.filter((w) => !inDrop(w));
  return kept.length === s.words.length ? s.text : joinWords(kept);
}

/** The v2 plan out of the answer, bounded to the ids it was given. */
export function parsePlanV2(text: string, ids: ReadonlySet<string>): PlanV2 {
  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const raw = fenced ? fenced[1] : body;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return EMPTY_PLAN_V2;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return EMPTY_PLAN_V2;
  }
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const id = (v: unknown) => (typeof v === "string" && ids.has(v.trim()) ? v.trim() : null);
  const reasons: DropReason[] = ["filler", "off-topic", "aside"];
  return {
    title: str(o.title, 120),
    speaker: str(o.speaker, 80),
    coldOpen: id(o.coldOpen),
    chapters: Array.isArray(o.chapters)
      ? o.chapters
          .map((c) => {
            const cid = id((c as { id?: unknown })?.id);
            const label = str((c as { label?: unknown })?.label, 60);
            return cid && label ? { id: cid, label } : null;
          })
          .filter((c): c is { id: string; label: string } => c !== null)
          .slice(0, 6)
      : [],
    drop: Array.isArray(o.drop)
      ? o.drop
          .map((d) => {
            const did = id((d as { id?: unknown })?.id);
            const reason = (d as { reason?: unknown })?.reason;
            const p = Number((d as { priority?: unknown })?.priority);
            if (!did || !reasons.includes(reason as DropReason)) return null;
            return {
              id: did,
              reason: reason as DropReason,
              priority: (p === 1 || p === 2 || p === 3 ? p : 2) as 1 | 2 | 3,
              why: str((d as { why?: unknown })?.why, 60) ?? "",
            };
          })
          .filter((d): d is PlanV2["drop"][number] => d !== null)
      : [],
  };
}

/*
 * What the brief pins down: quoted phrases, numbers, proper nouns.
 *
 * A sentence holding one of these is an anchor. It is never dropped for
 * length, never dropped on the model's say-so, and the evaluation expects
 * each quoted phrase in the cut exactly once. Numbers are matched as the
 * digits-and-unit string the brief wrote (154页, 1.51亿次); proper nouns as
 * the brief's spelling and — for Latin names whisper mangles — as any Latin
 * token of the same length within one letter, which is what a person
 * reading Anthrobic does. Only names of five letters or more get that
 * latitude: two edits on a three-letter name make FBI, API and AI one
 * another, and every sentence with an AI in it became an "anchor".
 */
export type BriefAnchors = { phrases: string[]; numbers: string[]; names: string[] };

const HAN_RUN = /\p{Script=Han}/u;
const NORMALISE = /[\p{P}\p{S}\s]/gu;
const norm = (s: string) => toSimplified(s).replace(NORMALISE, "").toLowerCase();

export function briefAnchors(brief: string | null | undefined): BriefAnchors {
  if (!brief) return { phrases: [], numbers: [], names: [] };
  const phrases = briefPhrases(brief);
  const numbers = new Set<string>();
  /* Not numbers: aspect ratios (9:16), colours (#d6e64f), durations in the format line (4.5-5 分钟, 2-3 秒). */
  const numberText = brief.replace(/#[0-9a-fA-F]{6}\b/g, " ").replace(/\d+:\d+/g, " ").replace(/\d+(?:\.\d+)?(?:\s*[-–—~到至]\s*\d+(?:\.\d+)?)?\s*(?:分钟|分|秒|s\b|min)/g, " ");
  for (const m of numberText.matchAll(/\d+(?:[.,]\d+)*(?:%|亿|万|千|百|多|页|次|条|个|倍|成|美金|美元|元)*/g)) {
    const t = norm(m[0]);
    if (t.length >= 2 && /\d/.test(t)) numbers.add(t);
  }
  const names = new Set<string>();
  /* Latin proper nouns (capitalised words of 3+ letters) anywhere; Han names
     only from the lists the brief labels as such (专有名词写法：…, 每提到一个
     机构、公司、产品…：…), split on the list punctuation, whole items only. */
  for (const m of brief.matchAll(/\b[A-Z][A-Za-z]{2,}\b/g)) names.add(m[0].toLowerCase());
  for (const line of brief.split("\n")) {
    const colon = line.search(/[：:]/);
    if (colon < 0 || !/专有名词|机构|公司|产品|人名|名字/.test(line.slice(0, colon))) continue;
    for (const item of line.slice(colon + 1).split(/[、，,。；;：:（）()《》「」【】\s|→=＝]+/)) {
      const t = item.trim();
      if (/^[\p{Script=Han}]{2,6}$/u.test(t)) names.add(t);
    }
  }
  return { phrases, numbers: [...numbers], names: [...names] };
}

/** Which anchors a normalised sentence text holds. */
export function anchorsIn(textIn: string, anchors: BriefAnchors): string[] {
  const t = norm(textIn);
  const hits: string[] = [];
  /* A long quoted phrase still counts when whisper misspelled a word of it
     (拒绝蒸留这条路是长期主义还是过于理想主义 for 拒绝蒸馏，是长期主义还是理想主义). */
  for (const p of anchors.phrases) {
    if (t.includes(p)) hits.push(p);
    else if (p.length >= 8 && t.length >= p.length * 0.6 && lcsChars(p, t) >= Math.ceil(p.length * 0.8)) hits.push(p);
  }
  for (const n of anchors.numbers) if (t.includes(n)) hits.push(n);
  const latin = t.match(/[a-z]{3,}/g) ?? [];
  for (const n of anchors.names) {
    if (HAN_RUN.test(n)) {
      if (t.includes(n)) hits.push(n);
    } else if (latin.some((w) => w === n || (n.length >= 5 && Math.abs(w.length - n.length) <= 1 && editDistance(w, n) <= 2))) {
      hits.push(n);
    }
  }
  return hits;
}

/** LCS length over characters; the spans here are a few dozen characters. */
function lcsChars(a: string, b: string): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export type PlanCutInput = {
  sentences: readonly Sentence[];
  /** Measured pauses ≥ 250 ms; what the sentences were split on. */
  silences: readonly Silence[];
  /** A finer list (≥ 80 ms) for snapping a cut into a gap between syllables when no pause is near; `silences` when absent. */
  fineSilences?: readonly Silence[];
  words: readonly Word[];
  brief: string | null;
  targetMs: number | null;
  retakes: readonly Retake[];
  plan?: PlanV2 | null;
  /** The take's length; the last word's end when absent. */
  totalMs?: number | null;
  options?: Partial<typeof CUT_DEFAULTS>;
};

export const CUT_DEFAULTS = {
  /** A pause at least this long is shortened. */
  minPause: 300,
  /** To this. */
  trimTo: 120,
  /** At a sentence end, to this. */
  endTrimTo: 200,
  /** Quiet kept after the last vowel before every cut. */
  guard: 60,
  /** How far a take's edge may move to reach a measured pause. */
  snapMs: 400,
  /** And to reach a gap between syllables in the fine list. */
  fineSnapMs: 150,
  /**
   * How far after a take's first syllable a *fine* gap may begin and still
   * count as the quiet before it. A proper pause (the 250 ms list) may start
   * up to `fineSnapMs` late, because whisper starts words early and
   * `alignWords` has already reconciled the long pauses; a gap of 80–200 ms
   * that begins 100 ms into the syllable is the gap *after* it, and a cut
   * placed by it would take the first syllable of the kept take with it.
   */
  fineLateMs: 40,
  /** A stand-alone filler at least this long goes. */
  fillerMs: 250,
  /** Slack over the budget that still counts as fitting: two per cent is six seconds on a five-minute brief. */
  slack: 0.02,
  /** A sentence longer than this is not a filler, whatever the model says. */
  fillerMaxHan: 8,
  /** A piece with no word in it shorter than this is noise between two pauses and goes; longer, it may be speech and stays. */
  noiseMaxMs: 820,
};

export type DropSpan = { startMs: number; endMs: number; reason: CutReport["removed"][number]["reason"]; sentenceIds: string[]; text: string; why: string };

export type PlanCutResult = {
  pieces: CutPiece[];
  report: CutReport;
  /** The pieces as source-time ranges, for `mapTime`. */
  cuts: Range[];
  lengthMs: number;
  removedMs: number;
  /** Every removal, in source time, with its reason: retakes, sentence drops, fillers (pauses are in `pauses`). */
  drops: DropSpan[];
  /** Every pause that was shortened: the silence and how much of it went. */
  pauses: { startMs: number; endMs: number; removedMs: number }[];
  keptSentenceIds: string[];
  /** Sentence ids holding a brief anchor. */
  anchorIds: string[];
  /** Model drops refused, with why: the sentence holds an anchor, is a retake's kept take, or is too long to be a filler. */
  refused: { id: string; anchors: string[]; whyZh: string }[];
  /** Retakes the rules or the model wanted gone but no measured quiet allows a clean cut at; kept. */
  refusedRetakes: { retake: Retake; text: string; whyZh: string }[];
  optionalDropped: OptionalDrop[];
  /**
   * The sentence the model would open on, when it named one that exists and
   * is still in the cut. The pieces are *not* reordered for it (see
   * `assemble`); the director decides what to do with it.
   */
  coldOpenId: string | null;
};

const FILLERS = new Set(["嗯", "呃", "额", "那个", "嗯嗯", "呃呃"]);

/**
 * The clean cut, decided.
 *
 * In order: the retakes' drop spans, each edge moved into the measured
 * silence beside it; the model's sentence drops, audited (unknown ids, bad
 * reasons and anchor sentences are refused and listed as restored); stand-
 * alone fillers; then every remaining pause shortened by
 * `speechFromSilences`. The pieces are what is left, and every one of their
 * edges is either inside a measured silence or on a word boundary — the
 * evaluation checks exactly that.
 *
 * The budget comes last and only ever takes from what the model offered
 * with priority 2–3, never an anchor; if the cut is still over, it stays
 * over and the report says so.
 */
export function planCut(input: PlanCutInput): PlanCutResult {
  const o = { ...CUT_DEFAULTS, ...(input.options ?? {}) };
  const sentences = input.sentences;
  const silences = [...input.silences].sort((a, b) => a.startMs - b.startMs);
  const fine = input.fineSilences ? [...input.fineSilences].sort((a, b) => a.startMs - b.startMs) : silences;
  const clipId = sentences[0]?.clipId ?? "src";
  const words = input.words.length ? input.words : sentences.flatMap((s) => s.words);
  const lastWordEnd = words.length ? Math.max(...words.map((w) => w.endMs)) : 0;
  const total = Math.max(input.totalMs ?? 0, lastWordEnd, silences.length ? silences[silences.length - 1].endMs : 0);
  const plan = input.plan ?? EMPTY_PLAN_V2;
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const index = new Map(sentences.map((s, i) => [s.id, i]));
  const anchors = briefAnchors(input.brief);
  const anchorIds = new Set(sentences.filter((s) => anchorsIn(s.text, anchors).length > 0).map((s) => s.id));

  /*
   * An edge into silence.
   *
   * The start of a drop is the end of the audio kept before it, the end of
   * a drop is the start of the audio kept after it, and in both cases the
   * edge the planner has is a word time: a take's first syllable, as
   * whisper timed it or as `alignWords` moved it. The silence wanted is the
   * quiet that touches that onset — it may end exactly there (aligned
   * words), or begin just after the nominal start and end later (whisper's
   * early starts), or end a little before it. It may not *begin* well after
   * the onset, since that quiet lies inside the take. The cut then sits
   * `guard` ms into the quiet at a drop's start, and `trimTo − guard` ms
   * before the quiet's end at a drop's end, so the syllable keeps its
   * breath on both sides.
   */
  const head = Math.max(0, o.trimTo - o.guard);
  const pick = (list: readonly Silence[], ms: number, edge: "start" | "end", shift: number, lateMs: number): Silence | null => {
    let best: Silence | null = null;
    let bestGap = Infinity;
    const lo = edge === "start" ? ms - shift : ms - o.fineSnapMs;
    const hi = edge === "start" ? ms + o.fineSnapMs : ms + shift;
    for (const s of list) {
      if (s.startMs > hi) break;
      if (s.endMs < lo) continue;
      /* The quiet must reach the onset: begin no later than `lateMs` after it, end no earlier than the tolerance before it. */
      if (s.startMs > ms + lateMs || s.endMs < ms - o.fineSnapMs) continue;
      const gap = Math.abs(s.endMs - ms);
      if (gap < bestGap) {
        bestGap = gap;
        best = s;
      }
    }
    return best;
  };
  const snapStart = (ms: number): number => {
    const s = pick(silences, ms, "start", o.snapMs, o.fineSnapMs) ?? pick(fine, ms, "start", o.fineSnapMs, o.fineLateMs);
    return s ? Math.min(s.endMs, s.startMs + o.guard) : ms;
  };
  const snapEnd = (ms: number): number => {
    const s = pick(silences, ms, "end", o.snapMs, o.fineSnapMs) ?? pick(fine, ms, "end", o.fineSnapMs, o.fineLateMs);
    return s ? Math.max(s.startMs, s.endMs - head) : ms;
  };

  const textBetween = (startMs: number, endMs: number): string =>
    joinWords(words.filter((w) => (w.startMs + w.endMs) / 2 >= startMs && (w.startMs + w.endMs) / 2 < endMs));

  const drops: DropSpan[] = [];
  /* Both end up in `report.restored` (the frozen shape has one list); the
     note tells them apart, because a suggestion turned down before anything
     was cut and a sentence put back after the audit found it missing are
     different facts for the person reading it. */
  const restored: string[] = [];
  const auditRestored: string[] = [];
  const refused: PlanCutResult["refused"] = [];
  const refusedRetakes: PlanCutResult["refusedRetakes"] = [];
  const inQuiet = (ms: number) => fine.some((s) => ms >= s.startMs - 20 && ms <= s.endMs + 20);

  /* 1. retakes: only where both edges land in measured quiet. A repeat with
     no pause between the takes (一轮比一轮官方一轮比一轮激进) cannot be cut
     without clipping a syllable, so it stays — keeping is the safe mistake. */
  for (const r of input.retakes) {
    const startMs = snapStart(r.dropStartMs);
    const endMs = snapEnd(r.dropEndMs);
    if (endMs <= startMs) continue;
    if (!inQuiet(startMs) || !inQuiet(endMs)) {
      refusedRetakes.push({ retake: r, text: textBetween(r.dropStartMs, r.dropEndMs), whyZh: "两遍之间没有停顿，剪不干净，保留" });
      continue;
    }
    drops.push({
      startMs,
      endMs,
      reason: "retake",
      sentenceIds: r.droppedSentenceIds,
      text: textBetween(r.dropStartMs, r.dropEndMs),
      why: `${RETAKE_ZH[r.kind]}，保留最后一遍（${r.decidedBy === "model" ? "模型判定" : "规则判定"}）`,
    });
  }

  /* 2. the model's drops, audited */
  const retakeSentences = new Set(input.retakes.flatMap((r) => r.droppedSentenceIds));
  const keptTakes = new Set(input.retakes.map((r) => r.keptSentenceId));
  /*
   * What may be dropped whole. `toSentences` splits on breaths, so many of
   * its "sentences" are clauses of a longer one; a clause dropped from the
   * middle leaves broken grammar (点名说中国AI公司搞工业规模蒸馏 without its
   * 超了美国的模型). A sentence may go only when it is a whole one: it opens
   * after a strong pause or a full stop and closes with one. The first and
   * the last sentence never go: the hook is the brief's, and the sign-off is
   * the channel's. A "filler" is a sentence made of discourse tokens and
   * nothing else, whatever the model calls it.
   */
  const strongPauseAt = (ms: number): boolean => {
    const near = silenceNear(ms, silences, 300);
    return near !== null && near.endMs - near.startMs >= 500;
  };
  const strongEndOf = (s: Sentence): boolean =>
    /[。！？!?；;]["”』」）)]*$/.test(s.words[s.words.length - 1]?.text ?? "") || strongPauseAt(s.endMs);
  const strongStartOf = (s: Sentence): boolean => {
    const i = index.get(s.id) ?? 0;
    return i === 0 || strongEndOf(sentences[i - 1]) || strongPauseAt(s.startMs);
  };
  const FILLER_SENTENCE = /^(嗯|呃|啊|额|对|好|好的|然后|那么|就是|就是说|那个|这个|你知道吗|对吧|是吧|ok|okay|所以|所以说|其实|然后呢|呢|吧|哦|噢|哎)+$/i;
  const isFillerSentence = (s: Sentence): boolean => FILLER_SENTENCE.test(norm(s.text));
  const sentenceSpan = (s: Sentence): Range => {
    const i = index.get(s.id) ?? 0;
    const next = sentences[i + 1];
    return { startMs: snapStart(s.startMs), endMs: next ? snapEnd(next.startMs) : snapEnd(s.endMs) };
  };
  const optional: OptionalDrop[] = [];
  for (const d of plan.drop) {
    const s = byId.get(d.id);
    if (!s || retakeSentences.has(d.id)) continue;
    const refuse = (whyZh: string) => {
      refused.push({ id: d.id, anchors: anchorsIn(s.text, anchors), whyZh });
      restored.push(d.id);
    };
    if (anchorIds.has(d.id)) {
      refuse("含简报点名的内容");
      continue;
    }
    if (keptTakes.has(d.id)) {
      refuse("重说后保留的那一遍");
      continue;
    }
    if (d.reason === "filler" && (hanCount(s.text) > o.fillerMaxHan || !isFillerSentence(s))) {
      refuse("整句不是空话");
      continue;
    }
    const at = index.get(d.id) ?? 0;
    if (at === 0 || at === sentences.length - 1) {
      refuse(at === 0 ? "开头的钩子" : "结尾的收束");
      continue;
    }
    if (!strongStartOf(s) || !strongEndOf(s)) {
      refuse("不是完整的一句（前后没有明显停顿）");
      continue;
    }
    const span = sentenceSpan(s);
    if (span.endMs <= span.startMs) continue;
    /* The same gate the retakes pass: a sentence whose edges cannot be moved
       into measured quiet (punctuation with no pause behind it) would be cut
       out of the middle of a syllable. It stays. */
    if (!inQuiet(span.startMs) || !inQuiet(span.endMs)) {
      refuse("句子两头没有可下刀的静音");
      continue;
    }
    if (d.priority === 1) {
      drops.push({ ...span, reason: d.reason, sentenceIds: [d.id], text: s.text, why: d.why || REASON_ZH[d.reason] });
    } else {
      optional.push({ id: d.id, ms: span.endMs - span.startMs, priority: d.priority, reason: d.reason, text: s.text });
    }
  }

  /* 3. stand-alone fillers: a filler word with quiet on both sides */
  for (const w of words) {
    const t = norm(w.text);
    if (!FILLERS.has(t) || w.endMs - w.startMs < o.fillerMs) continue;
    const before = silenceNear(w.startMs, fine, 100);
    const after = silenceNear(w.endMs, fine, 100);
    if (!before || !after || before === after) continue;
    const startMs = Math.min(w.endMs, before.startMs + o.guard);
    const endMs = Math.max(startMs, after.endMs - head);
    if (endMs - startMs < 100) continue;
    if (drops.some((d) => startMs < d.endMs && endMs > d.startMs)) continue;
    drops.push({ startMs, endMs, reason: "filler", sentenceIds: [], text: w.text, why: "口头语" });
  }

  /* 4. pauses: 200 ms stays between sentences, 120 ms inside one (§1) */
  const sentenceEnds = sentences.filter((s) => strongEndOf(s)).map((s) => s.endMs);
  const speech = speechFromSilences(silences, total, {
    minPause: o.minPause,
    trimTo: o.trimTo,
    endTrimTo: o.endTrimTo,
    guard: o.guard,
    sentenceEnds,
  });

  /*
   * The pieces stay in take order. The model names a cold-open sentence and
   * it is passed on (`coldOpenId`), but the take is not reordered here: every
   * consumer of the pieces — `mapTime` for the captions and graphics,
   * `mergeRanges` in `autoEdit`, W6's layout — walks them as a sorted list,
   * and a piece moved to the front made `mapTime` return null for every
   * moment before it, which deleted every caption up to the cold open. If
   * the director wants to open on a later line it must map times in cut
   * order; until it does, opening out of order loses captions.
   */
  const assemble = (dropList: readonly DropSpan[]): Range[] => {
    const kept = subtract([{ startMs: 0, endMs: total }], dropList);
    return intersectExact(kept, speech, 150);
  };

  let pieces = assemble(drops);
  const length = (list: readonly Range[]) => list.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);

  /*
   * 4b. Noise between pauses. silencedetect keeps anything above −32 dB, and
   * a laugh, a cough or a pair of lip noises between two pauses comes
   * through as a piece with no word in it: on the 蒸馏 take, 550 ms at
   * 163.6 s between 侵权实锤 and 而中方, which played as a second of dead
   * air with a noise in the middle. A piece no word touches, shorter than
   * `noiseMaxMs`, goes as a pause. The ceiling matters: a swallowed repeat
   * that `fillHoles` could not confirm is at least 700 ms of voice and
   * stays, because a wordless piece that long may be speech whisper missed
   * and keeping speech is the mistake this planner is allowed to make.
   */
  const touched = (p: Range) => words.some((w) => Math.min(p.endMs, w.endMs) - Math.max(p.startMs, w.startMs) >= 20);
  const noise = pieces.filter((p) => p.endMs - p.startMs < o.noiseMaxMs && p.startMs > 0 && p.endMs < total && !touched(p));
  if (noise.length) {
    for (const p of noise) drops.push({ startMs: p.startMs, endMs: p.endMs, reason: "pause", sentenceIds: [], text: "无字的杂音", why: "两段停顿之间没有词的杂音" });
    pieces = assemble(drops);
  }

  /* 5. the budget: only what the model offered, never an anchor */
  const fit = fitSentencesToBudget({
    lengthMs: length(pieces),
    budgetMs: input.targetMs ?? null,
    optional,
    anchors: anchorIds,
    slack: o.slack,
  });
  for (const d of fit.refused) {
    refused.push({ id: d.id, anchors: anchorsIn(byId.get(d.id)?.text ?? "", anchors), whyZh: "含简报点名的内容" });
    if (!restored.includes(d.id)) restored.push(d.id);
  }
  if (fit.dropped.length) {
    for (const d of fit.dropped) {
      const s = byId.get(d.id);
      if (!s) continue;
      drops.push({ ...sentenceSpan(s), reason: d.reason, sentenceIds: [d.id], text: s.text, why: `${REASON_ZH[d.reason]}（为控制时长）` });
    }
    pieces = assemble(drops);
  }
  drops.sort((a, b) => a.startMs - b.startMs);

  /* 6. the audit: every sentence is kept, a retake, or dropped with a reason */
  const covered = (s: Sentence) => pieces.some((p) => p.startMs < s.endMs && p.endMs > s.startMs);
  const droppedIds = new Set(drops.flatMap((d) => d.sentenceIds));
  const keptSentenceIds: string[] = [];
  for (const s of sentences) {
    if (covered(s)) keptSentenceIds.push(s.id);
    else if (!droppedIds.has(s.id) && !retakeSentences.has(s.id)) {
      /* Not kept, not a retake, nobody gave a reason: put it back. This is
         the case of a sentence swallowed whole by a snapped edge. */
      const span = sentenceSpan(s);
      const back = intersectExact([span], speech, 150);
      if (back.length) {
        pieces = mergeRanges([...pieces, ...back], 0);
        restored.push(s.id);
        auditRestored.push(s.id);
        keptSentenceIds.push(s.id);
      }
    }
  }

  /* 7. the pauses that went, for the report */
  const pauses: PlanCutResult["pauses"] = [];
  for (const s of silences) {
    if (s.endMs - s.startMs < o.minPause) continue;
    if (s.startMs <= 0 || s.endMs >= total) continue;
    if (drops.some((d) => s.startMs >= d.startMs && s.endMs <= d.endMs)) continue;
    const keep = sentenceEnds.some((e) => Math.abs(e - s.startMs) <= 600 || (e >= s.startMs && e <= s.endMs)) ? o.endTrimTo : o.trimTo;
    pauses.push({ startMs: s.startMs, endMs: s.endMs, removedMs: Math.max(0, s.endMs - s.startMs - keep) });
  }

  const lengthMs = length(pieces);
  const retakeCount = drops.filter((d) => d.reason === "retake").length;
  const pauseMs = pauses.reduce((sum, p) => sum + p.removedMs, 0);
  const sentenceDrops = drops.filter((d) => d.reason !== "retake" && d.sentenceIds.length > 0);
  const fillerCount = drops.filter((d) => d.reason === "filler" && d.sentenceIds.length === 0).length;
  const noiseCount = drops.filter((d) => d.reason === "pause" && d.sentenceIds.length === 0).length;
  const parts = [
    retakeCount ? `删掉 ${retakeCount} 处重复口误` : "",
    pauses.length ? `${pauses.length} 处停顿（共 ${Math.round(pauseMs / 1000)} 秒）` : "",
    fillerCount ? `${fillerCount} 个口头语` : "",
    noiseCount ? `${noiseCount} 处无字的杂音` : "",
  ].filter(Boolean);
  const refusedCount = restored.length - auditRestored.length;
  const noteZh = [
    parts.length ? parts.join("、") : "没有可删的口误或停顿",
    sentenceDrops.length ? `另按模型建议删去 ${sentenceDrops.length} 句（${sentenceDrops.map((d) => REASON_ZH[d.reason as DropReason] ?? d.reason).join("、")}）` : "未删减内容",
    refusedCount > 0 ? `驳回了模型 ${refusedCount} 条理由不足的删句建议` : "",
    auditRestored.length ? `补回了 ${auditRestored.length} 句被剪掉却没有理由的内容` : "",
    refusedRetakes.length ? `${refusedRetakes.length} 处疑似重说因没有停顿而保留` : "",
    fit.overBudgetMs > 0 ? `成片 ${clock(lengthMs)} 超出简报 ${Math.round(fit.overBudgetMs / 1000)} 秒，未为凑时长删句` : "",
  ]
    .filter(Boolean)
    .join("，");

  const report: CutReport = {
    removed: [
      ...drops.map((d) => ({ sentenceIds: d.sentenceIds, ms: d.endMs - d.startMs, reason: d.reason, text: d.text.slice(0, 80) })),
      ...pauses.map((p) => ({ sentenceIds: [], ms: p.removedMs, reason: "pause" as const, text: `停顿 ${((p.endMs - p.startMs) / 1000).toFixed(2)} 秒 @ ${(p.startMs / 1000).toFixed(2)}s` })),
    ],
    restored,
    overBudgetMs: fit.overBudgetMs,
    noteZh,
  };

  return {
    pieces: pieces.map((p) => ({ clipId, inMs: p.startMs, outMs: p.endMs })),
    report,
    cuts: pieces,
    lengthMs,
    removedMs: Math.max(0, total - lengthMs),
    drops,
    pauses,
    keptSentenceIds,
    anchorIds: [...anchorIds],
    refused,
    refusedRetakes,
    optionalDropped: fit.dropped,
    coldOpenId: plan.coldOpen && byId.has(plan.coldOpen) && keptSentenceIds.includes(plan.coldOpen) ? plan.coldOpen : null,
  };
}

const RETAKE_ZH: Record<Retake["kind"], string> = {
  restart: "重新起头说了一遍",
  reworded: "换了说法重说一遍",
  stutter: "结巴重复",
  repeat: "原句重复",
};

const REASON_ZH: Record<DropReason, string> = { filler: "空话", "off-topic": "跑题", aside: "插话" };

/* --------------------------------------------------------------- v2 IO */

/** The words `cutV2` works on: source-time milliseconds. */
type V2Input = {
  viewer: Viewer;
  title: string;
  clipId: string;
  fileId: string;
  /** A local path or an https URL ffmpeg can read. */
  source: string;
  version: string;
  localSource: boolean;
  languageCode: string;
  words: Word[];
  brief: string | null;
  targetMs: number | null;
  totalMs: number | null;
};

type V2Result = {
  pieces: CutPiece[];
  report: CutReport;
  drops: { startMs: number; endMs: number; why: string }[];
  title: string | null;
  speaker: string | null;
  /** Chapter starts in source time. */
  chapters: { atMs: number; label: string }[];
  note: string | null;
  decisions: RetakeDecision[];
};

/**
 * Measure, find, ask, plan. Two model calls at most (the ambiguous retakes
 * when there are any; the plan), both recorded in the ledger, both optional:
 * either failing leaves a cut with the retakes and pauses out and a line in
 * the note.
 */
async function cutV2(input: V2Input): Promise<V2Result> {
  /* One ffmpeg pass at 80 ms; the 250 ms list is a subset of it (silencedetect
     back-dates every start, so the edges are identical). */
  const fine = await detectSilencesForFile(input.fileId, input.source, input.version, { db: -32, minMs: 80 });
  const silences = fine.filter((s) => s.endMs - s.startMs >= 250);

  /* Whisper's swallowed repeats, when the file is on disk (a window from a
     remote master would be a range request per hole; not worth it). */
  let words = input.words;
  if (input.localSource) {
    const filled = await fillHoles(words, silences, holeTranscriber(input.source, input.languageCode));
    words = filled.words;
  }
  words = alignWords(words, fine);

  const sentences = toSentences(words, [], { clipId: input.clipId, silences });
  const found = findRetakes(words, sentences, { briefPhrases: briefPhrases(input.brief), silences });
  const notes: string[] = [];
  const ask = (model: string, temperature: number, maxTokens: number) => async (messages: { role: "system" | "user"; content: string }[]) => {
    const out = await complete({ model, temperature, maxTokens, messages });
    await recordUsage({
      viewer: input.viewer,
      module: "video",
      provider: out.provider ?? "openrouter",
      model: out.model,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
      costMicros: out.costMicros,
      requestId: out.requestId,
    });
    return out.text;
  };
  const modelDecisions = await decideRetakes(found.ambiguous, ask(modelFor.utility(), 0, 600));
  const decisions = [...found.decisions, ...modelDecisions];
  const retakes = decisions.filter((d) => d.drop).map(toRetake);

  const total = input.totalMs ?? Math.max(...words.map((w) => w.endMs));
  let plan: PlanV2 = EMPTY_PLAN_V2;
  try {
    const answer = await ask(modelFor.assistant(), 0.2, 2000)(
      planMessagesV2({ title: input.title, sentences, retakes, brief: input.brief, targetMs: input.targetMs, totalMs: total }),
    );
    plan = parsePlanV2(answer, new Set(sentences.map((s) => s.id)));
  } catch (err) {
    notes.push(`模型暂时连不上（${err instanceof Error ? err.message.slice(0, 120) : "未知原因"}），这一版只去掉了口误和停顿`);
  }

  const cut = planCut({ sentences, silences, fineSilences: fine, words, brief: input.brief, targetMs: input.targetMs, retakes, plan, totalMs: total });
  return {
    pieces: cut.pieces,
    report: cut.report,
    drops: cut.drops.map((d) => ({ startMs: d.startMs, endMs: d.endMs, why: d.why })),
    title: plan.title,
    speaker: plan.speaker,
    chapters: plan.chapters
      .map((c) => {
        const s = sentences.find((x) => x.id === c.id);
        return s ? { atMs: s.startMs, label: c.label } : null;
      })
      .filter((c): c is { atMs: number; label: string } => c !== null),
    note: [cut.report.noteZh, ...notes].join("；"),
    decisions,
  };
}

/**
 * A hole transcriber over a local file: ffmpeg cuts the window to a mono
 * 16 kHz wav on stdout, `transcribeLocal` (faster-whisper) reads it, and
 * the words come back in source time. Exported for the lab.
 */
export function holeTranscriber(file: string, languageCode: string | null): (startMs: number, endMs: number) => Promise<Word[]> {
  return async (startMs, endMs) => {
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-ss", (startMs / 1000).toFixed(3),
      "-t", ((endMs - startMs) / 1000).toFixed(3),
      "-i", file,
      "-vn", "-ac", "1", "-ar", "16000",
      "-f", "wav", "pipe:1",
    ];
    const wav = await new Promise<Buffer>((resolve, reject) => {
      execFile("ffmpeg", args, { encoding: "buffer", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(new Error(`ffmpeg could not cut the window: ${err.message.slice(0, 200)}`));
        else resolve(stdout as Buffer);
      });
    });
    const t = await transcribeLocal(new Blob([new Uint8Array(wav)]), "hole.wav", { languageCode: languageCode || undefined });
    return toWords(t.words.map((w) => ({ text: w.text, start: w.start + startMs / 1000, end: w.end + startMs / 1000 })));
  };
}
