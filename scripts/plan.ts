/**
 * The Planning agent's morning to-dos, posted into #研究日报 right after the
 * Research agent's digest.
 *
 * The client's ask, in his words: *"every mornig 8am HKT research agent will
 * send a message on yesterday's trend"* and *"polanning agent will send out to
 * dos"*. So this is the second half of the morning: 研究员 says what happened,
 * 策划 says what the studio should do about it today, and every item that an
 * AI employee could start carries a button that starts it.
 *
 * It reads the digest that was just posted rather than the research again —
 * the two should agree, and two independent reads of the same data at eight in
 * the morning is how they stop agreeing.
 *
 * Buttons are the ordinary card kind (`lib/agents/cards.ts`): pressing one
 * posts a line *as the person who pressed it*, which tags the colleague and
 * starts them off. Nothing here assigns work by itself; the studio still
 * chooses, in one press instead of a sentence.
 *
 * Run by pm2 at 00:05 UTC (08:05 in Hong Kong), five minutes behind the digest.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/plan.ts [--force] [--dry]
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { agentViewer, ensureAgentChannel, postAsAgent } from "../lib/agents";
import { AGENT_LABELS, agentTag, type AgentKey } from "../lib/agents/catalog";
import type { CardAction } from "../lib/agents/cards";
import { runTool } from "../lib/ai/tools";
import { assemblePrompt } from "../lib/ai/prompt";
import { AiError, complete } from "../lib/ai/openrouter";
import { modelFor } from "../lib/ai/models";
import { BudgetStop, assertBudget, recordUsage } from "../lib/ai/ledger";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";
const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

/** Today, in Hong Kong: the plan's identity, and the digest's. */
const hkDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The colleagues a to-do can be handed to. `human` is everything that needs a
 * person: shooting, approving, deciding what the studio is willing to say. */
const OWNERS = ["research", "planning", "script", "video", "article", "human"] as const;
type Owner = (typeof OWNERS)[number];

const INSTRUCTIONS = `你现在是腾亚创变的「策划」，一名 AI 员工。每天早上，研究员发完晨报之后，你在同一个频道发当天的工作计划。

同事（可以派活给他们）：
- 研究员：查趋势、对标账号、把一个选题挖深
- 编剧：写脚本、改脚本
- 剪辑师：粗剪、字幕、图形、渲染
- 撰稿人：长文、发布记录、按平台改写
- 人（human）：需要真人做的事——拍摄、审批、对外沟通、决定要不要讲

规则：
- 只用下面给你的资料。不要编造数字、新闻或来源。
- 3 到 5 条待办，按今天的优先级排序。每条一句话，具体到可以马上开始。
- 每条都要指定一个负责人（上面六个里的一个）。
- 不要把「审批」派给 AI 员工。
- 至少一条跟今天晨报里的选题直接相关。
- 简体中文。

只输出 JSON，不要写别的：
{
  "focus": "今天最重要的一件事，一句话",
  "todos": [
    { "text": "待办内容", "owner": "script", "why": "为什么是今天，一句话，引用资料里的具体内容" }
  ]
}`;

type Plan = { focus: string; todos: { text: string; owner: Owner; why?: string }[] };

async function digestToday(channelId: string, date: string): Promise<string | null> {
  const { rows } = await db.execute<{ body: string }>(sql`
    select body from chat_messages
     where channel_id = ${channelId} and deleted_at is null
       and meta -> 'digest' ->> 'date' = ${date}
     order by created_at desc
     limit 1
  `);
  return rows[0]?.body ?? null;
}

