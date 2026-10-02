import "server-only";
import { toSimplified } from "@/lib/text/simplified";
import type { RichDoc, RichNode } from "@/lib/script/rich";

/**
 * A document's HTML (LibreOffice's conversion of a Word file, or our own from
 * Markdown) as the script page's document, so an import keeps its headings,
 * bold, italic, underline, links and lists (QA, 2 Oct: 导入 flattened a Word
 * file into plain lines). The page has no table block, a script being read
 * line by line, so each table row becomes one line with its cells side by
 * side; a header cell is bold. No DOM on the server: a small tag walk is
 * enough for what converters write.
 */

type Mark = { type: string; attrs?: Record<string, unknown> };
type Open = { tag: string; mark: Mark | null };

const SKIP = new Set(["head", "style", "script", "title", "noscript", "template", "svg", "object"]);
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", middot: "·", ndash: "-", mdash: "-", bull: "•", copy: "©", reg: "®", times: "×" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

/** The marks a tag stands for: the tag itself, or what its inline style says. */
function marksOf(tag: string, attrs: string): Mark[] {
  const out: Mark[] = [];
  if (tag === "b" || tag === "strong") out.push({ type: "bold" });
  if (tag === "i" || tag === "em" || tag === "cite") out.push({ type: "italic" });
  if (tag === "u" || tag === "ins") out.push({ type: "underline" });
  if (tag === "s" || tag === "strike" || tag === "del") out.push({ type: "strike" });
  if (tag === "a") {
    const href = attr(attrs, "href");
    if (href && /^(https?:|mailto:)/i.test(href.trim())) out.push({ type: "link", attrs: { href: href.trim(), target: "_blank", rel: "noopener noreferrer" } });
  }
  const style = (attr(attrs, "style") ?? "").toLowerCase();
  if (style) {
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) out.push({ type: "bold" });
    if (/font-style\s*:\s*italic/.test(style)) out.push({ type: "italic" });
    if (/text-decoration[^;]*underline/.test(style)) out.push({ type: "underline" });
    if (/text-decoration[^;]*line-through/.test(style)) out.push({ type: "strike" });
  }
  return out;
}

