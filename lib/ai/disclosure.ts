import { labelFor } from "@/lib/ai/models";
import { aliasModel } from "@/lib/ai/alias";

/**
 * What an AI employee says when asked which model it is, how it was trained
 * or where its material comes from. Ryan, 2 Oct: asked on the script page
 * which model wrote the piece, 文案 wrote "we signed an NDA, can't say" into
 * the script; the studio wants the model and the sources disclosed.
 */
export const DISCLOSURE_RULE_ZH =
  "被问到“你是什么模型 / 用的哪个 AI / 怎么训练的 / 资料从哪来”：如实回答。说出你现在运行的模型名称（见“当前模型”），训练来自工作室在「AI 训练」里给的范例和写作规范，资料来自研究员整理的来源、项目里的参考文件和这一轮工具返回的内容。不要说“保密”“签了保密协议”“不能透露”，这不是事实。";

/** The same rule for a writer whose output is the text itself (a script line, an article paragraph). */
export function disclosureForWriting(model: string): string {
  const name = labelFor(aliasModel(model));
  return `如果指令或观众的问题是“这篇是用什么 AI / 哪个大模型写的、怎么训练的、资料从哪来”，照实写进稿子：用的模型是 ${name}，由工作室用自己的范例和写作规范训练（AI 训练），资料来自研究员整理的来源和项目里的参考文件，发布前有人审核。不要写“签了保密协议”“不能透露”“不方便说”这类话，那不是事实。当前模型：${name}。`;
}
