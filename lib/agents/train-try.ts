import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Viewer } from "@/lib/auth/dal";
import type { Module } from "@/lib/db/schema";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage, BudgetStop } from "@/lib/ai/ledger";
import { identityFor } from "@/lib/agents/lanes";
import { trainingFor, type TrainKey } from "@/lib/agents/training";

/**
 * The two helpers behind the AI 训练 page that are not plain saving:
 * 试一试 (one short answer from the employee with what it has been taught)
 * and reading an uploaded example file into text.
 */

const LEDGER_MODULE: Record<TrainKey, Module> = {
  assistant: "chat",
  research: "research",
  planning: "chat",
  script: "script",
  video: "video",
  article: "script",
  legal: "legal",
  finance: "finance",
};

export async function tryTraining(viewer: Viewer, key: TrainKey, ask: string): Promise<{ text: string } | { error: string }> {
  const q = ask.trim().slice(0, 1500);
  if (!q) return { error: "先写一句要它做什么" };
  try {
    await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) return { error: "本月的 AI 预算已用完" };
    throw err;
  }
  const training = await trainingFor(viewer.tenantId, key);
  const who =
    key === "assistant"
      ? "你是腾亚创变（香港的视频工作室）的 AI 助理，替同事查资料、派活、回答问题。"
      : identityFor(key);
  const system = [
    who,
    training.text || "（团队还没有给你写训练内容。）",
    "这是在 AI 训练页上的一次试写，用来看训练的效果：直接给出成品，不调用任何工具，不要解释你是怎么想的，不要写“好的”。用提问的语言回答。",
  ].join("\n\n");
  const out = await complete({
    model: modelFor.utility(),
    temperature: 0.6,
    maxTokens: 1200,
    user: viewer.id,
    messages: [
      { role: "system", content: system },
      { role: "user", content: q },
    ],
  });
  await recordUsage({
    viewer,
    module: LEDGER_MODULE[key],
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });
  const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim();
  return text ? { text } : { error: "它这次没有给出内容，再试一次" };
}

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "srt", "vtt", "ass", "html", "htm", "xml", "rtf"]);
const run = promisify(execFile);

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The words of an uploaded example. Plain-text formats as they are (HTML
 * without its tags, subtitles without their timings), Word .docx from its
 * document XML. A PDF or an old .doc cannot be read here yet: the person is
 * told to paste the text instead.
 */
export async function extractExampleText(name: string, bytes: Uint8Array): Promise<{ text: string } | { error: string }> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (TEXT_EXT.has(ext) || !name.includes(".")) {
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (ext === "html" || ext === "htm" || ext === "xml") text = decodeEntities(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|li)>/gi, "\n").replace(/<[^>]+>/g, ""));
    if (ext === "srt" || ext === "vtt" || ext === "ass") text = text.split("\n").filter((l) => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^WEBVTT/.test(l)).join("\n");
    if (ext === "rtf") text = text.replace(/\\[a-z]+-?\d* ?|[{}]/gi, "");
    text = tidy(text);
    return text ? { text } : { error: "这个文件是空的" };
  }
  if (ext === "docx") {
    const dir = await mkdtemp(join(tmpdir(), "train-"));
    try {
      const path = join(dir, "in.docx");
      await writeFile(path, bytes);
      const { stdout } = await run("unzip", ["-p", path, "word/document.xml"], { maxBuffer: 32 * 1024 * 1024 });
      const text = tidy(
        decodeEntities(
          stdout
            .replace(/<w:tab\/>/g, "\t")
            .replace(/<w:br[^>]*\/>/g, "\n")
            .replace(/<\/w:p>/g, "\n")
            .replace(/<[^>]+>/g, ""),
        ),
      );
      return text ? { text } : { error: "这个 Word 文件里没有读到文字" };
    } catch {
      return { error: "这个 Word 文件打不开，请另存为 .docx 或直接粘贴文字" };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (ext === "pdf") return { error: "PDF 暂时读不出文字：请把内容复制粘贴进来，或另存为 Word / TXT 再上传" };
  if (ext === "doc") return { error: "旧版 .doc 读不了：请另存为 .docx 再上传，或直接粘贴文字" };
  return { error: `读不了 .${ext} 文件：支持 TXT、Markdown、Word (.docx)、字幕和网页` };
}
