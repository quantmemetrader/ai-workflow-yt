/**
 * The voices the studio can narrate in.
 *
 * Pure data, no server imports, so the editor and the project page can label
 * a track ("新闻女主播") without a round trip, and the worker can resolve the
 * same id to an engine voice.
 *
 * A voice id is `provider:voice`, optionally with a pace: `kokoro:zf_086`,
 * `kokoro:zm_064@1.1`, `elevenlabs:21m00Tcm4TlvDq8ikWAM`. The provider is in
 * the id because a track has to be re-speakable exactly as it was made, long
 * after the catalogue below has moved on; the pace is in it because
 * `audio_tracks` has no column for one and does not need a migration for it.
 * A bare id with no prefix is an ElevenLabs voice, which is how the only ids
 * ever written before this existed were spelled.
 *
 * The local voices are Kokoro-82M's (Apache-2.0). The Mandarin ones come from
 * v1.1-zh, whose hundred speakers were recorded by a professional dataset
 * company (LongMaoData) and granted for this model; the English ones from
 * v1.0. They were chosen from all 103 by measurement, not by ear:
 *
 *   - every voice read the same two sentences and was scored by UTMOS, a
 *     neural predictor of listener naturalness ratings (these are the top of
 *     the hundred; the female average was 3.51, these are 4.0-4.1);
 *   - the pitch and its spread told warm (low, steady), anchor (steady),
 *     and energetic (wide) apart;
 *   - each then read a 174-character paragraph that the local Whisper
 *     transcribed back: every one here came back at 1.2% character error or
 *     better (the misses are 它/他, the same sound).
 *
 * The owner chooses by ear from the samples; this list is where to change it.
 */

export type VoiceStyle = "warm" | "anchor" | "energetic" | "calm" | "deep";

export type CatalogVoice = {
  /** What is stored on the track: `kokoro:zf_086`. */
  id: string;
  provider: "local" | "elevenlabs";
  /** The engine's own name for it. */
  engineVoice: string;
  lang: "zh" | "en";
  gender: "female" | "male";
  style: VoiceStyle;
  /** The pace this voice reads best at, 1 being the model's own. */
  speed: number;
  name: { zh: string; en: string };
  blurb: { zh: string; en: string };
};

/** The default for a Mandarin narration, and what the director uses unless asked. */
export const DEFAULT_VOICE_ZH = "kokoro:zf_086";
export const DEFAULT_VOICE_EN = "kokoro:af_heart";

export const LOCAL_VOICES: CatalogVoice[] = [
  {
    id: "kokoro:zf_086",
    provider: "local",
    engineVoice: "zf_086",
    lang: "zh",
    gender: "female",
    style: "anchor",
    speed: 1,
    name: { zh: "新闻女声", en: "News anchor (female)" },
    blurb: { zh: "平稳清晰，适合资讯、解说", en: "Even and clear, for news and explainers" },
  },
  {
    id: "kokoro:zf_036",
    provider: "local",
    engineVoice: "zf_036",
    lang: "zh",
    gender: "female",
    style: "warm",
    speed: 1,
    name: { zh: "知性女声", en: "Warm (female)" },
    blurb: { zh: "低沉温和，适合故事、人物", en: "Lower and gentle, for stories and profiles" },
  },
  {
    id: "kokoro:zf_022",
    provider: "local",
    engineVoice: "zf_022",
    lang: "zh",
    gender: "female",
    style: "energetic",
    speed: 1.12,
    name: { zh: "活力女声", en: "Energetic (female)" },
    blurb: { zh: "起伏大、有感染力，适合短视频", en: "Lively and expressive, for shorts" },
  },
  {
    id: "kokoro:zf_075",
    provider: "local",
    engineVoice: "zf_075",
    lang: "zh",
    gender: "female",
    style: "calm",
    speed: 1.1,
    name: { zh: "亲切女声", en: "Friendly (female)" },
    blurb: { zh: "明亮柔和，适合生活、教程", en: "Bright and soft, for lifestyle and how-tos" },
  },
  {
    id: "kokoro:zm_064",
    provider: "local",
    engineVoice: "zm_064",
    lang: "zh",
    gender: "male",
    style: "deep",
    speed: 1,
    name: { zh: "浑厚男声", en: "Deep (male)" },
    blurb: { zh: "低沉有分量，适合纪录片、财经", en: "Low and weighty, for documentary and finance" },
  },
  {
    id: "kokoro:zm_081",
    provider: "local",
    engineVoice: "zm_081",
    lang: "zh",
    gender: "male",
    style: "anchor",
    speed: 1.15,
    name: { zh: "新闻男声", en: "News anchor (male)" },
    blurb: { zh: "沉稳标准，适合资讯播报", en: "Steady and standard, for news reads" },
  },
  {
    id: "kokoro:zm_095",
    provider: "local",
    engineVoice: "zm_095",
    lang: "zh",
    gender: "male",
    style: "energetic",
    speed: 1.08,
    name: { zh: "青年男声", en: "Young (male)" },
    blurb: { zh: "明亮有朝气，适合科技、快节奏", en: "Bright and young, for tech and fast cuts" },
  },
  {
    id: "kokoro:af_heart",
    provider: "local",
    engineVoice: "af_heart",
    lang: "en",
    gender: "female",
    style: "warm",
    speed: 1,
    name: { zh: "英文女声", en: "English (female)" },
    blurb: { zh: "美式，温暖自然", en: "American, warm and natural" },
  },
  {
    id: "kokoro:am_michael",
    provider: "local",
    engineVoice: "am_michael",
    lang: "en",
    gender: "male",
    style: "anchor",
    speed: 1,
    name: { zh: "英文男声", en: "English (male)" },
    blurb: { zh: "美式，沉稳", en: "American, steady" },
  },
  {
    id: "kokoro:bf_emma",
    provider: "local",
    engineVoice: "bf_emma",
    lang: "en",
    gender: "female",
    style: "calm",
    speed: 1,
    name: { zh: "英式女声", en: "British (female)" },
    blurb: { zh: "英式，清晰", en: "British, clear" },
  },
];

