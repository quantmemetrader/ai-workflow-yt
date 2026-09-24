import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, videoProjects } from "@/lib/db/schema";
import { agentViewer, postAsAgent } from "@/lib/agents";
import { AGENT_LABELS, agentTag, type AgentKey } from "@/lib/agents/catalog";
import type { CardAction } from "@/lib/agents/cards";
import { assemblePrompt } from "@/lib/ai/prompt";
import { AiError, complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { BudgetStop, assertBudget, recordUsage } from "@/lib/ai/ledger";
import { readAutomation } from "@/lib/automations/service";

/**
 * Footage lands, and the studio hears what could be made from it — without
 * anybody asking.
 *
 * The client's words: *"Say i upload a new source file, agent should already
 * start processing"*. Half of that was already true — an upload queues its
 * poster, its proxy, its peaks and its transcript by itself. The half that was
 * missing is the part a person would notice: somebody reading the transcript
 * and saying what is in it.
 *
 * So when an automatic transcription finishes, 策划 reads the words that came
 * back and posts into #制作: what this tape is, the two or three moments worth
 * cutting to, and one thing the studio could make. The buttons hand it on.
 *
 * Deliberately *after* the transcript rather than on the upload itself: before
 * it, the only thing anybody could say is "a file arrived", which the file
 * list already says.
 */
const MAX_TRANSCRIPT = 12_000;

const INSTRUCTIONS = `你现在是腾亚创变的「策划」，一名 AI 员工。团队刚上传了一段新素材，系统已经自动转写完成。你在频道 #制作 里说说这段素材可以拿来做什么。

只根据下面的转写内容说话。不要编造画面、人名或数字；转写里没有的就不要写。

格式（Markdown，简体中文，不超过 220 字）：

**这段素材是什么**：<一到两句>

**值得剪的片段**
- <时间点 + 这里说了什么，最多 3 条>

**可以做成**：<一句话，一个具体的成品建议>`;

type Line = { startMs: number; text: string };

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The buttons: hand it to the two colleagues who could start on it now. */
function buttons(projectId: string, title: string): CardAction[] {
  const hand = (key: AgentKey, what: string, tone: CardAction["tone"]): CardAction => ({
    id: `footage-${key}`,
    label: `交给${AGENT_LABELS[key].nameLocal}`,
    labelEn: `Hand to ${AGENT_LABELS[key].name}`,
    kind: "say",
    body: `${agentTag(key)} ${what}`,
    tone,
  });

  return [
    hand("script", `《${title}》的素材已经转写好了，按上面这段，先写一版脚本。`, "primary"),
    hand("video", `《${title}》的素材已经转写好了，先出一版粗剪。项目：/video?project=${projectId}`, "quiet"),
    {
      id: "footage-open",
      label: "打开项目",
      labelEn: "Open the project",
      kind: "open",
      href: `/video?project=${projectId}`,
      tone: "quiet",
    },
  ];
}

/**
 * Post 策划's read of a freshly transcribed project.
 *
 * Returns what happened, so the job row says why it did nothing on the days it
 * does nothing. Never throws for a reason that is not the studio's problem: a
 * used-up budget or a model refusal is a missed post, not a failed upload.
 */
export async function proposeFromFootage(projectId: string): Promise<{ posted: string | null; why?: string }> {
  const setting = await readAutomation("footage");
  if (!setting.enabled) return { posted: null, why: "switched off in Automations" };

  const [project] = await db
    .select({ id: videoProjects.id, tenantId: videoProjects.tenantId, title: videoProjects.title })
    .from(videoProjects)
    .where(eq(videoProjects.id, projectId))
    .limit(1);
  if (!project) return { posted: null, why: "no such project" };

  const lines: Line[] = await db
    .select({ startMs: captions.startMs, text: captions.text })
    .from(captions)
    .where(and(eq(captions.projectId, projectId)))
    .orderBy(asc(captions.startMs));
  if (lines.length < 4) return { posted: null, why: "not enough transcript to say anything about" };

  const viewer = await agentViewer(project.tenantId, setting.agent);
  try {
    await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) return { posted: null, why: "the Planning agent's AI budget is used up" };
    throw err;
  }

  let transcript = "";
  for (const line of lines) {
    const next = `[${clock(line.startMs)}] ${line.text}\n`;
    if (transcript.length + next.length > MAX_TRANSCRIPT) break;
    transcript += next;
  }

  const { text: base } = await assemblePrompt(viewer, "video");
  const chain = [modelFor.assistant(), ...modelFor.fallbacks().filter((m) => m !== modelFor.assistant())];

  let out: Awaited<ReturnType<typeof complete>> | null = null;
  for (const model of chain) {
    try {
      const attempt = await complete({
        model,
        temperature: 0.4,
        maxTokens: 2000,
        user: viewer.id,
        messages: [
          { role: "system", content: `${base}\n\n${INSTRUCTIONS}` },
          { role: "user", content: `项目：《${project.title}》\n\n转写：\n${transcript}` },
        ],
      });
      await recordUsage({
        viewer,
        module: "video",
        model: attempt.model,
        provider: attempt.provider ?? "openrouter",
        promptTokens: attempt.promptTokens,
        completionTokens: attempt.completionTokens,
        costMicros: attempt.costMicros,
        requestId: attempt.requestId,
      });
      if (attempt.text.trim()) {
        out = attempt;
        break;
      }
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "credit" || err.kind === "rate_limit");
      if (!retryable) throw err;
    }
  }

  const body = (out?.text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!body) return { posted: null, why: "no model produced a read of the footage" };

  const id = await postAsAgent(
    project.tenantId,
    setting.agent,
    "production",
    `🎬 **新素材 ·《${project.title}》**\n\n${body}`,
    {
      footage: { projectId, lines: lines.length, model: out!.model, costMicros: out!.costMicros },
      actions: buttons(projectId, project.title),
    },
  );
  return { posted: id };
}
