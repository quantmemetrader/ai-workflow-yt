import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage } from "@/lib/ai/ledger";
import { disclosureForWriting } from "@/lib/ai/disclosure";
import { trainingFor } from "@/lib/agents/training";
import { humanize } from "@/lib/text/human";
import { toSimplified } from "@/lib/text/simplified";
import type { Viewer } from "@/lib/auth/dal";

/**
 * The assistant beside a document (5 Oct: the documents in 文件, 法务 and 财务
 * had no AI bar or AI panel, the script page has both). The page sends its
 * paragraphs and one instruction; the answer names only the paragraphs it
 * changes and any it adds, and the page writes them in as one step that a
 * single undo takes back.
 */
export type DocAgent = "assistant" | "legal" | "finance";

const ROLE: Record<DocAgent, string> = {
  assistant: "你是工作室的助理，帮同事改文档。",
  legal: "你是工作室的法务，帮同事改合同和法务文件。改动要严谨：不编造对方信息、金额、日期或法律依据；不确定的地方留横线或在说明里提醒去核对，不要替人做法律判断。",
  finance: "你是工作室的财务，帮同事改报告、申请和财务文件。数字只能来自原文，不编造金额、日期或数据；需要补数据的地方在说明里点出来。",
};

const PROMPT = `按同事的指令修改下面这份文档。文档按段落编号给出：[编号] 段落。
只输出 JSON，不要别的文字：
{"changes":[{"i":段落编号,"text":"改好的整段"}],"inserts":[{"after":插在哪个编号之后（-1 表示最前面）,"text":"新段落"}],"summary":"一句话说你改了什么"}
规则：
- 只改需要改的段落，没改的不要列出来；每段给出改好后的完整文字。
- 指令里说了“选中的部分”时，只改标了 ★ 的段落。
- 保留原文的事实、名字、数字和日期；用简体中文，原文是英文就保持英文。
- 不要在文字里加 Markdown 符号（#、*、**）。
- 如果按指令不需要改，changes 和 inserts 都给空数组，summary 说明原因。`;

export async function docRewrite(
  viewer: Viewer,
  input: { agent: DocAgent; module: "files" | "legal" | "finance" | "accounting" | "hr"; title: string; paragraphs: string[]; focus: number[]; instruction: string; pick?: string | null },
) {
  await assertBudget(viewer);
  const training = await trainingFor(viewer.tenantId, input.agent).catch(() => ({ text: "" }) as { text: string });
  const model0 = input.pick ?? modelFor.agent(input.agent) ?? modelFor.assistant();
  const system = [ROLE[input.agent], PROMPT, disclosureForWriting(model0), training.text ? `工作室给你的训练和规范：\n${training.text.slice(0, 10000)}` : ""].filter(Boolean).join("\n\n");
  const focus = new Set(input.focus);
  const user = [
    `文档标题：${input.title.slice(0, 200)}`,
    `指令：${input.instruction.slice(0, 1000)}${focus.size ? "（只改选中的部分）" : ""}`,
    "",
    "文档：",
    ...input.paragraphs.map((p, i) => `${focus.has(i) ? "★" : ""}[${i}] ${p || "（空行）"}`),
  ].join("\n");

  let raw: { changes?: unknown; inserts?: unknown; summary?: unknown } | null = null;
  let model = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const out = await complete({
      model: model0,
      temperature: attempt ? 0.2 : 0.4,
      maxTokens: 14000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    await recordUsage({ viewer, module: input.module, provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    model = out.model;
    const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/```(?:json)?/g, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      raw = null;
    }
  }
  if (!raw) return { error: "这次没有给出可用的改法，再试一次。" };
  const s = (v: unknown, max: number) => (typeof v === "string" ? toSimplified(humanize(v.trim().slice(0, max))) : "");
  const n = input.paragraphs.length;
  const seen = new Set<number>();
  const changes = (Array.isArray(raw.changes) ? raw.changes : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ i: Number(c.i), text: s(c.text, 6000) }))
    .filter((c) => Number.isInteger(c.i) && c.i >= 0 && c.i < n && c.text !== input.paragraphs[c.i] && (!focus.size || focus.has(c.i)))
    .filter((c) => (seen.has(c.i) ? false : (seen.add(c.i), true)));
  const inserts = (Array.isArray(raw.inserts) ? raw.inserts : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ after: Number(c.after), text: s(c.text, 6000) }))
    .filter((c) => Number.isInteger(c.after) && c.after >= -1 && c.after < n && c.text)
    .slice(0, 12);
  const summary = s(raw.summary, 200);
  if (!changes.length && !inserts.length) return { error: summary || "按这个指令不需要改动，换个说法试试。" };
  return { ok: true as const, changes, inserts, summary, model };
}
