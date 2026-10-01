import { scrubToolNames } from "@/lib/agents/steps";

/**
 * What a person reads of an AI employee's message: no internal ids
 * (「（scr_01m3…）」), no tool names (「assign_task 已调用」), no doubled name
 * prefix (「编剧 — 编剧 — 」). QA, 2 Oct: all three were showing on 首页,
 * 选题 and in the channels.
 */
const ID = "(?:scr|wp|fil|prj|rnd|cnv|msg|top|job|vp|req|idea|use|am|tc|ch|chn|cmt|sug|sv|apr|inv|usr|tup|ver)_[0-9a-z]{10,}";

export function readerMarkdown(text: string): string {
  if (!text) return text;
  return scrubToolNames(
    text
      // an id alone in brackets after the thing it names
      .replace(new RegExp(`\\s*[（(]\\s*(?:id|ID|编号)?[:：]?\\s*\`?${ID}\`?\\s*[）)]`, "g"), "")
      // an id standing alone in prose (not inside a link target)
      .replace(new RegExp(`(^|[^/\\w(])\`?${ID}\`?`, "g"), "$1")
      // 「编剧 — 编剧 — 写…」, 「编剧：编剧 —」
      .replace(/(^|\n)\s*([一-鿿]{2,4})\s*[—\-–:：]\s*\2\s*[—\-–:：]\s*/g, "$1$2：")
      .replace(/[ \t]+\n/g, "\n"),
  );
}

/** One plain line for a card or a preview: the Markdown above, then its symbols gone and links reduced to their words. */
export function readerLine(text: string, max = 160): string {
  return readerMarkdown(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}《「『（(“"【]+/u, "")
    .trim()
    .slice(0, max);
}
