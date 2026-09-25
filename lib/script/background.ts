import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db/client";
import { chatMembers } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { agentViewer } from "@/lib/agents";
import { postMessage } from "@/lib/chat/service";
import { BudgetStop } from "@/lib/ai/ledger";
import { setProjectWriting } from "@/lib/projects/service";
import { writeScript, type ScriptRequest } from "./from-research";
import { cutVersion } from "./service";

/**
 * A project's draft, written after the response.
 *
 * Choosing a topic and reading a draft should be one decision apart, and
 * the draft takes thirty seconds to a minute. So the button's action only
 * marks the project "writing" and returns; the draft is written here once
 * the page has moved on to the script, which shows the writing state and
 * polls `/api/script/[id]/pulse` until the mark is gone.
 *
 * When it lands, 编剧 says so in the project's chat, in its own name, and
 * says exactly what `writeScript` returned: how many beats, or why there
 * are none. Nothing is claimed that did not happen, so the rule the
 * employees follow in chat ("only say what a tool actually did") holds for
 * this message too.
 */
export async function draftInBackground(
  viewer: Viewer,
  input: {
    projectId: string;
    channelId: string;
    scriptId: string;
    req: ScriptRequest;
    /** Beats already exist: keep them as a version first. */
    rewrite?: boolean;
  },
): Promise<void> {
  await setProjectWriting(input.projectId, new Date().toISOString());
  after(async () => {
    let text: string;
    try {
      if (input.rewrite) await cutVersion(viewer, input.scriptId, { note: "按选题重写之前" }).catch(() => null);
      const res = await writeScript(viewer, { ...input.req, intoScriptId: input.scriptId });
      if (!res.ok) text = `这次没写成：${res.error}`;
      else if (res.beats > 0)
        text = [
          `《${res.title}》的${input.rewrite ? "新一版" : "初稿"}写好了：${res.beats} 个分镜。`,
          `在脚本页看、改：/script/${res.id}`,
          res.note ? `备注：${res.note}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      else text = `《${res.title}》这次没写出分镜：${res.note ?? "模型没有返回能读的脚本"}。在脚本页按「按选题重写」可以再试一次。`;
    } catch (err) {
      text = err instanceof BudgetStop ? "这次没写成：本期的 AI 额度已经用完。" : `这次没写成：${err instanceof Error ? err.message : String(err)}`;
      console.error("[script] the draft from the topic failed", err);
    } finally {
      await setProjectWriting(input.projectId, null).catch(() => {});
    }
    try {
      const writer = await agentViewer(viewer.tenantId, "script");
      /* In the room before speaking in it, as a tagged employee is. */
      await db.insert(chatMembers).values({ channelId: input.channelId, userId: writer.id }).onConflictDoNothing();
      await postMessage(writer, input.channelId, text, { draft: { scriptId: input.scriptId } });
    } catch (err) {
      console.error("[script] could not tell the project the draft landed", err);
    }
  });
}
