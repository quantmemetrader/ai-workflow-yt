/**
 * The Research agent's morning digest, posted into #研究日报.
 *
 * The client's ask: "every morning 8am HKT research agent will send a message
 * on yesterday's trend", with "a topic and item to discuss". A list of
 * trending searches is not a topic to discuss, so this is synthesis: the
 * agent reads what the studio's research already collected — through the same
 * tools a person's assistant calls, as itself — and one model call turns that
 * into one topic worth arguing about this morning, and the trend lines behind
 * it.
 *
 * Billed to the Research agent's own user row, so the AI ledger and
 * `check_ai_spend` show what the digest costs apart from anybody's own use.
 *
 * Run by pm2 at 00:00 UTC (08:00 in Hong Kong). pm2 also runs it once when
 * the process is started, so it posts at most once per Hong Kong day; `--force`
 * posts again anyway.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/digest.ts [--force] [--dry]
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { agentViewer, ensureAgentChannel, postAsAgent } from "../lib/agents";
import { runTool } from "../lib/ai/tools";
import { assemblePrompt } from "../lib/ai/prompt";
import { AiError, complete } from "../lib/ai/openrouter";
import { modelFor } from "../lib/ai/models";
import { BudgetStop, assertBudget, recordUsage } from "../lib/ai/ledger";
import { rankedTopics } from "../lib/research/service";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";
const FORCE = process.argv.includes("--force");
/** Write the digest to stdout instead of the channel — for checking the words. */
const DRY = process.argv.includes("--dry");

/** Today, in Hong Kong: the digest's identity. */
const hkDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const INSTRUCTIONS = `你现在是腾亚创变的「研究助理」，一名 AI 员工。每天早上 8 点，你在团队频道 #研究日报 发一条晨报。

只用下面给你的资料。不要编造数字、新闻或来源；资料不够就直说「资料不足」，不要硬凑。
传闻就写明是传闻；当事人已经否认的，要写出否认。不要把未经证实的消息当成事实，尤其是个人私生活。

格式（Markdown，简体中文，整条不超过 350 字）：

**今天讨论：<一个选题，一句话>**
为什么是现在：<一到两句，引用资料里的具体数字或标题>
可以讨论：
- <问题 1>
- <问题 2>
- <问题 3>
建议角度：<一句话，适合这个频道的观众>

**昨日趋势**
- <最多 5 条，每条一行：发生了什么 + 数据>

**值得盯的**
- <1 到 2 个正在变化的已关注话题，没有就写「暂无明显变化」>

选题要选团队今天真的可以开会讨论、可以拍的那一个，不是最热的那个。`;

async function alreadyPosted(channelId: string, date: string): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from chat_messages
     where channel_id = ${channelId} and deleted_at is null
       and meta -> 'digest' ->> 'date' = ${date}
  `);
  return (rows[0]?.n ?? 0) > 0;
}

async function main() {
  const date = hkDate();
  const viewer = await agentViewer(TENANT, "research");
  const channelId = await ensureAgentChannel(TENANT, "digest");

  if (!FORCE && !DRY && (await alreadyPosted(channelId, date))) {
    console.log(`[digest] ${date} already posted; --force to post again`);
    return;
  }

  try {
    await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) {
      console.log("[digest] the Research agent's AI budget is used up; not posting");
      return;
    }
    throw err;
  }

  /* What the studio's research already knows, read through the agent's own
     tools: the same text a person's assistant would have been handed. */
  const topics = await rankedTopics(viewer, { limit: 40 });
  const movers = topics
    .filter((t) => !t.collecting)
    .sort((a, b) => b.change14d - a.change14d)
    .slice(0, 3);

  const [trending, listed, ...details] = await Promise.all([
    runTool(viewer, "trending_now", JSON.stringify({ region: "HK" })),
    runTool(viewer, "list_topics", JSON.stringify({ limit: 20 })),
    ...movers.map((t) => runTool(viewer, "read_topic", JSON.stringify({ phrase: t.name }))),
  ]);

  const material = [
    `日期：${date}（香港）`,
    `## 香港热搜与 YouTube 热门\n${trending.text}`,
    `## 团队关注的话题（热度与 14 天变化）\n${listed.text}`,
    ...details.map((d) => `## 话题详情\n${d.text}`),
  ].join("\n\n");

  const { text: base } = await assemblePrompt(viewer, "research");
  const chain = [modelFor.assistant(), ...modelFor.fallbacks().filter((m) => m !== modelFor.assistant())];

  let out: Awaited<ReturnType<typeof complete>> | null = null;
  for (const model of chain) {
    try {
      out = await complete({
        model,
        temperature: 0.5,
        // Room for a reasoning model to think before it writes (see angles.ts).
        maxTokens: 3000,
        user: viewer.id,
        messages: [
          { role: "system", content: `${base}\n\n${INSTRUCTIONS}` },
          { role: "user", content: material },
        ],
      });
      // Metered whether or not the answer is usable: the call was billed.
      await recordUsage({
        viewer,
        module: "research",
        model: out.model,
        provider: out.provider ?? "openrouter",
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
        costMicros: out.costMicros,
        requestId: out.requestId,
      });
      if (out.text.trim()) break;
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "credit" || err.kind === "rate_limit");
      if (!retryable) throw err;
      console.log(`[digest] ${model} refused (${err.kind}); trying the next model`);
    }
  }

  const body = ownLines(stripThinking(out?.text ?? ""));
  if (!body) throw new Error("No model produced a digest");

  if (DRY) {
    console.log(`[digest] dry run, ${out!.model}, ${out!.costMicros}µ$\n\n${body}`);
    return;
  }

  const id = await postAsAgent(TENANT, "research", "digest", `☀️ **研究日报 · ${date}**\n\n${body}`, {
    digest: { date, model: out!.model, costMicros: out!.costMicros, topics: movers.map((t) => t.name) },
  });
  console.log(`[digest] ${date} posted ${id} by ${out!.model}, ${out!.costMicros}µ$`);
}

/**
 * One line, one paragraph. The chat's Markdown joins consecutive lines into a
 * paragraph, which ran "为什么是现在" into the heading above it. List items are
 * left together, since a blank line between them is the same list anyway.
 */
function ownLines(text: string): string {
  const isItem = (l: string) => /^\s*([-*+]|\d+\.)\s/.test(l);
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out[out.length - 1];
    if (prev && prev.trim() && line.trim() && !(isItem(prev) && isItem(line))) out.push("");
    out.push(line);
  }
  return out.join("\n");
}

/** Reasoning models sometimes put their working in the content. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

main()
  .catch((err) => {
    console.error("[digest] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
