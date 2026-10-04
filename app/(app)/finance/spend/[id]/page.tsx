import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { spendRequests } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { listSpend, spendEditable } from "@/lib/finance/service";
import { textToHtml } from "@/lib/docs/convert";
import { toSimplified } from "@/lib/text/simplified";
import { DocEditor } from "@/components/files/DocEditor";
import { SpendDetails } from "@/components/finance/SpendDetails";
import { renameSpendAction, saveSpendDocAction } from "@/app/(app)/docs/record-actions";

export const metadata = { title: "用款申请" };

/**
 * One spend request on the script page's paper (Ryan, 5 Oct): what it is
 * for, the supplier and the quote written out as a page, while nobody has
 * decided it; its amount, approvals and the decision in the side panel.
 */
export default async function SpendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("finance");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const s = (await listSpend(viewer)).find((x) => x.id === id);
  if (!s) notFound();
  const [raw] = await db
    .select({ html: spendRequests.descriptionHtml, requestedBy: spendRequests.requestedBy, state: spendRequests.state })
    .from(spendRequests)
    .where(and(eq(spendRequests.id, id), eq(spendRequests.tenantId, viewer.tenantId)))
    .limit(1);
  if (!raw) notFound();
  const canEdit = viewer.role !== "guest" && spendEditable(raw, viewer);
  const html = toSimplified(raw.html ?? textToHtml(s.description, "markdown"));
  const exp = (f: string) => `/api/finance/spend/${s.id}/export?format=${f}`;
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <DocEditor
        id={s.id}
        name={s.title}
        html={html}
        canEdit={canEdit}
        zh={zh}
        back={{ href: "/finance?tab=spend", label: zh ? "财务 · 用款申请" : "Finance · Spend requests" }}
        fromOriginal={false}
        hasOriginal={false}
        openShare
        panelLabel={zh ? "申请和审批" : "Request and approvals"}
        textMode="markdown"
        save={saveSpendDocAction.bind(null, s.id)}
        rename={renameSpendAction.bind(null, s.id)}
        placeholder={zh ? "写下用途、供应商、报价和为什么现在要买，审批人会看这一页…" : "What it is for, the supplier, the quote and why now: approvers read this page…"}
        downloads={[
          { label: zh ? "Word 文档 (.docx)" : "Word (.docx)", href: exp("docx") },
          { label: "PDF (.pdf)", href: exp("pdf") },
        ]}
        share={
          <SpendDetails
            id={s.id}
            zh={zh}
            amountMicros={s.amountMicros}
            centreName={s.centreName}
            state={s.state}
            approvalsNeeded={s.approvalsNeeded}
            requestedByName={s.requestedByName}
            mine={s.requestedById === viewer.id}
            createdAt={s.createdAt.toISOString()}
            decisions={s.decisions.map((d) => ({ ...d, at: d.at.toISOString() }))}
            period={new Date().toISOString().slice(0, 7)}
          />
        }
      />
    </div>
  );
}
