import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A page from the document editor as a Word or PDF download, made by
 * LibreOffice on this box (the way `app/api/docs/[id]/export` makes them),
 * for the records that open on the same paper: reports and spend requests.
 */
export async function officeDownload(bodyHtml: string, title: string, format: "docx" | "pdf", fallbackName: string): Promise<Response> {
  const safe = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) || fallbackName;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#171717}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 8pt}ul[data-type="taskList"]{list-style:none;padding-left:0}</style></head><body><h1>${esc(title)}</h1>${bodyHtml}</body></html>`;
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-office-"));
  try {
    const src = path.join(/*turbopackIgnore: true*/ dir, "doc.html");
    await writeFile(src, html);
    const target = format === "docx" ? "docx:MS Word 2007 XML" : "pdf:writer_web_pdf_Export";
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, src], { timeout: 120_000, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: dir, LANG: "C.UTF-8" } });
    const out = await readFile(path.join(/*turbopackIgnore: true*/ dir, `doc.${format}`));
    return new Response(new Uint8Array(out), {
      headers: {
        "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
        "content-disposition": `attachment; filename="${fallbackName}.${format}"; filename*=UTF-8''${encodeURIComponent(`${safe}.${format}`)}`,
      },
    });
  } catch (err) {
    console.error("[office-download] could not make the file", err);
    return new Response("Could not make the file", { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
