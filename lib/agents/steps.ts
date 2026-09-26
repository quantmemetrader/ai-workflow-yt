import type { IconName } from "@/components/ui/Icon";

/**
 * What an AI employee is doing right now, as the chat says it.
 *
 * Between a person pressing "交给编剧" and 编剧's answer landing there used
 * to be a minute of nothing: the channel looked exactly as it did before the
 * press, and the studio could not tell a colleague at work from a tag that
 * went nowhere. Now the turn keeps a row in the channel (`lib/chat/pending.ts`)
 * whose step follows what the turn is really doing — its tool calls, or the
 * model thinking and then writing — and this file is the one list of those
 * steps and how each one reads.
 *
 * Pure and dependency-free (an icon name is only a string), so the server
 * that records a step and the client that draws it read the same table.
 */
export const STEP_KEYS = [
  "thinking",
  "typing",
  "channel",
  "scripts",
  "projects",
  "research",
  "writing_script",
  "writing",
  "handing",
  "topics",
  "footage",
  "looking",
  "rough_cut",
  "editing",
  "captions",
  "graphics",
  "making",
  "rendering",
  "checking",
  "working",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS: Record<StepKey, { zh: string; en: string; icon: IconName }> = {
  thinking: { zh: "正在看…", en: "Looking…", icon: "eye" },
  typing: { zh: "正在输入…", en: "Typing…", icon: "comment" },
  channel: { zh: "正在看频道", en: "Reading the channel", icon: "chat" },
  scripts: { zh: "正在看脚本", en: "Reading the script", icon: "pen" },
  projects: { zh: "正在查项目和计划", en: "Checking projects and the plan", icon: "check" },
  research: { zh: "正在查资料", en: "Looking things up", icon: "bulb" },
  writing_script: { zh: "正在写脚本", en: "Writing the script", icon: "pen" },
  writing: { zh: "正在写稿", en: "Writing", icon: "pen" },
  handing: { zh: "正在交给同事", en: "Handing it on", icon: "share" },
  topics: { zh: "正在更新选题", en: "Updating topics", icon: "bulb" },
  footage: { zh: "正在找素材", en: "Finding footage", icon: "clapper" },
  looking: { zh: "正在看素材", en: "Looking at the footage", icon: "eye" },
  rough_cut: { zh: "正在粗剪", en: "Making the rough cut", icon: "scissors" },
  editing: { zh: "正在剪辑", en: "Editing", icon: "scissors" },
  captions: { zh: "正在加字幕", en: "Working on captions", icon: "comment" },
  graphics: { zh: "正在加图形", en: "Adding graphics", icon: "spark" },
  making: { zh: "正在做成片：拼接、粗剪、渲染", en: "Making the video: joining, cutting, rendering", icon: "film" },
  rendering: { zh: "正在渲染", en: "Rendering", icon: "film" },
  checking: { zh: "正在核对", en: "Checking the answer", icon: "check" },
  working: { zh: "正在处理", en: "Working", icon: "spark" },
};

/**
 * The step a tool call stands for, by the tool's real name
 * (`lib/ai/tools/*`, `lib/ai/tools.ts`). A tool not listed is "working":
 * honest, if vague, and never a step the employee is not taking.
 */
const TOOL_STEPS: Record<string, StepKey> = {
  // chat
  read_channel: "channel",
  search_messages: "channel",
  list_channels: "channel",
  send_message: "handing",
  // team
  read_plan: "projects",
  list_projects: "projects",
  assign_task: "handing",
  // script
  list_scripts: "scripts",
  read_script: "scripts",
  write_script: "writing_script",
  // article
  write_article: "writing",
  list_articles: "research",
  read_article: "research",
  publishing_log: "research",
  // research and the channel's own numbers
  list_topics: "research",
  read_topic: "research",
  trending_now: "research",
  who_makes_this: "research",
  suggest_angles: "research",
  creator_videos: "research",
  creator_video: "research",
  watch_topic: "topics",
  decide_topic: "topics",
  watch_channel: "topics",
  // files and the rest of the assistant's own tools
  search_files: "research",
  read_file: "research",
  list_recent_files: "research",
  create_document: "writing",
  check_ai_spend: "research",
  // video
  list_clips: "looking",
  describe_timeline: "looking",
  find_in_transcript: "looking",
  find_footage: "footage",
  take_footage: "footage",
  find_a_picture: "footage",
  take_picture: "footage",
  list_pictures: "footage",
  add_picture: "footage",
  add_icon: "graphics",
  add_broll: "footage",
  first_cut: "rough_cut",
  remove_range: "editing",
  keep_only: "editing",
  remove_silences: "editing",
  punch_in: "editing",
  set_transition: "editing",
  edit_caption: "captions",
  add_graphic: "graphics",
  remove_graphic: "graphics",
  set_enter: "graphics",
  set_look: "graphics",
  make_video: "making",
};

export function stepForTool(name: string): StepKey {
  return Object.prototype.hasOwnProperty.call(TOOL_STEPS, name) ? TOOL_STEPS[name] : "working";
}

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
}

/** One step as a person reads it. */
export function stepLabel(step: StepKey, zh: boolean): string {
  return zh ? STEP_LABELS[step].zh : STEP_LABELS[step].en;
}

/**
 * The poll's fingerprint of a channel's working rows: who is at work and on
 * which step. The pulse route builds it from the database and the channel
 * from what it was rendered with, so a room where nothing moved costs no
 * refresh.
 */
export function pendingStamp(rows: { id: string; step: string }[]): string {
  return rows.map((r) => `${r.id}:${r.step}`).join(",");
}

/**
 * The director's own steps (`DirectorState.step` in lib/video/director), as
 * a job chip under a message says them: joining the footage, transcribing,
 * the rough cut, captions and graphics, rendering.
 */
const DIRECTOR_STEPS: Record<string, [string, string]> = {
  footage: ["拼接素材", "joining the footage"],
  transcribe: ["转写素材", "transcribing"],
  cut: ["粗剪", "making the rough cut"],
  design: ["加字幕和图形", "adding captions and graphics"],
  pictures: ["找图", "finding pictures"],
  write: ["写入时间线", "writing the timeline"],
  render: ["渲染", "rendering"],
};

export function directorStepLabel(step: string | null | undefined, zh: boolean): string {
  const v = step ? DIRECTOR_STEPS[step] : undefined;
  return v ? (zh ? v[0] : v[1]) : zh ? "处理中" : "working";
}
