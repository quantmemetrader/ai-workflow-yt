import "server-only";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getObject } from "@/lib/storage/r2";
import { readImages, type VisionLedger } from "@/lib/video/vision";
import { transcribeLocal } from "@/lib/video/whisper";

/**
 * Read any file into plain text, for the AI employees and for search.
 *
 * The client (28 Sep): a PowerPoint dragged into the chat came back as "I
 * cannot read attachments". The owner: "it should be able to read anything
 * and everything". So every kind a studio passes around has a reader here:
 *
 *   text, Markdown, CSV, JSON, subtitles, code, HTML   decoded (UTF-8, else GB18030 / Big5)
 *   Word .docx, PowerPoint .pptx, Excel .xlsx          the XML inside the zip, slide by slide, sheet by sheet
 *   .doc .ppt .xls .rtf .odt .odp .ods .wps .key …     LibreOffice to PDF, then the PDF reader
 *   PDF                                                pdftotext; a scanned PDF's pages go to the vision model
 *   pictures and screenshots                           the vision model copies the text out and describes it
 *   audio and video                                    transcribed on this box (faster-whisper)
 *   zip / 7z / rar                                     unpacked, and each file inside read the same way
 *   EPUB                                               its chapters' HTML
 *
 * The text is kept on `files.text` (what `read_file` and `search_files`
 * read), so a file is read once. Nothing here throws at the caller: a file
 * that cannot be read gives `null`, and the line the AI sees says so.
 */

const run = promisify(execFile);

/** Kept per file; the AI reads at most a slice of it per turn. */
export const MAX_TEXT = 400_000;
/** Never pull more than this out of storage to read. */
const MAX_BYTES = 1_500_000_000;
/** Media is transcribed for at most this long from the start. */
const MAX_MEDIA_SECS = 45 * 60;

type Opts = { ledger?: VisionLedger; depth?: number };

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "srt", "vtt", "ass", "ssa", "log", "ini", "toml", "js", "ts", "tsx", "jsx", "py", "sql", "css", "sh", "lrc", "tex"]);
const HTML_EXT = new Set(["html", "htm", "xhtml", "mht", "mhtml"]);
const OFFICE_VIA_PDF = new Set(["doc", "ppt", "pps", "ppsx", "xls", "rtf", "odt", "odp", "ods", "odg", "wps", "wpt", "et", "dps", "dpt", "key", "pages", "numbers", "vsd", "vsdx", "pub", "docm", "pptm", "xlsm", "dot", "dotx", "potx", "xltx"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "svg"]);
const MEDIA_EXT = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "flv", "3gp", "mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "amr", "wma"]);
const ARCHIVE_EXT = new Set(["zip", "7z", "rar", "tar", "gz", "tgz"]);

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** Whether a file of this name/type is one this module can read at all. */
export function readable(name: string, mime: string | null): boolean {
  const ext = extOf(name);
  return (
    TEXT_EXT.has(ext) || HTML_EXT.has(ext) || OFFICE_VIA_PDF.has(ext) || IMAGE_EXT.has(ext) || MEDIA_EXT.has(ext) || ARCHIVE_EXT.has(ext) ||
    ["docx", "pptx", "xlsx", "pdf", "epub"].includes(ext) || /^(text|image|audio|video)\//.test(mime ?? "") || /pdf|officedocument|msword|excel|powerpoint|opendocument|zip/.test(mime ?? "")
  );
}

/** Whether reading it is slow (transcription), so a chat turn should not wait long for it. */
export function slowToRead(name: string, mime: string | null): boolean {
  return MEDIA_EXT.has(extOf(name)) || /^(audio|video)\//.test(mime ?? "");
}

/* ----------------------------------------------------------------- helpers */

