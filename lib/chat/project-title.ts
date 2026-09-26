import { splitMentions } from "@/lib/agents/catalog";

/**
 * A project's name, suggested from a conversation: the person's first real
 * ask, cleaned. Pure, so the chat bar (client) and the route that creates
 * the project (server) suggest the same words.
 *
 * "Real" is a message with something in it besides tags: "@编剧 " alone is
 * the box's own pre-fill, not an ask. Home's "问研究员" puts the idea's own
 * title first ("关于首页上研究员给的这个选题《X》…"), and a quoted title is
 * the project's name whatever else the message says.
 */
export type AskLike = { role: string; content: string };

export function firstAsk(messages: readonly AskLike[]): string | null {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = withoutTags(m.content);
    if (text) return text;
  }
  return null;
}

/** The message with every @tag taken out. */
export function withoutTags(content: string): string {
  return splitMentions(content)
    .filter((p) => p.agent === null)
    .map((p) => p.text)
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const FILLER = /^(?:请你?|麻烦你?|帮我|帮忙|能不能|可不可以|可以|我想|我要|想|你|给我)+\s*/;
const VERB = /^(?:做|拍|写|剪|出|想)(?:一个|一条|一篇|一期|个|条|篇|期)?\s*/;

export function askTitle(text: string | null | undefined): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const quoted = raw.match(/《([^》\n]{2,60})》/)?.[1];
  if (quoted) return quoted.trim().slice(0, 40);
  /* "写一个 3 分钟的脚本，主题：X" is about X. */
  const theme = raw.match(/(?:主题|题目|选题|话题|topic|about)\s*[:：]\s*([^\n]+)/i)?.[1];
  let s = (theme ?? raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "").trim();
  s = s.replace(FILLER, "").replace(VERB, "");
  /* One sentence; a long one is cut at its first pause. */
  s = s.split(/[。！？!?]/)[0] ?? s;
  if (s.length > 20) {
    const head = s.split(/[，,；;：:]/)[0] ?? s;
    if (head.length >= 6) s = head;
  }
  s = s.replace(/[\s，,。.;；:：、…~～]+$/u, "").replace(/^["“'‘「]+|["”'’」]+$/g, "").trim();
  return (s || raw).slice(0, 40);
}

/** The whole rule: the first real ask's title, or "" when there is none. */
export function suggestTitle(messages: readonly AskLike[]): string {
  return askTitle(firstAsk(messages));
}
