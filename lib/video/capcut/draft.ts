/**
 * A 剪映 / CapCut desktop draft, built from plain data.
 *
 * The client's ask (Oct 2026) is to carry an edit out of this app and keep
 * editing it in 剪映 / CapCut: every cut still a cut with its trim, every
 * caption still a line of text, the voice-over still on its own track. A
 * rendered MP4 cannot do that, and neither app imports FCPXML or Premiere XML,
 * so the only way in is the app's own draft folder.
 *
 * The JSON follows what pyJianYingDraft writes (github.com/GuanYixuan/pyJianYingDraft,
 * MIT; its `draft_content_template.json`, `local_materials.py`, `segment.py`,
 * `video_segment.py`, `text_segment.py`, `track.py`), which is the generator
 * the 剪映 community actually uses and checks against real installs. Key for
 * key, so a draft from here and one from there can be diffed: the validation
 * script compares the two field by field.
 *
 * Pure: no database, no disk, no clock unless one is passed in. Times come in
 * as milliseconds, the app's unit, and go out as microseconds, the draft's.
 */

/** A file inside the draft folder, by its path relative to that folder. */
export type DraftVideoMaterial = {
  key: string;
  /** Relative to the draft folder, forward slashes: `materials/v01.mp4`. */
  rel: string;
  name: string;
  kind: "video" | "photo";
  durationMs: number;
  width: number;
  height: number;
};

export type DraftAudioMaterial = { key: string; rel: string; name: string; durationMs: number };

/** Where a picture sits: a uniform scale and an offset in half-canvas units (the draft's own). */
export type Placement = { scale: number; x: number; y: number };

export type DraftVideoSegment = {
  material: string;
  /** On the timeline. */
  startMs: number;
  lengthMs: number;
  /** Into the source. Ignored for a photo. */
  sourceInMs: number;
  volume: number;
  place?: Placement;
  /** Into this segment from the one before, on the same track. */
  transitionIn?: { kind: "dissolve" | "dip"; ms: number };
};

export type DraftAudioSegment = { material: string; startMs: number; lengthMs: number; sourceInMs: number; volume: number };

export type DraftTextStyle = {
  /** The draft's own size unit (剪映's default is 8; its imported subtitles use 5). */
  size: number;
  bold?: boolean;
  /** `#rrggbb`. */
  color?: string;
  alpha?: number;
  /** 0 left, 1 centre, 2 right. */
  align?: 0 | 1 | 2;
  /** A black outline, which is what keeps white text readable over footage. */
  stroke?: boolean;
  /** Wrap to the line width: what makes the draft call it a subtitle rather than a text. */
  wrap?: boolean;
  /** 0–1 of the canvas width. */
  maxLineWidth?: number;
};

export type DraftText = { startMs: number; endMs: number; text: string; style: DraftTextStyle; x: number; y: number };

export type DraftTrack =
  | { type: "video"; name: string; segments: DraftVideoSegment[] }
  | { type: "audio"; name: string; segments: DraftAudioSegment[]; mute?: boolean }
  | { type: "text"; name: string; segments: DraftText[] };

/**
 * Which app the draft is written for. The track, segment and material JSON
 * is the same for both; the top-level keys and the platform stamp follow
 * what each one's own generator actually writes (pyJianYingDraft for 剪映,
 * its sibling pyCapCut for CapCut — their saved output, not their template
 * files, whose `materials` and `canvas_config` are overwritten on save),
 * because an app that finds another app's stamp on a draft is the case
 * nobody has tested.
 */
export type DraftApp = "jianying" | "capcut";

export type DraftInput = {
  app: DraftApp;
  name: string;
  width: number;
  height: number;
  fps: number;
  videos: DraftVideoMaterial[];
  audios: DraftAudioMaterial[];
  /** Bottom to top. The first video track is the main track. */
  tracks: DraftTrack[];
  /**
   * How a material's relative path is written into the JSON. The draft has
   * to name files by absolute path, and where the person puts the folder is
   * not known here; see `materialPath` in `lib/video/capcut/export.ts`.
   */
  pathOf: (rel: string) => string;
  /** Ids, injectable so a test can compare two runs byte for byte. */
  newId?: () => string;
  /** Seconds since the epoch, for the meta file's timestamps. */
  nowSec?: number;
};

