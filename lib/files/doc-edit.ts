import "server-only";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { files, fileVersions } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { relationOn } from "@/lib/authz/rebac";
import { getObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { pendingVersionKey } from "@/lib/files/move-paths";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { toSimplified } from "@/lib/text/simplified";
import { htmlToMarkdown, markdownToHtml } from "@/lib/files/markdown";

/**
 * Documents edited in the browser (Ryan, 1 Oct: legal, finance and accounting
 * "need a place to share files and edit files"). The edited page lives in
 * `files.doc_html`; `files.text` follows it, so search and every AI read the
 * current words. The uploaded original stays in storage, downloadable as it
 * came; the edited one downloads as Word or PDF (`/api/files/[id]/doc-export`).
 */
const run = promisify(execFile);
const OFFICE = new Set(["doc", "docx", "odt", "rtf", "wps", "pages"]);
const MD = new Set(["md", "markdown"]);
const extOf = (name: string) => (name.toLowerCase().split(".").pop() ?? "");

export type DocState = { id: string; name: string; html: string; canEdit: boolean; version: number; updatedAt: string; fromOriginal: boolean };

/** What the editor may open: documents, not footage. */
export function editable(name: string, kind: string, mime: string | null): boolean {
  if (kind === "doc") return true;
  const ext = extOf(name);
  return OFFICE.has(ext) || ["txt", "md", "markdown", "html", "htm", "pdf"].includes(ext) || (mime ?? "").startsWith("text/");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text (or light Markdown) as paragraphs and headings. */
function textToHtml(text: string): string {
  return text
    .replace(/\r/g, "")
    .split(/\n/)
    .map((line) => {
      const l = line.trimEnd();
      if (!l.trim()) return "";
      const h = /^(#{1,3})\s+(.*)$/.exec(l);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      const li = /^\s*[-*•]\s+(.*)$/.exec(l);
      if (li) return `<ul><li><p>${esc(li[1])}</p></li></ul>`;
      if (/^【第 \d+ 页】$/.test(l.trim())) return "";
      return `<p>${esc(l.trim())}</p>`;
    })
    .filter(Boolean)
    .join("")
    .replace(/<\/ul><ul>/g, "");
}

/** A Word file as HTML, by LibreOffice on this box; headings, bold and lists survive. */
async function officeToHtml(storageKey: string, name: string): Promise<string | null> {
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-doc-"));
  try {
    const res = await getObject(storageKey);
    if (!res.ok || !res.body) return null;
    const src = path.join(/*turbopackIgnore: true*/ dir, `in.${extOf(name) || "docx"}`);
    await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(src));
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--norestore", "--convert-to", "html", "--outdir", dir, src], { timeout: 120_000, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: dir, LANG: "C.UTF-8" } });
    const out = (await readdir(dir)).find((f) => /\.x?html?$/i.test(f));
    if (!out) return null;
    const html = await readFile(path.join(/*turbopackIgnore: true*/ dir, out), "utf8");
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    return clean(body.replace(/<img[^>]*>/gi, ""));
  } catch (err) {
    console.warn("[doc] could not convert", name, err instanceof Error ? err.message : err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** No scripts, no handlers, no styles sheets: the editor's own schema does the rest. */
export function clean(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 3_000_000);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function held(viewer: Viewer, fileId: string) {
  const rel = await relationOn(viewer, "file", fileId);
  return { read: Boolean(rel), write: rel === "owner" || rel === "editor" };
}

/**
 * A file as HTML for the script page's 导入 (QA, 2 Oct: a Word import came in as
 * plain lines): Word and other office files through LibreOffice, Markdown and
 * plain text through the same reading as the editor's. Null when the file is
 * something else (a PDF, a deck): the caller falls back to its text.
 */
export async function importableHtml(viewer: Viewer, fileId: string): Promise<string | null> {
  const can = await held(viewer, fileId);
  if (!can.read) return null;
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt || f.tenantId !== viewer.tenantId) return null;
  const ext = extOf(f.name);
  if (f.storageKey && OFFICE.has(ext)) return officeToHtml(f.storageKey, f.name);
  if (f.storageKey && (ext === "html" || ext === "htm")) {
    const res = await getObject(f.storageKey).catch(() => null);
    if (!res?.ok) return null;
    return clean(await res.text());
  }
  if (["txt", "md", "markdown"].includes(ext) || (f.mime ?? "").startsWith("text/plain")) return f.text ? textToHtml(f.text) : null;
  return null;
}

export async function openDoc(viewer: Viewer, fileId: string): Promise<DocState | null> {
  const can = await held(viewer, fileId);
  if (!can.read) return null;
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt || f.tenantId !== viewer.tenantId || !editable(f.name, f.kind, f.mime)) return null;
  let html = f.docHtml ?? null;
  let fromOriginal = false;
  if (!html && f.storageKey && OFFICE.has(extOf(f.name))) {
    html = await officeToHtml(f.storageKey, f.name);
    fromOriginal = Boolean(html);
  }
  if (!html) {
    /* Markdown by its blocks, so a save writes back the same paragraphs, lists, tables and code. */
    html = MD.has(extOf(f.name)) ? markdownToHtml(f.text ?? "") : textToHtml(f.text ?? "");
    fromOriginal = true;
  }
  return { id: f.id, name: f.name, html: toSimplified(html), canEdit: can.write, version: f.version, updatedAt: f.updatedAt.toISOString(), fromOriginal };
}

/** Plain-text files whose stored object is the text itself: their edits are saved as real versions. */
const TEXTY = new Set(["md", "markdown", "txt"]);

export async function saveDoc(viewer: Viewer, fileId: string, rawHtml: string): Promise<{ ok: true; version: number; at: string } | { error: string }> {
  const can = await held(viewer, fileId);
  if (!can.write) return { error: "你没有编辑这个文件的权限" };
  const html = toSimplified(clean(rawHtml));
  const text = htmlToText(html);
  const [f] = await db.select({ version: files.version, tenantId: files.tenantId, deletedAt: files.deletedAt, updatedAt: files.updatedAt, updatedBy: files.updatedBy, storageKey: files.storageKey, name: files.name, mime: files.mime }).from(files).where(eq(files.id, fileId)).limit(1);
  if (!f || f.deletedAt || f.tenantId !== viewer.tenantId) return { error: "文件不存在" };
  /* One version per sitting, not per keystroke: a new number when someone else
     edited last, or the last save is more than ten minutes old. */
  let fresh = f.updatedBy !== viewer.id || Date.now() - f.updatedAt.getTime() > 10 * 60_000;
  const now = new Date();

  /*
   * A .md or .txt that was uploaded is its text, so an edit is written back as
   * a new object and a new version row that points at it: the 版本 list can
   * download or restore what it said before, and 下载 gives what it says now.
   * Saves within one sitting rewrite that sitting's own object, never one an
   * earlier version (or a restore) still points at.
   */
  if (f.storageKey && TEXTY.has(extOf(f.name))) {
    const [cur] = await db.select().from(fileVersions).where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.versionNo, f.version))).limit(1);
    const shared = cur?.storageKey
      ? (await db.select({ id: fileVersions.id }).from(fileVersions).where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.storageKey, cur.storageKey))).limit(2)).length > 1
      : true;
    const reusable = Boolean(cur && cur.note === "在线编辑" && cur.storageKey && cur.storageKey === f.storageKey && !shared);
    if (!reusable) fresh = true;
    const version = fresh ? f.version + 1 : f.version;
    const md = extOf(f.name) !== "txt";
    const body = new TextEncoder().encode(md ? htmlToMarkdown(html) : text);
    const mime = (f.mime ?? (md ? "text/markdown" : "text/plain")).split(";")[0];
    const key = fresh ? pendingVersionKey(storageKey(viewer.tenantId, fileId, f.name), randomBytes(8).readBigUInt64BE().toString(36).padStart(10, "0").slice(-10)) : (cur?.storageKey as string);
    const stored = await putObjectConfirmed(key, body, `${mime}; charset=utf-8`);
    if (fresh) {
      await db.insert(fileVersions).values({ id: newId("ver"), fileId, versionNo: version, storageKey: key, sizeBytes: body.byteLength, checksum: stored.etag, note: "在线编辑", authorId: viewer.id }).onConflictDoNothing();
      await audit(viewer, "file.edit", { objectType: "file", objectId: fileId, module: "files", meta: { version } });
    } else {
      await db.update(fileVersions).set({ sizeBytes: body.byteLength, checksum: stored.etag }).where(eq(fileVersions.id, (cur as { id: string }).id));
    }
    await db
      .update(files)
      .set({ text, storageKey: key, sizeBytes: body.byteLength, checksum: stored.etag, version, updatedAt: now, updatedBy: viewer.id, docHtml: html })
      .where(eq(files.id, fileId));
    return { ok: true, version, at: now.toISOString() };
  }

  const version = fresh ? f.version + 1 : f.version;
  await db
    .update(files)
    /* An uploaded file keeps the size of its original; only a document born in
       the editor is measured by its text (QA, 2 Oct: a 2 MB contract turned
       into "18 KB" after one edit). */
    .set({ text, ...(f.storageKey ? {} : { sizeBytes: Buffer.byteLength(html) }), version, updatedAt: now, updatedBy: viewer.id, docHtml: html })
    .where(eq(files.id, fileId));
  if (fresh) {
    await db.insert(fileVersions).values({ id: newId("ver"), fileId, versionNo: version, sizeBytes: Buffer.byteLength(html), note: "在线编辑", authorId: viewer.id }).onConflictDoNothing();
    await audit(viewer, "file.edit", { objectType: "file", objectId: fileId, module: "files", meta: { version } });
  }
  return { ok: true, version, at: now.toISOString() };
}
