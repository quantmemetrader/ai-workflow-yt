import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getViewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { getContract } from "@/lib/legal/service";

const run = promisify(execFile);

/**
 * A contract's text as Word, PDF or plain text (4 Oct: a drafted contract
 * could not be downloaded anywhere). Word and PDF are made by LibreOffice on
 * this box from simple HTML, the way `app/api/docs/[id]/export` makes them.
 * The same permission as every 法务 action: the legal module, own studio only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  if (!viewer.modules.includes("legal")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!id || id.length > 64) return new Response("Not found", { status: 404 });
  const row = await getContract(viewer, id);
  if (!row) return new Response("Not found", { status: 404 });

  const format = (new URL(request.url).searchParams.get("format") ?? "docx").toLowerCase();
  if (format !== "docx" && format !== "pdf" && format !== "txt") return new Response("Bad format", { status: 400 });

  const title = row.c.title.trim() || "contract";
  const safe = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").slice(0, 80) || "contract";
  const disposition = (ext: string) =>
    `attachment; filename="contract.${ext}"; filename*=UTF-8''${encodeURIComponent(`${safe}.${ext}`)}`;
  const done = () => audit(viewer, "legal.contract.export", { module: "legal", objectType: "contract", objectId: id, meta: { format } });

  if (format === "txt") {
    await done();
    return new Response(`﻿${row.c.body.replace(/\r?\n/g, "\r\n")}`, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": disposition("txt") },
    });
  }

  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = row.c.body.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  const paragraphs = lines
    .map((l, i) => (i === first ? `<h1>${esc(l.trim())}</h1>` : l.trim() ? `<p>${esc(l)}</p>` : `<p class="gap">&nbsp;</p>`))
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:1.6;color:#171717}h1{font-size:16pt;text-align:center;margin:0 0 12pt}p{margin:0 0 4pt}p.gap{margin:0;line-height:0.8}</style></head><body>${paragraphs}</body></html>`;

  const dir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tmpdir(), "tg-contract-"));
  try {
    const src = path.join(/*turbopackIgnore: true*/ dir, "contract.html");
    await writeFile(src, html);
    const target = format === "docx" ? "docx:MS Word 2007 XML" : "pdf:writer_web_pdf_Export";
    await run("soffice", [`-env:UserInstallation=file://${path.join(/*turbopackIgnore: true*/ dir, "lo")}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, src], { timeout: 120_000, env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "", HOME: dir, LANG: "C.UTF-8" } });
    const out = await readFile(path.join(/*turbopackIgnore: true*/ dir, `contract.${format}`));
    await done();
    return new Response(new Uint8Array(out), {
      headers: {
        "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
        "content-disposition": disposition(format),
      },
    });
  } catch (err) {
    console.error("[contract-export] could not make the file", err);
    return new Response("Could not make the file", { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