async function alreadyPosted(channelId: string, date: string): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from chat_messages
     where channel_id = ${channelId} and deleted_at is null
       and meta -> 'plan' ->> 'date' = ${date}
  `);
  return (rows[0]?.n ?? 0) > 0;
}

/** The model's answer, read defensively: it is text until it parses. */
function readPlan(text: string): Plan | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const obj = raw as { focus?: unknown; todos?: unknown };
  const focus = typeof obj.focus === "string" ? obj.focus.trim().slice(0, 200) : "";
  if (!Array.isArray(obj.todos)) return null;

  const todos: Plan["todos"] = [];
  for (const item of obj.todos.slice(0, 6)) {
    const t = item as { text?: unknown; owner?: unknown; why?: unknown };
    const text_ = typeof t.text === "string" ? t.text.trim().slice(0, 240) : "";
    if (!text_) continue;
    const owner = OWNERS.includes(t.owner as Owner) ? (t.owner as Owner) : "human";
    todos.push({
      text: text_,
      // Approving is a person's, whatever the model decided.
      owner: /审批|批准|approve/i.test(text_) ? "human" : owner,
      why: typeof t.why === "string" ? t.why.trim().slice(0, 240) : undefined,
    });
  }
  return todos.length ? { focus, todos } : null;
}

/**
 * One button per colleague, not per to-do.
 *
 * Two items for the same person produced two buttons reading 交给编剧 side by
 * side, which is a choice nobody can make. A colleague's button carries
 * everything the plan asked of them today, numbered, so one press is the whole
 * hand-over and the card stays four buttons wide at most.
 */
function buttons(plan: Plan): CardAction[] {
  const byOwner = new Map<AgentKey, string[]>();
  for (const todo of plan.todos) {
    if (todo.owner === "human" || todo.owner === "planning") continue;
    const key = todo.owner as AgentKey;
    byOwner.set(key, [...(byOwner.get(key) ?? []), todo.text]);
  }

  return [...byOwner].slice(0, 4).map(([key, items], i) => ({
    id: `hand-${key}`,
    label: `交给${AGENT_LABELS[key].nameLocal}`,
    labelEn: `Hand to ${AGENT_LABELS[key].name}`,
    kind: "say" as const,
    body:
      items.length === 1
        ? `${agentTag(key)} ${items[0]}`
        : [`${agentTag(key)} 今天这两三件，麻烦你：`, ...items.map((t, n) => `${n + 1}. ${t}`)].join("\n"),
    tone: i === 0 ? ("primary" as const) : ("quiet" as const),
  }));
}

function render(date: string, plan: Plan): string {
  const lines = [`📋 **今日计划 · ${date}**`, ""];
  if (plan.focus) lines.push(`**今天最重要：**${plan.focus}`, "");
  for (const todo of plan.todos) {
    const who = todo.owner === "human" ? "**人**" : AGENT_LABELS[todo.owner as AgentKey].nameLocal;
    lines.push(`- ${who} — ${todo.text}${todo.why ? `\n  _${todo.why}_` : ""}`);
  }
  return lines.join("\n");
}

async function main() {
  const date = hkDate();
  const viewer = await agentViewer(TENANT, "planning");
  const channelId = await ensureAgentChannel(TENANT, "digest");

  if (!FORCE && !DRY && (await alreadyPosted(channelId, date))) {
    console.log(`[plan] ${date} already posted; --force to post again`);
    return;
  }

  try {
    await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) {
      console.log("[plan] the Planning agent's AI budget is used up; not posting");
      return;
    }
    throw err;
  }

  const digest = await digestToday(channelId, date);
  const [topics, scripts] = await Promise.all([
    runTool(viewer, "list_topics", JSON.stringify({ limit: 20 })),
    runTool(viewer, "list_scripts", JSON.stringify({ limit: 15 })),
  ]);

  const material = [
    `日期：${date}（香港）`,
    digest ? `## 今天早上研究员发的晨报\n${digest}` : "## 今天早上研究员还没发晨报\n（按下面的资料自己判断）",
    `## 选题储备\n${topics.text}`,
    `## 脚本进度\n${scripts.text}`,
  ].join("\n\n");

  const { text: base } = await assemblePrompt(viewer, "research");
  const chain = [modelFor.assistant(), ...modelFor.fallbacks().filter((m) => m !== modelFor.assistant())];

  let plan: Plan | null = null;
  let used: Awaited<ReturnType<typeof complete>> | null = null;
  for (const model of chain) {
    try {
      const out = await complete({
        model,
        temperature: 0.4,
        maxTokens: 2500,
        user: viewer.id,
        messages: [
          { role: "system", content: `${base}\n\n${INSTRUCTIONS}` },
          { role: "user", content: material },
        ],
      });
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
      plan = readPlan(out.text);
      if (plan) {
        used = out;
        break;
      }
      console.log(`[plan] ${model} did not return a plan; trying the next model`);
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "credit" || err.kind === "rate_limit");
      if (!retryable) throw err;
      console.log(`[plan] ${model} refused (${err.kind}); trying the next model`);
    }
  }

  if (!plan || !used) throw new Error("No model produced a plan");

  const body = render(date, plan);
  const actions = buttons(plan);

  if (DRY) {
    console.log(`[plan] dry run, ${used.model}, ${used.costMicros}µ$\n\n${body}\n\nbuttons: ${actions.map((a) => a.label).join(" | ") || "none"}`);
    return;
  }

  const id = await postAsAgent(TENANT, "planning", "digest", body, {
    plan: { date, model: used.model, costMicros: used.costMicros, todos: plan.todos.length },
    actions,
  });
  console.log(`[plan] ${date} posted ${id} by ${used.model}, ${used.costMicros}µ$, ${actions.length} buttons`);
}

main()
  .catch((err) => {
    console.error("[plan] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
