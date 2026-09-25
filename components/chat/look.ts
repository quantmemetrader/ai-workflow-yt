/**
 * Small pieces of the chat's look that more than one component needs.
 *
 * Pure functions, no React, so the server pages and the client lists agree.
 */

import { splitMentions } from "@/lib/agents/catalog";

/** A palette colour at a given opacity: `soft("#d5e7fb", .4)`. */
export function soft(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The picture characters an employee opens a message with — the morning
 * brief's sun, the plan's clipboard.
 *
 * The product draws no emoji (they render differently on every machine and
 * read as a toy in a studio tool), and a card's title is chrome, so the
 * decoration in front of the first line is left off when it is drawn. Only
 * the leading run: anything inside the text is what the employee wrote.
 */
const LEADING_PICTURES = /^\s*(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{200D}\u{20E3}]*\s*)+/u;

export function withoutLeadingPictures(body: string): string {
  const next = body.replace(LEADING_PICTURES, "");
  return next.length ? next : body;
}

/**
 * Two habits of the employees' Markdown that the shared renderer
 * (`components/ui/Markdown`) does not read, evened out before it is drawn:
 *
 *   — `_reason_` for italics. The renderer only knows `*…*`, so the planner's
 *     day plan showed every reason wrapped in underscores.
 *   — a reason indented under its list item on the next line. The renderer
 *     ends a list at the first line that is not an item, so each reason broke
 *     the list in two and sat flush left between the bullets.
 *
 * Display only: the stored message is untouched, and a message without these
 * comes back exactly as it went in. Underscores inside words (`snake_case`,
 * ids) are left alone — only a run bounded by space or punctuation counts.
 */
const UNDERSCORE_EM = /(^|[\s(（「『《])_([^_\n]+?)_(?=$|[\s)）」』》.,，。;；:：!！?？、])/gm;
const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+/;

export function tidyMarkdown(body: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    // Inside a code fence, every character is the writer's: leave it be.
    if (line.startsWith("```")) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev !== undefined && /^\s{2,}\S/.test(line) && !LIST_ITEM.test(line) && LIST_ITEM.test(prev)) {
      out[out.length - 1] = `${prev} ${line.trim()}`.replace(UNDERSCORE_EM, "$1*$2*");
      continue;
    }
    out.push(line.replace(UNDERSCORE_EM, "$1*$2*"));
  }
  return out.join("\n");
}

/**
 * Whether a draft to the assistant asks anything beyond who should answer.
 *
 * The composers that talk to the assistant start a draft with an employee's
 * tag already in it — picked in the sidebar ("/chat?agent=script"), carried
 * over from the last turn, or put there by a face button. "@编剧 " alone is
 * not a question, but it is not empty either, so the send button lit up and
 * Enter started a billed turn with nothing in it. An employee's tag is set
 * aside — read the way routing reads it (`splitMentions`), so "@编剧写个开头"
 * with no space is a tag and a question — and anything else counts, a
 * person's name or a stray "@" included.
 */
export function asksSomething(draft: string): boolean {
  return splitMentions(draft).some((part) => part.agent === null && part.text.trim().length > 0);
}

/** "Vincent Chow" -> "VC"; "谢亚芳" -> "谢". For the grey initials tile. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/**
 * The rules a message thread needs, scoped to one screen.
 *
 * `canvas.css` is shared by every screen and is the design canvas verbatim, so
 * it is not edited for one column. These sit on top of it under the screen's
 * own attribute (`[data-chat-surface]`, `[data-agent-screen]`), which outranks
 * the canvas's bare class rules, and carry what a thread needed to read well:
 *
 *   — room between authors and almost none between one author's lines, with
 *     the time of a grouped line shown in the gutter on hover;
 *   — a line length a long agent message can be read at: 72ch is about forty
 *     Han characters, which is where a Chinese paragraph stops being a wall;
 *   — Markdown that looks like the rest of the product (lists, code, links)
 *     rather than the model's raw output;
 *   — one composer: the text first, then a single quiet row of tools and send.
 *
 * Returned as a string for a `<style dangerouslySetInnerHTML>`, which renders
 * the same bytes on the server and in the browser.
 */
