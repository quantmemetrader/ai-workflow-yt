import type { RichNode } from "./rich";

/**
 * The rich script document (TipTap JSON, `lib/script/rich.ts`) written out as
 * HTML, plain text or Markdown: for the 导出 files and for the read-only
 * preview of a version on the 脚本 page (QA, 2 Oct: .docx lost bold and
 * highlight, .txt and .md lost the headings, and a version previewed as
 * bare paragraphs).
 *
 * Built from the JSON, never from stored HTML, so everything is escaped here
 * and only known-safe attributes and styles come out. Pure: no imports that
 * need the server, so the browser uses it too.
 */

type Mark = NonNullable<RichNode["marks"]>[number];

export type RichOut = {
  /** Add each paragraph's shot note (画面说明) under it. */
  notes?: boolean;
  /** For LibreOffice (Word / PDF): plain tags it maps, no images, checkboxes as ☐ / ☑. */
  forExport?: boolean;
  /** What a paragraph with only a shot note says (a natural-sound line). */
  natural?: string;
};

export function escapeHtml(x: string): string {
  return x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
const SIZE = /^\d{1,3}(\.\d+)?(pt|px|em|rem|%)$/;
const ALIGN = new Set(["left", "center", "right", "justify"]);

function cssColor(v: unknown): string | null {
  return typeof v === "string" && COLOR.test(v.trim()) ? v.trim() : null;
}

function safeHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const href = v.trim();
  return /^(https?:\/\/|mailto:|\/(?!\/))/i.test(href) ? href : null;
}

function textOf(n: RichNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(textOf).join("");
}

function shotOf(n: RichNode): string {
  return typeof n.attrs?.shot === "string" ? (n.attrs.shot as string).trim() : "";
}

/* ------------------------------------------------------------------ HTML */

function wrapMark(html: string, m: Mark, o: RichOut): string {
  const a = m.attrs ?? {};
  switch (m.type) {
    case "bold":
      return `<b>${html}</b>`;
    case "italic":
      return `<i>${html}</i>`;
    case "underline":
      return `<u>${html}</u>`;
    case "strike":
      return `<s>${html}</s>`;
    case "highlight": {
      /* A span with a background, not <mark>: LibreOffice drops <mark> when it writes Word. */
      const c = cssColor(a.color) ?? "#fff2a8";
      return `<span style="background-color:${c}">${html}</span>`;
    }
    case "textStyle": {
      const css: string[] = [];
      const color = cssColor(a.color);
      if (color) css.push(`color:${color}`);
      if (typeof a.fontSize === "string" && SIZE.test(a.fontSize)) css.push(`font-size:${a.fontSize}`);
      if (typeof a.fontFamily === "string" && a.fontFamily.trim()) css.push(`font-family:${a.fontFamily.replace(/[;:{}()<>\\]/g, "").slice(0, 200)}`);
      return css.length ? `<span style="${escapeHtml(css.join(";"))}">${html}</span>` : html;
    }
    case "link": {
      const href = safeHref(a.href);
      return href ? `<a href="${escapeHtml(href)}"${o.forExport ? "" : ' target="_blank" rel="noopener noreferrer"'}>${html}</a>` : html;
    }
    default:
      return html;
  }
}

function blockStyle(n: RichNode): string {
  const a = n.attrs ?? {};
  const css: string[] = [];
  if (typeof a.textAlign === "string" && ALIGN.has(a.textAlign) && a.textAlign !== "left") css.push(`text-align:${a.textAlign}`);
  const indent = Math.max(0, Math.min(8, Number(a.indent) || 0));
  if (indent) css.push(`margin-left:${indent * 36}px`);
  if (typeof a.lineHeight === "string" && /^\d(\.\d{1,2})?$/.test(a.lineHeight)) css.push(`line-height:${a.lineHeight}`);
  return css.length ? ` style="${css.join(";")}"` : "";
}

function inlineHtml(nodes: RichNode[] | undefined, o: RichOut): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "text") return (n.marks ?? []).reduce((h, m) => wrapMark(h, m, o), escapeHtml(n.text ?? ""));
      if (n.type === "hardBreak") return "<br>";
      if (n.type === "image") {
        if (o.forExport) return "";
        const src = typeof n.attrs?.src === "string" ? n.attrs.src : "";
        return /^(\/api\/files\/|https:\/\/)/.test(src) ? `<img src="${escapeHtml(src)}" alt="">` : "";
      }
      return inlineHtml(n.content, o);
    })
    .join("");
}