/** Microseconds, the draft's unit. */
export const us = (ms: number) => Math.max(0, Math.round(ms * 1000));

/**
 * The transitions this app has, by 剪映's own resource ids (pyJianYingDraft's
 * `metadata/transition_meta.py`: 叠化 and 闪黑, both free). A transition is a
 * downloadable effect; an id the app does not know shows as a missing effect,
 * never as a draft that will not open.
 */
const TRANSITIONS = {
  dissolve: { name: "叠化", resourceId: "6724845717472416269", effectId: "322577", overlap: true },
  dip: { name: "闪黑", resourceId: "6724239388189921806", effectId: "321493", overlap: false },
} as const;

export function uuidUpper(): string {
  return crypto.randomUUID().toUpperCase();
}

function rgb(hex: string | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000) as [number, number, number];
}

/** The keys every segment carries (pyJianYingDraft `BaseSegment.export_json`). */
function baseSegment(id: string, materialId: string, startMs: number, lengthMs: number) {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id,
    material_id: materialId,
    target_timerange: { start: us(startMs), duration: us(lengthMs) },
    common_keyframes: [] as unknown[],
    keyframe_refs: [] as unknown[],
  };
}

function clip(place: Placement | undefined) {
  return {
    alpha: 1.0,
    flip: { horizontal: false, vertical: false },
    rotation: 0.0,
    scale: { x: place?.scale ?? 1.0, y: place?.scale ?? 1.0 },
    transform: { x: place?.x ?? 0.0, y: place?.y ?? 0.0 },
  };
}