function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad < Math.max(3, utf8.length / 200)) return utf8.replace(/^﻿/, "");
  for (const enc of ["gb18030", "big5", "utf-16le"]) {
    try {
      const t = new TextDecoder(enc, { fatal: true }).decode(buf);
      return t;
    } catch {
      /* next */
    }
  }
  return utf8;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function htmlToText(html: string): string {
  return unescapeXml(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function unzipList(file: string): Promise<string[]> {
  const { stdout } = await run("unzip", ["-Z1", file], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function unzipEntry(file: string, entry: string): Promise<string> {
  const { stdout } = await run("unzip", ["-p", file, entry], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
  return (stdout as unknown as Buffer).toString("utf8");
}

const byNumber = (re: RegExp) => (a: string, b: string) => Number(re.exec(a)?.[1] ?? 0) - Number(re.exec(b)?.[1] ?? 0);

/** Paragraph text out of an OOXML part: one line per paragraph, tabs kept. */
function ooxmlText(xml: string, para: RegExp, run: RegExp): string {
  return xml
    .split(para)
    .map((p) => {
      const out: string[] = [];
      for (const m of p.matchAll(run)) out.push(unescapeXml(m[1] ?? ""));
      return out.join("").replace(/\s+$/, "");
    })
    .filter((l) => l.trim())
    .join("\n");
}

async function readDocx(file: string): Promise<string> {
  const xml = await unzipEntry(file, "word/document.xml");
  const body = xml.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>");
  return ooxmlText(body, /<\/w:p>/, /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g);
}

async function readPptx(file: string): Promise<string> {
  const entries = await unzipList(file);
  const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e)).sort(byNumber(/slide(\d+)\.xml/));
  const notes = new Map(entries.filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e)).map((e) => [Number(/(\d+)\.xml/.exec(e)?.[1]), e]));
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    const text = ooxmlText(await unzipEntry(file, s), /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g);
    const n = Number(/slide(\d+)\.xml/.exec(s)?.[1] ?? i + 1);
    const noteFile = notes.get(n);
    const note = noteFile ? ooxmlText(await unzipEntry(file, noteFile), /<\/a:p>/, /<a:t>([^<]*)<\/a:t>/g).replace(/^\d+$/gm, "").trim() : "";
    out.push(`【第 ${i + 1} 页】\n${text || "（这一页没有文字）"}${note ? `\n（演讲者备注）${note}` : ""}`);
  }
  return out.join("\n\n");
}

