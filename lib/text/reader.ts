import { scrubToolNames } from "@/lib/agents/steps";
import { humanize } from "@/lib/text/human";

/* Provider errors stored in English before 2 Oct, said in Chinese when shown. */
const OLD_ERRORS: [RegExp, string][] = [
  [/The model provider failed:[^\n。]*/gi, "AI 服务暂时出错了"],
  [/Orbio could not complete this private operation[^\n。]*/gi, "AI 服务暂时出错了"],
  [/No provider is currently serving this model[^\n。]*/gi, "选的模型暂时没有服务商可用"],
  [/[a-z0-9-]+\/[a-z0-9.:_-]+ did not respond within \d+s/gi, "AI 服务这次没有回应"],
  [/[a-z0-9-]+\/[a-z0-9.:_-]+ stalled mid-answer/gi, "AI 服务这次没有回应"],
];

/**
 * What a person reads of an AI employee's message: no internal ids
 * (「（scr_01m3…）」), no tool names (「assign_task 已调用」), no doubled name
 * prefix (「文案 — 文案 — 」). QA, 2 Oct: all three were showing on 首页,
 * 选题 and in the channels.
 */
const ID = "(?:scr|wp|fil|prj|rnd|cnv|msg|top|job|vp|req|idea|use|am|tc|ch|chn|cmt|sug|sv|apr|inv|usr|tup|ver)_[0-9a-z]{10,}";

export function readerMarkdown(text: string): string {
  if (!text) return text;
  let t = text;
  for (const [re, zh] of OLD_ERRORS) t = t.replace(re, zh);
  return humanize(scrubToolNames(
    t
      // an id alone in brackets after the thing it names
      .replace(new RegExp(`\\s*[（(]\\s*(?:id|ID|编号)?[:：]?\\s*\`?${ID}\`?\\s*[）)]`, "g"), "")
      // an id standing alone in prose (not inside a link target)
      .replace(new RegExp(`(^|[^/\\w(])\`?${ID}\`?`, "g"), "$1")
      // 「文案 — 文案 — 写…」, 「文案：文案 —」
      .replace(/(^|\n)(\s*(?:[-*•]\s+)?)([一-鿿]{1,4})\s*[—\-–:：]\s*\3\s*[—\-–:：]\s*/g, "$1$2$3：")
      // a list of ids stripped away leaves 「（如等）」 or 「如等」
      .replace(/[（(]\s*如?\s*等?\s*[）)]/g, "")
      .replace(/如\s*、?\s*等/g, "")
      .replace(/[ \t]+\n/g, "\n"),
  ));
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
