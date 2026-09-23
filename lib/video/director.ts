import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  captions,
  files,
  scriptBeats,
  timelineItems,
  videoClips,
  videoExports,
  videoGraphics,
  videoProjects,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { isInterrupted, renderExport } from "@/lib/video/render";
import { canReadFiles } from "@/lib/authz/rebac";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { importPicture, importVideo } from "@/lib/files/service";
import { creatorVoiceText } from "@/lib/creator/service";
import { HOUSE_FORMAT, VIDEO_CRAFT } from "./craft";
import { autoEdit } from "./autoedit";
import { transcribeProject } from "./transcribe";
import { attributionFor, clipAttribution, searchAnyPicture, searchStockClips, stockConfigured } from "./stock";
import { addClip } from "./service";
import { ICON_NAMES, isIconName, isPlacement } from "./icons";
import { asEntrance, CAPTION_PRESETS, FURNITURE_KINDS, isGraphicKind } from "./presets";
import { canKaraoke } from "./ass";

/**
 * The director: a brief in, a finished video out.
 *
 * Everything the module could already do — transcribe, take the dead air
 * out, place a name, put a picture on — was a button each, and the person
 * pressed them in order and then asked for the rest one change at a time.
 * This is all of it in one job, in the order an editor works:
 *
 *   1. **Footage.** Whatever is in the bin goes on the timeline: the longest
 *      take as the spine, the rest kept as cutaways.
 *   2. **Transcribe**, if nobody has. Every later step is built on the words.
 *   3. **Cut.** The dead air out, the hook found, the weak takes dropped —
 *      `autoEdit`, now told what the producer asked for.
 *   4. **Design.** One model call, given the house rules, the creator's own
 *      voice, the brief, the transcript with timings, the clips, the pictures
 *      and the script if there is one, answering with a plan: the look,
 *      every graphic with its arrival, the punch-ins, the cutaways, the
 *      pictures to find. Bounded and checked here before a row is written —
 *      a number that was never said is not put on screen, a cutaway that
 *      outruns its clip is shortened, two punches in a row become one.
 *   5. **Pictures.** Openverse, for the things there is no footage of, with
 *      the licence written on the file.
 *   6. **Render**, when asked, in the same job, so "make the video" means the
 *      file and not a plan for one.
 *
 * Progress is written to `video_projects.director` at every step, so the
 * screen can say which minute it is in and what went wrong when one did.
 */
export type Pace = "calm" | "channel" | "hype";

/** What each pace tells the model, and the caps the writer holds it to. */
const PACES: Record<
  Pace,
  { prompt: string; perSec: number; pictures: number; footageGap: number; textGap: number; pictureMs: number; clipMs: number }
> = {
  calm: {
    prompt:
      "Pace: calm. One idea per shot, air between graphics, a picture only where the words genuinely need one. About one visual event every ten seconds.",
    perSec: 8,
    pictures: 6,
    footageGap: 25_000,
    textGap: 800,
    pictureMs: 5000,
    clipMs: 6000,
  },
  channel: {
    prompt: "Pace: the channel's own, as measured above. Something arrives every four to eight seconds; between arrivals nothing moves.",
    perSec: 3,
    pictures: 12,
    footageGap: 12_000,
    textGap: 400,
    pictureMs: 4000,
    clipMs: 5000,
  },
  hype: {
    prompt:
      "Pace: hype. This is a fast-cut short. EVERY named thing gets a full-frame visual the moment it is said — a person, a place, a machine, a parent, a rocket — as a picture (full frame, pushed in slowly) or a stock clip; every number lands as a big stat; a key phrase pops as a statement. Aim for a visual event every two to four seconds, back to back, the speaker's face returning between them. Use the whole timeline. Do not hold back for restraint; the producer has asked for the CapCut look.",
    perSec: 1.5,
    pictures: 40,
    footageGap: 5_000,
    textGap: 150,
    pictureMs: 3000,
    clipMs: 4000,
  },
};

/**
 * How a cutaway sits. The channel keeps the presenter in a circle over the
 * footage (`pip`) for most of a video, as measured from the editor's own
 * cut; the hype look swaps to full frame; calm keeps whatever was asked.
 */
function cutawayPlacement(asked: string, pace: Pace): string {
  if (asked === "top-right" || asked === "bottom-right") return asked;
  if (pace === "hype") return "full";
  if (pace === "channel") return "pip";
  return asked === "pip" ? "pip" : "full";
}

export type DirectorState = {
  state: "queued" | "running" | "done" | "failed";
  step?: "footage" | "transcribe" | "cut" | "design" | "pictures" | "write" | "render";
  brief?: string;
  aspect?: string;
  render?: boolean;
  language?: string;
  /** How much happens on screen: calm (one idea, air between), channel (the
   * format as measured), hype (every named thing full frame, one after
   * another, the way a fast-cut short is made). */
  pace?: Pace;
  note?: string;
  error?: string;
  log?: { at: string; text: string }[];
  startedAt?: string;
  finishedAt?: string;
  /** Set when the worker was restarted under the render: the design is on
   * the timeline already, so the next run goes straight to the encoder. */
  resume?: "render";
  result?: {
    cuts: number;
    graphics: number;
    punches: number;
    broll: number;
    pictures: number;
    exportId?: string;
    fileId?: string;
    title?: string;
    notes?: string;
  };
};