async function readXlsx(file: string): Promise<string> {
  const entries = await unzipList(file);
  const shared: string[] = [];
  if (entries.includes("xl/sharedStrings.xml")) {
    const xml = await unzipEntry(file, "xl/sharedStrings.xml");
    for (const si of xml.split("</si>")) {
      const parts = [...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unescapeXml(m[1]));
      if (si.includes("<si")) shared.push(parts.join(""));
    }
  }
  const names: string[] = [];
  if (entries.includes("xl/workbook.xml")) {
    const wb = await unzipEntry(file, "xl/workbook.xml");
    for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)) names.push(unescapeXml(m[1]));
  }
  const sheets = entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e)).sort(byNumber(/sheet(\d+)\.xml/));
  const out: string[] = [];
  for (const [i, s] of sheets.entries()) {
    const whole = await unzipEntry(file, s);
    const xml = /<sheetData[^>]*>([\s\S]*)<\/sheetData>/.exec(whole)?.[1] ?? "";
    const rows: string[] = [];
    for (const row of xml.split("</row>")) {
      const cells: string[] = [];
      for (const c of row.matchAll(/<c(?=[\s>\/])([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const t = /\st="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        const inline = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join("");
        cells.push(t === "s" && v !== undefined ? (shared[Number(v)] ?? "") : t === "inlineStr" ? unescapeXml(inline) : unescapeXml(v ?? ""));
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join("\t").replace(/\t+$/, ""));
      if (rows.length >= 5000) break;
    }
    out.push(`【表格：${names[i] ?? `Sheet${i + 1}`}】\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

async function readPdf(file: string, dir: string, opts: Opts): Promise<string> {
  const { stdout: info } = await run("pdfinfo", [file]).catch(() => ({ stdout: "" }));
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 256 * 1024 * 1024 });
  const text = stdout.replace(/\f/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  /* A scan: almost no text for its pages. The first pages go to the vision
     model instead — twelve at most, four to a call. */
  if (text.replace(/\s/g, "").length < Math.max(1, pages) * 8) {
    const prefix = path.join(/*turbopackIgnore: true*/ dir, "page");
    await run("pdftoppm", ["-r", "110", "-jpeg", "-jpegopt", "quality=80", "-f", "1", "-l", "12", file, prefix]);
    const imgs = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".jpg")).sort().map((f) => path.join(/*turbopackIgnore: true*/ dir, f));
    const parts: string[] = [];
    for (let i = 0; i < imgs.length; i += 4) {
      const batch = imgs.slice(i, i + 4);
      const t = await readImages(batch, `这是一份扫描 PDF 的第 ${i + 1}–${i + batch.length} 页。按页把所有文字原样抄出来（保留原文语言和繁简），每页前写【第 N 页】。`, opts).catch(() => "");
      if (t) parts.push(t);
    }
    const ocr = parts.join("\n\n").trim();
    if (ocr) return `${ocr}${pages > 12 ? `\n\n（共 ${pages} 页，只读了前 12 页）` : ""}`;
  }
  return text;
}

async function viaPdf(file: string, dir: string, opts: Opts): Promise<string> {
  const profile = path.join(/*turbopackIgnore: true*/ dir, "lo-profile");
  await run("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, file], { timeout: 180_000, env: { ...process.env, HOME: dir } });
  const pdf = (await readdir(dir)).find((f) => f.endsWith(".pdf") && path.join(/*turbopackIgnore: true*/ dir, f) !== file);
  if (!pdf) throw new Error("LibreOffice made no PDF");
  const sub = await mkdtemp(path.join(/*turbopackIgnore: true*/ dir, "p-"));
  return readPdf(path.join(/*turbopackIgnore: true*/ dir, pdf), sub, opts);
}

async function readImage(file: string, dir: string, opts: Opts): Promise<string> {
  /* Any format in, one reasonable JPEG out (HEIC, TIFF, BMP, SVG…). */
  const jpg = path.join(/*turbopackIgnore: true*/ dir, "img.jpg");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", jpg], { timeout: 60_000 }).catch(async () => {
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--convert-to", "jpg", "--outdir", dir, file], { timeout: 60_000, env: { ...process.env, HOME: dir } });
  });
  const src = (await stat(jpg).catch(() => null)) ? jpg : file;
  return readImages([src], "先把图里所有文字原样抄出来（保留原文语言和繁简；没有文字就写「无文字」），再用两三句话说明这张图是什么、画面里有什么。格式：\n【图中文字】…\n【图片内容】…", opts);
}

async function readMedia(file: string, dir: string): Promise<string> {
  const wav = path.join(/*turbopackIgnore: true*/ dir, "audio.wav");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-t", String(MAX_MEDIA_SECS), "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 15 * 60_000 });
  const t = await transcribeLocal(wav, "audio.wav");
  const text = t.text.trim();
  return text ? `【转写】${text}${t.durationSecs >= MAX_MEDIA_SECS - 1 ? `\n（只转写了前 ${MAX_MEDIA_SECS / 60} 分钟）` : ""}` : "（这段音频里没有听到说话）";
}

async function readArchive(file: string, ext: string, dir: string, opts: Opts): Promise<string> {
  const out = path.join(/*turbopackIgnore: true*/ dir, "unpacked");
  await run("7z", ["x", "-y", `-o${out}`, file], { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  if (ext === "tgz" || ext === "gz") {
    const inner = (await readdir(out)).find((f) => f.endsWith(".tar"));
    if (inner) await run("7z", ["x", "-y", `-o${out}`, path.join(/*turbopackIgnore: true*/ out, inner)], { timeout: 180_000 });
  }
  const list: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
      const p = path.join(/*turbopackIgnore: true*/ d, e.name);
      if (e.isDirectory()) await walk(p);
      else list.push(p);
    }
  };
  await walk(out);
  const parts: string[] = [`【压缩包里的文件（${list.length} 个）】\n${list.map((p) => path.relative(out, p)).slice(0, 200).join("\n")}`];
  let used = 0;
  for (const p of list.slice(0, 40)) {
    const rel = path.relative(out, p);
    if (!readable(rel, null) || slowToRead(rel, null)) continue;
    const size = (await stat(p)).size;
    if (size > 50_000_000) continue;
    const text = await readLocal(p, rel, null, { ...opts, depth: (opts.depth ?? 0) + 1 }).catch(() => null);
    if (!text) continue;
    parts.push(`===== ${rel} =====\n${text.slice(0, 60_000)}`);
    used += text.length;
    if (used > MAX_TEXT) break;
  }
  return parts.join("\n\n");
}

/**
 * Read a file already on disk. `name` decides the reader (its extension),
 * `mime` is the fallback when the name has none.
 */
export async function readLocal(file: string, name: string, mime: string | null, opts: Opts = {}): Promise<string | null> {
  let ext = extOf(name);
  if (!ext && mime) {
    ext = mime.includes("pdf") ? "pdf" : mime.startsWith("image/") ? "png" : mime.startsWith("video/") ? "mp4" : mime.startsWith("audio/") ? "mp3" : mime.startsWith("text/") ? "txt" : "";
  }
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-read-"));
  try {
    let text: string;
    if (TEXT_EXT.has(ext)) text = decodeText(await readFile(file));
    else if (HTML_EXT.has(ext)) text = htmlToText(decodeText(await readFile(file)));
    else if (ext === "docx") text = await readDocx(file).catch(() => viaPdf(file, dir, opts));
    else if (ext === "pptx") text = await readPptx(file).catch(() => viaPdf(file, dir, opts));
    else if (ext === "xlsx") text = await readXlsx(file).catch(() => viaPdf(file, dir, opts));
    else if (ext === "pdf") text = await readPdf(file, dir, opts);
    else if (ext === "epub") {
      const entries = (await unzipList(file)).filter((e) => /\.(x?html?)$/i.test(e)).sort();
      const parts: string[] = [];
      for (const e of entries.slice(0, 200)) parts.push(htmlToText(await unzipEntry(file, e)));
      text = parts.filter(Boolean).join("\n\n");
    } else if (OFFICE_VIA_PDF.has(ext)) text = await viaPdf(file, dir, opts);
    else if (IMAGE_EXT.has(ext)) text = await readImage(file, dir, opts);
    else if (MEDIA_EXT.has(ext)) text = await readMedia(file, dir);
    else if (ARCHIVE_EXT.has(ext) && (opts.depth ?? 0) < 1) text = await readArchive(file, ext, dir, opts);
    else {
      /* Unknown: text if it decodes as text, else nothing. */
      const buf = await readFile(file);
      const sample = buf.subarray(0, 4096);
      if (sample.includes(0)) return null;
      text = decodeText(buf);
    }
    const clean = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
    return clean ? clean.slice(0, MAX_TEXT) : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Read bytes held in memory (an upload being handled on the server). */
export async function readBytes(bytes: Buffer, name: string, mime: string | null, opts: Opts = {}): Promise<string | null> {
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-bytes-"));
  try {
    const p = path.join(/*turbopackIgnore: true*/ dir, `in.${extOf(name) || "bin"}`);
    await (await import("node:fs/promises")).writeFile(p, bytes);
    return await readLocal(p, name, mime, opts);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const inFlight = new Map<string, Promise<string | null>>();

/**
 * The text of a stored file: what is kept on it, or read now and kept.
 * Several callers asking for the same file at once share one read.
 */
export function ensureFileText(fileId: string, opts: Opts & { force?: boolean } = {}): Promise<string | null> {
  const running = inFlight.get(fileId);
  if (running) return running;
  const p = (async () => {
    const [row] = await db.select({ name: files.name, mime: files.mime, text: files.text, storageKey: files.storageKey, sizeBytes: files.sizeBytes }).from(files).where(eq(files.id, fileId)).limit(1);
    if (!row) return null;
    if (!opts.force && row.text && row.text.trim().length > 0) return row.text;
    if (!row.storageKey || !readable(row.name, row.mime) || row.sizeBytes > MAX_BYTES) return row.text || null;
    const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-file-"));
    try {
      const res = await getObject(row.storageKey);
      if (!res.ok || !res.body) throw new Error(`storage said ${res.status}`);
      const local = path.join(/*turbopackIgnore: true*/ dir, `in.${extOf(row.name) || "bin"}`);
      await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(local));
      const text = await readLocal(local, row.name, row.mime, opts);
      if (text) await db.update(files).set({ text }).where(eq(files.id, fileId));
      return text;
    } catch (err) {
      console.warn(`[read] ${fileId} (${row.name}) could not be read:`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })().finally(() => inFlight.delete(fileId));
  inFlight.set(fileId, p);
  return p;
}

/**
 * Wait up to `ms` for a file's text; after that the read carries on in the
 * background (and lands on the file) while the caller goes on without it.
 */
export async function fileTextWithin(fileId: string, ms: number, opts: Opts = {}): Promise<{ text: string | null; pending: boolean }> {
  const read = ensureFileText(fileId, opts);
  const timer = new Promise<"late">((r) => setTimeout(() => r("late"), ms));
  const got = await Promise.race([read, timer]);
  return got === "late" ? { text: null, pending: true } : { text: got, pending: false };
}