function blockHtml(n: RichNode, o: RichOut): string {
  const kids = () => (n.content ?? []).map((c) => blockHtml(c, o)).join("");
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph": {
      const shot = shotOf(n);
      let inner = inlineHtml(n.content, o);
      if (!textOf(n).trim() && shot && o.natural) inner = `<span style="color:#80868b">${escapeHtml(o.natural)}</span>`;
      const attr = shot && !o.forExport ? ` data-shot="${escapeHtml(shot)}"` : "";
      const note = shot && o.notes && o.forExport ? `<p class="shot">画面：${escapeHtml(shot)}</p>` : "";
      return `<p${attr}${blockStyle(n)}>${inner || (o.forExport ? "" : "<br>")}</p>${note}`;
    }
    case "heading": {
      const level = Math.max(1, Math.min(3, Number(n.attrs?.level) || 1));
      return `<h${level}${blockStyle(n)}>${inlineHtml(n.content, o)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${kids()}</ul>`;
    case "orderedList": {
      const start = Number(n.attrs?.start) || 1;
      return `<ol${start > 1 ? ` start="${start}"` : ""}>${kids()}</ol>`;
    }
    case "listItem":
      return `<li>${kids()}</li>`;
    case "taskList":
      return o.forExport ? `<ul style="list-style:none">${kids()}</ul>` : `<ul data-type="taskList">${kids()}</ul>`;
    case "taskItem": {
      const done = n.attrs?.checked === true;
      if (o.forExport) return `<li>${done ? "☑" : "☐"} ${(n.content ?? []).map((c) => (c.type === "paragraph" ? inlineHtml(c.content, o) : blockHtml(c, o))).join("")}</li>`;
      return `<li data-checked="${done}"><label><input type="checkbox" disabled${done ? " checked" : ""}></label><div>${kids()}</div></li>`;
    }
    case "blockquote":
      return `<blockquote>${kids()}</blockquote>`;
    case "horizontalRule":
      return "<hr>";
    case "image":
    case "text":
    case "hardBreak":
      return inlineHtml([n], o);
    default:
      return kids();
  }
}

/** The document as HTML: escaped, with only safe attributes. */
export function richToHtml(doc: RichNode, o: RichOut = {}): string {
  return blockHtml(doc, o);
}

/* ------------------------------------------------------- text & markdown */

function inlineMd(nodes: RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type !== "text") return inlineMd(n.content);
      let t = n.text ?? "";
      if (!t.trim()) return t;
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      /* Keep the spaces outside the markers, or Markdown will not read them. */
      const lead = t.match(/^\s*/)?.[0] ?? "";
      const tail = t.match(/\s*$/)?.[0] ?? "";
      t = t.trim();
      if (marks.has("strike")) t = `~~${t}~~`;
      if (marks.has("italic")) t = `*${t}*`;
      if (marks.has("bold")) t = `**${t}**`;
      const link = (n.marks ?? []).find((m) => m.type === "link");
      const href = link ? safeHref(link.attrs?.href) : null;
      if (href) t = `[${t}](${href})`;
      return lead + t + tail;
    })
    .join("");
}

function lines(n: RichNode, md: boolean, o: RichOut, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  const inline = (x: RichNode) => (md ? inlineMd(x.content) : textOf(x));
  const noteLine = (shot: string) => (md ? `> 画面：${shot}` : `（画面：${shot}）`);
  const kids = (d = depth) => (n.content ?? []).flatMap((c) => lines(c, md, o, d));
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph": {
      const shot = shotOf(n);
      let text = inline(n).replace(/\s+$/g, "");
      if (!text.trim() && shot) {
        if (!o.natural && !o.notes) return [];
        text = o.natural ?? "";
      }
      if (!text.trim() && !shot) return [];
      return [text, ...(o.notes && shot ? [noteLine(shot)] : []), ""];
    }
    case "heading": {
      const level = Math.max(1, Math.min(3, Number(n.attrs?.level) || 1));
      const text = inline(n).trim();
      if (!text) return [];
      /* The file's title is the one #, so the document's headings start at ##. */
      return md ? [`${"#".repeat(level + 1)} ${text}`, ""] : [text, ""];
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number(n.attrs?.start) || 1;
      const out: string[] = [];
      (n.content ?? []).forEach((item, i) => {
        const mark = n.type === "orderedList" ? `${start + i}.` : n.type === "taskList" ? (md ? `- [${item.attrs?.checked === true ? "x" : " "}]` : item.attrs?.checked === true ? "☑" : "☐") : md ? "-" : "•";
        let first = true;
        for (const c of item.content ?? []) {
          if (c.type === "paragraph") {
            const text = inline(c).replace(/\s+$/g, "");
            out.push(first ? `${pad}${mark} ${text}` : `${pad}   ${text}`);
            const shot = shotOf(c);
            if (o.notes && shot) out.push(`${pad}   ${noteLine(shot)}`);
            first = false;
          } else {
            out.push(...lines(c, md, o, depth + 1).filter((l) => l !== ""));
          }
        }
      });
      return depth === 0 ? [...out, ""] : out;
    }
    case "blockquote":
      return md ? kids().map((l) => (l ? `> ${l}` : l)) : kids();
    case "horizontalRule":
      return [md ? "---" : "----------", ""];
    default:
      return kids();
  }
}

function tidy(list: string[]): string {
  return list.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Plain text: headings on their own lines, list items marked. */
export function richToText(title: string, doc: RichNode, o: RichOut = {}): string {
  return tidy([title, "", ...lines(doc, false, o)]);
}

/** Markdown: # title, ## headings, **bold**, lists. */
export function richToMarkdown(title: string, doc: RichNode, o: RichOut = {}): string {
  return tidy([`# ${title}`, "", ...lines(doc, true, o)]);
}