export function threadCss(s: string): string {
  return `
${s} .dc-composer::placeholder { color: #a3a3a3; }
${s} .msg { position: relative; gap: 12px; padding: 10px 24px 3px; }
${s} .msg.cont { padding-top: 1px; }
${s} .msg.cont .mav, ${s} .msg.cont .face { visibility: hidden; height: 0; }
${s} .msg:hover { background: #fafafa; }
${s} .msg .face { width: 36px; flex-shrink: 0; }
${s} .msg .gut { position: absolute; left: 24px; top: 4px; width: 36px; text-align: center; font-size: 11px; line-height: 22px; color: #a3a3a3; font-variant-numeric: tabular-nums; opacity: 0; }
${s} .msg.cont:hover .gut { opacity: 1; }
${s} .msg .head { display: flex; align-items: center; flex-wrap: wrap; gap: 0 7px; min-height: 20px; }
${s} .msg .who { font-size: 13.5px; font-weight: 600; color: #171717; }
${s} .msg .when { font-size: 11.5px; color: #a3a3a3; margin-left: 0; font-variant-numeric: tabular-nums; }
${s} .role { display: inline-flex; align-items: center; height: 19px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0; white-space: nowrap; }
${s} .msg .txt { font-size: 13.5px; line-height: 1.7; color: #262626; margin-top: 2px; max-width: 72ch; overflow-wrap: anywhere; }
${s} .msg .txt.plain { white-space: pre-wrap; }
${s} .txt > div { font-size: inherit; line-height: inherit; color: inherit; gap: 7px; }
${s} .txt p { margin: 0; }
${s} .txt strong { color: #171717; font-weight: 600; }
${s} .txt ul, ${s} .txt ol { margin: 0; padding-left: 1.3em; gap: 3px; }
${s} .txt li { padding-left: 2px; }
${s} .txt li::marker { color: #a3a3a3; }
${s} .txt a { color: #0f5bd5; text-decoration: none; }
${s} .txt a:hover { text-decoration: underline; }
${s} .txt code { font-size: .88em; background: #f4f4f5; border: 1px solid #ececec; border-radius: 5px; padding: 0 4px; }
${s} .txt pre { margin: 0; background: #fafafa; border: 1px solid #ececec; border-radius: 9px; padding: 10px 12px; font-size: 12px; line-height: 1.6; overflow-x: auto; }
${s} .txt pre code { background: none; border: 0; padding: 0; font-size: inherit; }
${s} .txt table { font-size: 12.5px; }
${s} .day { padding: 16px 24px 4px; }
${s} .day span { font-size: 11.5px; color: #737373; background: #fff; }
${s} .composer { position: relative; border: 1px solid #dedede; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(5,5,6,.04); transition: border-color .15s, box-shadow .15s; }
${s} .composer:focus-within { border-color: #b5b5b5; box-shadow: 0 0 0 3px rgba(23,23,23,.05); }
${s} .bar { display: flex; align-items: center; gap: 1px; padding: 4px 8px 8px; }
${s} .bar .ico2 { width: 28px; height: 28px; border-radius: 7px; background: transparent; border: 0; padding: 0; cursor: pointer; }
${s} .bar .ico2 svg { width: 15px; height: 15px; stroke: #737373; }
${s} .bar .ico2:hover { background: #f4f4f5; }
${s} .bar .ico2:hover svg { stroke: #171717; }
${s} .bar .sep { width: 1px; height: 16px; background: #ececec; margin: 0 5px; flex-shrink: 0; }
${s} .bar .hint { font-size: 11.5px; color: #a3a3a3; padding-left: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
}
