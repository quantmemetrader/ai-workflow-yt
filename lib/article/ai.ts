import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { articles, scriptBeats, scriptVersions, scripts } from "@/lib/db/schema";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage } from "@/lib/ai/ledger";
import { searchFiles, type Hit } from "@/lib/ai/retrieval";
import { creatorVoiceText } from "@/lib/creator/service";
import { houseStyle } from "@/lib/script/ai";
import type { Viewer } from "@/lib/auth/dal";
import { saveArticle } from "./service";

/**
 * Writing articles.
 *
 * Everything that makes a script sound like this studio applies to an article
 * unchanged — the house style in the `knowledge` table, the creator's own
 * voice note, the approved work the writer is allowed to read — so all three
 * are borrowed from `lib/script/ai.ts` rather than written again. What differs
 * is the shape of the answer: prose in Markdown, with a headline and a
 * standfirst, instead of a list of beats.
 *
 * Every call is metered and budget-checked like any other (spec §5).
 */

const ARTICLE_PROMPT = `你是一家香港视频工作室的撰稿人，写财经、科技和时事评论。读者是普通人，不是分析师。

只输出一个 JSON 对象，不要写别的：
{ "title": "...", "summary": "...", "body": "..." }

  "title"   标题。具体、平实，不用冒号副标题，不标题党。
  "summary" 标题下一两句：这篇文章的观点，以及为什么现在写。
  "body"    正文，Markdown。用 "## " 做小标题，段落短；只有列表真的更清楚时才用列表。

怎么写：
- 简报说用什么语言就用什么语言；没说就用标题的语言。中文一律简体。
- 开头先说发生了什么，不先讲背景。第一段要让人想读第二段。
- 说具体的：时间、地点、数字、人名、文件。不写“最近”“很多人”“业内人士”。
- 这是观点文章，不是新闻摘要：说清它意味着什么、接下来会怎样，敢把判断写出来。
- 像真人写的：不用“首先、其次、总之、综上所述、值得注意的是、不仅……而且”，不用“赋能、助力、打造、重磅、颠覆、全方位”，不要破折号（——），不要排比凑数，不要每段结尾总结一句。
- 事实只能来自简报、脚本和给你的资料。没有给的事实、数字、日期、引语、人名，一个都不要写；宁可少写一段。每个数字和引语都要能对上来源。
- 正文里不要再写标题，正文从第一段开始。

改稿时（已经有正文、并且给了修改要求）：
- 按要求改，其余内容保持原样；不要从头重写。
- 修改要求是给你的指令，不是文章内容：不要把要求里的话抄进文章。
- 要求里提到的事实如果简报和资料里没有，就不要加，并在 summary 末尾用一句话说明没有依据。`;

type Drafted = { title: string; summary: string; body: string };

/**
 * Writes the article from what the brief and its sources say.
 *
 * Replaces the body wholesale, which is what "draft this for me" means. The
 * words that were there are not lost: the caller cuts a version first, and
 * every version is immutable.
 */
