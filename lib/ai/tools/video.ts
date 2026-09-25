import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, files, timelineItems, videoClips, videoGraphics, videoProjects } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { ToolDef } from "@/lib/ai/openrouter";
import {
  asEntrance,
  asTransition,
  CAPTION_PRESETS,
  ENTRANCES,
  GRAPHIC_KIND_KEYS,
  isGraphicKind,
} from "@/lib/video/presets";
import { ICON_NAMES, isIconName } from "@/lib/video/icons";
import { canReadFiles } from "@/lib/authz/rebac";
import { addClip, addGraphic, requestDirector, directorRunning } from "@/lib/video/service";
import type { DirectorState } from "@/lib/video/director";
import { importPicture } from "@/lib/files/service";
import { attributionFor, clipAttribution, needsCredit, searchAnyPicture, searchStockClips, stockById, stockClipById, stockConfigured } from "@/lib/video/stock";
import { importVideo } from "@/lib/files/service";
import { mapTime, mergeRanges, speechRanges, type Range } from "@/lib/video/ranges";
import { autoEdit } from "@/lib/video/autoedit";
import { clock, id as asId, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Editing the video by asking.
 *
 * The whole timeline as tools, so the one agent that is on every screen can
 * cut a video the same way it can summarise a channel. Every tool is bound to
 * the project **on screen** — the model is never given a project id and cannot
 * reach another one by inventing a string.
 *
 * Three rules the prompt asks for and this enforces:
 *
 *   1. **Look before acting.** `describe_timeline` is the only way to know
 *      what is there.
 *   2. **Find moments by what was said**, never by guessing a timecode:
 *      `find_in_transcript` turns "where I stumble" into a real range.
 *   3. **Every structural edit goes through one function.** Removing a range,
 *      keeping only a range and cutting the silences differ solely in which
 *      spans survive, so captions and graphics are re-timed by the same code
 *      every time instead of by three near-copies that drift.
 */
/* ------------------------------------------------------------------ tools */

const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "describe_timeline",
      description:
        "The current state of the edit: every cut with its position and source range, every caption, every graphic, the caption preset and the accent colour. Call this before your first change in a turn.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_in_transcript",
      description:
        "Find where something was said. Returns the matching lines with their positions on the timeline. Use this whenever the person refers to a moment by its content rather than by a timecode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for. Case-insensitive." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_range",
      description:
        "Cut a span out of the finished video. Positions are on the timeline, in milliseconds, as describe_timeline reports them. Captions and graphics inside the span go with it; everything after it moves earlier.",
      parameters: {
        type: "object",
        properties: {
          startMs: { type: "number" },
          endMs: { type: "number" },
          why: { type: "string", description: "Five words on why, for the record." },
        },
        required: ["startMs", "endMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "keep_only",
      description:
        "Keep one span of the finished video and drop everything else. For 'just the first minute' or 'only the part about pricing'.",
      parameters: {
        type: "object",
        properties: { startMs: { type: "number" }, endMs: { type: "number" } },
        required: ["startMs", "endMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_silences",
      description:
        "Take out every pause longer than a threshold, using the transcript's own word timings. This is arithmetic, not judgement, and is usually the first thing worth doing to a raw take.",
      parameters: {
        type: "object",
        properties: {
          keepMs: {
            type: "number",
            description: "Pauses shorter than this are speech and are kept. Default 600.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_graphic",
      description:
        "Put a graphic over the picture. lower-third: a name and a role under whoever is speaking. title: one line naming what is coming. statement: one short line on a scrim, six words at most. chapter: a small marker for a video with parts. stat: one figure, huge, with what it counts underneath. quote: somebody's words with the attribution under a rule. bracket: a section opener inside { } on black. ticker: a strip along the bottom for a source or a disclaimer. badge: a small corner mark that can hold for a whole section. end-card: full frame on black, the last thing, and the only place a call to action belongs. Positions are on the timeline. (For a cutaway use add_broll; for a zoom use punch_in.)",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: GRAPHIC_KIND_KEYS.filter((k) => k !== "image" && k !== "icon" && k !== "broll" && k !== "punch") },
          text: { type: "string" },
          sub: { type: "string", description: "Second line: a role, a source. Optional." },
          startMs: { type: "number" },
          seconds: { type: "number", description: "How long it stays. Default 3." },
          enter: { type: "string", enum: [...ENTRANCES], description: "How it arrives. Default fade; pop for a number, slide for a name." },
        },
        required: ["kind", "text", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_video",
      description:
        "Make the whole video from the footage in the bin and a brief: put the footage on the timeline, transcribe it, take out the dead air, choose the look, place the titles, captions, punch-ins, cutaways and pictures, and render it. Runs on the worker for a few minutes; the screen shows each step. Use it when the person asks for the video to be made, edited, finished or rendered as a whole. For one change to an existing cut, use the other tools instead.",
      parameters: {
        type: "object",
        properties: {
          brief: { type: "string", description: "What the video should be, in the person's own words: the subject, the mood, the platform, anything they asked for." },
          aspect: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Default 16:9. 9:16 for a short." },
          render: { type: "boolean", description: "Render the file at the end. Default true." },
          pace: { type: "string", enum: ["calm", "channel", "hype"], description: "How much happens on screen. hype = a full-frame visual for every named thing, every two to four seconds, the CapCut look. Default channel." },
        },
        required: ["brief"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_clips",
      description: "The clips in this project's bin with their ids and lengths, and whether each is on the timeline. Needed before add_broll.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "punch_in",
      description:
        "Push the picture in on the speaker for a beat: a zoom of 1.1 to 1.3 that arrives in a quarter of a second, holds, and cuts back. For the line that matters. Never two in a row.",
      parameters: {
        type: "object",
        properties: {
          startMs: { type: "number" },
          seconds: { type: "number", description: "How long it holds. 2 to 6. Default 3." },
          zoom: { type: "number", description: "1.1 to 1.3. Default 1.15." },
        },
        required: ["startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_broll",
      description:
        "Lay a clip from the bin over the picture for a few seconds while the speaker keeps talking: a cutaway to the thing being described. The clip must be in the bin (list_clips) and should not be the one on the timeline.",
      parameters: {
        type: "object",
        properties: {
          clip: { type: "string", description: "The clip's id or its label, from list_clips." },
          startMs: { type: "number", description: "Where on the timeline it appears." },
          seconds: { type: "number", description: "How long. 3 to 8. Default 4." },
          sourceInMs: { type: "number", description: "Where in the clip to start. Default 0." },
          placement: { type: "string", enum: ["pip", "full", "top-right", "bottom-right"], description: "pip fills the frame with the footage and keeps the speaker in a circle at the top right (the channel's layout); full covers the frame. Default pip." },
        },
        required: ["clip", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_enter",
      description: `How a graphic arrives, by its number from describe_timeline: ${ENTRANCES.join(", ")}.`,
      parameters: {
        type: "object",
        properties: { index: { type: "number" }, enter: { type: "string", enum: [...ENTRANCES] } },
        required: ["index", "enter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pictures",
      description:
        "Pictures in the studio's file store that this person can open, newest first, with their ids. Use it before add_picture: you cannot put a picture on the video without one of these ids, and you must never invent one.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Part of a filename. Optional." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_a_picture",
      description:
        "Search Openverse — the Creative Commons index over Flickr, Wikimedia, museums and the rest — for a picture of something the studio has no footage of. Results are filtered to licences that allow commercial use and modification, and every one comes back with its creator, its licence and the page it came from. Use it when the thing being spoken about is worth seeing and list_pictures has nothing. Then use take_picture to bring the one you chose into the studio's own files and put it on the video.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the picture should be of. Plain words." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_footage",
      description:
        "Search the licensed stock library (Pexels) for a video clip of a generic scene to cut away to: counting money, a trading screen, a factory floor, a city at night. Plain words. Returns clips with their ids and lengths; then take_footage lays one over the picture. Not for a specific product or person: use find_a_picture for those.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "take_footage",
      description:
        "Bring one clip from find_footage into the studio's files and the bin, and lay it over the picture as a cutaway at a moment, the speaker's sound continuing underneath.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id from find_footage." },
          startMs: { type: "number" },
          seconds: { type: "number", description: "3 to 8. Default 4." },
        },
        required: ["id", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "take_picture",
      description:
        "Copy one picture from find_a_picture into the studio's own file store — licence and credit recorded on the file — and put it on the video at a moment. Say in your answer who it is by and under what licence, because a licence other than CC0 needs that credit in the description.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id from find_a_picture." },
          startMs: { type: "number" },
          seconds: { type: "number", description: "How long it stays. Default 3." },
          placement: {
            type: "string",
            enum: ["center", "top-left", "top-right", "bottom-left", "bottom-right", "full"],
          },
          scale: { type: "number", description: "Share of the frame height, 5-95. Default 40." },
          caption: { type: "string", description: "A word or two under it. Optional." },
        },
        required: ["id", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_picture",
      description:
        "Put a picture from the file store over the footage, from list_pictures. It fades in over a fifth of a second, holds, and leaves faster than it arrived. Use it when the thing being talked about is worth seeing — a product, a chart somebody made, a place. Not as decoration: one picture, one idea, and it goes when the idea does.",
      parameters: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "From list_pictures." },
          startMs: { type: "number" },
          seconds: { type: "number", description: "How long it stays. Default 3." },
          placement: {
            type: "string",
            enum: ["center", "top-left", "top-right", "bottom-left", "bottom-right", "full"],
            description: "full covers the frame; the corners sit over it. Default center.",
          },
          scale: { type: "number", description: "Share of the frame height, 5-90. Default 40." },
          caption: { type: "string", description: "A word or two under it. Optional." },
        },
        required: ["fileId", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_icon",
      description:
        `Mark a moment with one of the app's own icons, drawn in the project's accent colour and animated in and out. Use it when the speaker names a thing and there is no footage of it. One icon for one idea, never a row of them. Available: ${ICON_NAMES.join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          icon: { type: "string", enum: [...ICON_NAMES] },
          label: { type: "string", description: "A word under it. Optional, and usually better left out." },
          startMs: { type: "number" },
          seconds: { type: "number", description: "How long it stays. Default 2.5." },
          placement: {
            type: "string",
            enum: ["center", "top-left", "top-right", "bottom-left", "bottom-right"],
            description: "Default top-right, which keeps it off the captions.",
          },
          scale: { type: "number", description: "Share of the frame height, 5-60. Default 18." },
        },
        required: ["icon", "startMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_graphic",
      description: "Take a graphic off, by the number describe_timeline gave it.",
      parameters: {
        type: "object",
        properties: { index: { type: "number" } },
        required: ["index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_look",
      description:
        `Change the caption style for the whole video, or the one accent colour. Presets: ${CAPTION_PRESETS.map((p) => `${p.key} (${p.note.split(".")[0].toLowerCase()})`).join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          captionPreset: { type: "string", enum: CAPTION_PRESETS.map((p) => p.key) },
          accent: { type: "string", description: "A hex colour such as #007be0." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "first_cut",
      description:
        "Make a first pass at the whole video: take out the dead air, keep what is worth keeping, pick a hook, re-time the captions onto the result and place a name and chapter marks. It replaces the timeline, so only do it when they ask for a first cut or a fresh start. Needs a transcript.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_transition",
      description:
        "How one cut arrives from the one before it, by the cut's number from describe_timeline. Three choices and no more: cut (nothing between them — the default and usually right), dissolve (a cross-fade, for two shots of the same thing), dip (through black, which reads as time passing between sections). The first cut on the timeline has nothing to arrive from and cannot take one.",
      parameters: {
        type: "object",
        properties: {
          index: { type: "number", description: "Which cut, counting from 0 as describe_timeline lists them." },
          transition: { type: "string", enum: ["cut", "dissolve", "dip"] },
          ms: { type: "number", description: "How long it takes, in milliseconds. 300-600 is normal." },
        },
        required: ["index", "transition"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_caption",
      description: "Change the words of one caption, by the number describe_timeline gave it.",
      parameters: {
        type: "object",
        properties: { index: { type: "number" }, text: { type: "string" } },
        required: ["index", "text"],
      },
    },
  },
];

/* ------------------------------------------------------------ the running */

/** The cuts, with where each one sits on the finished timeline. */
async function timeline(projectId: string) {
  const items = await db
    .select()
    .from(timelineItems)
    .where(eq(timelineItems.projectId, projectId))
    .orderBy(asc(timelineItems.ord));

  const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, projectId));
  const byId = new Map(clips.map((c) => [c.id, c]));

  const rows = items.reduce<
    {
      id: string;
      kind: string;
      atMs: number;
      lengthMs: number;
      inMs: number;
      outMs: number;
      label: string;
      transition: "cut" | "dissolve" | "dip";
      transitionMs: number;
    }[]
  >((acc, i) => {
    const clip = i.clipId ? byId.get(i.clipId) : undefined;
    const outMs = i.outMs ?? clip?.durationMs ?? i.inMs + i.holdMs;
    const lengthMs = i.kind === "title" ? Math.max(1, i.holdMs) : Math.max(1, outMs - i.inMs);
    const previous = acc[acc.length - 1];
    acc.push({
      id: i.id,
      kind: i.kind,
      atMs: previous ? previous.atMs + previous.lengthMs : 0,
      lengthMs,
      inMs: i.inMs,
      outMs,
      label: i.kind === "title" ? (i.text ?? "title card") : (clip?.label ?? "clip"),
      transition: asTransition(i.transition),
      transitionMs: i.transitionMs,
    });
    return acc;
  }, []);

  const last = rows[rows.length - 1];
  return { rows, totalMs: last ? last.atMs + last.lengthMs : 0 };
}

/**
 * Rewrite the timeline to a new set of *timeline* spans to keep.
 *
 * Every structural edit reduces to this: removing a range, keeping only a
 * range, cutting the silences — they differ only in which spans survive. Doing
 * it once, here, means captions and graphics are re-timed by the same code
 * every time rather than by three near-copies.
 */
async function rewrite(ctx: ToolContext & { projectId: string; language: string }, keep: Range[]) {
  const { rows } = await timeline(ctx.projectId);
  if (rows.length === 0) return;

  // A timeline span becomes one or more source spans, because a span can
  // straddle a join between two cuts.
  const pieces: { itemId: string; kind: string; inMs: number; outMs: number }[] = [];
  for (const span of mergeRanges(keep)) {
    for (const row of rows) {
      const from = Math.max(span.startMs, row.atMs);
      const to = Math.min(span.endMs, row.atMs + row.lengthMs);
      if (to - from < 120) continue;
      pieces.push({
        itemId: row.id,
        kind: row.kind,
        inMs: row.inMs + (from - row.atMs),
        outMs: row.inMs + (to - row.atMs),
      });
    }
  }
  if (pieces.length === 0) throw new Error("that would leave nothing");

  const old = await db
    .select()
    .from(timelineItems)
    .where(eq(timelineItems.projectId, ctx.projectId));
  const oldById = new Map(old.map((o) => [o.id, o]));

  await db.delete(timelineItems).where(eq(timelineItems.projectId, ctx.projectId));
  await db.insert(timelineItems).values(
    pieces.map((p, i) => {
      const source = oldById.get(p.itemId);
      return {
        id: newId("beat"),
        projectId: ctx.projectId,
        kind: p.kind,
        clipId: source?.clipId ?? null,
        text: source?.text ?? null,
        inMs: Math.round(p.inMs),
        outMs: Math.round(p.outMs),
        holdMs: source?.holdMs ?? 0,
        ord: i * 10,
      };
    }),
  );

  await retime(ctx, mergeRanges(keep));
}

/** Captions and graphics moved onto the new timeline, and dropped if the piece
 * they sat on is gone. */
async function retime(ctx: ToolContext & { projectId: string; language: string }, keep: Range[]) {
  const cues = await db.select().from(captions).where(eq(captions.projectId, ctx.projectId));
  for (const c of cues) {
    const startMs = mapTime(c.startMs, keep);
    const endMs = mapTime(c.endMs, keep);
    if (startMs === null || endMs === null || endMs <= startMs) {
      await db.delete(captions).where(eq(captions.id, c.id));
      continue;
    }
    await db
      .update(captions)
      .set({
        startMs,
        endMs,
        words: (c.words ?? [])
          .map((w) => {
            const s = mapTime(w.start * 1000, keep);
            const e = mapTime(w.end * 1000, keep);
            return s === null || e === null ? null : { start: s / 1000, end: e / 1000, text: w.text };
          })
          .filter((w): w is { start: number; end: number; text: string } => w !== null),
      })
      .where(eq(captions.id, c.id));
  }

  const gs = await db.select().from(videoGraphics).where(eq(videoGraphics.projectId, ctx.projectId));
  for (const g of gs) {
    const startMs = mapTime(g.startMs, keep);
    if (startMs === null) {
      await db.delete(videoGraphics).where(eq(videoGraphics.id, g.id));
      continue;
    }
    const endMs = mapTime(g.endMs, keep) ?? startMs + (g.endMs - g.startMs);
    await db
      .update(videoGraphics)
      .set({ startMs, endMs: Math.max(startMs + 500, endMs) })
      .where(eq(videoGraphics.id, g.id));
  }
}

/**
 * A tool that did what it was asked.
 *
 * Every tool here answers in a sentence, whether it worked or refused —
 * "Punch in ×1.15 at 0:12" and "That could not be placed" are both strings —
 * so the caller could not tell them apart, and marked both as a change. A
 * success is wrapped in this instead, and only a wrapped answer earns a
 * receipt: an employee may then say it cut something only when it did.
 */
type Done = { text: string; done: true };
const done = (text: string): Done => ({ text, done: true });

/** The tools that only look. Everything else changes the project, but only
 * when it answers with `done`. */
export const VIDEO_READ_ONLY: readonly string[] = [
  "describe_timeline",
  "find_in_transcript",
  "list_clips",
  "list_pictures",
  "find_a_picture",
  "find_footage",
];

async function dispatch(ctx: ToolContext & { projectId: string; language: string }, name: string, rawArgs: string): Promise<string | Done> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return "Those arguments were not valid JSON. Try again with a single JSON object.";
  }
  
  if (name === "describe_timeline") {
    const { rows, totalMs } = await timeline(ctx.projectId);
    const cues = await db
      .select()
      .from(captions)
      .where(and(eq(captions.projectId, ctx.projectId), eq(captions.language, ctx.language)))
      .orderBy(asc(captions.startMs));
    const gs = await db
      .select()
      .from(videoGraphics)
      .where(eq(videoGraphics.projectId, ctx.projectId))
      .orderBy(asc(videoGraphics.startMs));
    const [project] = await db
      .select()
      .from(videoProjects)
      .where(eq(videoProjects.id, ctx.projectId))
      .limit(1);

    return [
      `Title: ${project?.title ?? "—"}`,
      `Length: ${clock(totalMs)} (${Math.round(totalMs)}ms)`,
      `Caption preset: ${project?.captionPreset ?? "clean"} · accent ${project?.accent ?? "#007be0"}`,
      "",
      `Cuts (${rows.length}), positions on the timeline:`,
      ...rows.map(
        (r, i) =>
          `  ${i}. ${clock(r.atMs)}–${clock(r.atMs + r.lengthMs)}  (${Math.round(r.atMs)}–${Math.round(
            r.atMs + r.lengthMs,
          )}ms)  ${r.label}${
            i > 0 && r.transition !== "cut" ? `  [arrives on a ${r.transition}, ${r.transitionMs}ms]` : ""
          }`,
      ),
      "",
      `Captions (${cues.length}):`,
      ...cues
        .slice(0, 60)
        .map((c, i) => `  ${i}. ${clock(c.startMs)}–${clock(c.endMs)}  ${c.text}`),
      cues.length > 60 ? `  …and ${cues.length - 60} more` : "",
      "",
      `Graphics (${gs.length}):`,
      ...gs.map((g, i) => {
        const o = (g.options ?? {}) as Record<string, unknown>;
        const detail =
          g.kind === "punch"
            ? `×${Number(o.zoom ?? 1.15).toFixed(2)}`
            : g.kind === "broll"
              ? `cutaway from ${clock(Number(o.sourceInMs ?? 0))} into the clip, ${g.placement}`
              : `${g.text}${g.sub ? ` / ${g.sub}` : ""} · arrives: ${asEntrance(o.enter)}`;
        return `  ${i}. ${clock(g.startMs)}–${clock(g.endMs)}  ${g.kind}: ${detail}`;
      }),
      "",
      describeDirector(project?.director as DirectorState | undefined),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (name === "make_video") {
    const brief = str(args.brief, 4000);
    if (!brief) return "Say what the video should be.";
    const [project] = await db.select({ director: videoProjects.director }).from(videoProjects).where(eq(videoProjects.id, ctx.projectId)).limit(1);
    if (directorRunning(project?.director as DirectorState | undefined)) {
      return "It is already making this video. Wait for it to finish; the steps are on screen.";
    }
    const aspect = ["16:9", "9:16", "1:1"].includes(str(args.aspect, 5)) ? str(args.aspect, 5) : "16:9";
    const render = typeof args.render === "boolean" ? args.render : true;
    const pace = ["calm", "channel", "hype"].includes(str(args.pace, 10)) ? str(args.pace, 10) : /hype|capcut|fast|dense|快|多|炸|燃/i.test(brief) ? "hype" : "channel";
    try {
      await requestDirector(ctx.viewer, ctx.projectId, { brief, aspect, render, language: ctx.language, pace });
    } catch (err) {
      return err instanceof Error ? err.message : "That could not be started.";
    }
    return done(`Making it now: footage → transcribe → cut → design → ${render ? `render ${aspect}` : "no render"}. It takes a few minutes; each step shows on screen, and you can undo the lot afterwards with ⌘Z.`);
  }

  if (name === "list_clips") {
    const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, ctx.projectId)).orderBy(asc(videoClips.addedAt));
    if (!clips.length) return "The bin is empty. Drop a clip on the editor first.";
    const items = await db.select({ clipId: timelineItems.clipId }).from(timelineItems).where(eq(timelineItems.projectId, ctx.projectId));
    const onTimeline = new Set(items.map((i) => i.clipId));
    return [
      `Clips in the bin (${clips.length}):`,
      ...clips.map((c) => `  ${c.id}  ${c.label}  ${clock(c.durationMs ?? 0)}  ${onTimeline.has(c.id) ? "on the timeline" : "spare, can be a cutaway"}`),
    ].join("\n");
  }

  if (name === "punch_in") {
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(1.5, Math.min(8, num(args.seconds, 3)));
    const zoom = Math.max(1.05, Math.min(1.5, num(args.zoom, 1.15)));
    try {
      await addGraphic(ctx.viewer, ctx.projectId, { kind: "punch", text: "punch in", startMs, endMs: startMs + Math.round(seconds * 1000), zoom });
    } catch (err) {
      return err instanceof Error ? err.message : "That could not be placed.";
    }
    return done(`Punch in ×${zoom.toFixed(2)} at ${clock(startMs)} for ${seconds}s.`);
  }

  if (name === "add_broll") {
    const wanted = str(args.clip, 200).toLowerCase();
    if (!wanted) return "Which clip? Call list_clips first.";
    const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, ctx.projectId));
    const clip =
      clips.find((c) => c.id.toLowerCase() === wanted) ??
      clips.find((c) => c.label.toLowerCase() === wanted) ??
      clips.find((c) => c.label.toLowerCase().includes(wanted)) ??
      null;
    if (!clip) return `No clip in the bin matches "${str(args.clip, 200)}". Call list_clips to see them.`;
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(2, Math.min(10, num(args.seconds, 4)));
    const placement = ["pip", "full", "top-right", "bottom-right"].includes(str(args.placement, 20)) ? str(args.placement, 20) : "pip";
    try {
      await addGraphic(ctx.viewer, ctx.projectId, {
        kind: "broll",
        text: clip.label,
        startMs,
        endMs: startMs + Math.round(seconds * 1000),
        clipId: clip.id,
        sourceInMs: Math.max(0, Math.round(num(args.sourceInMs, 0))),
        placement,
      });
    } catch (err) {
      return err instanceof Error ? err.message : "That could not be placed.";
    }
    return done(`Cutaway to ${clip.label} at ${clock(startMs)} for ${seconds}s (${placement}).`);
  }

  if (name === "set_enter") {
    const gs = await db.select().from(videoGraphics).where(eq(videoGraphics.projectId, ctx.projectId)).orderBy(asc(videoGraphics.startMs));
    const g = gs[Math.round(num(args.index, -1))];
    if (!g) return `There is no graphic ${num(args.index)}. There are ${gs.length}.`;
    if (g.kind === "punch" || g.kind === "broll") return "A punch-in and a cutaway arrive their own way; this is for the text and picture graphics.";
    const enter = asEntrance(args.enter);
    await db.update(videoGraphics).set({ options: { ...(g.options ?? {}), enter } }).where(eq(videoGraphics.id, g.id));
    return done(`The ${g.kind} "${g.text}" now arrives with a ${enter}.`);
  }

  if (name === "find_in_transcript") {
    const q = str(args.query).toLowerCase();
    if (!q) return "Give me something to look for.";
    const cues = await db
      .select()
      .from(captions)
      .where(and(eq(captions.projectId, ctx.projectId), eq(captions.language, ctx.language)))
      .orderBy(asc(captions.startMs));
    const hits = cues.filter((c) => c.text.toLowerCase().includes(q));
    if (hits.length === 0) return `Nothing in the transcript matches "${q}".`;
    return [
      `${hits.length} match(es) for "${q}":`,
      ...hits.map(
        (c) => `  ${clock(c.startMs)}–${clock(c.endMs)}  (${c.startMs}–${c.endMs}ms)  ${c.text}`,
      ),
    ].join("\n");
  }

  if (name === "remove_range") {
    const startMs = num(args.startMs);
    const endMs = num(args.endMs);
    if (endMs <= startMs) return "The end has to be after the start.";
    const { totalMs } = await timeline(ctx.projectId);
    const keep: Range[] = [];
    if (startMs > 200) keep.push({ startMs: 0, endMs: startMs });
    if (endMs < totalMs - 200) keep.push({ startMs: endMs, endMs: totalMs });
    try {
      await rewrite(ctx, keep);
    } catch {
      return "That would remove the whole video. Nothing changed.";
    }
    const why = str(args.why);
    const line = `Cut ${clock(startMs)}–${clock(endMs)}${why ? ` — ${why}` : ""}`;
    return done(`${line}. The video is now ${clock((await timeline(ctx.projectId)).totalMs)}.`);
  }

  if (name === "keep_only") {
    const startMs = num(args.startMs);
    const endMs = num(args.endMs);
    if (endMs <= startMs) return "The end has to be after the start.";
    try {
      await rewrite(ctx, [{ startMs, endMs }]);
    } catch {
      return "There is nothing inside that range. Nothing changed.";
    }
    const line = `Kept only ${clock(startMs)}–${clock(endMs)}`;
    return done(`${line}. The video is now ${clock((await timeline(ctx.projectId)).totalMs)}.`);
  }

  if (name === "remove_silences") {
    const cues = await db
      .select()
      .from(captions)
      .where(and(eq(captions.projectId, ctx.projectId), eq(captions.language, ctx.language)))
      .orderBy(asc(captions.startMs));
    const words = cues.flatMap((c) => c.words ?? []);
    if (words.length === 0) {
      return "There are no word timings on this project, so there is nothing to measure the pauses against. Transcribe it first.";
    }
    const before = (await timeline(ctx.projectId)).totalMs;
    /* The word timings are against the *timeline* as it stands, because
       captions are re-timed on every edit — so the spans they produce are
       timeline spans and need no conversion. */
    const keep = mergeRanges(speechRanges(words, { keepMs: num(args.keepMs, 600) }));
    try {
      await rewrite(ctx, keep);
    } catch {
      return "That would leave nothing. Nothing changed.";
    }
    const after = (await timeline(ctx.projectId)).totalMs;
    const line = `Removed ${clock(before - after)} of pauses`;
    return done(`${line}. ${clock(before)} → ${clock(after)}.`);
  }

  if (name === "first_cut") {
    const r = await autoEdit(ctx.viewer, ctx.projectId, { language: ctx.language });
    const said = [
      `Cut it down to ${r.cuts} piece${r.cuts === 1 ? "" : "s"}, ${clock(r.removedMs)} removed.`,
      r.title ? `Title: "${r.title}".` : "",
      r.drop.length
        ? `Dropped:\n${r.drop.map((d) => `  ${clock(d.startMs)}–${clock(d.endMs)} — ${d.why}`).join("\n")}`
        : "",
      r.note ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    return r.cuts > 0 ? done(said) : said;
  }

  if (name === "add_graphic") {
    const kind = isGraphicKind(args.kind) ? args.kind : "lower-third";
    const text = str(args.text).slice(0, 160);
    if (!text) return "A graphic needs something to say.";
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.min(30, Math.max(0.8, num(args.seconds, 3)));

    const enter = asEntrance(args.enter ?? (kind === "stat" ? "pop" : kind === "lower-third" || kind === "chapter" ? "slide" : "fade"));
    await db.insert(videoGraphics).values({
      id: newId("gfx"),
      projectId: ctx.projectId,
      kind,
      text,
      sub: str(args.sub).slice(0, 120) || null,
      startMs,
      endMs: startMs + Math.round(seconds * 1000),
      ord: 0,
      options: { enter },
    });
    const line = `Added a ${kind} at ${clock(startMs)}: "${text}" (arrives with a ${enter})`;
    return done(line);
  }

  if (name === "remove_graphic") {
    const gs = await db
      .select()
      .from(videoGraphics)
      .where(eq(videoGraphics.projectId, ctx.projectId))
      .orderBy(asc(videoGraphics.startMs));
    const g = gs[Math.round(num(args.index, -1))];
    if (!g) return `There is no graphic ${num(args.index)}. There are ${gs.length}.`;
    await db.delete(videoGraphics).where(eq(videoGraphics.id, g.id));
    const line = `Removed the ${g.kind} "${g.text}"`;
    return done(line);
  }

  if (name === "set_look") {
    const preset = CAPTION_PRESETS.find((p) => p.key === str(args.captionPreset))?.key;
    const accent = /^#[0-9a-f]{6}$/i.test(str(args.accent)) ? str(args.accent) : undefined;
    if (!preset && !accent) return "Give me a caption preset or an accent colour.";
    await db
      .update(videoProjects)
      .set({ ...(preset ? { captionPreset: preset } : {}), ...(accent ? { accent } : {}), updatedAt: new Date() })
      .where(eq(videoProjects.id, ctx.projectId));
    const line = [preset ? `Captions set to ${preset}` : null, accent ? `Accent set to ${accent}` : null]
      .filter(Boolean)
      .join(", ");
    return done(line);
  }

  if (name === "list_pictures") {
    const needle = str(args.query).trim().toLowerCase();
    const rows = await db
      .select({ id: files.id, name: files.name, at: files.createdAt })
      .from(files)
      .where(
        and(
          eq(files.tenantId, ctx.viewer.tenantId),
          eq(files.kind, "image"),
          isNull(files.deletedAt),
          canReadFiles(ctx.viewer),
        ),
      )
      .orderBy(desc(files.createdAt))
      .limit(60);

    const matching = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
    if (matching.length === 0) {
      return needle
        ? `No picture in the store matches "${needle}". There are ${rows.length} pictures in all.`
        : "There are no pictures in the file store yet. Somebody has to upload one in Files first.";
    }
    return [
      `Pictures you can use (${matching.length}):`,
      ...matching.slice(0, 40).map((r) => `  ${r.id}  ${r.name}`),
    ].join("\n");
  }

  if (name === "find_a_picture") {
    const query = str(args.query).trim();
    if (!query) return "Say what the picture should be of.";
    const found = await searchAnyPicture(query, 8);
    if (found.length === 0) {
      return `Nothing for "${query}" under a licence this studio can use. Either the words need to be plainer, or this is a shot somebody has to take.`;
    }
    return [
      `Pictures for "${query}" (licences that allow commercial use and changes):`,
      ...found.map(
        (f) =>
          `  ${f.id}  ${f.title}${f.creator ? ` — ${f.creator}` : ""} — CC ${f.license.toUpperCase()}${
            f.licenseVersion ? ` ${f.licenseVersion}` : ""
          }${needsCredit(f) ? " (needs a credit)" : " (no credit needed)"}`,
      ),
      "",
      "take_picture copies the one you choose into the studio's files and puts it on the video.",
    ].join("\n");
  }

  if (name === "find_footage") {
    if (!stockConfigured().pexels) return "No stock video library is configured on this deployment. An admin can add a Pexels key.";
    const query = str(args.query).trim();
    if (!query) return "Say what the footage should show.";
    const found = await searchStockClips(query, { limit: 6 });
    if (!found.length) return `No stock footage for "${query}". Plainer words help: "counting cash", "stock market screen".`;
    return [
      `Stock clips for "${query}":`,
      ...found.map((c) => `  ${c.id}  ${c.durationSec}s  ${c.width}×${c.height}${c.creator ? ` — ${c.creator}` : ""}`),
      "",
      "take_footage brings one in and lays it over the picture.",
    ].join("\n");
  }

  if (name === "take_footage") {
    const clip = await stockClipById(str(args.id, 20));
    if (!clip) return "That id is not one find_footage gave you. Search again and use an id from the list.";
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(2, Math.min(8, num(args.seconds, 4)));
    try {
      const brought = await importVideo(ctx.viewer, { url: clip.url, name: `stock · ${clip.title}`, attribution: clipAttribution(clip), source: clip.source });
      const clipId = await addClip(ctx.viewer, ctx.projectId, brought.id);
      await addGraphic(ctx.viewer, ctx.projectId, {
        kind: "broll",
        text: clip.title,
        startMs,
        endMs: startMs + Math.round(seconds * 1000),
        clipId,
        sourceInMs: 0,
        placement: "full",
      });
    } catch (err) {
      return err instanceof Error ? err.message : "That clip could not be brought in.";
    }
    return done(`Cutaway on at ${clock(startMs)} for ${seconds}s: ${clip.title}. Credit: ${clipAttribution(clip)}.`);
  }

  if (name === "take_picture") {
    const image = await stockById(str(args.id));
    if (!image) return "That picture id is not one find_a_picture gave you. Search again and use an id from the list.";

    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(0.5, Math.min(30, num(args.seconds, 3)));

    let brought: { id: string; name: string };
    try {
      brought = await importPicture(ctx.viewer, {
        url: image.url,
        name: image.title,
        attribution: attributionFor(image),
        source: image.source,
      });
    } catch (err) {
      return err instanceof Error ? err.message : "That picture could not be brought in.";
    }

    try {
      await addGraphic(ctx.viewer, ctx.projectId, {
        kind: "image",
        text: str(args.caption).slice(0, 120),
        startMs,
        endMs: startMs + Math.round(seconds * 1000),
        fileId: brought.id,
        placement: str(args.placement) || "center",
        scale: num(args.scale, 40),
      });
    } catch (err) {
      return err instanceof Error ? err.message : "It came in, but it could not be placed.";
    }

    return done([
      `In and on at ${clock(startMs)} for ${seconds}s: ${image.title}.`,
      `Credit: ${attributionFor(image)}`,
      needsCredit(image)
        ? "That licence needs the credit in the video description — say so when you hand this over."
        : "That licence needs no credit, though the file keeps the record anyway.",
    ].join("\n"));
  }

  if (name === "add_picture") {
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(0.5, Math.min(30, num(args.seconds, 3)));
    try {
      await addGraphic(ctx.viewer, ctx.projectId, {
        kind: "image",
        text: str(args.caption).slice(0, 120),
        startMs,
        endMs: startMs + Math.round(seconds * 1000),
        fileId: str(args.fileId),
        placement: str(args.placement) || "center",
        scale: num(args.scale, 40),
      });
    } catch (err) {
      return err instanceof Error ? err.message : "That picture could not be placed.";
    }
    return done(`Picture on at ${clock(startMs)} for ${seconds}s.`);
  }

  if (name === "add_icon") {
    const startMs = Math.max(0, Math.round(num(args.startMs)));
    const seconds = Math.max(0.5, Math.min(20, num(args.seconds, 2.5)));
    if (!isIconName(args.icon)) {
      return `I do not have that icon. The ones I have: ${ICON_NAMES.join(", ")}.`;
    }
    try {
      await addGraphic(ctx.viewer, ctx.projectId, {
        kind: "icon",
        text: str(args.label).slice(0, 40),
        startMs,
        endMs: startMs + Math.round(seconds * 1000),
        icon: args.icon,
        placement: str(args.placement) || "top-right",
        scale: num(args.scale, 18),
      });
    } catch (err) {
      return err instanceof Error ? err.message : "That icon could not be placed.";
    }
    return done(`${args.icon} on at ${clock(startMs)} for ${seconds}s.`);
  }

  if (name === "set_transition") {
    const { rows } = await timeline(ctx.projectId);
    const index = Math.round(num(args.index, -1));
    const item = rows[index];
    if (!item) return `There is no cut ${num(args.index)}. There are ${rows.length}.`;
    if (index === 0) {
      return "The first cut has nothing to arrive from, so it cannot take a transition. Put it on the cut after it.";
    }
    const kind = asTransition(args.transition);
    if (kind !== str(args.transition)) {
      return "I can do a cut, a dissolve, or a dip to black. Nothing else.";
    }
    const ms = Math.max(80, Math.min(4000, Math.round(num(args.ms, 400))));
    await db
      .update(timelineItems)
      .set({ transition: kind, transitionMs: ms })
      .where(eq(timelineItems.id, item.id));
    await db.update(videoProjects).set({ updatedAt: new Date() }).where(eq(videoProjects.id, ctx.projectId));
    return done(
      kind === "cut"
        ? `Cut ${index} now arrives on a hard cut.`
        : `Cut ${index} now arrives on a ${kind === "dip" ? "dip to black" : "dissolve"} of ${ms}ms.`,
    );
  }

  if (name === "edit_caption") {
    const cues = await db
      .select()
      .from(captions)
      .where(and(eq(captions.projectId, ctx.projectId), eq(captions.language, ctx.language)))
      .orderBy(asc(captions.startMs));
    const c = cues[Math.round(num(args.index, -1))];
    if (!c) return `There is no caption ${num(args.index)}. There are ${cues.length}.`;
    const text = str(args.text).slice(0, 400);
    if (!text) return "Give me the words.";
    /* The words change; the per-word timings do not survive it, and keeping
       stale ones would make the word-by-word preset follow the wrong words. */
    await db.update(captions).set({ text, words: null }).where(eq(captions.id, c.id));
    const line = `Caption at ${clock(c.startMs)} is now "${text}"`;
    return done(line);
  }

  return `Unknown tool ${name}.`;
}


/** One line on where "make the video" has got to, for describe_timeline. */
function describeDirector(d: DirectorState | undefined): string {
  if (!d?.state) return "";
  if (d.state === "queued") return "The director is queued to make this video.";
  if (d.state === "running") return `The director is at work: ${d.step ?? "starting"}${d.note ? ` — ${d.note}` : ""}.`;
  if (d.state === "failed") return `The last make-the-video run failed: ${d.error ?? "no reason recorded"}.`;
  if (d.state === "done" && d.result) {
    const r = d.result;
    return `Last made by the director: ${r.cuts} cuts, ${r.graphics} graphics, ${r.punches} punch-ins, ${r.broll} cutaways${r.fileId ? ", rendered" : ""}.${r.notes ? ` Notes: ${r.notes}` : ""}`;
  }
  return "";
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  /*
   * The project on screen, or the one named — and it has to belong to this
   * studio. Without one there is nothing to edit, and saying so beats every
   * tool failing in its own way.
   */
  const wanted = asId(args.project_id) ?? ctx.projectId ?? null;
  if (!wanted) {
    return {
      text: "No video project is open. Open one in the Video module and ask again.",
    };
  }

  const [project] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, wanted), eq(videoProjects.tenantId, ctx.viewer.tenantId)))
    .limit(1);
  if (!project) return { text: "That project does not exist, or this person may not open it." };

  const [anyCaption] = await db
    .select({ language: captions.language })
    .from(captions)
    .where(eq(captions.projectId, project.id))
    .limit(1);

  const scoped = { ...ctx, projectId: project.id, language: anyCaption?.language ?? "zh-CN" };
  const out = await dispatch(scoped, name, JSON.stringify(args));
  const text = typeof out === "string" ? out : out.text;
  const worked = typeof out !== "string";

  /* Everything here but the read-only tools changes the timeline, and the
     screen refreshes on that — but only when the tool said it worked. A
     refusal ("that would leave nothing, nothing changed") used to come back
     as a change as well, which is how a failed make_video on a channel with
     no project read, to the employee's colleagues, as a video being made. */
  const readOnly = VIDEO_READ_ONLY.includes(name);
  if (!readOnly) {
    if (worked) await db.update(videoProjects).set({ updatedAt: new Date() }).where(eq(videoProjects.id, project.id));
    await audit(ctx.viewer, "agent.video", {
      objectType: "video_project",
      objectId: project.id,
      module: "video",
      meta: { tool: name, ok: worked },
    });
  }

  const changed = !readOnly && worked;
  return {
    text,
    changed,
    ...(changed
      ? {
          artifacts: [
            {
              kind: "video_project" as const,
              id: project.id,
              title: project.title,
              /* make_video hands the whole job to the worker: it has begun,
                 and it will be minutes before anybody may say it is done. */
              action: name === "make_video" ? ("started" as const) : ("updated" as const),
            },
          ],
        }
      : {}),
  };
}

export const videoPack: ToolPack = { module: "video", defs, run };
