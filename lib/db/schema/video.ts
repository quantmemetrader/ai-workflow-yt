import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Video Edit (spec §4.5), reshaped.
 *
 * The spec and the artboards were written around generated footage: a Veo
 * render queue, shot prompts, takes. The reference the client gave on 19
 * September is one of their own interviews — real footage, cut down, captioned
 * and titled. So this is an **assembly** module, not a generation one, and the
 * Vertex AI, ElevenLabs and Azure keys it was waiting on are no longer what it
 * needs. FFmpeg runs on the box and does all of it.
 *
 * Three shapes, and each is deliberate:
 *
 *   1. **A clip is a reference, not a copy.** `fileId` points into the file
 *      store, so the media bin is the studio's own files with the studio's own
 *      permissions, and trimming a clip never touches the master.
 *   2. **The timeline is rows, not a blob.** An ordered list of items with in
 *      and out points, so a cut can be moved, an item can be captioned, and a
 *      render can be reproduced from the database rather than from whatever
 *      the browser last held.
 *   3. **Captions are their own rows with times.** They are the thing this
 *      kind of video actually lives on, they get edited long after the cut is
 *      locked, and burning them in is a render option rather than a different
 *      document.
 */
export const exportStateEnum = pgEnum("export_state", [
  "queued",
  "rendering",
  "done",
  "failed",
  "cancelled",
]);

export const videoProjects = pgTable(
  "video_projects",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    title: text().notNull(),
    /** The locked script this is being cut against, when there is one. */
    scriptId: text(),
    /** The finished master in the file store, once something has rendered. */
    masterFileId: text(),
    notes: text().notNull().default(""),
    /**
     * Which caption preset this project uses, and the one colour it is allowed
     * to be loud in.
     *
     * On the project rather than on each caption: a video whose captions
     * change style between sentences is the thing the house rules exist to
     * prevent, and storing it per line would make that a two-click mistake.
     */
    captionPreset: text().notNull().default("clean"),
    accent: text().notNull().default("#007be0"),
    /**
     * Where the director has got to, when one is at work on this project.
     *
     * "Make the video" is transcribe, cut, design, render: minutes on the
     * worker, and a screen has to be able to say which of those it is in and
     * what went wrong when one of them did. `{ state, step, note, error, log }`.
     */
    director: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("video_projects_idx").on(t.tenantId, t.updatedAt)],
);

/** A piece of footage in the project's bin. Always a reference to a file. */
export const videoClips = pgTable(
  "video_clips",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    fileId: text().notNull(),
    label: text().notNull().default(""),
    /** Probed once on add, so the timeline can draw without opening the file. */
    durationMs: integer(),
    width: integer(),
    height: integer(),
    /**
     * The shape of the sound: ~600 peaks, 0..1, evenly across the clip.
     *
     * Trimming by typing a timecode means watching the clip, writing down a
     * number, typing it, and watching again. Every editor worth using draws
     * the audio instead, because a cut lands on a breath or the end of a
     * sentence and both are *visible* in a waveform.
     *
     * Computed once by the worker and kept here rather than being derived in
     * the browser: it needs FFmpeg, and the alternative is every person who
     * opens the project downloading the whole master to draw the same picture.
     */
    peaks: jsonb().$type<number[]>(),
    /** Null until the peaks job has run; a reason when it could not. */
    peaksError: text(),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_clips_idx").on(t.projectId)],
);

/**
 * One cut on the timeline.
 *
 * `kind` is `clip` for footage and `title` for a card the renderer draws:
 * a title card is not footage and giving it a fake `fileId` would make every
 * query that joins a clip lie about what it found.
 */
export const timelineItems = pgTable(
  "timeline_items",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    clipId: text().references(() => videoClips.id, { onDelete: "cascade" }),
    kind: text().notNull().default("clip"),
    ord: integer().notNull().default(0),
    /** Where in the source this cut starts and ends. Milliseconds. */
    inMs: integer().notNull().default(0),
    outMs: integer(),
    /** For a title card: what it says, and how long it holds. */
    text: text(),
    holdMs: integer().notNull().default(2500),
    /**
     * How this cut arrives: "cut" (nothing), "dissolve" (a cross-fade) or
     * "dip" (through black). It belongs to the *incoming* item, because that
     * is what a person points at when they say "fade into this one", and it
     * is ignored on the first item, which has nothing to arrive from.
     */
    transition: text().notNull().default("cut"),
    transitionMs: integer().notNull().default(400),
    /** Per-item options the renderer reads: animation preset and the like. */
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("timeline_items_idx").on(t.projectId, t.ord)],
);

/**
 * A caption, timed against the finished cut.
 *
 * Times are relative to the timeline, not to any one clip, because that is
 * what a viewer sees and what an SRT has to say.
 */