const sameMarks = (a?: Mark[], b?: Mark[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Adjacent runs with the same marks as one; the line's edges trimmed; nothing left = null. */
function tidy(nodes: RichNode[]): RichNode[] | null {
  const merged: RichNode[] = [];
  for (const n of nodes) {
    const last = merged[merged.length - 1];
    if (n.type === "text" && last?.type === "text" && sameMarks(last.marks, n.marks)) last.text = (last.text ?? "") + (n.text ?? "");
    else merged.push({ ...n });
  }
  const blank = (n?: RichNode) => n?.type === "hardBreak" || (n?.type === "text" && !(n.text ?? "").trim());
  while (merged.length && blank(merged[0])) merged.shift();
  while (merged.length && blank(merged[merged.length - 1])) merged.pop();
  if (merged[0]?.type === "text") merged[0].text = (merged[0].text ?? "").replace(/^\s+/, "");
  const end = merged[merged.length - 1];
  if (end?.type === "text") end.text = (end.text ?? "").replace(/\s+$/, "");
  const kept = merged.filter((n) => n.type !== "text" || (n.text ?? "") !== "");
  return kept.some((n) => n.type === "text" && (n.text ?? "").trim()) ? kept : null;
}

export function htmlToRichDoc(html: string, limit = 600): RichDoc {
  const root: RichNode[] = [];
  const lists: RichNode[] = [];
  const items: RichNode[] = [];
  const marks: Open[] = [];
  let block: { type: "paragraph" } | { type: "heading"; level: number } = { type: "paragraph" };
  let cur: RichNode[] | null = null;
  let row: { nodes: RichNode[]; th: boolean }[] | null = null;
  let cell: { nodes: RichNode[]; th: boolean } | null = null;
  let skipping: string | null = null;
  let count = 0;

  const target = (): RichNode[] => (items.length ? (items[items.length - 1].content ??= []) : root);
  const flush = () => {
    const content = cur ? tidy(cur) : null;
    cur = null;
    if (!content || count >= limit) return;
    count++;
    target().push(block.type === "heading" ? { type: "heading", attrs: { level: block.level }, content } : { type: "paragraph", content });
  };
  const active = (): Mark[] => {
    const seen = new Map<string, Mark>();
    for (const o of marks) if (o.mark) seen.set(o.mark.type, o.mark);
    return [...seen.values()];
  };
  const pushText = (raw: string) => {
    const text = toSimplified(decode(raw).replace(/[\s ]+/g, " "));
    if (!text) return;
    const ms = active();
    const node: RichNode = { type: "text", text, ...(ms.length ? { marks: ms } : {}) };
    if (cell) {
      if (cell.th && !ms.some((m) => m.type === "bold")) node.marks = [...ms, { type: "bold" }];
      cell.nodes.push(node);
      return;
    }
    if (!cur) {
      if (!text.trim()) return;
      cur = [];
    }
    cur.push(node);
  };
  const closeList = () => {
    flush();
    lists.pop();
  };

  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[0].startsWith("<!--")) continue;
    const text = m[4];
    if (text !== undefined) {
      if (!skipping) pushText(text);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    if (skipping) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (SKIP.has(tag)) {
      if (!closing && !/\/\s*$/.test(attrs)) skipping = tag;
      continue;
    }

    /* A table: each row one line, the cells side by side. */
    if (tag === "tr") {
      if (!closing) {
        flush();
        row = [];
      } else if (row) {
        const content: RichNode[] = [];
        row
          .map((c) => tidy(c.nodes.map((n) => (n.type === "text" ? { ...n, text: (n.text ?? "").replace(/\s+/g, " ") } : n))))
          .filter((c): c is RichNode[] => Boolean(c))
          .forEach((c, i) => {
            if (i) content.push({ type: "text", text: "　|　" });
            content.push(...c);
          });
        const tidied = tidy(content);
        if (tidied && count < limit) {
          count++;
          target().push({ type: "paragraph", content: tidied });
        }
        row = null;
        cell = null;
      }
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (!closing && row) {
        cell = { nodes: [], th: tag === "th" };
        row.push(cell);
      } else if (closing) cell = null;
      continue;
    }
    if (cell) {
      /* Inside a cell, blocks are only spacing. */
      if (tag === "br" || tag === "p" || tag === "div" || tag === "li") {
        if (cell.nodes.length) cell.nodes.push({ type: "text", text: " " });
        continue;
      }
    }

    if (/^h[1-6]$/.test(tag)) {
      flush();
      block = closing ? { type: "paragraph" } : { type: "heading", level: Math.min(3, Number(tag[1])) };
      continue;
    }
    if (tag === "p" || tag === "div" || tag === "center" || tag === "blockquote" || tag === "section" || tag === "article" || tag === "dd" || tag === "dt" || tag === "pre") {
      flush();
      if (!closing && block.type === "heading" && tag !== "p") block = { type: "paragraph" };
      continue;
    }
    if (tag === "br") {
      if (cur !== null) (cur as RichNode[]).push({ type: "hardBreak" });
      continue;
    }
    if (tag === "hr") {
      flush();
      continue;
    }
    if (tag === "ul" || tag === "ol" || tag === "dl") {
      if (closing) {
        if (lists.length) closeList();
        continue;
      }
      flush();
      const list: RichNode = { type: tag === "ol" ? "orderedList" : "bulletList", content: [] };
      target().push(list);
      lists.push(list);
      continue;
    }
    if (tag === "li") {
      flush();
      if (closing) {
        const item = items.pop();
        if (item && !(item.content ?? []).length) item.content = [{ type: "paragraph" }];
        continue;
      }
      if (!lists.length) {
        const list: RichNode = { type: "bulletList", content: [] };
        target().push(list);
        lists.push(list);
      }
      const item: RichNode = { type: "listItem", content: [] };
      (lists[lists.length - 1].content ??= []).push(item);
      items.push(item);
      continue;
    }

    /* Inline: a mark while it is open (or nothing, to keep the closes in step). */
    if (/\/\s*$/.test(attrs) || tag === "img" || tag === "meta" || tag === "link" || tag === "col" || tag === "input") continue;
    if (!closing) {
      const ms = marksOf(tag, attrs);
      if (!ms.length) marks.push({ tag, mark: null });
      else ms.forEach((mark) => marks.push({ tag, mark }));
    } else {
      let i = marks.length - 1;
      while (i >= 0 && marks[i].tag !== tag) i--;
      if (i >= 0) {
        let j = i;
        while (j > 0 && marks[j - 1].tag === tag && marks[j - 1].mark) j--;
        marks.splice(j, marks.length - j, ...marks.slice(i + 1));
      }
    }
  }
  flush();

  /* A list item must start with a paragraph; an empty list goes. */
  const fix = (nodes: RichNode[]): RichNode[] =>
    nodes
      .map((n) => {
        if (n.type === "bulletList" || n.type === "orderedList") return { ...n, content: fix(n.content ?? []).filter((c) => c.type === "listItem") };
        if (n.type === "listItem") {
          const inner = fix(n.content ?? []);
          return { ...n, content: inner[0]?.type === "paragraph" ? inner : [{ type: "paragraph" }, ...inner] };
        }
        return n;
      })
      .filter((n) => !((n.type === "bulletList" || n.type === "orderedList") && !(n.content ?? []).length));
  const content = fix(root);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** How many lines (paragraphs, headings, list items) a document has. */
export function lineCount(doc: RichNode): number {
  let n = 0;
  const walk = (x: RichNode) => {
    if (x.type === "paragraph" || x.type === "heading") {
      if ((x.content ?? []).length) n++;
      return;
    }
    (x.content ?? []).forEach(walk);
  };
  walk(doc);
  return n;
}
