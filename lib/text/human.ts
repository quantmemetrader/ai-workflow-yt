/**
 * AI-written text made to read like a person wrote it (the owner, 2 Oct:
 * "remove AI hyphens, i.e. em dashes, and everything that makes it feel like
 * AI"). Applied to what the AI employees write — replies, drafts, rewrites,
 * plans — never to what people type themselves.
 */
const CJK = "[\\u3400-\\u9fff\\uff00-\\uffef\\u3000-\\u303f]";

export function humanize(text: string): string {
  if (!text || !/[—–]/.test(text)) return text;
  return (
    text
      // a number range keeps a plain hyphen: 2024—2025 → 2024-2025
      .replace(/(\d)\s*[—–]{1,2}\s*(?=\d)/g, "$1-")
      // a dash opening a line (a list marker): drop it
      .replace(/^[ \t]*[—–]{1,2}[ \t]+/gm, "")
      // Chinese around it: a comma reads naturally (——, —, –)
      .replace(new RegExp(`(${CJK}|[0-9A-Za-z）)】」』"])\\s*[—–]{1,2}\\s*(?=${CJK}|[0-9A-Za-z（(【「『"])`, "g"), (m, a: string) => (/[㐀-鿿＀-￯　-〿]/.test(a) || /[㐀-鿿]/.test(m) ? `${a}，` : `${a}, `))
      // whatever is left, at the end of a line or alone
      .replace(/\s*[—–]{1,2}\s*$/gm, "")
      .replace(/[—–]{1,2}/g, "，")
      .replace(/，，+/g, "，")
      .replace(/，([。！？；：])/g, "$1")
  );
}

/** The house rule every AI employee writes by, added to their prompts. */
export const HUMAN_STYLE_ZH = `写作风格（必须遵守）：
- 像真人同事说话：短句、口语、具体。不要用破折号（——、—），需要停顿就用逗号或句号。
- 不要 AI 腔：不用“首先/其次/最后/总之/综上所述/值得注意的是/不仅…而且…/赋能/助力/打造/深度解析/全方位/一站式/让我们”这类词，不要每段都总结，不要排比凑数。
- 能用一句话说清的，不写三句。数字和例子比形容词有用。`;