/** The same two sentences in every voice, so a sample compares voices, not lines. */
export const SAMPLE_LINE = {
  zh: "模型蒸馏，就是让一个小模型向大模型学习。它更便宜、更快，但能力可能出乎你的意料。",
  en: "Model distillation teaches a small model to learn from a large one. It is cheaper and faster, and it may surprise you.",
};

export type ParsedVoice = {
  provider: "local" | "elevenlabs";
  engineVoice: string;
  /** Multiplier on the voice's own pace (from the `@` suffix), 1 when absent. */
  pace: number;
  /** The catalogue entry, when it is one of ours. */
  voice: CatalogVoice | null;
};

/** `kokoro:zm_064@1.1` into its parts; null for anything malformed. */
export function parseVoiceId(raw: string | null | undefined): ParsedVoice | null {
  const id = (raw ?? "").trim();
  if (!id) return null;
  const m = /^(?:(kokoro|elevenlabs):)?([A-Za-z0-9_-]{2,64})(?:@(\d(?:\.\d{1,2})?))?$/.exec(id);
  if (!m) return null;
  const provider = m[1] === "kokoro" ? "local" : "elevenlabs";
  if (provider === "local" && !/^[abz][fm]_[a-z0-9]+$/.test(m[2])) return null;
  const pace = m[3] ? Math.max(0.7, Math.min(1.4, Number(m[3]))) : 1;
  const base = `${m[1] ?? "elevenlabs"}:${m[2]}`;
  const voice = LOCAL_VOICES.find((v) => v.id === base) ?? null;
  return { provider, engineVoice: m[2], pace, voice };
}

/** The id without its pace: what a sample is cached under. */
export function baseVoiceId(raw: string): string {
  return raw.replace(/@.*$/, "");
}

/** Human name for a stored voice id, in the UI's language. */
export function voiceLabel(raw: string | null | undefined, zh: boolean, extra: { id: string; name: string }[] = []): string {
  const p = parseVoiceId(raw);
  if (!p) return raw ?? "";
  if (p.voice) return zh ? p.voice.name.zh : p.voice.name.en;
  const other = extra.find((v) => v.id === baseVoiceId(raw ?? "") || v.id === p.engineVoice);
  return other?.name ?? p.engineVoice;
}

/** Which language a voice reads, so captions are filed under the right one. */
export function voiceLanguage(raw: string | null | undefined): "zh" | "en" {
  const p = parseVoiceId(raw);
  if (p?.voice) return p.voice.lang;
  if (p?.provider === "local") return p.engineVoice.startsWith("z") ? "zh" : "en";
  return "zh";
}
