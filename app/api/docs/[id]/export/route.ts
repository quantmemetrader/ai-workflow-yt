import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getViewer } from "@/lib/auth/dal";
import { openDoc } from "@/lib/files/doc-edit";
import { audit } from "@/lib/audit";

const run = promisify(execFile);

/** The edited document as Word or PDF, made by LibreOffice on this box from its HTML. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  const doc = await openDoc(viewer, id);
  if (!doc) return new Response("Not found", { status: 404 });
  const format = (new URL(request.url).searchParams.get("format") ?? "docx").toLowerCase();
  if (format !== "docx" && format !== "pdf") return new Response("Bad format", { status: 400 });
  const title = doc.name.replace(/\.(docx?|odt|rtf|wps|pages|txt|md|markdown|html?)$/i, "");
  const safe = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").slice(0, 80) || "document";
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#171717}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 8pt}ul[data-type="taskList"]{list-style:none;padding-left:0}</style></head><body>${doc.html}</body></html>`;
  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-docx-"));
  try {
    const src = path.join(/*turbopackIgnore: true*/ dir, "doc.html");
    await writeFile(src, html);
    const target = format === "docx" ? "docx:MS Word 2007 XML" : "pdf:writer_web_pdf_Export";
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, src], { timeout: 120_000, env: { ...process.env, HOME: dir } });
    const out = await readFile(path.join(/*turbopackIgnore: true*/ dir, `doc.${format}`));
    await audit(viewer, "file.export", { objectType: "file", objectId: id, module: "files", meta: { format } });
    return new Response(new Uint8Array(out), {
      headers: {
        "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
        "content-disposition": `attachment; filename="document.${format}"; filename*=UTF-8''${encodeURIComponent(`${safe}.${format}`)}`,
      },
    });
  } catch (err) {
    console.error("[doc-export] could not make the file", err);
    return new Response("Could not make the file", { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