export const captions = pgTable(
  "captions",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    startMs: integer().notNull().default(0),
    endMs: integer().notNull().default(2000),
    text: text().notNull().default(""),
    /** zh-HK, zh-CN, en. A project can carry several tracks. */
    language: text().notNull().default("zh-HK"),
    ord: integer().notNull().default(0),
    /**
     * When each word was said, from the transcriber.
     *
     * Only the word-by-word caption preset uses it, and only when it is here:
     * spacing words evenly across a line and calling it sync drifts off the
     * voice within a sentence, and every viewer feels it even if they cannot
     * say why. No timings, no karaoke — the line is shown whole instead.
     */
    words: jsonb().$type<{ start: number; end: number; text: string }[]>(),
    /**
     * The words in this line worth setting in the accent colour: a product,
     * a number, the verb the sentence turns on. Chosen by the director's
     * translation pass, rendered by the bilingual caption preset, and never
     * part of the text itself so the SRT stays plain.
     */
    keywords: text().array().notNull().default([]),
  },
  (t) => [index("captions_idx").on(t.projectId, t.language, t.startMs)],
);

/**
 * A graphic over the picture: a title, a name under whoever is speaking, a
 * chapter marker, an end card.
 *
 * Its own table rather than a timeline item, because a graphic sits *over* the
 * cut rather than in it — moving a clip does not move the lower third, and
 * deleting a clip must not delete the title that happened to start during it.
 * They are drawn by Remotion in one pass and composited by FFmpeg.
 */
export const videoGraphics = pgTable(
  "video_graphics",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    /** One of `GRAPHIC_KINDS`: lower-third, title, stat, image, icon… */
    kind: text().notNull().default("lower-third"),
    text: text().notNull().default(""),
    /** The second line, where the preset has one: a role, a source, a handle. */
    sub: text(),
    startMs: integer().notNull().default(0),
    endMs: integer().notNull().default(3000),
    ord: integer().notNull().default(0),
    /**
     * A picture from the studio's own file store, for an `image` graphic.
     * A reference, never a copy — the same rule the media bin follows — and
     * the render re-checks that whoever asked for it may open it.
     */
    fileId: text(),
    /** For an `icon` graphic: which one, from the set the app ships. */
    icon: text(),
    /** Where it sits: a corner, the middle, or over the whole frame. */
    placement: text().notNull().default("center"),
    /** Share of the frame's height, for an image or an icon. 0.05–0.9. */
    scale: integer().notNull().default(30),
    /**
     * How it arrives (`enter`: fade, rise, pop, slide, wipe), and for a
     * `broll` cutaway which clip and where in it (`clipId`, `sourceInMs`), and
     * for a `punch` how far in (`zoom`). Shapeless because each kind reads its
     * own keys, and each one is validated where it is read.
     */
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("video_graphics_idx").on(t.projectId, t.startMs)],
);

/**
 * A render.
 *
 * Every attempt is a row and the FFmpeg command is kept on it: a render that
 * came out wrong is a question about what was actually run, and "we think it
 * was something like this" is not an answer.
 */
export const videoExports = pgTable(
  "video_exports",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    /** 16:9, 9:16, 1:1. */
    aspect: text().notNull().default("16:9"),
    /** Burn the captions into the picture, or ship an SRT beside it. */
    burnCaptions: text().notNull().default("burn"),
    captionLanguage: text().notNull().default("zh-HK"),
    state: exportStateEnum().notNull().default("queued"),
    progress: real().notNull().default(0),
    /** The finished file, and its subtitle sidecar when there is one. */
    fileId: text(),
    subtitleFileId: text(),
    /**
     * The small copy people actually watch: 480p on the short edge, made from
     * the master by a second pass and stored as its own file.
     *
     * Nullable and allowed to stay that way. A proxy is a convenience — the
     * preview falls back to the master when it is missing — so a render whose
     * second pass failed, and every render made before this column existed,
     * is still a finished render and not a broken row.
     */
    proxyFileId: text(),
    durationMs: integer(),
    sizeBytes: bigint({ mode: "number" }),
    command: text(),
    error: text(),
    requestedBy: text().references(() => users.id),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("video_exports_idx").on(t.tenantId, t.state, t.createdAt)],
);

/**
 * Voice-over and music, laid over the cut.
 *
 * `fileId` points into the file store for anything uploaded or generated, so a
 * voice-over is a real file with a real owner that somebody can listen to
 * outside this module. `gain` is a multiplier rather than decibels because
 * that is what FFmpeg's `volume` filter takes and one conversion is one place
 * to get it wrong.
 */
export const audioTracks = pgTable(
  "audio_tracks",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => videoProjects.id, { onDelete: "cascade" }),
    /** `voiceover` or `music`. */
    kind: text().notNull().default("music"),
    label: text().notNull().default(""),
    fileId: text(),
    /** Where it starts against the timeline. */
    startMs: integer().notNull().default(0),
    durationMs: integer(),
    /** 1 is as recorded. Music under speech usually wants about 0.15. */
    gain: real().notNull().default(1),
    /** Fade the music down while somebody is speaking. */
    duckUnderSpeech: boolean().notNull().default(true),
    /** For a generated voice-over: what was said and in whose voice. */
    text: text(),
    voiceId: text(),
    state: text().notNull().default("ready"),
    error: text(),
    createdBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audio_tracks_idx").on(t.projectId, t.kind)],
);
