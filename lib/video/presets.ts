/**
 * The caption presets, where both sides can read them.
 *
 * Its own file rather than a constant in `craft.ts`, which is `server-only`
 * because it also holds the agent's prompt: the picker that draws these is a
 * client component, and importing a *value* from a server-only module pulls it
 * into the browser bundle and fails the build. A type imported from there is
 * erased and does not.
 *
 * The rules these encode are in `craft.ts` and in `VIDEO-CRAFT.md`. The short
 * version: exactly one treatment each — a plate or an outline or a shadow,
 * never the three stacked — and word-by-word highlighting only where it is
 * honest.
 */
export type CaptionPreset = {
  key: string;
  name: string;
  nameZh: string;
  /** When this one is right, in the studio's own words. */
  note: string;
  noteZh: string;
/*
 * Every caption family must carry Han glyphs.
 *
 * These presets asked for Inter, which has none: a burned-in Chinese caption
 * came out as a row of empty boxes, and the studio saw it before we did. Noto
 * Sans CJK SC covers Latin too, so one family serves a bilingual caption
 * without a second face. Whatever is named here has to exist on the box AND in
 * remotion/public/fonts (libass is pointed at that directory), or the glyphs
 * silently fall back to boxes again.
 */
  style: {
    family: string;
    weight: number;
    /** Share of frame height, so it survives a re-frame to 9:16. */
    sizeRatio: number;
    fill: string;
    /** One treatment, never three. */
    treatment: "plate" | "outline" | "shadow" | "none";
    plate?: string;
    lines: 1 | 2;
    /** Distance from the bottom, as a share of height. */
    marginRatio: number;
    /** Highlight the word being spoken. Off for anything considered. */
    karaoke: boolean;
    uppercase: boolean;
    /**
     * Show this many words at a time, each group popping in as it is said,
     * instead of a whole line. The short-form style. Needs word timings, like
     * karaoke, and for the same reason.
     */
    chunk?: number;
    /** Set the line's keywords in the accent colour, a size up. */
    keywords?: boolean;
    /** A second-language line under the first, small and light. */
    second?: { family: string; sizeRatio: number };
  };
};

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    key: "clean",
    name: "Clean",
    nameZh: "干净",
    note: "Two lines, a quiet plate, no animation. Right for an interview, and right by default.",
    noteZh: "两行，浅色底板，无动画。访谈首选，也是默认。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 600,
      sizeRatio: 0.044,
      fill: "#ffffff",
      treatment: "plate",
      plate: "rgba(0,0,0,0.62)",
      lines: 2,
      marginRatio: 0.09,
      karaoke: false,
      uppercase: false,
    },
  },
  {
    key: "spoken",
    name: "Spoken",
    nameZh: "口播",
    note: "One line, word by word as it is said. For a piece to camera with energy. Wrong for a considered answer.",
    noteZh: "单行，逐词跟读。适合有节奏的口播，不适合需要思考的回答。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 700,
      sizeRatio: 0.052,
      fill: "#ffffff",
      treatment: "shadow",
      lines: 1,
      marginRatio: 0.12,
      karaoke: true,
      uppercase: false,
    },
  },
  {
    key: "bilingual",
    name: "Bilingual",
    nameZh: "双语高亮",
    note: "The channel's own look: a bold Chinese line with its keywords in the accent colour, and the English under it, small. For a piece to camera that is subtitled both ways.",
    noteZh: "频道自己的样式：粗体中文主句，关键词用强调色，下方一行小号英文。适合双语字幕的口播。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 700,
      sizeRatio: 0.036,
      fill: "#ffffff",
      treatment: "shadow",
      lines: 2,
      marginRatio: 0.27,
      karaoke: false,
      uppercase: false,
      keywords: true,
      second: { family: "Noto Sans CJK SC", sizeRatio: 0.021 },
    },
  },
  {
    key: "pop",
    name: "Punch",
    nameZh: "弹字",
    note: "One to three words at a time, big and centred, each group popping in as it is said. For a short with pace. Needs word timings.",
    noteZh: "每次只显示一到三个词，居中放大，随语音逐组弹出。适合有节奏的短片，需要逐词时间轴。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 800,
      sizeRatio: 0.07,
      fill: "#ffffff",
      treatment: "shadow",
      lines: 1,
      marginRatio: 0.3,
      karaoke: true,
      uppercase: true,
      chunk: 3,
    },
  },
  {
    key: "broadcast",
    name: "Broadcast",
    nameZh: "字幕条",
    note: "Small, bottom-safe, outlined. For footage that is busy behind the type.",
    noteZh: "小字号，贴近安全边，描边。适合画面较杂的素材。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 500,
      sizeRatio: 0.036,
      fill: "#ffffff",
      treatment: "outline",
      lines: 2,
      marginRatio: 0.07,
      karaoke: false,
      uppercase: false,
    },
  },
  {
    key: "statement",
    name: "Statement",
    nameZh: "标语",
    note: "One short line, centred, no plate. For a line that is the whole shot. Under six words or pick another.",
    noteZh: "居中单行，无底板。整段只讲一句话时用，超过六个词请换一种。",
    style: {
      family: "Noto Sans CJK SC",
      weight: 700,
      sizeRatio: 0.072,
      fill: "#ffffff",
      treatment: "none",
      lines: 1,
      marginRatio: 0.44,
      karaoke: false,
      uppercase: false,
    },
  },
];

