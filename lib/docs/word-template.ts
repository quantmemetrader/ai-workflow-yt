import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { canReadFiles } from "@/lib/authz/rebac";
import { beginUpload, completeUpload } from "@/lib/files/service";
import { getObject, putObjectConfirmed } from "@/lib/storage/r2";

const run = promisify(execFile);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * A new Word file in the format of one the studio already has (Avon, 9 Oct:
 * "given a sample weekly report with a fixed header and footer, the agent
 * should make the new report in the same Word format; it gave plain text").
 *
 * The sample is copied whole: page setup, header, footer, fonts, styles,
 * numbering, logos. Only the body is rewritten, and each new paragraph takes
 * its formatting from the sample paragraph it is "like" (paragraph settings
 * and the first run's font), each new table from a sample table. So a title
 * in the sample's red 22pt centred heading comes out exactly so, without the
 * model having to know a single style name.
 */

type Part = { kind: "p" | "tbl" | "other"; xml: string };

/** The body's top-level elements, nested tables and content controls kept whole. */
function bodyParts(doc: string): { head: string; parts: Part[]; sectPr: string; tail: string } {
  const open = doc.indexOf("<w:body>");
  const close = doc.lastIndexOf("</w:body>");
  if (open < 0 || close < 0) throw new Error("这个 Word 文件读不出正文");
  const head = doc.slice(0, open + "<w:body>".length);
  const tail = doc.slice(close);
  let body = doc.slice(open + "<w:body>".length, close);
  let sectPr = "";
  const last = body.lastIndexOf("<w:sectPr");
  if (last >= 0 && body.slice(last).trimEnd().endsWith("</w:sectPr>")) {
    sectPr = body.slice(last);
    body = body.slice(0, last);
  }
  const parts: Part[] = [];
  const tag = /<(\/?)w:(p|tbl|sdt)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let top = "";
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    const [all, closing, name, self] = m;
    if (!closing && depth === 0) {
      start = m.index;
      top = name;
    }
    if (self) {
      if (depth === 0) parts.push({ kind: top === "p" ? "p" : top === "tbl" ? "tbl" : "other", xml: all });
      continue;
    }
    if (closing) {
      depth--;
      if (depth === 0 && start >= 0) {
        parts.push({ kind: top === "p" ? "p" : top === "tbl" ? "tbl" : "other", xml: body.slice(start, m.index + all.length) });
        start = -1;
      }
    } else depth++;
  }
  return { head, parts, sectPr, tail };
}

const unesc = (x: string) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textOf = (xml: string) => unesc([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
const one = (xml: string, re: RegExp) => re.exec(xml)?.[0] ?? "";

function pPr(p: string): string {
  /* A section break inside the sample paragraph would start a new section in every copy. */
  return one(p, /<w:pPr>[\s\S]*?<\/w:pPr>/).replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, "").replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, "");
}
function rPr(p: string): string {
  const run = one(p, /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:t[\s>]/);
  return one(run, /<w:rPr>[\s\S]*?<\/w:rPr>/);
}
/** The paragraph's main font: the run that carries the most text (a lead word or an emoji often has its own). */
function bodyRPr(p: string): string {
  let best = "";
  let most = -1;
  for (const m of p.matchAll(/<w:r(?:\s[^>]*)?>((?:(?!<\/w:r>)[\s\S])*?)<\/w:r>/g)) {
    const len = textOf(m[1]).length;
    if (len > most) {
      most = len;
      best = one(m[1], /<w:rPr>[\s\S]*?<\/w:rPr>/);
    }
  }
  return most > 0 ? best : rPr(p);
}

/**
 * A line in the sample's dress: a 【lead】 or "lead：" at the start takes the
 * sample's lead font (often bold, coloured) when it has one, the rest its
 * main font (Avon's reports: only the bracketed headline is bold).
 */
function dressed(text: string, sample: string): string {
  const lead = rPr(sample);
  const body = bodyRPr(sample);
  const m = lead !== body ? /^(【[^】\n]{1,60}】|[^：:\n]{1,24}[：:])/.exec(text) : null;
  return m ? runs(m[1], lead) + runs(text.slice(m[1].length), body) : runs(text, body);
}

function styleName(p: string, names: Map<string, string>): string {
  const id = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1];
  return id ? (names.get(id) ?? id) : "Normal";
}