export async function draftArticle(
  viewer: Viewer,
  articleId: string,
  opts: {
    /** What the writer wants this pass to do differently: "shorter", "open on
     * the Hang Seng number", "less hedged". Optional. */
    instruction?: string | null;
    /** Extra facts the writer pasted in. Optional. */
    sources?: string | null;
  } = {},
): Promise<{ error: string } | { ok: true; model: string; words: number }> {
  await assertBudget(viewer);

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId)))
    .limit(1);
  if (!article) return { error: "Not allowed" };
  if (article.lockedVersion !== null) return { error: "That article is published. Retract it before rewriting." };

  const [style, refs, voice, fromScript] = await Promise.all([
    houseStyle(viewer, "article"),
    examples(viewer, article.title),
    creatorVoiceText(viewer.tenantId),
    article.scriptId ? scriptText(viewer, article.scriptId) : Promise.resolve(""),
  ]);

  const model = modelFor.agent("article") ?? modelFor.drafting();
  const revising = Boolean(article.body.trim()) && Boolean(opts.instruction);
  const brief = [
    `标题（可以改得更好）：${article.title}`,
    article.angle ? `角度：${article.angle}` : null,
    article.summary ? `目前的导语：${article.summary}` : null,
    article.language ? `语言：${article.language}` : "语言：简体中文",
    article.tags.length ? `标签：${article.tags.join("、")}` : null,
    opts.instruction ? (revising ? `修改要求（这是指令，不是正文；按它改，其余保持原样）：${opts.instruction}` : `这一稿特别要求：${opts.instruction}`) : null,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete({
    model,
    temperature: 0.7,
    maxTokens: 4000,
    messages: [
      {
        role: "system",
        content:
          ARTICLE_PROMPT +
          (voice ? `\n\nThe creator this is written for, from their own channel. Sound like them:\n${voice}` : "") +
          (style.text ? `\n\nThe studio's house style:\n${style.text}` : ""),
      },
      {
        role: "user",
        content: [
          brief,
          /* The script this article came from is the best source there is: it
             is the studio's own reporting on the same subject, and it has
             usually already been approved. */
          fromScript ? `工作室自己写的这个题的脚本，事实和讲述顺序都在这里：\n${fromScript}` : null,
          opts.sources ? `还可以用的事实（不要超出这些）：\n${opts.sources}` : null,
          article.body.trim() ? `${revising ? "现在的正文（按修改要求改，其余保持原样）" : "已经写了的部分，在此基础上改写，不要从头来"}：\n${article.body.slice(0, 12_000)}` : null,
          refs ? `语气要像这些已批准的稿子：\n${refs}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  await recordUsage({
    viewer,
    /* The ledger is keyed by module and there is no `article` entitlement:
       Article is a surface of the writing module, so its spend lands with the
       rest of the writing spend rather than in a category nothing else uses. */
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const parsedOut = parseArticle(out.text);
  if (!parsedOut || !parsedOut.body.trim()) return { error: "The model did not return an article we could read." };
  /* A second pair of eyes with the most natural Chinese (Kimi K2.6): the
     wording only, never the facts; a failure leaves the draft as it was. */
  const drafted = { ...parsedOut, body: await polishProse(viewer, parsedOut.body) };

  const saved = await saveArticle(viewer, articleId, {
    title: drafted.title || article.title,
    summary: drafted.summary || article.summary,
    body: drafted.body,
  });
  if (!saved) return { error: "That article is published. Retract it before rewriting." };

  return { ok: true, model: out.model, words: saved.wordCount };
}

/* ---------------------------------------------------------------- input */

/**
 * The script an article was started from, as prose the model can use.
 *
 * The locked version when there is one — those are the words somebody
 * approved — otherwise the working beats. Only the voice-over: the visual
 * column is camera direction, and an article has no camera.
 */
async function scriptText(viewer: Viewer, scriptId: string): Promise<string> {
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return "";

  if (script.lockedVersion !== null) {
    const [version] = await db
      .select({ beats: scriptVersions.beats })
      .from(scriptVersions)
      .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, script.lockedVersion)))
      .limit(1);
    if (version) {
      return version.beats
        .map((b) => b.voiceover.trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 12_000);
    }
  }

  const beats = await db
    .select({ voiceover: scriptBeats.voiceover })
    .from(scriptBeats)
    .where(eq(scriptBeats.scriptId, scriptId))
    .orderBy(asc(scriptBeats.ord));
  return beats
    .map((b) => b.voiceover.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000);
}

/**
 * Approved reference work the writer may read, as examples.
 *
 * `searchFiles` filters by the *writer's* own access, so an example can never
 * be drawn from a document the person asking cannot open. The `withheld` count
 * is ignored on purpose: telling a writer that examples exist which they may
 * not see leaks the fact of them.
 */
async function examples(viewer: Viewer, query: string): Promise<string> {
  const found = await searchFiles(viewer, query, 3).catch(() => ({ hits: [] as Hit[], withheld: 0 }));
  if (!found.hits.length) return "";
  return found.hits.map((f) => `### ${f.name}\n${f.snippet.slice(0, 1200)}`).join("\n\n");
}

/* --------------------------------------------------------------- output */

/** Model output, read defensively: a fenced block, a preamble, or a bare
 * object are all things models do, and none of them should lose the draft. */
function parseArticle(text: string): Drafted | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    // Not JSON at all. A model that simply wrote the article is more useful
    // than an error message, so its prose is taken as the body.
    return cleaned ? { title: "", summary: "", body: cleaned } : null;
  }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Drafted>;
    return {
      title: typeof parsed.title === "string" ? parsed.title.trim().slice(0, 300) : "",
      summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1000) : "",
      body: typeof parsed.body === "string" ? parsed.body.trim() : "",
    };
  } catch {
    return { title: "", summary: "", body: cleaned };
  }
}

/** Newest article ids first — used by the tool pack to resolve "the article
 * we just wrote" without asking the model to remember an id. */
export async function latestArticleId(viewer: Viewer): Promise<string | null> {
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.tenantId, viewer.tenantId))
    .orderBy(desc(articles.updatedAt))
    .limit(1);
  return row?.id ?? null;
}


/* ---------------------------------------------------------- fact check */

export type FactCheck = { claim: string; verdict: "confirmed" | "unconfirmed" | "contradicted"; note: string; source: string | null };

const CLAIMS_PROMPT = `从这篇文章里挑出最多 8 条可以核对的具体说法：数字、日期、人名、机构、事件、引语。每条一句话，原文怎么说就怎么写。只输出 JSON：{"claims":["..."]}`;
const VERDICT_PROMPT = `你是事实核查员。下面每条说法后面附了刚搜到的资料。逐条判断：
- confirmed：资料直接支持这个说法（数字、日期、名字都对得上）
- contradicted：资料和说法不一致，写明资料怎么说
- unconfirmed：资料里找不到，不能证实也不能证伪
note 用一句简体中文说明依据；source 写资料里的媒体或页面名，没有就 null。
只输出 JSON：{"results":[{"claim":"...","verdict":"confirmed","note":"...","source":"..."}]}`;