async function patch(projectId: string, fn: (d: DirectorState) => DirectorState) {
  const [row] = await db.select({ director: videoProjects.director }).from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  const next = fn((row?.director ?? {}) as DirectorState);
  await db.update(videoProjects).set({ director: next, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
  return next;
}

const DESIGN_PROMPT = `You are designing the finished video from a cut that already exists.

You are given: the producer's brief, the transcript with timings on the finished
timeline, the clips in the bin (which one is on the timeline, which are spare),
the pictures in the studio's files, the icons that exist, and the script if
there is one. Answer with a single JSON object and nothing else. The first
character of your answer must be an opening brace.

{
  "title": "the video's title, under 60 characters, from what is actually said",
  "look": { "captionPreset": "clean|spoken|pop|bilingual|broadcast|statement", "accent": "#rrggbb", "bilingual": true },
  "header": { "title": "the title, top left, from ~10s to the end", "sub": "one line under it", "fromMs": 10000 },
  "watermark": { "text": "the channel's mark", "sub": "its English line" },
  "footnote": "one grey line along the bottom, or empty",
  "graphics": [
    { "kind": "title|lower-third|statement|chapter|stat|quote|bracket|ticker|badge|card|end-card|icon",
      "text": "", "sub": "", "startMs": 0, "endMs": 0,
      "enter": "fade|rise|pop|slide|drop", "icon": "", "placement": "center|top-left|top-right|bottom-left|bottom-right", "why": "five words" }
  ],
  "punches": [ { "startMs": 0, "endMs": 0, "zoom": 1.15, "why": "five words" } ],
  "broll": [ { "clipId": "", "startMs": 0, "endMs": 0, "sourceInMs": 0, "placement": "pip|full|top-right|bottom-right", "why": "five words" } ],
  "footage": [ { "query": "plain words for a stock clip: counting money, trading screen, factory line, city at night", "startMs": 0, "endMs": 0, "why": "five words" } ],
  "pictures": [ { "fileId": "", "query": "", "startMs": 0, "endMs": 0, "placement": "center|full|top-right|bottom-right", "caption": "", "why": "five words" } ],
  "notes": "two or three sentences to the producer: what you did, and what you could not do and why"
}

Rules:
 - Follow the channel's format above: the statement hook, then the header, the watermark and the footnote for the whole video, bilingual captions with keywords, a picture or cutaway for every named thing, a stat for every number. A "statement" is two or three short lines separated by " | " with the key words marked 【like this】; a "lower-third" sub may hold up to three credential lines separated by " | ".
 - Every millisecond figure is a position on the finished timeline and must fall inside it.
 - The first graphic starts at 0 to 400ms: a title, a statement or a big number over the opening line, on screen for two to three seconds. Frame one is the thumbnail; never open on nothing.
 - Text on screen is written in the language the producer's brief is written in, unless the brief says otherwise. The creator's voice governs the tone and the kind of line, not the language. Names stay as they are said.
 - "stat" only for a figure that is actually said in the transcript or written in the brief. Never invent a number, a name or a claim.
 - "lower-third" once, when the speaker is first seen, if a name is known from the brief or the transcript.
 - "chapter" only where the subject genuinely changes. "end-card" once, at the very end, or not at all.
 - One idea per graphic, and at most one graphic on screen at a time. Leave air between them. A ten-minute video wants perhaps ten to fifteen; a sixty-second short wants five to eight.
 - "punches" are for the line that matters: 2 to 6 seconds each, zoom 1.1 to 1.3, never two in a row, at most one a minute.
 - "broll" only from the spare clips listed, only when the words describe what the clip shows, 3 to 8 seconds, never over the opening five seconds.
 - "footage": stock video for a cutaway when the bin has nothing that fits: a generic scene, in plain words (money being counted, a stock chart, a factory floor, a phone in a hand). Only when the stock library is available (said below). 3 to 6 seconds, at most one a minute, never over the opening five seconds and never over a named person.
 - "pictures": use "fileId" for a picture from the studio's files; use "query" (plain words, the product's or company's name, or the thing itself: "space shuttle launch", "astronaut in suit", "parents with baby") to search the picture libraries for something the studio has no picture of. Every product, company, place, person or object the speaker names is worth a picture, and a picture beats an icon for anything that has a real appearance. As many as the pace allows, one at a time, each for 2 to 3 seconds and then back to the speaker: a picture that stays up longer goes stale, and a second picture beats a long one.
 - "icon": only when one of the listed icons genuinely means the thing said (money for a price, clock for time, warning for a risk, chart for growth). Never "check" as a filler. An icon is a mark, not a picture of the thing.
 - The channel's own format, which every video here follows: one presenter to camera, a business story told through concrete things. Every named item gets a picture the moment it is named; every number said gets a big stat; the key phrase of each section is a statement or a bracket; the punchline gets the punch-in. Something arrives on screen every five to eight seconds, and it leaves when the next idea starts. Between arrivals, nothing moves.
 - Text on screen is short: a title under eight words, a statement under six, a chapter two or three. The viewer must never pause to read.
 - Pick "pop" captions only for a short with pace, "spoken" for a piece to camera, "clean" for an interview, "statement" only when the whole video is one line at a time.
 - Follow the brief. If the brief asks for something the footage cannot support, say so in "notes" and do the nearest honest thing.`;

type Plan = {
  title: string | null;
  look: { captionPreset: string | null; accent: string | null; bilingual: boolean };
  header: { title: string; sub: string | null; fromMs: number } | null;
  watermark: { text: string; sub: string | null } | null;
  footnote: string | null;
  graphics: { kind: string; text: string; sub: string | null; startMs: number; endMs: number; enter: string; icon: string | null; placement: string | null; why: string }[];
  punches: { startMs: number; endMs: number; zoom: number; why: string }[];
  broll: { clipId: string; startMs: number; endMs: number; sourceInMs: number; placement: string; why: string }[];
  footage: { query: string; startMs: number; endMs: number; why: string }[];
  pictures: { fileId: string | null; query: string | null; startMs: number; endMs: number; placement: string; caption: string; why: string }[];
  notes: string | null;
};

export type DirectResult = NonNullable<DirectorState["result"]>;

export async function direct(viewer: Viewer, projectId: string, jobId?: string): Promise<DirectResult> {
  const [project] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt)))
    .limit(1);
  if (!project) throw new Error("That project does not exist");

  const asked = (project.director ?? {}) as DirectorState;
  const brief = (asked.brief ?? "").trim();
  const aspect = asked.aspect && ["16:9", "9:16", "1:1"].includes(asked.aspect) ? asked.aspect : "16:9";
  const wantRender = asked.render !== false;
  const pace: Pace = asked.pace === "calm" || asked.pace === "hype" ? asked.pace : "channel";
  const P = PACES[pace];

  const say = async (step: DirectorState["step"], text: string) => {
    console.log(`[director ${projectId}] ${step}: ${text}`);
    await patch(projectId, (d) => ({
      ...d,
      state: "running",
      step,
      note: text,
      log: [...(d.log ?? []).slice(-30), { at: new Date().toISOString(), text }],
    }));
  };

  // The worker was restarted under the encoder last time: the cut, the
  // design and the pictures are all on the timeline already, so this run
  // goes straight back to the render rather than designing it all again
  // (and importing every picture a second time).
  if (asked.resume === "render" && asked.result && wantRender) {
    await patch(projectId, (d) => ({ ...d, state: "running", resume: undefined, error: undefined }));
    try {
      const result = await renderStep(viewer, projectId, aspect, asked.language ?? "zh-HK", asked.result, say);
      await finish(viewer, projectId, jobId, result);
      return result;
    } catch (err) {
      await onFailure(projectId, err);
      throw err;
    }
  }

  await patch(projectId, (d) => ({ ...d, state: "running", startedAt: new Date().toISOString(), error: undefined, result: undefined, log: [] }));

  try {
    /* ---- 1. footage ------------------------------------------------- */
    await say("footage", "Looking at what is in the bin");

    const bin = await db
      .select({ c: videoClips, name: files.name, kind: files.kind })
      .from(videoClips)
      .leftJoin(files, eq(files.id, videoClips.fileId))
      .where(eq(videoClips.projectId, projectId))
      .orderBy(asc(videoClips.addedAt));
    const footage = bin.filter((b) => b.kind === "video");
    if (!footage.length) throw new Error("There is no footage in the bin. Drop a clip on the editor first.");

    let items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord));
    if (!items.length) {
      const joinAll = /all clips|every clip|join|stitch|in order|拼接|全部素材|按顺序/i.test(brief);
      const chosen = joinAll ? footage : [footage.reduce((best, f) => ((f.c.durationMs ?? 0) > (best.c.durationMs ?? 0) ? f : best), footage[0])];
      await db.insert(timelineItems).values(
        chosen.map((f, i) => ({ id: newId("beat"), projectId, kind: "clip", clipId: f.c.id, ord: i * 10, inMs: 0, outMs: f.c.durationMs ?? null })),
      );
      items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord));
      await say("footage", joinAll ? `Put all ${chosen.length} clips on the timeline in order` : `Put ${chosen[0].name ?? "the longest take"} on the timeline; the other ${footage.length - 1} stay as cutaways`);
    }

    /* ---- 2. transcribe ---------------------------------------------- */
    const [anyCaption] = await db.select({ language: captions.language }).from(captions).where(eq(captions.projectId, projectId)).limit(1);
    const language = anyCaption?.language ?? asked.language ?? (/english|英文|in english/i.test(brief) ? "en" : "zh-HK");

    const timed = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(captions)
      .where(and(eq(captions.projectId, projectId), eq(captions.language, language), sql`${captions.words} is not null`));
    if (Number(timed[0]?.n ?? 0) === 0) {
      await say("transcribe", "Transcribing the footage with word timings. A minute or two on a long take.");
      const t = await transcribeProject(projectId, { language, diarize: true });
      await say("transcribe", `Transcribed: ${t.captions} lines, ${t.languageCode} (${Math.round(t.languageProbability * 100)}% sure)`);
    } else {
      await say("transcribe", "The transcript is already here");
    }

    /* ---- 3. cut ----------------------------------------------------- */
    const keepAll = /don'?t cut|do not cut|keep everything|no cuts|leave the cut|不要剪|不剪|保留全部|全部保留/i.test(brief);
    if (keepAll) {
      await say("cut", "Leaving the cut as it is, as asked");
    } else {
      await say("cut", "Taking out the dead air and choosing what to keep");
      const r = await autoEdit(viewer, projectId, { language, brief });
      await say("cut", `Cut to ${r.cuts} piece${r.cuts === 1 ? "" : "s"}, ${(r.removedMs / 1000).toFixed(1)}s removed${r.note ? ` (${r.note})` : ""}`);
    }

    /* ---- 4. design -------------------------------------------------- */
    await say("design", "Designing the titles, the captions, the punch-ins and the cutaways");

    const { rows: cutRows, totalMs } = await timelineOf(projectId);
    const cues = await db
      .select()
      .from(captions)
      .where(and(eq(captions.projectId, projectId), eq(captions.language, language)))
      .orderBy(asc(captions.startMs));
    const onTimeline = new Set(cutRows.map((r) => r.clipId).filter(Boolean));
    const clipList = footage.map((f) => ({
      id: f.c.id,
      label: f.c.label || f.name || "clip",
      seconds: Math.round((f.c.durationMs ?? 0) / 1000),
      spare: !onTimeline.has(f.c.id),
    }));

    const pictures = await db
      .select({ id: files.id, name: files.name })
      .from(files)
      .where(and(eq(files.tenantId, viewer.tenantId), eq(files.kind, "image"), isNull(files.deletedAt), canReadFiles(viewer)))
      .orderBy(desc(files.updatedAt))
      .limit(25);

    const beats = project.scriptId
      ? await db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, project.scriptId)).orderBy(asc(scriptBeats.ord))
      : [];

    const voice = await creatorVoiceText(viewer.tenantId);
    const line = (c: (typeof cues)[number]) => `[${c.startMs}–${c.endMs}ms] ${c.text}`;
    const transcript = cues.map(line).join("\n").slice(0, 26_000);

    const context = [
      `Brief from the producer:\n${brief || "(none given: make the best video the footage allows)"}`,
      P.prompt,
      `Aspect: ${aspect}. Language of the captions: ${language}.`,
      `The finished timeline runs to ${totalMs}ms in ${cutRows.length} cut${cutRows.length === 1 ? "" : "s"}.`,
      `Clips in the bin:\n${clipList.map((c) => `- ${c.id}  ${c.label}  ${c.seconds}s  ${c.spare ? "SPARE (can be a cutaway)" : "on the timeline"}`).join("\n")}`,
      pictures.length ? `Pictures in the studio's files:\n${pictures.map((p) => `- ${p.id}  ${p.name}`).join("\n")}` : "Pictures in the studio's files: none.",
      `Icons that exist: ${ICON_NAMES.join(", ")}.`,
      stockConfigured().pexels
        ? "A stock video library is available: ask for cutaway footage with \"footage\" queries in plain words."
        : "No stock video library is configured: cutaways can only come from the spare clips in the bin.",
      beats.length
        ? `The script this was shot to (the intended shape; the transcript is what was actually said):\n${beats
            .map((b) => `Beat ${b.ord + 1}: visual: ${b.visual.slice(0, 160)} | VO: ${b.voiceover.slice(0, 200)}`)
            .join("\n")
            .slice(0, 6000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    /*
     * Designed a minute at a time, not the whole video in one answer.
     *
     * One call over a six-minute transcript came back with a rich first
     * minute and almost nothing after it: attention spreads thin over a
     * hundred captions, and the studio saw "3 graphics" on a video that
     * named twenty companies. Each part now gets the whole brief, the whole
     * bin and only its own stretch of transcript, so the fifth minute is
     * designed as carefully as the first. Part 1 places the opening
     * furniture and the last part the end card; the rest are told not to,
     * so nothing is set twice. The parts run together, so six of them cost
     * the wall-clock of one. A part that fails loses its own minute and
     * nothing else.
     */
    const WINDOW_MS = 60_000;
    const windowCount = Math.max(1, Math.ceil(totalMs / WINDOW_MS));
    const windows = Array.from({ length: windowCount }, (_, i) => {
      const from = i * WINDOW_MS;
      const to = i === windowCount - 1 ? totalMs : (i + 1) * WINDOW_MS;
      return { i, from, to, text: cues.filter((c) => c.startMs >= from && c.startMs < to).map(line).join("\n") };
    }).filter((w, _, all) => w.text.length > 0 || all.length === 1);

    const system = `${VIDEO_CRAFT}\n\n---\n\n${HOUSE_FORMAT}\n\n---\n\n${voice ? `The creator whose channel this is for, in their own numbers and words. Make it look and sound like theirs:\n${voice}\n\n---\n\n` : ""}${DESIGN_PROMPT}`;

    const designWindow = async (w: (typeof windows)[number]): Promise<Plan> => {
      const last = windows.length - 1;
      const note = [
        `You are designing part ${w.i + 1} of ${windows.length}: the stretch from ${w.from}ms to ${w.to}ms of a video that runs to ${totalMs}ms.`,
        `Place graphics, punch-ins, cutaways, pictures and footage ONLY between ${w.from}ms and ${w.to}ms, as densely as the pace asks: every named thing, every number, every claim in this stretch gets something on screen.`,
        w.i === 0
          ? "This is the opening: the hook, the title, the header, the watermark and the footnote are yours to place."
          : 'The opening hook, title, header, watermark and footnote were placed in part 1. Do not repeat them: leave "title", "header", "watermark" and "footnote" null.',
        w.i === last ? "This is the ending: the end card is yours to place." : "The end card belongs to the last part, not to this one.",
      ].join(" ");
      const out = await complete({
        model: modelFor.assistant(),
        temperature: 0.5,
        // A minute's plan fits easily; the old whole-video call did not, and
        // came back truncated with no error. Check completion_tokens in
        // ai_usage against this if a part ever comes back empty.
        maxTokens: 8000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${context}\n\n${note}\n\nTranscript for this part:\n${w.text || "(nothing was said in this stretch)"}` },
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
      const part = parsePlan(out.text, totalMs);
      // A part that wanders outside its own minute would double up with its
      // neighbour, so anything placed elsewhere is dropped.
      const within = <T extends { startMs: number }>(xs: T[]) => xs.filter((x) => x.startMs >= w.from - 500 && x.startMs < w.to + 500);
      return { ...part, graphics: within(part.graphics), punches: within(part.punches), broll: within(part.broll), footage: within(part.footage), pictures: within(part.pictures) };
    };

    let plan: Plan = empty();
    let designNote: string | null = null;
    const settled = await Promise.allSettled(windows.map(designWindow));
    const failed: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "rejected") {
        failed.push(`part ${i + 1}: ${r.reason instanceof Error ? r.reason.message.slice(0, 80) : "unknown"}`);
        return;
      }
      const part = r.value;
      plan.title ??= part.title;
      plan.header ??= part.header;
      plan.watermark ??= part.watermark;
      plan.footnote ??= part.footnote;
      if (!plan.look.captionPreset && part.look.captionPreset) plan.look = part.look;
      plan.graphics.push(...part.graphics);
      plan.punches.push(...part.punches);
      plan.broll.push(...part.broll);
      plan.footage.push(...part.footage);
      plan.pictures.push(...part.pictures);
      if (part.notes) plan.notes = plan.notes ? `${plan.notes} ${part.notes}` : part.notes;
    });
    if (!plan.graphics.length && !plan.title) {
      designNote = failed.length
        ? `The model could not be reached (${failed[0]}); the cut and the captions are here without titles.`
        : "The model returned no usable design; the cut and the captions are here without titles.";
    } else if (failed.length) {
      designNote = `${failed.length} of ${windows.length} parts could not be designed (${failed[0]}); the rest are on the timeline.`;
    }

    /* ---- 5. check and write ----------------------------------------- */
    await say("write", "Writing the design onto the timeline");

    const said = `${transcript}\n${brief}`.replace(/[,，]/g, "");
    const clipById = new Map(footage.map((f) => [f.c.id, f.c]));
    const rows: (typeof videoGraphics.$inferInsert)[] = [];
    let lastEnd = -1;

    const sortedGraphics = plan.graphics.slice().sort((a, b) => a.startMs - b.startMs);
    for (const g of sortedGraphics) {
      if (!isGraphicKind(g.kind) || g.kind === "image" || g.kind === "broll" || g.kind === "punch") continue;
      if ((FURNITURE_KINDS as readonly string[]).includes(g.kind)) continue;
      if (rows.filter((r) => r.kind !== "punch" && r.kind !== "broll").length >= Math.max(8, Math.ceil(totalMs / (P.perSec * 1000)))) break;
      const text = g.text.trim().slice(0, 120);
      if (!text && g.kind !== "icon") continue;
      // A figure that was never said stays off the screen; a "stat" with no
      // figure in it is a line, and is set as one.
      let kind: string = g.kind;
      if (kind === "stat") {
        const digits = text.replace(/[,，\s]/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
        if (!digits.length && !/[一二三四五六七八九十百千万亿]/.test(text)) kind = "statement";
        else if (digits.length && !digits.every((d) => said.includes(d))) continue;
      }
      // An icon in a bottom corner lands on the watermark and the footnote;
      // the top corners are its own.
      const placement =
        kind === "icon"
          ? isPlacement(g.placement) && g.placement.startsWith("top")
            ? g.placement
            : "top-right"
          : isPlacement(g.placement)
            ? g.placement
            : "center";
      // One line of text at a time, with air between. An icon sits in a
      // corner and may share the frame with a line.
      const isText = g.kind !== "icon";
      if (isText && g.startMs < lastEnd + P.textGap) continue;
      const startMs = Math.max(0, Math.min(totalMs - 800, g.startMs));
      const endMs = Math.max(startMs + 1200, Math.min(totalMs, g.endMs));
      if (isText) lastEnd = endMs;
      rows.push({
        id: newId("gfx"),
        projectId,
        kind,
        text: kind === "icon" ? text.slice(0, 40) : text,
        sub: g.sub?.trim().slice(0, 120) || null,
        startMs,
        endMs,
        icon: kind === "icon" ? (isIconName(g.icon) ? g.icon : "check") : null,
        placement,
        scale: kind === "icon" ? 18 : 30,
        options: { enter: kind === "stat" && pace === "hype" ? "slam" : asEntrance(g.enter), why: g.why.slice(0, 80) },
        ord: rows.length,
      });
    }

    /* The hook the rules ask for, if the model forgot it: the title it wrote,
       over the opening line. A video that opens on nothing is the one thing
       the house rules refuse before anything else. */
    if (plan.title && !rows.some((r) => (r.startMs ?? 0) <= 1500)) {
      const first = rows.find((r) => r.kind !== "punch" && r.kind !== "broll");
      const endMs = Math.min(3200, first ? Math.max(1500, (first.startMs ?? 0) - 400) : 3200, totalMs);
      if (endMs >= 1500) {
        rows.unshift({
          id: newId("gfx"),
          projectId,
          kind: "title",
          text: plan.title.slice(0, 80),
          sub: null,
          startMs: 200,
          endMs,
          placement: "center",
          scale: 30,
          options: { enter: "pop", why: "the hook, from the title" },
          ord: 0,
        });
      }
    }

    /* The furniture: header, watermark, footnote. Outside the one-at-a-time
       rule and the density cap, because they are the frame the rest sits in. */
    if (plan.header) {
      const fromMs = Math.max(0, Math.min(totalMs - 2000, plan.header.fromMs));
      rows.push({ id: newId("gfx"), projectId, kind: "header", text: plan.header.title, sub: plan.header.sub, startMs: fromMs, endMs: totalMs, placement: "top-left", scale: 30, options: { enter: "fade" }, ord: rows.length });
    }
    if (plan.watermark) {
      rows.push({ id: newId("gfx"), projectId, kind: "watermark", text: plan.watermark.text, sub: plan.watermark.sub, startMs: 0, endMs: totalMs, placement: "bottom-center", scale: 30, options: { enter: "fade" }, ord: rows.length });
    }
    if (plan.footnote) {
      rows.push({ id: newId("gfx"), projectId, kind: "footnote", text: plan.footnote, startMs: 0, endMs: totalMs, placement: "bottom-center", scale: 30, options: { enter: "fade" }, ord: rows.length });
    }

    let punchEnd = -60_000;
    for (const p of plan.punches.slice().sort((a, b) => a.startMs - b.startMs)) {
      if (p.startMs < punchEnd + 20_000) continue;
      const startMs = Math.max(0, p.startMs);
      const endMs = Math.min(totalMs, Math.max(startMs + 2000, Math.min(startMs + 6000, p.endMs)));
      if (endMs - startMs < 1500) continue;
      punchEnd = endMs;
      rows.push({
        id: newId("gfx"),
        projectId,
        kind: "punch",
        text: "punch in",
        startMs,
        endMs,
        placement: "center",
        scale: 30,
        options: { zoom: Math.max(1.1, Math.min(1.3, p.zoom || 1.15)), why: p.why.slice(0, 80) },
        ord: rows.length,
      });
    }

    let brollEnd = -1;
    for (const b of plan.broll.slice().sort((a, b) => a.startMs - b.startMs)) {
      const clip = clipById.get(b.clipId);
      if (!clip || onTimeline.has(clip.id)) continue;
      if (b.startMs < Math.max(5000, brollEnd + 3000)) continue;
      const sourceInMs = Math.max(0, Math.min(clip.durationMs ? Math.max(0, clip.durationMs - 3000) : 0, b.sourceInMs || 0));
      const maxLen = clip.durationMs ? clip.durationMs - sourceInMs : 8000;
      const startMs = b.startMs;
      const endMs = Math.min(totalMs, startMs + Math.min(P.clipMs, Math.max(2500, b.endMs - startMs), maxLen));
      if (endMs - startMs < 2000) continue;
      brollEnd = endMs;
      rows.push({
        id: newId("gfx"),
        projectId,
        kind: "broll",
        text: clip.label || "cutaway",
        startMs,
        endMs,
        placement: cutawayPlacement(b.placement, pace),
        scale: 34,
        options: { clipId: clip.id, sourceInMs, why: b.why.slice(0, 80) },
        ord: rows.length,
      });
      if (rows.filter((r) => r.kind === "broll").length >= 6) break;
    }

    /* ---- 5b. stock footage ----------------------------------------- */
    if (stockConfigured().pexels && plan.footage.length) {
      let stockEnd = -1;
      for (const f of plan.footage.slice().sort((a, b) => a.startMs - b.startMs)) {
        if (f.startMs < Math.max(pace === "hype" ? 1500 : 5000, stockEnd + P.footageGap)) continue;
        const startMs = f.startMs;
        const endMs = Math.min(totalMs, Math.max(startMs + 2500, Math.min(startMs + P.clipMs, f.endMs)));
        if (endMs - startMs < 2500) continue;
        await say("pictures", `Looking for footage of "${f.query}"`);
        const found = await searchStockClips(f.query, {
          orientation: aspect === "9:16" ? "portrait" : aspect === "1:1" ? "square" : "landscape",
          limit: 5,
        }).catch(() => []);
        const pick = found.find((c) => c.durationSec >= (endMs - startMs) / 1000) ?? found[0];
        if (!pick) continue;
        try {
          const brought = await importVideo(viewer, {
            url: pick.url,
            name: `stock · ${f.query}`,
            attribution: clipAttribution(pick),
            source: pick.source,
          });
          const clipId = await addClip(viewer, projectId, brought.id);
          rows.push({
            id: newId("gfx"),
            projectId,
            kind: "broll",
            text: f.query.slice(0, 60),
            startMs,
            endMs,
            placement: cutawayPlacement("pip", pace),
            scale: 34,
            options: { clipId, sourceInMs: 0, why: f.why.slice(0, 80), credit: clipAttribution(pick) },
            ord: rows.length,
          });
          stockEnd = endMs;
        } catch {
          // A clip that would not come in is a cutaway not made; the rest stand.
        }
      }
    }

    /* ---- 6. pictures ------------------------------------------------ */
    const pictureRows: (typeof videoGraphics.$inferInsert)[] = [];
    const known = new Set(pictures.map((p) => p.id));
    let pictureEnd = -1;
    for (const p of plan.pictures.slice().sort((a, b) => a.startMs - b.startMs).slice(0, P.pictures)) {
      const startMs = Math.max(0, p.startMs);
      // Short by design: a picture is a beat, not a scene. The pace caps it
      // (3 s in hype, 4 s on the channel, 5 s calm) whatever the model asked.
      const endMs = Math.min(totalMs, Math.max(startMs + (pace === "hype" ? 1500 : 2000), Math.min(startMs + P.pictureMs, p.endMs)));
      if (endMs - startMs < 1200) continue;
      // Full-frame pictures do not stack: the later one waits its turn.
      if (startMs < pictureEnd) continue;
      let fileId: string | null = p.fileId && known.has(p.fileId) ? p.fileId : null;
      let credit: string | null = null;
      if (!fileId && p.query) {
        await say("pictures", `Looking for a picture of "${p.query}"`);
        const found = await searchAnyPicture(p.query, 4).catch(() => []);
        const pick = found.find((f) => (f.width ?? 0) >= 800) ?? found[0];
        if (pick) {
          try {
            const brought = await importPicture(viewer, {
              url: pick.url,
              name: pick.title,
              attribution: attributionFor(pick),
              source: pick.source,
            });
            fileId = brought.id;
            credit = attributionFor(pick);
          } catch {
            fileId = null;
          }
        }
      }
      if (!fileId) continue;
      // In hype, every picture is the whole frame with the slow push; the
      // channel's own pace keeps a picture where the model put it.
      const placement = pace === "hype" ? "full" : isPlacement(p.placement) || p.placement === "full" ? p.placement : "center";
      pictureEnd = endMs;
      pictureRows.push({
        id: newId("gfx"),
        projectId,
        kind: "image",
        text: p.caption.slice(0, 60),
        startMs,
        endMs,
        fileId,
        placement,
        scale: placement === "full" ? 90 : 42,
        options: { enter: placement === "full" ? "zoom" : "fade", why: p.why.slice(0, 80), ...(credit ? { credit } : {}) },
        ord: rows.length + pictureRows.length,
      });
    }

    // The design replaces what the first cut placed: this is the whole video,
    // and a second lower third on top of the first is not a design.
    await db.delete(videoGraphics).where(eq(videoGraphics.projectId, projectId));
    const all = [...rows, ...pictureRows];
    if (all.length) await db.insert(videoGraphics).values(all);

    /* ---- the look --------------------------------------------------- */
    const timedCues = cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words }));
    /* Bilingual captions: the translation and the keywords, one model call
       per forty lines, written as a second language track plus keywords on
       the first. The channel's own look, and the only preset that reads it. */
    const bilingual = plan.look.bilingual || plan.look.captionPreset === "bilingual";
    if (bilingual && cues.length) {
      await say("write", "Translating the captions and choosing the keywords");
      await translateCues(viewer, projectId, language, cues);
    }
    const wantedPreset = plan.look.captionPreset && CAPTION_PRESETS.some((p) => p.key === plan.look.captionPreset) ? plan.look.captionPreset : null;
    const preset = bilingual
      ? "bilingual"
      : wantedPreset && (CAPTION_PRESETS.find((p) => p.key === wantedPreset)?.style.karaoke ? canKaraoke(timedCues) : true)
        ? wantedPreset
        : canKaraoke(timedCues)
          ? aspect === "9:16"
            ? "pop"
            : "spoken"
          : "clean";
    const accent = plan.look.accent && /^#[0-9a-f]{6}$/i.test(plan.look.accent) ? plan.look.accent : project.accent;
    const title = plan.title && (project.title.startsWith("Untitled") || /^new project|^未命名/i.test(project.title)) ? plan.title.slice(0, 120) : project.title;

    await db
      .update(videoProjects)
      .set({ captionPreset: preset, accent, title, updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId));

    const result: DirectResult = {
      cuts: cutRows.length,
      graphics: rows.filter((r) => r.kind !== "punch" && r.kind !== "broll").length + pictureRows.length,
      punches: rows.filter((r) => r.kind === "punch").length,
      broll: rows.filter((r) => r.kind === "broll").length,
      pictures: pictureRows.length,
      title,
      notes: [plan.notes, designNote].filter(Boolean).join(" ") || undefined,
    };

    /* ---- 7. render -------------------------------------------------- */
    // The counts are kept before the encoder starts, so a run interrupted
    // here can pick up at the render with the same summary.
    await patch(projectId, (d) => ({ ...d, result, language }));
    if (wantRender) await renderStep(viewer, projectId, aspect, language, result, say);

    await finish(viewer, projectId, jobId, result);
    return result;
  } catch (err) {
    await onFailure(projectId, err);
    throw err;
  }
}

