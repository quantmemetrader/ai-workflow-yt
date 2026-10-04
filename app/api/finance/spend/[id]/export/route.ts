import { getViewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { listSpend } from "@/lib/finance/service";
import { textToHtml } from "@/lib/docs/convert";
import { officeDownload } from "@/lib/docs/office";
import { usd } from "@/components/finance/usd";

/** A spend request as Word or PDF, its amount and decisions under the title: the finance module, own studio only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not signed in", { status: 401 });
  if (!viewer.modules.includes("finance")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const s = (await listSpend(viewer)).find((x) => x.id === id);
  if (!s) return new Response("Not found", { status: 404 });
  const format = (new URL(request.url).searchParams.get("format") ?? "docx").toLowerCase();
  if (format !== "docx" && format !== "pdf") return new Response("Bad format", { status: 400 });
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = `<p><b>金额</b> ${usd(s.amountMicros)} · <b>提交人</b> ${esc(s.requestedByName ?? "—")} · <b>归类</b> ${esc(s.centreName ?? "未归类")}</p>`;
  const log = s.decisions.length
    ? `<p><b>审批记录</b></p><ul>${s.decisions.map((d) => `<li><p>${d.decision === "approve" ? "批准" : "拒绝"} · ${esc(d.deciderName ?? "—")}${d.note ? `：${esc(d.note)}` : ""}</p></li>`).join("")}</ul>`
    : "";
  await audit(viewer, "finance.spend.export", { module: "finance", objectType: "spend_request", objectId: id, meta: { format } });
  return officeDownload(`${head}${s.descriptionHtml ?? textToHtml(s.description, "markdown")}${log}`, s.title, format, "spend-request");
}