/**
 * 核对事实 (Ryan, 2 Oct: "I want it to repeatedly verify its accuracy"):
 * the article's checkable claims, each looked up live (`search_now`), each
 * given a verdict with the evidence. Nothing is changed in the article; the
 * writer decides what to fix.
 */
export async function checkArticleFacts(viewer: Viewer, articleId: string): Promise<{ error: string } | { ok: true; results: FactCheck[] }> {
  await assertBudget(viewer);
  const [article] = await db.select({ id: articles.id, body: articles.body, title: articles.title }).from(articles).where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId))).limit(1);
  if (!article) return { error: "Not allowed" };
  if (!article.body.trim()) return { error: "文章还是空的" };
  const model = modelFor.agent("article") ?? modelFor.assistant();
  const meter = async (out: Awaited<ReturnType<typeof complete>>) =>
    recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId }).catch(() => {});

  const first = await complete({ model, temperature: 0.1, maxTokens: 1200, messages: [{ role: "system", content: CLAIMS_PROMPT }, { role: "user", content: `《${article.title}》\n\n${article.body.slice(0, 14_000)}` }] });
  await meter(first);
  const parsed = readJson<{ claims?: unknown }>(first.text);
  const claims: string[] = (Array.isArray(parsed?.claims) ? (parsed.claims as unknown[]) : []).filter((c): c is string => typeof c === "string" && c.trim().length > 3).slice(0, 8);
  if (!claims.length) return { ok: true, results: [] };

  const { runTool } = await import("@/lib/ai/tools");
  const evidence = await Promise.all(
    claims.map(async (claim) => {
      try {
        const r = await runTool(viewer, "search_now", JSON.stringify({ query: claim.slice(0, 80) }));
        return r.text.slice(0, 2500);
      } catch {
        return "（没搜到资料）";
      }
    }),
  );
  const second = await complete({
    model,
    temperature: 0.1,
    maxTokens: 2500,
    messages: [
      { role: "system", content: VERDICT_PROMPT },
      { role: "user", content: claims.map((c, i) => `## 说法 ${i + 1}\n${c}\n\n资料：\n${evidence[i]}`).join("\n\n") },
    ],
  });
  await meter(second);
  const raw = readJson<{ results?: unknown }>(second.text)?.results;
  const results: FactCheck[] = (Array.isArray(raw) ? raw : [])
    .map((r, i) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const verdict: FactCheck["verdict"] = o.verdict === "confirmed" || o.verdict === "contradicted" ? o.verdict : "unconfirmed";
      return { claim: typeof o.claim === "string" && o.claim.trim() ? o.claim.trim() : (claims[i] ?? ""), verdict, note: typeof o.note === "string" ? o.note.trim() : "", source: typeof o.source === "string" && o.source.trim() ? o.source.trim() : null };
    })
    .filter((r) => r.claim);
  return { ok: true, results: results.length ? results : claims.map((claim) => ({ claim, verdict: "unconfirmed" as const, note: "没有读到判断", source: null })) };
}

function readJson<T>(text: string): T | null {
  const m = /\{[\s\S]*\}/.exec(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}


/* ------------------------------------------------------------- polish */

const POLISH_MODEL = "moonshotai/kimi-k2.6";
const POLISH_PROMPT = `你是中文最好的文案编辑。下面是一篇文章的正文（Markdown）。逐句润色，让它像一个会写的真人写的，不像 AI 写的、也不像翻译过来的。

改什么：翻译腔（“进行……”“对于……来说”“作为一个……”“在……的同时”、长定语堆叠）、AI 腔（“首先/其次/总之/值得注意的是/不仅……而且”、“赋能/打造/重磅/颠覆”）、破折号、空洞的总结句、排比凑数。句子短一点、口语一点。
不能改：事实、数字、人名、时间、引语、段落顺序、小标题、Markdown 结构，一个都不能变，也不能加新的事实。总长度上下 15% 以内。
只输出润色后的正文，不要说明，不要加标题。`;

async function polishProse(viewer: Viewer, body: string): Promise<string> {
  if (body.length < 200 || !/[\u4e00-\u9fff]/.test(body)) return body;
  try {
    const out = await complete({ model: POLISH_MODEL, temperature: 0.3, maxTokens: 6000, user: viewer.id, messages: [{ role: "system", content: POLISH_PROMPT }, { role: "user", content: body.slice(0, 16_000) }] });
    await recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId }).catch(() => {});
    const text = out.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const ratio = text.length / body.length;
    if (!text || ratio < 0.7 || ratio > 1.35) return body;
    /* The numbers must survive the polish, every one of them. */
    const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)?%?/g) ?? []).sort().join("|");
    if (nums(text) !== nums(body)) return body;
    return text;
  } catch {
    return body;
  }
}