type Say = (step: DirectorState["step"], text: string) => Promise<void>;

async function renderStep(viewer: Viewer, projectId: string, aspect: string, language: string, result: DirectResult, say: Say) {
  await say("render", `Rendering ${aspect} with the captions burnt in. Minutes on a long cut.`);
  const exportId = newId("rnd");
  await db.insert(videoExports).values({
    id: exportId,
    tenantId: viewer.tenantId,
    projectId,
    aspect,
    burnCaptions: "burn",
    captionLanguage: language,
    requestedBy: viewer.id,
  });
  const rendered = await renderExport(exportId);
  result.exportId = exportId;
  result.fileId = rendered.fileId;
  await say("render", `Rendered: ${(rendered.durationMs / 1000).toFixed(0)}s`);
  return result;
}

async function finish(viewer: Viewer, projectId: string, jobId: string | undefined, result: DirectResult) {
  await patch(projectId, (d) => ({
    ...d,
    state: "done",
    step: undefined,
    note: undefined,
    resume: undefined,
    finishedAt: new Date().toISOString(),
    result,
  }));

  await audit(viewer, "video.direct", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
    meta: { ...result, jobId },
  });
}

/**
 * A restart under the encoder is not a failure: the run goes back to queued
 * with a note, and the next worker resumes at the render. Anything else is
 * a failure the screen shows as it was said.
 */
