/**
 * Markdown into the document editor and back out again, for an uploaded .md
 * edited with 在线编辑 (QA, 4 Oct: a save merged paragraphs, loosened tight
 * lists and dropped the final newline).
 *
 * The editor knows paragraphs, headings 1–3, lists, quotes and rules, not
 * tables or code blocks. Those come in as one paragraph whose lines are hard
 * breaks, with runs of spaces kept as no-break spaces (the editor folds plain
 * ones), and go back out line for line. Pure, so the round trip can be checked
 * without a database or a browser.
 */

const NBSP = " ";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Spaces the editor would fold: leading ones and runs. */
const keepSpaces = (s: string) => s.replace(/^ +/, (m) => NBSP.repeat(m.length)).replace(/ {2,}/g, (m) => NBSP.repeat(m.length));
const verbatim = (lines: string[]) => `<p>${lines.map((l) => esc(keepSpaces(l.replace(/\t/g, "    ")))).join("<br>")}</p>`;

const FENCE = /^\s{0,3}(```|~~~)/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

type Item = { indent: number; ordered: boolean; start: number; lines: string[]; children: Item[] };

function listHtml(items: Item[]): string {
  let out = "";
  let i = 0;
  while (i < items.length) {
    const ordered = items[i].ordered;
    const run: Item[] = [];
    while (i < items.length && items[i].ordered === ordered) run.push(items[i++]);
    const start = ordered && run[0].start !== 1 ? ` start="${run[0].start}"` : "";
    out += `<${ordered ? "ol" : "ul"}${start}>`;
    for (const it of run) out += `<li><p>${it.lines.map(esc).join("<br>")}</p>${it.children.length ? listHtml(it.children) : ""}</li>`;
    out += ordered ? "</ol>" : "</ul>";
  }
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const block = [line];
      i++;
      while (i < lines.length) {
        block.push(lines[i]);
        if (lines[i].trim().startsWith(fence[1])) {
          i++;
          break;
        }
        i++;
      }
      out.push(verbatim(block));
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) block.push(lines[i++]);
      out.push(verbatim(block));
      continue;
    }
    const h = HEADING.exec(line.trimEnd());
    if (h) {
      out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (ITEM.test(line)) {
      /* Items nest under the nearest earlier item indented less than they are. */
      const roots: Item[] = [];
      const stack: Item[] = [];
      while (i < lines.length && lines[i].trim()) {
        const m = ITEM.exec(lines[i]);
        if (m) {
          const it: Item = { indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, lines: [m[3].trimEnd()], children: [] };
          while (stack.length && stack[stack.length - 1].indent >= it.indent) stack.pop();
          (stack.length ? stack[stack.length - 1].children : roots).push(it);
          stack.push(it);
        } else if (FENCE.test(lines[i]) || HEADING.test(lines[i]) || /^\s*\|/.test(lines[i])) {
          break;
        } else {
          stack[stack.length - 1].lines.push(lines[i].trim());
        }
        i++;
      }
      out.push(listHtml(roots));
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !ITEM.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${para.map(esc).join("<br>")}</p>`);
  }
  return out.join("");
}

/* ---- back out ---------------------------------------------------------- */

type El = { tag: string; attrs: string; children: Nd[] };
type Nd = El | string;
const VOID = new Set(["br", "hr", "img", "input", "col", "wbr"]);

function parse(html: string): Nd[] {
  const root: El = { tag: "#root", attrs: "", children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)([^>]*)>|[^<]+|</g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tok = m[0];
    const top = stack[stack.length - 1];
    if (tok.startsWith("<!--")) continue;
    if (!m[1]) {
      top.children.push(decode(tok));
      continue;
    }
    const tag = m[1].toLowerCase();
    if (tok.startsWith("</")) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const el: El = { tag, attrs: m[2] ?? "", children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !tok.endsWith("/>")) stack.push(el);
  }
  return root.children;
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/ /g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

const attr = (el: El, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(el.attrs)?.slice(2).find((v) => v !== undefined);

function inline(nodes: Nd[]): string {
  let s = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      s += n;
      continue;
    }
    const body = inline(n.children);
    const wrap = (mark: string) => (body.trim() ? body.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${mark}$2${mark}$3`) : body);
    if (n.tag === "br") s += "\n";
    else if (n.tag === "strong" || n.tag === "b") s += wrap("**");
    else if (n.tag === "em" || n.tag === "i") s += wrap("*");
    else if (n.tag === "s" || n.tag === "del" || n.tag === "strike") s += wrap("~~");
    else if (n.tag === "code") s += `\`${body}\``;
    else if (n.tag === "a") {
      const href = attr(n, "href");
      s += href && href !== body ? `[${body}](${decode(href)})` : body;
    } else s += body;
  }
  return s;
}

const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "div", "pre", "table"]);

/** Block children as Markdown blocks; stray inline runs become a paragraph. */
function blocks(nodes: Nd[]): string[] {
  const out: string[] = [];
  let run: Nd[] = [];
  const flush = () => {
    const t = inline(run).trim();
    if (t) out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (typeof n === "string" || !BLOCK.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    const b = block(n);
    if (b !== null) out.push(b);
  }
  flush();
  return out;
}

function block(el: El): string | null {
  const h = /^h([1-6])$/.exec(el.tag);
  if (h) return `${"#".repeat(Number(h[1]))} ${inline(el.children).trim()}`;
  if (el.tag === "p") {
    /* A paragraph keeps its lines exactly: tables and code come back as they went in. */
    const t = inline(el.children).replace(/^\n+|\n+$/g, "");
    return t.trim() ? t.replace(/[ \t]+$/gm, "") : null;
  }
  if (el.tag === "hr") return "---";
  if (el.tag === "ul" || el.tag === "ol") return list(el);
  if (el.tag === "blockquote") {
    const inner = blocks(el.children).join("\n\n");
    return inner ? inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") : null;
  }
  const inner = blocks(el.children).join("\n\n");
  return inner || null;
}

/** A list stays tight: one item per line, nested lists indented under their item. */
function list(el: El): string | null {
  const ordered = el.tag === "ol";
  const task = /data-type\s*=\s*["']taskList/i.test(el.attrs);
  let n = Number(attr(el, "start") ?? 1) || 1;
  const lines: string[] = [];
  for (const li of el.children) {
    if (typeof li === "string" || li.tag !== "li") continue;
    const checked = /data-checked\s*=\s*["']true/i.test(li.attrs);
    const marker = ordered ? `${n++}. ` : task ? `- [${checked ? "x" : " "}] ` : "- ";
    const pad = " ".repeat(ordered ? marker.length : 2);
    /* A task item wraps its text in a <div>; look inside it for the blocks. */
    const kids = li.children.flatMap((c) => (typeof c !== "string" && c.tag === "div" && task ? c.children : [c]));
    const parts = kids.flatMap((c) => (typeof c !== "string" && c.tag === "label" ? [] : [c]));
    const body = blocks(parts);
    const text = body.length ? body.join("\n") : "";
    lines.push(
      text
        .split("\n")
        .map((l, k) => (k === 0 ? marker + l : l ? pad + l : l))
        .join("\n"),
    );
  }
  return lines.length ? lines.join("\n") : null;
}

/** The editor's HTML as Markdown: blocks one blank line apart, a final newline. */
export function htmlToMarkdown(html: string): string {
  const md = blocks(parse(html)).join("\n\n");
  return md ? `${md}\n` : "";
}