/** "**bold** rest" as runs in the sample's font, a line break as <w:br/>. */
function runs(text: string, base: string): string {
  const bold = (r: string) => (!r ? "<w:rPr><w:b/></w:rPr>" : /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r) ? r : r.replace("<w:rPr>", "<w:rPr><w:b/>"));
  const out: string[] = [];
  for (const piece of text.split(/(\*\*[^*]+\*\*)/)) {
    if (!piece) continue;
    const strong = /^\*\*[^*]+\*\*$/.test(piece);
    const words = strong ? piece.slice(2, -2) : piece;
    const lines = words.split("\n");
    lines.forEach((line, i) => {
      if (i) out.push(`<w:r>${base}<w:br/></w:r>`);
      if (line) out.push(`<w:r>${strong ? bold(base) : base}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`);
    });
  }
  return out.join("");
}

export type TemplateBlock = { like?: number | null; table_like?: number | null; keep_table?: number | null; keep_paragraph?: number | null; text?: string; rows?: string[][] };

type Template = { dir: string; doc: string; names: Map<string, string>; styleIds: Map<string, string>; parsed: ReturnType<typeof bodyParts>; name: string };

async function openTemplate(viewer: Viewer, fileId: string): Promise<Template> {
  const [f] = await db
    .select({ name: files.name, storageKey: files.storageKey })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!f) throw new Error("找不到这个文件，或者没有权限读它");
  if (!/\.docx$/i.test(f.name) || !f.storageKey) throw new Error(`「${f.name}」不是 Word（.docx）文件。旧的 .doc 请先在 Word 里另存为 .docx`);
  const res = await getObject(f.storageKey);
  if (!res.ok) throw new Error("文件读不出来，稍后再试");
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-wordtpl-"));
  try {
    const src = path.join(/*turbopackIgnore: true*/ dir, "in.docx");
    await writeFile(src, new Uint8Array(await res.arrayBuffer()));
    await run("unzip", ["-q", "-o", src, "-d", path.join(/*turbopackIgnore: true*/ dir, "x")], { maxBuffer: 16 * 1024 * 1024 });
    const doc = await readFile(path.join(/*turbopackIgnore: true*/ dir, "x", "word", "document.xml"), "utf8");
    const styles = await readFile(path.join(/*turbopackIgnore: true*/ dir, "x", "word", "styles.xml"), "utf8").catch(() => "");
    const names = new Map<string, string>();
    const styleIds = new Map<string, string>();
    for (const m of styles.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) {
      names.set(m[1], m[2]);
      styleIds.set(m[2].toLowerCase(), m[1]);
    }
    return { dir, doc, names, styleIds, parsed: bodyParts(doc), name: f.name };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** The sample as the model sees it: every paragraph and table, numbered, with its style and text. */
export async function describeTemplate(viewer: Viewer, fileId: string): Promise<string> {
  const t = await openTemplate(viewer, fileId);
  try {
    const lines: string[] = [];
    let p = 0;
    let tb = 0;
    for (const part of t.parsed.parts) {
      if (part.kind === "p") {
        const txt = textOf(part.xml).trim();
        const align = /<w:jc w:val="(center|right|both)"/.exec(part.xml)?.[1];
        const size = /<w:sz w:val="(\d+)"/.exec(rPr(part.xml))?.[1];
        const bold = /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(rPr(part.xml));
        const look = [styleName(part.xml, t.names), align && `对齐:${align}`, size && `${Number(size) / 2}磅`, bold && "加粗", /<w:numPr>/.test(part.xml) && "编号/项目符号"].filter(Boolean).join("，");
        lines.push(`[段落 ${p}]（${look}）${txt ? txt.slice(0, 120) : "（空行）"}`);
        p++;
      } else if (part.kind === "tbl") {
        /* Each cell's lines, so a layout box (a masthead, a highlighted summary) shows its structure. */
        const cellText = (tc: string) => [...tc.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => textOf(p[0]).trim()).filter(Boolean).map((x) => x.slice(0, 80)).join("⏎");
        const rows = [...part.xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => cellText(c[0])));
        const box = rows.length === 1 && rows[0].length === 1;
        lines.push(`[表格 ${tb}]（${box ? "排版框，1 格" : `${rows.length} 行 × ${rows[0]?.length ?? 0} 列`}${/<w:drawing|<w:pict/.test(part.xml) ? "，含图片" : ""}）${rows.slice(0, 4).map((r) => r.join(" | ")).join(" / ").slice(0, 400)}`);
        tb++;
      }
    }
    const extras = (await readdir(path.join(/*turbopackIgnore: true*/ t.dir, "x", "word"))).filter((n) => /^(header|footer)\d*\.xml$/.test(n));
    const hf: string[] = [];
    for (const n of extras) {
      const txt = textOf(await readFile(path.join(/*turbopackIgnore: true*/ t.dir, "x", "word", n), "utf8")).trim();
      if (txt) hf.push(`${n.startsWith("header") ? "页眉" : "页脚"}：${txt.slice(0, 120)}`);
    }
    return [
      `范本「${t.name}」的正文结构（新文件会保留它的页面设置、页眉、页脚、字体和样式）：`,
      ...lines,
      hf.length ? `\n${hf.join("\n")}` : "（没有页眉页脚文字）",
      "",
      "写新文件时：每一段用 like 指向格式最接近的范本段落编号；内容不变的段落用 keep_paragraph 原样保留。表格用 table_like 指向范本表格编号并给出 rows（格子里换行用 \\n，第 k 行沿用范本那一格第 k 行的格式）；内容不变的表格或排版框（报头、标语、含图片的框）用 keep_table 原样保留。⏎ 表示格子里的换行。页眉页脚里要换的文字（例如期号、日期）放在 replace 里。",
    ].join("\n");
  } finally {
    await rm(t.dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A sample cell's paragraphs, each with its own look, so line k of new text dresses like line k of the sample. */
function cellLooks(tc: string): { pPr: string; rPr: string; xml: string }[] {
  const ps = [...tc.matchAll(/<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)].map((m) => m[0]);
  const looks = ps.map((p) => ({ pPr: pPr(p), rPr: rPr(p), xml: p }));
  return looks.length ? looks : [{ pPr: "", rPr: "", xml: "" }];
}

function tableXml(sample: string, rows: string[][]): string {
  const tblPr = one(sample, /<w:tblPr>[\s\S]*?<\/w:tblPr>/);
  const gridCols = [...one(sample, /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/).matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  const total = gridCols.reduce((n, w) => n + w, 0) || 9000;
  const trs = [...sample.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  /* The sample's own column widths when the column count matches; else even. */
  const widths = gridCols.length === cols ? gridCols : Array.from({ length: cols }, () => Math.floor(total / cols));
  const out = rows.map((r, i) => {
    /* Same number of rows as the sample: row i dresses like sample row i; else the first row as the header, the second as the body. */
    const tr = trs.length === rows.length ? trs[i] : i === 0 ? trs[0] : (trs[1] ?? trs[0]);
    const tcs = [...(tr ?? "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
    const trPr = one(tr ?? "", /<w:trPr>[\s\S]*?<\/w:trPr>/);
    const cells = Array.from({ length: cols }, (_, c) => {
      const tc = tcs[Math.min(c, Math.max(0, tcs.length - 1))] ?? "";
      const base = one(tc, /<w:tcPr>[\s\S]*?<\/w:tcPr>/).replace(/<w:tcW [^>]*\/>/, "").replace(/<w:gridSpan [^>]*\/>/, "").replace(/<w:vMerge[^>]*\/>/, "");
      const tcPr = base ? base.replace("<w:tcPr>", `<w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/>`) : `<w:tcPr><w:tcW w:w="${widths[c]}" w:type="dxa"/></w:tcPr>`;
      const looks = cellLooks(tc);
      const lines = String(r[c] ?? "").split("\n");
      const paras = lines.map((line, k) => {
        const look = looks[Math.min(k, looks.length - 1)];
        return `<w:p>${look.pPr}${look.xml ? dressed(line, look.xml) : runs(line, look.rPr)}</w:p>`;
      });
      return `<w:tc>${tcPr}${paras.join("")}</w:tc>`;
    }).join("");
    return `<w:tr>${trPr}${cells}</w:tr>`;
  });
  const fallbackPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:left w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:right w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="999999"/></w:tblBorders></w:tblPr>';
  return `<w:tbl>${tblPr || fallbackPr}<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${out.join("")}</w:tbl>`;
}

/**
 * Write the new file from the sample and keep it in Files. `blocks` are the
 * new body in order; `replace` swaps text in the header and footer (an issue
 * number, a date) where the sample has it in one piece.
 */
export async function fillTemplate(
  viewer: Viewer,
  input: { templateId: string; name: string; blocks: TemplateBlock[]; replace?: { find: string; with: string }[]; folderId?: string | null },
): Promise<{ id: string; name: string; paragraphs: number; tables: number; replaced: number }> {
  const t = await openTemplate(viewer, input.templateId);
  try {
    const paras = t.parsed.parts.filter((x) => x.kind === "p").map((x) => x.xml);
    const tables = t.parsed.parts.filter((x) => x.kind === "tbl").map((x) => x.xml);
    const byStyle = (n: string) => {
      const id = t.styleIds.get(n);
      return id ? `<w:pPr><w:pStyle w:val="${id}"/></w:pPr>` : "";
    };
    const body: string[] = [];
    let np = 0;
    let nt = 0;
    for (const b of input.blocks.slice(0, 800)) {
      /* A box or a line that stays as it is (a masthead, a slogan, a logo line): copied whole, images and all. */
      const kt = Number(b.keep_table);
      if (b.keep_table !== undefined && b.keep_table !== null && Number.isInteger(kt) && tables[kt]) {
        body.push(tables[kt]);
        nt++;
        continue;
      }
      const kp = Number(b.keep_paragraph);
      if (b.keep_paragraph !== undefined && b.keep_paragraph !== null && Number.isInteger(kp) && paras[kp]) {
        body.push(paras[kp].replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, ""));
        np++;
        continue;
      }
      if (Array.isArray(b.rows) && b.rows.length) {
        const sample = tables[Math.min(Math.max(0, Number(b.table_like ?? 0) || 0), Math.max(0, tables.length - 1))] ?? "";
        body.push(tableXml(sample, b.rows.slice(0, 200).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").slice(0, 2000)).slice(0, 20) : []))));
        nt++;
        continue;
      }
      const text = String(b.text ?? "").slice(0, 20_000);
      const i = Number(b.like);
      const sample = Number.isInteger(i) && i >= 0 && i < paras.length ? paras[i] : null;
      /* No sample paragraph named: a Markdown heading or bullet still lands on the sample's own heading and list styles. */
      let look = sample ? pPr(sample) : "";
      let words = text;
      if (!sample) {
        const h = /^(#{1,3})\s+([\s\S]*)$/.exec(text);
        if (h) {
          look = byStyle(`heading ${h[1].length}`);
          words = h[2];
        } else if (/^[-*•]\s+/.test(text)) {
          look = byStyle("list paragraph");
          words = `• ${text.replace(/^[-*•]\s+/, "")}`;
        }
      }
      body.push(`<w:p>${look}${sample ? dressed(words, sample) : runs(words, "")}</w:p>`);
      np++;
    }
    if (!body.length) throw new Error("新文件没有内容");
    const doc = `${t.parsed.head}${body.join("")}${t.parsed.sectPr}${t.parsed.tail}`;
    const word = path.join(/*turbopackIgnore: true*/ t.dir, "x", "word");
    await writeFile(path.join(/*turbopackIgnore: true*/ word, "document.xml"), doc);
    let replaced = 0;
    const swaps = (input.replace ?? []).filter((r) => r && r.find && r.find !== r.with).slice(0, 20);
    if (swaps.length) {
      for (const n of (await readdir(word)).filter((x) => /^(header|footer)\d*\.xml$/.test(x))) {
        let xml = await readFile(path.join(/*turbopackIgnore: true*/ word, n), "utf8");
        for (const r of swaps) {
          const find = esc(r.find);
          if (xml.includes(find)) {
            xml = xml.split(find).join(esc(r.with));
            replaced++;
          }
        }
        await writeFile(path.join(/*turbopackIgnore: true*/ word, n), xml);
      }
    }
    const out = path.join(/*turbopackIgnore: true*/ t.dir, "out.docx");
    const top = await readdir(path.join(/*turbopackIgnore: true*/ t.dir, "x"));
    /* [Content_Types].xml first, as Word expects. */
    const order = ["[Content_Types].xml", ...top.filter((n) => n !== "[Content_Types].xml")];
    await run("zip", ["-X", "-q", "-r", out, ...order], { cwd: path.join(/*turbopackIgnore: true*/ t.dir, "x"), maxBuffer: 16 * 1024 * 1024 });
    const bytes = new Uint8Array(await readFile(out));
    const name = `${input.name.replace(/[\\/:*?"<>|\n\r]+/g, " ").replace(/\.docx?$/i, "").trim().slice(0, 120) || "新文件"}.docx`;
    const { file, storageKey } = await beginUpload(viewer, { name, mime: DOCX, sizeBytes: bytes.byteLength, folderId: input.folderId ?? null });
    const stored = await putObjectConfirmed(storageKey, bytes as Uint8Array<ArrayBuffer>, DOCX);
    await completeUpload(viewer, file.id, stored.etag ?? undefined);
    return { id: file.id, name, paragraphs: np, tables: nt, replaced };
  } finally {
    await rm(t.dir, { recursive: true, force: true }).catch(() => {});
  }
}