async function onFailure(projectId: string, err: unknown) {
  if (isInterrupted(err)) {
    await patch(projectId, (d) => ({
      ...d,
      state: "queued",
      resume: d.result ? "render" : undefined,
      note: "The worker restarted during the render. Picking it up again in a moment.",
      error: undefined,
    }));
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  await patch(projectId, (d) => ({ ...d, state: "failed", error: message.slice(0, 1000), finishedAt: new Date().toISOString() }));
}

/* --------------------------------------------------------- translation */

const TRANSLATE_PROMPT = `You subtitle a Chinese business creator's videos in two languages.

You are given numbered caption lines. Answer with a single JSON object and nothing else, the first character an opening brace:
{ "lines": [ { "i": 0, "second": "the same line in the other language, short, natural, under 12 words", "keywords": ["one to three words from the ORIGINAL line worth the accent colour: a product, a number, the verb it turns on"] } ] }

Rules:
 - "keywords" must be copied verbatim from the original line, or be an empty list. Never rewrite them.
 - If the line is Chinese, "second" is English. If the line is English, "second" is Simplified Chinese.
 - Keep numbers and names exactly. No quotation marks around the line.`;

/** Write the second-language track and the keywords for the bilingual preset. */
async function translateCues(
  viewer: Viewer,
  projectId: string,
  language: string,
  cues: (typeof captions.$inferSelect)[],
) {
  const other = /^zh/.test(language) ? "en" : "zh-CN";
  const out: { i: number; second: string; keywords: string[] }[] = [];

  for (let at = 0; at < cues.length; at += 40) {
    const batch = cues.slice(at, at + 40);
    try {
      const res = await complete({
        model: modelFor.utility(),
        temperature: 0.2,
        maxTokens: 8000,
        messages: [
          { role: "system", content: TRANSLATE_PROMPT },
          { role: "user", content: batch.map((c, j) => `${at + j}. ${c.text}`).join("\n") },
        ],
      });
      await recordUsage({
        viewer,
        module: "video",
        provider: res.provider ?? "openrouter",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
        costMicros: res.costMicros,
        requestId: res.requestId,
      });
      const body = res.text.replace(/<\/?think(?:ing)?>/gi, "\n");
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      if (start < 0 || end <= start) continue;
      const parsed = JSON.parse(body.slice(start, end + 1)) as { lines?: { i?: unknown; second?: unknown; keywords?: unknown }[] };
      for (const l of parsed.lines ?? []) {
        const i = Number(l.i);
        if (!Number.isInteger(i) || !cues[i]) continue;
        const second = typeof l.second === "string" ? l.second.trim().slice(0, 200) : "";
        const keywords = Array.isArray(l.keywords)
          ? l.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0 && cues[i].text.includes(k.trim())).map((k) => k.trim()).slice(0, 3)
          : [];
        out.push({ i, second, keywords });
      }
    } catch {
      // A batch that failed leaves its lines plain; the rest still get theirs.
    }
  }

  await db.delete(captions).where(and(eq(captions.projectId, projectId), eq(captions.language, other)));
  for (const o of out) {
    const c = cues[o.i];
    await db.update(captions).set({ keywords: o.keywords }).where(eq(captions.id, c.id));
    if (o.second) {
      await db.insert(captions).values({
        id: newId("beat"),
        projectId,
        startMs: c.startMs,
        endMs: c.endMs,
        text: o.second,
        language: other,
        ord: c.ord,
      });
    }
  }
}

