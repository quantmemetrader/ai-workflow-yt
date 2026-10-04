import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { getContract } from "@/lib/legal/service";
import { textToHtml } from "@/lib/docs/convert";
import { toSimplified } from "@/lib/text/simplified";
import { DocEditor } from "@/components/files/DocEditor";
import { ContractDetails } from "@/components/legal/ContractDetails";
import { renameContractAction, saveContractDocAction } from "@/app/(app)/docs/record-actions";

export const metadata = { title: "合同" };

const READ_ONLY = new Set(["signed", "expired", "terminated"]);

/**
 * One contract on the script page's paper (Ryan, 5 Oct: "like the script
 * page, Google Docs"): the text edited in place and saved as you type while
 * it is a draft, in review or sent; read-only once signed, expired or
 * terminated. Its details sit in the side panel.
 */
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("legal");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const row = await getContract(viewer, id);
  if (!row) notFound();
  const c = row.c;
  const canEdit = viewer.role !== "guest" && !READ_ONLY.has(c.state);
  const html = toSimplified(c.bodyHtml ?? textToHtml(c.body, "plain"));
  const exp = (f: string) => `/api/legal/contracts/${c.id}/export?format=${f}`;
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <DocEditor
        id={c.id}
        name={c.title}
        html={html}
        canEdit={canEdit}
        zh={zh}
        back={{ href: "/legal?tab=repository", label: zh ? "法务 · 合同库" : "Legal · Contracts" }}
        fromOriginal={false}
        hasOriginal={false}
        openShare
        panelLabel={zh ? "合同信息" : "Contract details"}
        textMode="plain"
        save={saveContractDocAction.bind(null, c.id)}
        rename={renameContractAction.bind(null, c.id)}
        placeholder={zh ? "合同正文从这里开始…" : "The contract text starts here…"}
        downloads={[
          { label: zh ? "Word 文档 (.docx)" : "Word (.docx)", href: exp("docx") },
          { label: "PDF (.pdf)", href: exp("pdf") },
          { label: zh ? "纯文本 (.txt)" : "Plain text (.txt)", href: exp("txt") },
        ]}
        share={
          <ContractDetails
            id={c.id}
            zh={zh}
            counterparty={c.counterparty ?? ""}
            state={c.state}
            signedOn={c.signedOn ?? ""}
            expiresOn={c.expiresOn ?? ""}
            templateName={row.templateName}
            ownerName={row.ownerName}
            values={Object.entries(c.values ?? {}).filter(([, v]) => v && v.trim())}
            fieldLabels={Object.fromEntries((row.templateFields ?? []).map((f) => [f.key, f.label]))}
            updatedAt={c.updatedAt.toISOString()}
            canEdit={viewer.role !== "guest"}
          />
        }
      />
    </div>
  );
}
