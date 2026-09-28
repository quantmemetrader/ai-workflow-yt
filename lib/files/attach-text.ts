import "server-only";
import type { Viewer } from "@/lib/auth/dal";
import { readFileText } from "@/lib/ai/retrieval";

/**
 * A person's message with the text of the files they attached put under it,
 * for the model. The stored message keeps only its `[附件] … file id fil_…`
 * lines (the chat draws those as file chips); the text goes to the model on
 * every turn, the newest message's files in full, older ones as a start —
 * so a follow-up ("look at slide 3 again") still has them.
 *
 * Read as the one answering (`readFileText` checks the relation): an
 * employee reads an attachment through the viewer grant the stream route
 * gave it.
 */
const ATTACHED = /\[附件\][^\n]*?file id (fil_[0-9a-z]+)/gi;

export async function withAttachmentText(viewer: Viewer, content: string, budget: number): Promise<string> {
  const ids = [...new Set([...content.matchAll(ATTACHED)].map((m) => m[1]))];
  if (!ids.length) return content;
  const blocks: string[] = [];
  let left = budget;
  for (const id of ids) {
    if (left < 400) break;
    const doc = await readFileText(viewer, id, Math.min(left, 90_000)).catch(() => null);
    if (!doc || !doc.text.trim()) continue;
    blocks.push(`〔附件内容：${doc.name}〕\n${doc.text}${doc.truncated ? "\n（内容太长，这里只有前面一部分；要看后面的，用 read_file 读这个 file id）" : ""}\n〔附件内容结束〕`);
    left -= doc.text.length;
  }
  return blocks.length ? `${content}\n\n${blocks.join("\n\n")}` : content;
}
