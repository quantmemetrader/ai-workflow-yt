import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { visibleProject } from "@/lib/projects/service";
import { audit } from "@/lib/audit";
import { docForBeats, type RichNode } from "@/lib/script/rich";
import { escapeHtml, richToHtml, richToMarkdown, richToText } from "@/lib/script/rich-html";

const run = promisify(execFile);

/**
 * 导出: the project's script as a file, like Google Docs' "Download as" —
 * Word (.docx), PDF, plain text or Markdown (Ryan, 29 Sep: "more like google
 * doc, got an export button"). The words as they are now (the draft), the
 * title on top; `?notes=1` adds each paragraph's shot note in grey.
 * Word and PDF are made by LibreOffice on this box from a small HTML page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  const project = await visibleProject(viewer, id);
  if (!project?.scriptId) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "docx").toLowerCase();
  const notes = url.searchParams.get("notes") === "1";
  if (!["docx", "pdf", "txt", "md"].includes(format)) return new Response("Bad format", { status: 400 });

  const [s] = await db.select({ title: scripts.title, doc: scripts.doc }).from(scripts).where(eq(scripts.id, project.scriptId)).limit(1);
  const beats = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual, naturalSound: scriptBeats.naturalSound }).from(scriptBeats).where(eq(scriptBeats.scriptId, project.scriptId)).orderBy(asc(scriptBeats.ord));
  const title = (s?.title || project.title || "脚本").trim();
  const safe = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").slice(0, 80) || "script";
  await audit(viewer, "script.export", { objectType: "script", objectId: project.scriptId, module: "script", meta: { format } });

  /* Every format is written from the rich document (headings, bold, lists,
     highlight) when it still matches the beats, else from the beats as plain
     paragraphs (QA, 2 Oct: .txt/.md dropped headings, .docx lost bold and
     highlight). */
  const doc = docForBeats((s?.doc as RichNode | null) ?? null, beats);
  const opts = { notes, natural: "（现场声）" };

  if (format === "txt" || format === "md") {
    const body = format === "md" ? richToMarkdown(title, doc, opts) : richToText(title, doc, opts);
    return new Response(body, { headers: { "content-type": `${format === "md" ? "text/markdown" : "text/plain"}; charset=utf-8`, "content-disposition": disposition(`${safe}.${format}`) } });
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#171717}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 8pt}.shot{color:#8a8a8a;font-size:9.5pt}</style></head><body><h1>${escapeHtml(title)}</h1>${richToHtml(doc, { ...opts, forExport: true })}</body></html>`;
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-export-"));
  try {
    const src = path.join(/*turbopackIgnore: true*/ dir, "script.html");
    await writeFile(src, html);
    const target = format === "docx" ? "docx:MS Word 2007 XML" : "pdf:writer_web_pdf_Export";
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, src], { timeout: 120_000, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: dir, LANG: "C.UTF-8" } });
    const out = await readFile(path.join(/*turbopackIgnore: true*/ dir, `script.${format}`));
    return new Response(new Uint8Array(out), {
      headers: {
        "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
        "content-disposition": disposition(`${safe}.${format}`),
      },
    });
  } catch (err) {
    console.error("[export] could not make the file", err);
    return new Response("Could not make the file", { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function disposition(name: string): string {
  return `attachment; filename="script"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
