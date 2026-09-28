/**
 * The models a person may pick for one message, in plain words.
 *
 * Ryan (28 Sep): "they can change the model for every message instead of
 * changing it for the entire platform — like Claude, put change model in the
 * chat box". So the chip in the composer picks from this list for the
 * messages sent from that box; the studio's default (Admin → 设置) is what
 * 「自动」 means and is untouched by it.
 *
 * Client-safe on purpose (no server imports): the composer draws it, the
 * stream route and the copilot check a sent id against it.
 */
export type ChatModel = { id: string; zh: string; en: string; lineZh: string; lineEn: string; real: string };

export const AUTO_MODEL = "auto";

export const CHAT_MODELS: ChatModel[] = [
  { id: AUTO_MODEL, zh: "自动", en: "Auto", lineZh: "工作室默认，一般选这个", lineEn: "The studio's default — usually right", real: "" },
  { id: "qwen/qwen3-max", zh: "标准", en: "Standard", lineZh: "中文好，最稳", lineEn: "Strong Chinese, the steady one", real: "Qwen3 Max" },
  { id: "qwen/qwen3.7-max", zh: "最强", en: "Strongest", lineZh: "难的问题、很长的文件", lineEn: "Hard questions, long files", real: "Qwen3.7 Max" },
  { id: "moonshotai/kimi-k2.6", zh: "写稿", en: "Writer", lineZh: "中文文字最自然，改稿用", lineEn: "The most natural Chinese prose", real: "Kimi K2.6" },
  { id: "qwen/qwen3.7-plus", zh: "省钱", en: "Thrifty", lineZh: "日常问题，便宜", lineEn: "Everyday questions, cheaper", real: "Qwen3.7 Plus" },
  { id: "z-ai/glm-5.3", zh: "第二意见", en: "Second opinion", lineZh: "换一家模型再看一遍", lineEn: "A different model's take", real: "GLM 5.3" },
  { id: "deepseek/deepseek-v4-flash", zh: "最快", en: "Fastest", lineZh: "简单的小事，又快又便宜", lineEn: "Quick small jobs, cheapest", real: "DeepSeek V4 Flash" },
];

const IDS = new Set(CHAT_MODELS.map((m) => m.id).filter((id) => id !== AUTO_MODEL));

/** The model to use for a turn, or null for the studio default. Anything not on the list is the default. */
export function pickedModel(raw: unknown): string | null {
  return typeof raw === "string" && IDS.has(raw) ? raw : null;
}

export function chatModel(id: string | null | undefined): ChatModel {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0];
}
