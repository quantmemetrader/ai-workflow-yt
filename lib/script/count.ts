/**
 * How a script is counted and timed, in one place for the server (versions,
 * the library) and the browser (the 脚本 page's 字数 and 时长), so the draft
 * and a version of the same text never disagree (QA, 2 Oct: they were one
 * word apart because the page had its own counter).
 *
 * CJK characters are counted individually and everything else by whitespace
 * word, which is also how a mixed line comes out roughly right.
 */

export const CJK_PER_SECOND = 4.5;
export const WORDS_PER_SECOND = 2.6;

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/gu;

function split(text: string) {
  const cjk = (text.match(CJK) ?? []).length;
  const words = text
    .replace(CJK, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return { cjk, words };
}

export function spokenSeconds(text: string): number {
  const { cjk, words } = split(text);
  return cjk / CJK_PER_SECOND + words / WORDS_PER_SECOND;
}

export function wordCount(text: string): number {
  const { cjk, words } = split(text);
  return cjk + words;
}

/** Everything the page's 字数统计 shows for one piece of text. */
export function measureText(text: string) {
  const { cjk, words } = split(text);
  return { count: cjk + words, cjk, words, seconds: cjk / CJK_PER_SECOND + words / WORDS_PER_SECOND };
}