/** The stamp each generator's template carries: 剪映 5.9 (pyJianYingDraft), CapCut 6.7 (pyCapCut). */
function platformOf(app: DraftApp) {
  return app === "capcut"
    ? { app_id: 359289, app_source: "cc", app_version: "6.7.0", os: "windows" }
    : { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" };
}

function speed(id: string) {
  return { curve_speed: null, id, mode: 0, speed: 1.0, type: "speed" };
}

export type BuiltDraft = {
  content: Record<string, unknown>;
  meta: Record<string, unknown>;
  durationUs: number;
  /** Every relative path the JSON points at, for the caller to check is in the folder. */
  files: string[];
};

export function buildDraft(input: DraftInput): BuiltDraft {
  const newId = input.newId ?? uuidUpper;
  const draftId = newId();
  const videoById = new Map(input.videos.map((v) => [v.key, { ...v, id: newId() }]));
  const audioById = new Map(input.audios.map((a) => [a.key, { ...a, id: newId() }]));

  const speeds: unknown[] = [];
  const transitions: unknown[] = [];
  const texts: unknown[] = [];
  const usedVideos = new Set<string>();
  const usedAudios = new Set<string>();
  let durationUs = 0;

  const tracks = input.tracks.map((track, renderIndex) => {
    const id = newId();
    let segments: Record<string, unknown>[];

    if (track.type === "video") {
      const sorted = [...track.segments].sort((a, b) => a.startMs - b.startMs);
      segments = sorted.map((s, i) => {
        const m = videoById.get(s.material);
        if (!m) throw new Error(`capcut: no video material ${s.material}`);
        usedVideos.add(m.key);
        const speedId = newId();
        speeds.push(speed(speedId));
        const refs = [speedId];
        /* The draft keeps a transition on the *earlier* segment (pyJianYingDraft
           `add_transition`); this app keeps it on the incoming one. */
        const next = sorted[i + 1];
        if (next?.transitionIn) {
          const t = TRANSITIONS[next.transitionIn.kind];
          const tid = newId();
          transitions.push({
            category_id: "",
            category_name: "",
            duration: us(next.transitionIn.ms),
            effect_id: t.effectId,
            id: tid,
            is_overlap: t.overlap,
            name: t.name,
            platform: "all",
            resource_id: t.resourceId,
            type: "transition",
          });
          refs.push(tid);
        }
        const photo = m.kind === "photo";
        const sourceIn = photo ? 0 : Math.max(0, Math.min(s.sourceInMs, m.durationMs - s.lengthMs));
        durationUs = Math.max(durationUs, us(s.startMs) + us(s.lengthMs));
        return {
          ...baseSegment(newId(), m.id, s.startMs, s.lengthMs),
          source_timerange: { start: us(sourceIn), duration: us(s.lengthMs) },
          speed: 1.0,
          volume: s.volume,
          extra_material_refs: refs,
          is_tone_modify: false,
          clip: clip(s.place),
          uniform_scale: { on: true, value: 1.0 },
          hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
          render_index: renderIndex,
        };
      });
    } else if (track.type === "audio") {
      segments = [...track.segments]
        .sort((a, b) => a.startMs - b.startMs)
        .map((s) => {
          const m = audioById.get(s.material);
          if (!m) throw new Error(`capcut: no audio material ${s.material}`);
          usedAudios.add(m.key);
          const speedId = newId();
          speeds.push(speed(speedId));
          const length = Math.min(s.lengthMs, m.durationMs - s.sourceInMs);
          durationUs = Math.max(durationUs, us(s.startMs) + us(length));
          return {
            ...baseSegment(newId(), m.id, s.startMs, length),
            source_timerange: { start: us(s.sourceInMs), duration: us(length) },
            speed: 1.0,
            volume: s.volume,
            extra_material_refs: [speedId],
            is_tone_modify: false,
            clip: null,
            hdr_settings: null,
            render_index: renderIndex,
          };
        });
    } else {
      segments = [...track.segments]
        .sort((a, b) => a.startMs - b.startMs)
        .map((s) => {
          const materialId = newId();
          texts.push(textMaterial(materialId, s.text, s.style));
          durationUs = Math.max(durationUs, us(s.endMs));
          return {
            ...baseSegment(newId(), materialId, s.startMs, s.endMs - s.startMs),
            source_timerange: null,
            speed: 1.0,
            volume: 1.0,
            extra_material_refs: [] as string[],
            // pyCapCut writes this on media segments only; pyJianYingDraft on every segment.
            ...(input.app === "capcut" ? {} : { is_tone_modify: false }),
            clip: clip({ scale: 1, x: s.x, y: s.y }),
            uniform_scale: { on: true, value: 1.0 },
            render_index: renderIndex,
          };
        });
    }

    return {
      attribute: track.type === "audio" && track.mute ? 1 : 0,
      flag: 0,
      id,
      is_default_name: track.name.length === 0,
      name: track.name,
      segments,
      type: track.type,
    };
  });

  const videos = [...videoById.values()].filter((v) => usedVideos.has(v.key)).map((v) => ({
    audio_fade: null,
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: { upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0, lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0 },
    crop_ratio: "free",
    crop_scale: 1.0,
    // A still has no length of its own; 剪映 writes three hours for one.
    duration: v.kind === "photo" ? 10_800_000_000 : us(v.durationMs),
    height: v.height,
    id: v.id,
    local_material_id: "",
    material_id: v.id,
    material_name: v.name,
    media_path: "",
    path: input.pathOf(v.rel),
    type: v.kind,
    width: v.width,
  }));

  const audios = [...audioById.values()].filter((a) => usedAudios.has(a.key)).map((a) => ({
    app_id: 0,
    category_id: "",
    category_name: "local",
    check_flag: 3,
    copyright_limit_type: "none",
    duration: us(a.durationMs),
    effect_id: "",
    formula_id: "",
    id: a.id,
    local_material_id: a.id,
    music_id: a.id,
    name: a.name,
    path: input.pathOf(a.rel),
    source_platform: 0,
    type: "extract_music",
    wave_points: [] as unknown[],
  }));

  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const content = {
    canvas_config: { width: input.width, height: input.height, ratio: "original" },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      // 1: every file the draft uses is inside its own folder (the placeholder paths).
      material_save_mode: 1,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      ...(input.app === "capcut" ? { use_float_render: false } : {}),
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: durationUs,
    extra_info: null,
    fps: input.fps,
    free_render_index_mode_on: false,
    group_container: null,
    id: draftId,
    keyframe_graph_list: [],
    keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    ...(input.app === "capcut" ? { is_drop_frame_timecode: false } : {}),
    last_modified_platform: platformOf(input.app),
    platform: platformOf(input.app),
    ...(input.app === "capcut" ? { lyrics_effects: [], path: "" } : {}),
    materials: {
      ai_translates: [],
      audio_balances: [],
      audio_effects: [],
      audio_fades: [],
      audio_track_indexes: [],
      audios,
      beats: [],
      canvases: [],
      chromas: [],
      color_curves: [],
      digital_humans: [],
      drafts: [],
      effects: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks: [],
      material_animations: [],
      material_colors: [],
      multi_language_refs: [],
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: [],
      speeds,
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts,
      time_marks: [],
      transitions,
      video_effects: [],
      video_trackings: [],
      videos,
      vocal_beautifys: [],
      vocal_separations: [],
    },
    mutable_config: null,
    name: "",
    new_version: input.app === "capcut" ? "140.0.0" : "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks,
    update_time: 0,
    version: 360000,
  };

  const meta = draftMeta({ app: input.app, draftId: newId(), name: input.name, durationUs, nowSec });
  const files = [...videoById.values()].filter((v) => usedVideos.has(v.key)).map((v) => v.rel).concat([...audioById.values()].filter((a) => usedAudios.has(a.key)).map((a) => a.rel));
  return { content, meta, durationUs, files };
}

/**
 * A text material (pyJianYingDraft `TextSegment.export_material`): the words
 * and their one style run live in `content`, itself a JSON string.
 */
function textMaterial(id: string, text: string, style: DraftTextStyle) {
  /* The style run covers the whole line, counted in UTF-16 units the way the
     app counts it (capcut-cli #85; pyJianYingDraft counts code points, which
     is the same number for Chinese and different only for emoji). */
  const length = text.length;
  const strokes = style.stroke ? [{ content: { solid: { alpha: 1.0, color: [0, 0, 0] } }, width: 0.08 }] : [];
  const content = {
    styles: [
      {
        fill: { alpha: 1.0, content: { render_type: "solid", solid: { alpha: 1.0, color: rgb(style.color) } } },
        range: [0, length],
        size: style.size,
        bold: Boolean(style.bold),
        italic: false,
        underline: false,
        strokes,
      },
    ],
    text,
  };
  return {
    id,
    content: JSON.stringify(content),
    typesetting: 0,
    alignment: style.align ?? 1,
    letter_spacing: 0,
    line_spacing: 0.02,
    line_feed: 1,
    line_max_width: style.maxLineWidth ?? 0.82,
    force_apply_line_max_width: false,
    // 7 is fill, size and font; +8 marks the outline as set.
    check_flag: style.stroke ? 15 : 7,
    type: style.wrap ? "subtitle" : "text",
    global_alpha: style.alpha ?? 1.0,
  };
}

/** `draft_meta_info.json`, the file 剪映's draft list reads (pyJianYingDraft's template, filled in). */
export function draftMeta(input: { app: DraftApp; draftId: string; name: string; durationUs: number; nowSec: number; foldPath?: string; rootPath?: string }) {
  const nowUs = input.nowSec * 1_000_000;
  const capcut = input.app === "capcut";
  return {
    ...(capcut ? { cloud_draft_cover: false, cloud_draft_sync: false } : {}),
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    ...(capcut ? { draft_cloud_package_type: "" } : { draft_cloud_materials: [] }),
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: { draft_enterprise_extra: "", draft_enterprise_id: "", draft_enterprise_name: "", enterprise_material: [] },
    draft_fold_path: input.foldPath ?? "",
    draft_id: input.draftId,
    ...(capcut ? { draft_is_ae_produce: false } : {}),
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    ...(capcut ? { draft_is_cloud_temp_draft: false } : {}),
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })),
    draft_materials_copied_info: [],
    draft_name: input.name,
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: input.rootPath ?? "",
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    ...(capcut ? { tm_draft_cloud_entry_id: 0 } : {}),
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: input.durationUs,
  };
}

/**
 * Lay segments on as few tracks as they fit, in order: a track's segments
 * may not overlap (the draft refuses it, as pyJianYingDraft's `add_segment`
 * does), and a graphic over a graphic is two tracks in any editor.
 */
export function packTracks<T extends { startMs: number; endMs: number }>(items: T[]): T[][] {
  const lanes: T[][] = [];
  for (const item of [...items].sort((a, b) => a.startMs - b.startMs)) {
    const lane = lanes.find((l) => l[l.length - 1].endMs <= item.startMs);
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}