/* ------------------------------------------------------------- helpers */

async function timelineOf(projectId: string) {
  const items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord));
  const clipIds = items.map((i) => i.clipId).filter((c): c is string => Boolean(c));
  const clips = clipIds.length ? await db.select().from(videoClips).where(inArray(videoClips.id, clipIds)) : [];
  const byId = new Map(clips.map((c) => [c.id, c]));
  let at = 0;
  const rows = items.map((i) => {
    const clip = i.clipId ? byId.get(i.clipId) : undefined;
    const outMs = i.outMs ?? clip?.durationMs ?? i.inMs + i.holdMs;
    const lengthMs = i.kind === "title" ? Math.max(1, i.holdMs) : Math.max(1, outMs - i.inMs);
    const row = { id: i.id, clipId: i.clipId, atMs: at, lengthMs };
    at += lengthMs;
    return row;
  });
  return { rows, totalMs: at };
}

function empty(): Plan {
  return {
    title: null,
    look: { captionPreset: null, accent: null, bilingual: false },
    header: null,
    watermark: null,
    footnote: null,
    graphics: [],
    punches: [],
    broll: [],
    footage: [],
    pictures: [],
    notes: null,
  };
}

/** The plan out of the answer, bounded, however the model wrapped it. */
export function parsePlan(text: string, totalMs: number): Plan {
  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const raw = candidate(fenced ? fenced[1] : body);
  if (!raw) return empty();

  const ms = (v: unknown): number | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(totalMs, Math.round(n));
  };
  const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "object" && x !== null) : []) as Record<string, unknown>[];

  const look = (raw.look ?? {}) as Record<string, unknown>;
  const header = (raw.header ?? null) as Record<string, unknown> | null;
  const watermark = (raw.watermark ?? null) as Record<string, unknown> | null;
  return {
    title: s(raw.title, 120) || null,
    look: { captionPreset: s(look.captionPreset, 20) || null, accent: s(look.accent, 9) || null, bilingual: look.bilingual === true },
    header: header && s(header.title, 80) ? { title: s(header.title, 80), sub: s(header.sub, 120) || null, fromMs: ms(header.fromMs) ?? 10_000 } : null,
    watermark: watermark && s(watermark.text, 60) ? { text: s(watermark.text, 60), sub: s(watermark.sub, 60) || null } : null,
    footnote: s(raw.footnote, 160) || null,
    graphics: list(raw.graphics)
      .map((g) => {
        const startMs = ms(g.startMs);
        const endMs = ms(g.endMs);
        if (startMs === null || endMs === null) return null;
        return {
          kind: s(g.kind, 20),
          text: s(g.text, 200),
          sub: s(g.sub, 160) || null,
          startMs,
          endMs,
          enter: s(g.enter, 10),
          icon: s(g.icon, 20) || null,
          placement: s(g.placement, 20) || null,
          why: s(g.why, 80),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .slice(0, 40),
    punches: list(raw.punches)
      .map((p) => {
        const startMs = ms(p.startMs);
        const endMs = ms(p.endMs);
        if (startMs === null || endMs === null) return null;
        return { startMs, endMs, zoom: Number(p.zoom) || 1.15, why: s(p.why, 80) };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 20),
    broll: list(raw.broll)
      .map((b) => {
        const startMs = ms(b.startMs);
        const endMs = ms(b.endMs);
        if (startMs === null || endMs === null) return null;
        return {
          clipId: s(b.clipId, 64),
          startMs,
          endMs,
          sourceInMs: Math.max(0, Number(b.sourceInMs) || 0),
          placement: s(b.placement, 20) || "full",
          why: s(b.why, 80),
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .slice(0, 12),
    footage: list(raw.footage)
      .map((f) => {
        const startMs = ms(f.startMs);
        const endMs = ms(f.endMs);
        if (startMs === null || endMs === null) return null;
        return { query: s(f.query, 120), startMs, endMs, why: s(f.why, 80) };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null && f.query.length > 0)
      .slice(0, 8),
    pictures: list(raw.pictures)
      .map((p) => {
        const startMs = ms(p.startMs);
        const endMs = ms(p.endMs);
        if (startMs === null || endMs === null) return null;
        return {
          fileId: s(p.fileId, 64) || null,
          query: s(p.query, 120) || null,
          startMs,
          endMs,
          placement: s(p.placement, 20) || "center",
          caption: s(p.caption, 60),
          why: s(p.why, 80),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 60),
    notes: s(raw.notes, 800) || null,
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
            if (typeof value === "object" && value !== null && ("graphics" in value || "look" in value)) {
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

