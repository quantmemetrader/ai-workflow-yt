import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, timelineItems, videoClips, videoGraphics, videoProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/auth/dal";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { VIDEO_CRAFT } from "@/lib/video/craft";
import { canKaraoke } from "@/lib/video/ass";
import { intersect, mapTime, mapTimeNear, mergeRanges, speechRanges } from "@/lib/video/ranges";
import { clock, fitToBudget, targetFromBrief, totalMs } from "@/lib/video/length";

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
};

export async function autoEdit(
  viewer: Viewer,
  projectId: string,
  opts: { language?: string; brief?: string | null; targetMs?: number | null } = {},
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
  let plan: Plan = { title: null, hook: null, keep: [], chapters: [], speaker: null, drop: [] };
  let modelNote: string | null = null;

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
      modelNote = "The model did not return a usable plan, so this is the take with its dead air removed — which is most of the work anyway.";
    }
  } catch (err) {
    modelNote = `The model could not be reached (${
      err instanceof Error ? err.message.slice(0, 120) : "unknown"
    }), so this is the take with its dead air removed. Run it again for the rest.`;
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
  let cuts = wanted.length ? intersect(wanted, speech) : speech;

  /*
   * The backstop.
   *
   * The model is told the budget and usually respects it. When it does not —
   * and with a long take it often does not — this cuts to time the way a
   * person would: the opening stays, the ending stays, the middle gives way.
   * Arithmetic over ranges, so unlike a second model call it cannot fail.
   */
  let budgetNote: string | null = null;
  if (targetMs) {
    const before = totalMs(cuts);
    const fitted = fitToBudget(cuts[0] ?? null, cuts.slice(1), targetMs);
    if (fitted.dropped.length) {
      cuts = fitted.kept;
      budgetNote = `Cut to the brief's ${clock(targetMs)}: ${clock(before)} of speech came back from the plan, so ${fitted.dropped.length} section${fitted.dropped.length > 1 ? "s" : ""} in the middle were dropped. The opening and the ending were kept.`;
    } else if (fitted.overBy > 0) {
      budgetNote = `This runs ${clock(totalMs(cuts))} against a brief of ${clock(targetMs)}. The opening and the ending alone are longer than that, so nothing was dropped — shorten the brief or the take.`;
    }
  }

  /* A kept range is a span of the *timeline*, and a span can straddle the join
     between two cuts — so each one becomes one new item per cut it covers,
     with the source in and out worked out from that cut's own in point. */
  const pieces: { source: (typeof existing)[number]; inMs: number; outMs: number }[] = [];
  for (const span of mergeRanges(cuts)) {
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
  const cjk = /[\u3000-\u9fff\uf900-\ufaff]/.test(rows.map((r) => r.text).join(""));
  const join = (parts: string[]) => (cjk ? parts.join("") : parts.join(" ")).trim();

  const retimed = rows
    .map((r) => {
      const original = r.words ?? [];
      const words = original
        .map((w) => {
          const s = mapTime(w.start * 1000, cuts);
          const e = mapTime(w.end * 1000, cuts);
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
      plannedBy: modelNote === null ? modelFor.assistant() : "silence only",
    },
  });

  return {
    cuts: items.length,
    captions: retimed.length,
    graphics: graphics.length,
    removedMs: Math.max(0, lastMs - keptMs),
    drop: plan.drop.slice(0, 8),
    title: plan.title,
    /* Both, when both happened: the model's excuse and the cut to time are
       different facts and a person needs to read the one that applies. */
    note: [modelNote, budgetNote].filter(Boolean).join(" ") || null,
    targetMs,
    lengthMs: keptMs,
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
