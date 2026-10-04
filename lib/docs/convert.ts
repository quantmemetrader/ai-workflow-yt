/**
 * Plain text and Markdown in, editor HTML out, and back (5 Oct: contracts,
 * monthly reports and spend requests open on the same paper as the script
 * page). The text stays the record the assistants and the clause review read;
 * the HTML is only how it looks on the page. No DOM here, so it runs on the
 * server for the first render and in the browser on every save.
 */

type Node = { type?: string; text?: string; content?: Node[]; marks?: { type: string }[]; attrs?: Record<string, unknown> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * `markdown`: headings, lists and **bold** become formatting, blank lines
 * separate paragraphs. `plain` (a contract): every line is its own paragraph,
 * blank lines included, so the text comes back exactly as it went in; the
 * first line is the centred title.
 */
export function textToHtml(src: string, mode: "markdown" | "plain"): string {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (mode === "plain") {
    const first = lines.findIndex((l) => l.trim());
    if (first < 0) return "<p></p>";
    return lines
      .slice(first)
      .map((l, i) => (i === 0 ? `<h1 style="text-align: center">${esc(l.trim())}</h1>` : l.trim() ? `<p>${esc(l)}</p>` : "<p></p>"))
      .join("");
  }
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!l.trim()) {
      close();
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) {
      close();
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) {
      if (list !== "ul") {
        close();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li><p>${inline(m[1])}</p></li>`);
    } else if ((m = /^\s*(\d+)[.)、]\s+(.*)$/.exec(l))) {
      if (list !== "ol") {
        close();
        out.push(m[1] === "1" ? "<ol>" : `<ol start="${m[1]}">`);
        list = "ol";
      }
      out.push(`<li><p>${inline(m[2])}</p></li>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) {
      close();
      out.push("<hr>");
    } else {
      close();
      out.push(`<p>${inline(l)}</p>`);
    }
  }
  close();
  return out.join("") || "<p></p>";
}

/** The editor's document as text again: Markdown for reports and requests, plain lines for a contract. */
export function docToText(doc: Node, mode: "markdown" | "plain"): string {
  const md = mode === "markdown";
  const inline = (n: Node): string =>
    (n.content ?? [])
      .map((c) => {
        if (c.type === "hardBreak") return "\n";
        let t = c.text ?? inline(c);
        if (md && t.trim()) {
          if (c.marks?.some((m) => m.type === "bold")) t = `**${t}**`;
          else if (c.marks?.some((m) => m.type === "italic")) t = `*${t}*`;
        }
        return t;
      })
      .join("");
  const blocks: { text: string; item: boolean }[] = [];
  const items = (list: Node, depth: number, ordered: boolean) => {
    let n = Number(list.attrs?.start ?? 1) || 1;
    for (const li of list.content ?? []) {
      const own = (li.content ?? []).filter((c) => c.type === "paragraph" || c.type === "heading").map(inline).join(" ");
      const mark = ordered ? `${n++}. ` : li.type === "taskItem" ? (li.attrs?.checked ? "- [x] " : "- [ ] ") : "- ";
      blocks.push({ text: `${"  ".repeat(depth)}${md || ordered ? mark : "· "}${own}`, item: true });
      for (const c of li.content ?? []) {
        if (c.type === "bulletList" || c.type === "taskList") items(c, depth + 1, false);
        else if (c.type === "orderedList") items(c, depth + 1, true);
      }
    }
  };
  const walk = (n: Node) => {
    for (const c of n.content ?? []) {
      if (c.type === "heading") blocks.push({ text: `${md ? `${"#".repeat(Number(c.attrs?.level ?? 1))} ` : ""}${inline(c)}`, item: false });
      else if (c.type === "paragraph") blocks.push({ text: inline(c), item: false });
      else if (c.type === "bulletList" || c.type === "taskList") items(c, 0, false);
      else if (c.type === "orderedList") items(c, 0, true);
      else if (c.type === "horizontalRule") blocks.push({ text: md ? "---" : "", item: false });
      else if (c.content) walk(c);
    }
  };
  walk(doc);
  if (!md) return blocks.map((b) => b.text).join("\n").replace(/\n+$/, "");
  let out = "";
  blocks.forEach((b, i) => {
    if (!b.text.trim() && !b.item) return;
    if (out) out += b.item && blocks[i - 1]?.item ? "\n" : "\n\n";
    out += b.text;
  });
  return out;
}

