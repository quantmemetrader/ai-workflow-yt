"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { openDoc } from "@/lib/files/doc-edit";
import { LIBRARIES } from "@/lib/files/module-library";
import { docRewrite, type DocAgent } from "@/lib/docs/copilot";

/**
 * 「让 AI 改」 on a document page: who answers follows what the document is
 * (a contract → 法务, a report or spend request → 财务, a file in a module's
 * 资料库 → that module's colleague, else the assistant), and the person must be
 * able to edit it.
 */
export async function docCopilotAction(input: { kind: string; id: string; title: string; paragraphs: unknown; focus: unknown; instruction: string; model?: string | null }) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  const id = typeof input.id === "string" && /^[a-z]+_[0-9a-z]+$/i.test(input.id) ? input.id : null;
  const instruction = String(input.instruction ?? "").trim();
  if (!id || !instruction) return { error: "请写下想怎么改" };
  const paragraphs = (Array.isArray(input.paragraphs) ? input.paragraphs : []).slice(0, 600).map((p) => String(p ?? "").slice(0, 6000));
  if (!paragraphs.some((p) => p.trim()) && !/写|起草|生成|draft|write/i.test(instruction)) return { error: "文档还是空的，先写几句，或者让我“起草”" };
  if (paragraphs.join("").length > 120_000) return { error: "文档太长了，选中一部分再让我改" };
  const focus = (Array.isArray(input.focus) ? input.focus : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < paragraphs.length);

  let agent: DocAgent = "assistant";
  let module: "files" | "legal" | "finance" | "accounting" | "hr" = "files";
  if (input.kind === "contract") {
    if (!viewer.modules.includes("legal")) return { error: "你没有权限这样做" };
    agent = "legal";
    module = "legal";
  } else if (input.kind === "report" || input.kind === "spend") {
    if (!viewer.modules.includes("finance")) return { error: "你没有权限这样做" };
    agent = "finance";
    module = "finance";
  } else {
    const doc = await openDoc(viewer, id);
    if (!doc || !doc.canEdit) return { error: "你没有权限改这份文档" };
    const [row] = await db.select({ folder: folders.name }).from(files).leftJoin(folders, eq(folders.id, files.folderId)).where(eq(files.id, id)).limit(1);
    const lib = (Object.entries(LIBRARIES) as [string, { zh: string }][]).find(([, l]) => l.zh === row?.folder)?.[0];
    if (lib === "legal") agent = "legal";
    if (lib === "finance" || lib === "accounting") agent = "finance";
    if (lib === "legal" || lib === "finance" || lib === "accounting" || lib === "hr") module = lib;
  }
  const model = typeof input.model === "string" && /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(input.model) ? input.model : null;
  try {
    return await docRewrite(viewer, { agent, module, title: String(input.title ?? ""), paragraphs, focus, instruction, pick: model });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成，请再试一次" };
  }
}
