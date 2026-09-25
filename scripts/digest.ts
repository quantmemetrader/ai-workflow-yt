/**
 * The Research agent's morning digest, posted into #研究日报.
 *
 * The daily signal: one topic, two at most, that the host can film today,
 * each with the evidence behind it and what to shoot.
 *
 * The studio's ask: "just 1 or 2 as base, most important signal, so the head
 * of the account will create her video clip for it". So this is not a news
 * round-up. It reads every stored hot list (`hot_snapshots`, filled hourly by
 * `scripts/collect-hot.ts`), led by 抖音's 财经/科技 billboards and the
 * small-account breakouts, next to the channel's own numbers, and one model
 * call chooses. The model names evidence by id; the numbers printed are the
 * rows' own (`lib/research/signals.ts`), so none of them can be invented.
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
import { evidenceForModel, evidenceForPeople, evidencePool, type Evidence } from "../lib/research/signals";
import { studioBrief } from "../lib/research/studio";
import { agentTag } from "../lib/agents/catalog";
import type { CardAction } from "../lib/agents/cards";
import { dueNow, readAutomation } from "../lib/automations/service";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";
const FORCE = process.argv.includes("--force");
/** Write the digest to stdout instead of the channel — for checking the words. */
const DRY = process.argv.includes("--dry");

