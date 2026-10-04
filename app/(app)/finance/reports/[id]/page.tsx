import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { getReport } from "@/lib/finance/reports";
import { textToHtml } from "@/lib/docs/convert";
import { toSimplified } from "@/lib/text/simplified";
import { DocEditor } from "@/components/files/DocEditor";
import { ReportDetails } from "@/components/finance/ReportDetails";
import { saveReportDocAction } from "@/app/(app)/docs/record-actions";

export const metadata = { title: "月度报告" };

/** The report's title in the reader's language, as on the Finance screen. */
function titleFor(title: string, period: string, zh: boolean): string {
  if (!zh || title !== `${period} management report`) return title;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${m[1]} 年 ${Number(m[2])} 月管理报告`;
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  return q ? `${q[1]} 年第 ${q[2]} 季度管理报告` : `${period} 管理报告`;
}

/**
 * A monthly report on the script page's paper (Ryan, 5 Oct). A draft is
 * edited in place and saved as you type; a shared report is a record, read
 * here as it was shared, and 另存为新草稿 starts a new draft from it.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("finance");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const r = await getReport(viewer, id);
  if (!r) notFound();
  const html = toSimplified(r.bodyHtml ?? textToHtml(r.body, "markdown"));
  const draft = r.state !== "shared";
  const exp = (f: string) => `/api/finance/reports/${r.id}/export?format=${f}`;
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <DocEditor
        key={r.id}
        id={r.id}
        name={titleFor(r.title, r.period, zh)}
        html={html}
        canEdit={draft && viewer.role !== "guest"}
        zh={zh}
        back={{ href: "/finance?tab=reports", label: zh ? "财务 · 报告草稿" : "Finance · Reports" }}
        subtitle={zh ? `财务 · ${r.period} · ${draft ? "草稿" : "已分享"}` : `Finance · ${r.period} · ${draft ? "draft" : "shared"}`}
        fromOriginal={false}
        hasOriginal={false}
        openShare
        panelLabel={zh ? "报告信息" : "Report details"}
        textMode="markdown"
        save={saveReportDocAction.bind(null, r.id)}
        fixedName
        downloads={[
          { label: zh ? "Word 文档 (.docx)" : "Word (.docx)", href: exp("docx") },
          { label: "PDF (.pdf)", href: exp("pdf") },
        ]}
        share={<ReportDetails id={r.id} period={r.period} state={r.state} sharedAt={r.sharedAt?.toISOString() ?? null} body={r.body} bodyHtml={r.bodyHtml ?? null} zh={zh} english={zh && draft && !/[\u4e00-\u9fff]/.test(r.body)} />}
      />
    </div>
  );
}
