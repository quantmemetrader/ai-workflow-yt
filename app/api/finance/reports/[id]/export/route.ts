import { getViewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { getReport } from "@/lib/finance/reports";
import { textToHtml } from "@/lib/docs/convert";
import { officeDownload } from "@/lib/docs/office";

/** A monthly report as Word or PDF: the finance module, own studio only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  if (!viewer.modules.includes("finance")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const r = id && id.length <= 64 ? await getReport(viewer, id) : null;
  if (!r) return new Response("Not found", { status: 404 });
  const format = (new URL(request.url).searchParams.get("format") ?? "docx").toLowerCase();
  if (format !== "docx" && format !== "pdf") return new Response("Bad format", { status: 400 });
  await audit(viewer, "finance.report.export", { module: "finance", objectType: "finance_report", objectId: id, meta: { format } });
  return officeDownload(r.bodyHtml ?? textToHtml(r.body, "markdown"), r.title, format, "report");
}