/** Today, in Hong Kong: the digest's identity. */
const hkDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const INSTRUCTIONS = `你现在是腾亚创变的「研究员」，全世界最好的内容研究员。每天早上你只做一件事：替这个频道的主持人挑出今天最值得拍的 1 个选题（最多 2 个），并把证据摆出来，让她看完就能去拍。

怎么挑（按重要性）：
1. 已经被验证的需求：抖音「低粉爆款」里，小账号的播放是粉丝的几十、几百倍，说明是题目本身在带流量，不是账号。这是最强的信号。
2. 多个平台同时出现：同一件事在两个以上的平台（抖音、微博、小红书、B站、YouTube、Google）同时在热，比只在一个平台上热更可靠。
3. 正在上升：抖音上升热点、刚发出几小时就破百万的视频。
4. 接得上本频道：必须能连到这个频道已经验证过的方向（香港机会、Web3 与 AI、投资与职涯、财经科技、人物对话），最好能引本频道自己的数字或观众原话。和频道无关的娱乐、体育、明星八卦，不选。
5. 主持人今天拍得了：一个人对着镜头、加一些素材就能讲清楚。

宁缺毋滥：只有一个强信号就只给一个。两个都弱就给一个，并在 strength 里如实打分。

证据规则（非常重要）：
- 下面每条外部数据前面有编号，例如 [B3]、[F1]。你只能用编号引用证据，不要自己写任何播放、点赞、粉丝数字，系统会按编号把真实数字印出来。
- 每个选题至少引 2 条证据，最好来自不同平台。同一条视频出现在两个榜单里只算一条，不要重复引用。
- why_now 里也不要写数字，只写编号和判断。
- 引用本频道数据时（channel_fit），可以写本频道数据段里出现过的具体数字或观众原话，原样照抄，不要改。
- 不要编造新闻或来源。传闻写明是传闻。

只输出一个 JSON，不要任何别的文字：
{
  "signals": [
    {
      "title": "选题，一句话，可以直接当片名，简体中文",
      "why_now": "为什么是今天，1 到 2 句，用编号指出证据，例如「[B3] 小账号播放远超粉丝，[W2] 微博同时在热」",
      "evidence": ["B3", "W2", "F1"],
      "channel_fit": "和本频道哪条已验证的数据接得上（引本频道数据段的原话或数字）；接不上就写「本频道还没做过这个方向」",
      "hook": "开头 3 秒说的第一句话",
      "angle": "这个频道的切入角度，一句话",
      "format": "例如：竖版 60 秒 / 横版 6 分钟",
      "shots": ["要拍或要找的画面 1", "画面 2", "画面 3"],
      "risk": "要核实的事实或要避开的坑；没有就写空字符串",
      "strength": 1
    }
  ]
}
strength 是 1 到 5 的整数，5 = 多平台 + 低粉爆款 + 接得上本频道。`;

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

  /* pm2 wakes this hourly and the Automations page decides the rest: whether
     it runs at all, at what Hong Kong time, and which employee signs it. */
  const setting = await readAutomation("digest");
  if (!FORCE && !DRY && !dueNow(setting)) {
    console.log(
      setting.enabled
        ? `[digest] not due yet (${String(setting.hour).padStart(2, "0")}:${String(setting.minute).padStart(2, "0")} HKT)`
        : "[digest] switched off in Automations",
    );
    return;
  }

  const viewer = await agentViewer(TENANT, setting.agent);
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

  /* The studio's own numbers first. This is the half that was missing: 125
     of its videos, their like rates and the questions its viewers typed are
     in this database, and the brief was reading Google's trending searches
     instead — which is why it came back generic. */
  const [studio, pool, listed] = await Promise.all([
    studioBrief(TENANT),
    evidencePool(),
    runTool(viewer, "list_topics", JSON.stringify({ limit: 20 })),
  ]);
  if (pool.rows.length === 0) throw new Error("No stored hot lists to choose from; run scripts/collect-hot.ts");
  const byId = new Map(pool.rows.map((e) => [e.id, e]));

  const material = [
    `日期：${date}（香港）`,
    studio.text,
    `## 外部数据（带编号，只能用编号引用）${evidenceForModel(pool.rows)}`,
    `## 团队长期关注的话题（热度与 14 天变化，只作参考）\n${listed.text}`,
  ].join("\n\n");

  const { text: base } = await assemblePrompt(viewer, "research");
  const chain = [modelFor.assistant(), ...modelFor.fallbacks().filter((m) => m !== modelFor.assistant())];

  let out: Awaited<ReturnType<typeof complete>> | null = null;
  for (const model of chain) {
    try {
      out = await complete({
        model,
        temperature: 0.4,
        // Room for a reasoning model to think before it writes (see angles.ts).
        maxTokens: 4000,
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
      if (parseSignals(stripThinking(out.text), byId).length) break;
      console.log(`[digest] ${model} gave no usable signal; trying the next model`);
    } catch (err) {
      const retryable = err instanceof AiError && (err.kind === "credit" || err.kind === "rate_limit");
      if (!retryable) throw err;
      console.log(`[digest] ${model} refused (${err.kind}); trying the next model`);
    }
  }

  const signals = parseSignals(stripThinking(out?.text ?? ""), byId);
  if (!signals.length) throw new Error("No model produced a usable signal");
  const body = ownLines(render(signals));

  if (DRY) {
    console.log(`[digest] dry run, ${out!.model}, ${out!.costMicros}µ$\n\n${body}`);
    return;
  }

  /*
   * The one button a brief should carry.
   *
   * 对标账号 has been an empty screen since the product was built, and an empty
   * screen never asks to be filled. When the studio is watching nobody, the
   * morning brief says so and offers the one press that fixes it — 研究员 has
   * `who_makes_this` and `watch_channel`, so it can genuinely go and do this.
   */
  /* Each signal starts a project: the button opens a one-press confirm with
     the title, the brief and the writer's first task filled in. */
  const write: CardAction[] = signals.map((sg, i) => {
    const brief = `${sg.whyNow}\n开头：「${sg.hook}」\n角度：${sg.angle}\n格式：${sg.format}`;
    const ask = `${agentTag("script")} 按这个信号写脚本初稿。开头第一句：「${sg.hook}」。角度：${sg.angle}。格式：${sg.format}。证据：${sg.evidence.map((e) => `${e.source} ${e.phrase.slice(0, 30)}`).join("；")}。`;
    void brief;
    void ask;
    return {
      id: `project-${i + 1}`,
      label: signals.length > 1 ? `开项目 · 第 ${i + 1} 个` : "开项目",
      labelEn: signals.length > 1 ? `Start project #${i + 1}` : "Start the project",
      kind: "open" as const,
      href: `/projects/new?signal=${i}&date=${date}`,
      tone: i === 0 ? ("primary" as const) : ("quiet" as const),
    };
  });
  const actions: CardAction[] = [...write, ...(
    studio.competitors === 0
      ? ([
          {
            id: "find-rivals",
            label: "让研究员找对标账号",
            labelEn: "Find channels to watch",
            kind: "say",
            body: `${agentTag("research")} 我们还没有任何对标账号。按本频道在做的题材（香港机会、Web3 与 AI、人物对话、投资与职涯），用 who_makes_this 找出真正在做这些题的 YouTube 频道，挑 3 到 5 个值得长期盯的，用 watch_channel 加进对标板，然后告诉我你选了谁、为什么。`,
            tone: "primary",
          },
        ] as CardAction[])
      : [])];

  const id = await postAsAgent(TENANT, setting.agent, "digest", `☀️ **研究日报 · ${date}**\n\n${body}`, {
    digest: {
      date,
      model: out!.model,
      costMicros: out!.costMicros,
      topics: signals.map((sg) => sg.title),
      signals: signals.map((sg) => ({ ...sg, evidence: sg.evidence.map(({ id: eid, ...e }) => ({ ref: eid, ...e })) })),
    },
    ...(actions.length ? { actions } : {}),
  });
  console.log(`[digest] ${date} posted ${id} by ${out!.model}, ${out!.costMicros}µ$`);
}

type Signal = {
  title: string;
  whyNow: string;
  evidence: Evidence[];
  channelFit: string;
  hook: string;
  angle: string;
  format: string;
  shots: string[];
  risk: string;
  strength: number;
};

/** The model's JSON, held to what it may say: known evidence ids only, at
 *  most two signals, and none without at least one real row behind it. */
function parseSignals(text: string, byId: Map<string, Evidence>): Signal[] {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: { signals?: Record<string, unknown>[] };
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out: Signal[] = [];
  for (const r of (raw.signals ?? []).slice(0, 2)) {
    const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
      .map((x) => byId.get(String(x).replace(/[\[\]\s]/g, "").toUpperCase()))
      .filter((e): e is Evidence => Boolean(e))
      // The same video on two lists is one piece of evidence, not two.
      .filter((e, k, all) => !e.url || all.findIndex((x) => x.url === e.url) === k)
      .slice(0, 5);
    const title = str(r.title, 60);
    if (!title || evidence.length === 0) continue;
    out.push({
      title,
      whyNow: str(r.why_now, 240),
      evidence,
      channelFit: str(r.channel_fit, 240),
      hook: str(r.hook, 80),
      angle: str(r.angle, 120),
      format: str(r.format, 40) || "竖版 60 秒",
      shots: (Array.isArray(r.shots) ? r.shots : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 5),
      risk: str(r.risk, 160),
      strength: Math.max(1, Math.min(5, Math.round(Number(r.strength) || 1))),
    });
  }
  return out;
}

/** The brief, in the channel's words; every number comes from `evidence`.
 *  The first line keeps the 「今天讨论」 form Home and Research read. */
function render(signals: Signal[]): string {
  const stars = (n: number) => "●".repeat(n) + "○".repeat(5 - n);
  const refs = (text: string, sg: Signal) =>
    text.replace(/\[([A-Z]\d{1,2})\]/g, (m, id: string) => {
      const i = sg.evidence.findIndex((e) => e.id === id);
      return i >= 0 ? `（证据${i + 1}）` : "";
    });
  const one = (sg: Signal, i: number) => {
    const lines = [
      i === 0 ? `**今天讨论：${sg.title}**` : `**第二个信号：${sg.title}**`,
      `信号强度 ${stars(sg.strength)}`,
      sg.whyNow ? `为什么是现在：${refs(sg.whyNow, sg)}` : "",
      `**证据**\n${sg.evidence.map((e, k) => `- 证据${k + 1} · ${evidenceForPeople(e)}`).join("\n")}`,
      sg.channelFit ? `**和本频道的关系**：${sg.channelFit}` : "",
      sg.hook ? `**开头一句**：「${sg.hook}」` : "",
      sg.angle ? `**角度**：${sg.angle}` : "",
      sg.shots.length ? `**怎么拍**（${sg.format}）\n${sg.shots.map((x) => `- ${x}`).join("\n")}` : "",
      sg.risk ? `**注意**：${sg.risk}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  };
  return signals.map(one).join("\n\n---\n\n");
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