export const captionPreset = (key: string) =>
  CAPTION_PRESETS.find((p) => p.key === key) ?? CAPTION_PRESETS[0];


/* ----------------------------------------------------------- transitions */

/**
 * How one cut arrives from the one before it.
 *
 * Three, and only three. The craft notes are explicit that a viewer who can
 * name the transition is a viewer who stopped watching the film — so what is
 * on offer is the cut, the dissolve, and the dip through black that means
 * time has passed. No whip-pans, no cube spins, no "creative" wipes.
 */
export const TRANSITIONS = ["cut", "dissolve", "dip"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

export const TRANSITION_LABELS: Record<TransitionKind, { en: string; zh: string; note: string; noteZh: string }> = {
  cut: { en: "Cut", zh: "硬切", note: "Nothing between them.", noteZh: "两者之间不加任何过渡。" },
  dissolve: {
    en: "Dissolve",
    zh: "叠化",
    note: "One picture fades into the next. Use it between two shots of the same thing.",
    noteZh: "画面淡入下一画面。适合同一场景的两个镜头之间。",
  },
  dip: {
    en: "Dip to black",
    zh: "淡入淡出黑场",
    note: "Through black. It reads as time passing, so use it between sections.",
    noteZh: "经过黑场，意味着时间流逝，适合段落之间。",
  },
};

export function asTransition(value: unknown): TransitionKind {
  return (TRANSITIONS as readonly string[]).includes(String(value)) ? (value as TransitionKind) : "cut";
}


/* -------------------------------------------------------------- graphics */

/**
 * The graphics on offer, in one list.
 *
 * It used to be written out four times — the picker, the service's validation,
 * the agent's tool schema and the renderer — and the four had already drifted.
 * One list, imported by all of them: adding a kind is one edit.
 *
 * Ten, not fifty. Each one is a move the studio's own reference work found in
 * clips that worked; a menu of forty effects is how a video ends up wearing
 * six of them.
 */
export const GRAPHIC_KINDS = [
  {
    key: "lower-third",
    name: "Lower third",
    nameZh: "人名条",
    note: "A name and a role, bottom left, under whoever is speaking.",
    noteZh: "左下角的姓名与职务，压在说话人下方。",
    hasSub: true,
  },
  {
    key: "title",
    name: "Title",
    nameZh: "标题",
    note: "One line over the footage. For naming what you are about to see.",
    noteZh: "压在画面上的一行字，用来点出接下来要看的内容。",
    hasSub: true,
  },
  {
    key: "statement",
    name: "Statement",
    nameZh: "标语",
    note: "Two or three short lines, left, with the accent dash, the key words in the accent colour (mark them 【like this】). The claim of a section.",
    noteZh: "左对齐两三行短句，带强调色短线，关键词用强调色（用【】标出）。一段的核心论断。",
    hasSub: false,
  },
  {
    key: "chapter",
    name: "Chapter",
    nameZh: "章节",
    note: "A small marker, top left. For a video with parts.",
    noteZh: "左上角的小标记，适合分段的视频。",
    hasSub: false,
  },
  {
    key: "stat",
    name: "Big number",
    nameZh: "数字",
    note: "The figure, huge, with what it counts under it. For a number worth stopping on.",
    noteZh: "把数字放到最大，下面写它代表什么。适合值得停留的数据。",
    hasSub: true,
  },
  {
    key: "quote",
    name: "Pull quote",
    nameZh: "引言",
    note: "Somebody's words, set left over a scrim, with who said them under a rule.",
    noteZh: "左对齐的引语压在半透明底上，下方用一条横线标注出处。",
    hasSub: true,
  },
  {
    key: "bracket",
    name: "Bracket",
    nameZh: "括号标题",
    note: "The line inside { }, on black. A section opener, not a caption.",
    noteZh: "黑底上用 { } 包住的一行字，用于开启段落，不是字幕。",
    hasSub: false,
  },
  {
    key: "ticker",
    name: "Source strip",
    nameZh: "来源条",
    note: "A strip along the bottom: a source, a disclaimer, where it was filmed.",
    noteZh: "画面底部的条带：出处、免责声明、拍摄地点。",
    hasSub: true,
  },
  {
    key: "badge",
    name: "Corner badge",
    nameZh: "角标",
    note: "A small mark and a word, top right. It can hold for a whole section.",
    noteZh: "右上角的小标记加一个词，可以在整段内保持显示。",
    hasSub: false,
  },
  {
    key: "image",
    name: "Picture",
    nameZh: "图片",
    note: "A picture from Files, over the footage. Use it when the thing being talked about is worth seeing.",
    noteZh: "把文件库中的图片压在画面上。当谈到的东西值得一看时使用。",
    hasSub: false,
  },
  {
    key: "icon",
    name: "Icon",
    nameZh: "图标",
    note: "One of the studio's icons, for a thing just named. One idea, one icon — not a row of them.",
    noteZh: "用工作室自带的图标标示刚提到的事物。一个想法配一个图标，不要排成一列。",
    hasSub: false,
  },
  {
    key: "header",
    name: "Header",
    nameZh: "片头题",
    note: "The video's title and its one-line subtitle, top left, with the accent dash. Arrives after the hook and holds to the end.",
    noteZh: "左上角的视频标题与一句副题，带强调色短线。钩子之后出现，保持到结尾。",
    hasSub: true,
  },
  {
    key: "watermark",
    name: "Watermark",
    nameZh: "水印",
    note: "The channel's mark, small, bottom centre, for the whole video.",
    noteZh: "频道标识，小号，居中靠下，贯穿全片。",
    hasSub: true,
  },
  {
    key: "footnote",
    name: "Footnote",
    nameZh: "脚注",
    note: "One tiny grey line along the very bottom: a disclaimer, a source. Holds for the whole video.",
    noteZh: "画面最底部一行灰色小字：免责声明、资料来源。贯穿全片。",
    hasSub: false,
  },
  {
    key: "card",
    name: "Note card",
    nameZh: "便签卡",
    note: "A white rounded card with dark text, for an aside or a figure worth reading twice.",
    noteZh: "白色圆角卡片配深色文字，用于旁注或值得再看一眼的数字。",
    hasSub: false,
  },
  {
    key: "broll",
    name: "Cutaway",
    nameZh: "空镜",
    note: "A clip from the bin over the picture while the speaker keeps talking. For the thing being described, when there is footage of it.",
    noteZh: "在说话人继续讲的同时，用素材库里的一段画面盖住画面。适合讲到的东西恰好有素材时。",
    hasSub: false,
  },
  {
    key: "punch",
    name: "Punch in",
    nameZh: "推近",
    note: "The picture pushes in on the speaker for a beat. For the line that matters. Never two in a row.",
    noteZh: "画面向说话人推近一拍。用在关键的一句上，绝不连续两次。",
    hasSub: false,
  },
  {
    key: "end-card",
    name: "End card",
    nameZh: "片尾卡",
    note: "Full frame, on black. The last thing, and the only place a call to action belongs.",
    noteZh: "黑底满屏。放在最后，也是唯一适合放行动号召的位置。",
    hasSub: true,
  },
] as const;

export type GraphicKindKey = (typeof GRAPHIC_KINDS)[number]["key"];

export const GRAPHIC_KIND_KEYS = GRAPHIC_KINDS.map((k) => k.key) as readonly GraphicKindKey[];

export function isGraphicKind(value: unknown): value is GraphicKindKey {
  return (GRAPHIC_KIND_KEYS as readonly string[]).includes(String(value));
}


/* ------------------------------------------------------------- entrances */

/**
 * How a graphic arrives.
 *
 * Five, and they are all the same idea at different sizes: it appears, it
 * settles, it stays still. There is no bounce, no spin, no blur. `fade` is
 * what every graphic used to do; the rest exist because a title that fades
 * and a name that fades and a number that fades read as one tired hand.
 */
export const ENTRANCES = ["fade", "rise", "pop", "slide", "drop", "zoom", "slam"] as const;
export type Entrance = (typeof ENTRANCES)[number];

export const ENTRANCE_LABELS: Record<Entrance, { en: string; zh: string; note: string }> = {
  fade: { en: "Fade", zh: "淡入", note: "Appears in place with a small lift. The quiet default." },
  rise: { en: "Rise", zh: "上升", note: "Comes up from a little below and settles." },
  pop: { en: "Pop", zh: "弹出", note: "Scales up from slightly small. For a number or a word that is the point." },
  slide: { en: "Slide", zh: "滑入", note: "Slides in from the left and stops. For a name or a chapter." },
  drop: { en: "Drop", zh: "落下", note: "Drops in from above. For a badge or a ticker." },
  zoom: { en: "Push in", zh: "缓推", note: "A slow push in for as long as it is on. For a full-frame picture: the cutaway look." },
  slam: { en: "Slam", zh: "砸入", note: "Arrives a size too big and lands. For a number or a word that hits." },
};

export function asEntrance(value: unknown): Entrance {
  return (ENTRANCES as readonly string[]).includes(String(value)) ? (value as Entrance) : "fade";
}

/** The kinds that hold for the whole video rather than for a moment. */
export const FURNITURE_KINDS = ["header", "watermark", "footnote"] as const;

