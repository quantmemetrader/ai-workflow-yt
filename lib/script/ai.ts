import "server-only";
import { toSimplified } from "@/lib/text/simplified";
import { HUMAN_STYLE_ZH, humanize } from "@/lib/text/human";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, scriptBeats, scripts } from "@/lib/db/schema";
import { complete } from "@/lib/ai/openrouter";
import { disclosureForWriting } from "@/lib/ai/disclosure";
import { modelFor } from "@/lib/ai/models";
import { recordUsage, assertBudget } from "@/lib/ai/ledger";
import { searchFiles, type Hit } from "@/lib/ai/retrieval";
import { creatorVoiceText } from "@/lib/creator/service";
import { trainingFor, type TrainKey } from "@/lib/agents/training";
import type { Viewer } from "@/lib/auth/dal";
import { measure, replaceSuggestions, saveBeats, spokenSeconds } from "./service";

/**
 * Writing and checking scripts (spec §4.4).
 *
 * House style is a **prompt and a corpus**, not a fine-tune — the brief is
 * explicit about that, and it is also the only version that a studio can
 * change on a Tuesday afternoon. The style guide lives in the `knowledge`
 * table (Admin, "Knowledge and skills"), and the examples come from the
 * approved scripts the writer is allowed to read, through the same
 * permission-filtered retrieval the agent uses. A writer never sees an
 * "approved example" drawn from a file they have no access to.
 *
 * Every call here is metered and budget-checked like any other (spec §5).
 */

/**
 * The active house-style guide, assembled from the knowledge table, with
 * what the team taught the writer on AI 训练 (`lib/agents/training.ts`)
 * after it — 文案's for scripts, 撰稿人's when the article writer asks. So
 * every draft, rewrite and check here follows the same instructions and
 * learns from the same examples.
 */
export async function houseStyle(viewer: Viewer, who: TrainKey = "script"): Promise<{ text: string; version: string | null }> {
  const [rows, training] = await Promise.all([houseRows(viewer), trainingFor(viewer.tenantId, who)]);
  const text = [rows.map((r) => `## ${r.title}\n${r.body}`).join("\n\n"), training.text].filter(Boolean).join("\n\n");
  const style = rows.find((r) => r.kind === "style");
  return { text, version: style ? `v${style.version}` : null };
}

async function houseRows(viewer: Viewer) {
  return db
    .select({ title: knowledge.title, body: knowledge.body, version: knowledge.version, kind: knowledge.kind })
    .from(knowledge)
    .where(
      and(
        eq(knowledge.tenantId, viewer.tenantId),
        eq(knowledge.active, true),
        eq(knowledge.scope, "module"),
        eq(knowledge.scopeValue, "script"),
      ),
    );
}

/**
 * Approved reference scripts the writer may read, as examples.
 *
 * `searchFiles` filters by the *writer's* own access, not by the module's, so
 * a house-style example can never be drawn from a document the person asking
 * cannot open. The `withheld` count it returns is deliberately ignored here:
 * telling a writer that examples exist which they may not see would leak the
 * fact of them.
 */
async function examples(viewer: Viewer, query: string): Promise<string> {
  const found = await searchFiles(viewer, query, 4).catch(() => ({ hits: [] as Hit[], withheld: 0 }));
  if (!found.hits.length) return "";
  return found.hits.map((f) => `### ${f.name}\n${f.snippet.slice(0, 1200)}`).join("\n\n");
}

const DRAFT_PROMPT = `你是一名顶级的中文短视频文案，给一家香港视频工作室写口播脚本（抖音、小红书、视频号、YouTube Shorts）。你写的稿子要像真人在镜头前说话，观众听完第一句就想看下去。

一律用简体中文，不用繁体字（简报或资料是繁体的，也改成简体）。

脚本由若干分镜组成，每个分镜三部分：
- "visual"：画面。镜头、景别、画面上的字；用了别人的素材要注明出处
- "voiceover"：口播，真正要说出口的话
- "subtitle"：字幕，一般和口播一样

只输出一个 JSON 对象，不要写别的：
{ "beats": [ { "visual": "...", "voiceover": "...", "subtitle": "...", "naturalSound": false } ] }

怎么写才像真人：
- 说人话。一句话尽量不超过 20 个字，一句只讲一件事。读出来顺口，像跟朋友聊天，不像念新闻稿。
- 开头三秒定生死：用一个反常识的事实、一个具体数字、一个扎心的问题，或者一个画面开场。不要“大家好”“今天我们来聊聊”。
- 每个观点都要落地：给数字、给例子、给后果，让观众看得见、记得住。不写空话，不写“很多人”“最近”“非常重要”。
- 节奏有起伏：短句为主，偶尔一句稍长的；关键处停一下，留一句让人想截图的话。
- 结尾给一个具体的互动，只要一个：抛一个让人忍不住想回答的问题，或一句让人想转发的话。不要“喜欢的话点赞关注”这种套话。
- 前后观点要一致，不要前面说 A、后面又说反话；称呼观众的方式全稿统一。

绝对不要（一出现就是 AI 味或翻译腔）：
- 破折号（——、—）。要停顿，用逗号或句号。
- “首先、其次、最后、总之、综上所述、值得注意的是、不仅……而且……、让我们、一起来看看”
- “赋能、助力、打造、深度解析、全方位、一站式、颠覆性、革命性、重磅”这类空洞大词
- 翻译腔：“进行……”“对于……来说”“被……所……”“作为一个……”“这是一个……的时代”“在……的同时”，以及一长串定语堆在名词前面
- 排比凑数、每段结尾都总结一句、感叹号连用
- “不是……而是……”“不是 A，是 B”这种句式，全稿最多用一次
- 口号式的金句和套话：“拐点”“王道”“永远是第一位的”“战略性的”“跑得快……走得远”这类
- 夸大或拿不准的说法：事实没有把握就说得保守一点，不用夸张的比喻和编出来的数字

其他规则：
- 按目标时长写：口播大约每秒 4.5 个汉字（英文每秒 2.6 个词）。写完整的视频稿，不是提纲，也不是摘要。
- 第一个分镜通常是画面开场：naturalSound 设为 true，voiceover 留空。
- 标题就是这条视频要讲的事：全稿围绕它展开，开头就点题，不要拐去讲别的话题。
- 简报里列出的必讲要点，全部讲到。
- 不编造事实、人名、日期、引语和数字。简报和资料里没有的事实，就不写。`;

/**
 * The polish pass: a second editor with strong Chinese goes over every spoken
 * line of a fresh draft (the owner, 2 Oct: the scripts "feel too AI" and the
 * Chinese reads like a translation). Facts, numbers, order and length stay;
 * only the wording changes. A failure leaves the draft as it was.
 */
const POLISH_PROMPT = `你是中文短视频行业最贵的文案编辑。下面是一份口播稿，已经按分镜编好号。请逐条润色口播，让它听起来像一个会说话的真人在镜头前讲，而不是 AI 写的、也不是翻译过来的。

改什么：
- 去掉翻译腔：“进行……”“对于……来说”“被……所……”“作为一个……”“在……的同时”、长定语堆叠，改成中国人平时说话的说法。
- 去掉 AI 腔：“首先/其次/最后/总之/值得注意的是/让我们/不仅……而且……”、“赋能/打造/重磅/颠覆/全方位”这类大词、空洞的总结句。
- “不是……而是……”“不是 A，是 B”全稿最多保留一次，多的改成直接陈述。
- 口号式金句和套话（拐点、王道、战略性、跑得快走得远）改成具体的话；结尾只留一个互动问题。
- 不要破折号（——、—），停顿用逗号或句号。
- 句子短一点、口语一点、有节奏；该有画面感的地方，换成具体的词。
- 前后说法不能打架：如果某一条和前面的说法矛盾，改成和前文一致的说法（不加新事实）。

不能改：
- 事实、数字、人名、时间、引用和每条的意思，一个都不能变，也不能加新的事实。
- 条数和顺序不变，不合并、不拆分；每条长度和原来差不多（上下 15% 以内）。
- 一律简体中文。

只输出一个 JSON 对象，只列出改了的条目：
{"lines":[{"i":条目编号,"voiceover":"润色后的整条口播"}]}`;

type DraftBeat = { visual: string; voiceover: string; subtitle: string; naturalSound: boolean };

/**
 * The length a draft is written to when the brief sets none: three minutes,
 * about 800 characters. With no target the model stopped at 30–60 seconds —
 * "not enough for video creation" (the owner, 29 Sep).
 */
export const DEFAULT_TARGET_SECONDS = 180;

/**
 * Writes a draft from the brief.
 *
 * Replaces the working beats wholesale, which is what "Generate v5 from brief"
 * on the artboard means. The version that was there is not lost: the caller
 * cuts a version first, and every version is immutable.
 */
export async function draftFromBrief(
  viewer: Viewer,
  scriptId: string,
  /**
   * What the writer has in front of them beyond the brief: the headlines a
   * research topic collected, a note somebody pasted. Facts the model may
   * use, listed so it does not have to invent any.
   */
  opts: { sources?: string; instruction?: string; /** A model to use instead of the writer's own (a retry after an empty answer). */ model?: string } = {},
) {
  await assertBudget(viewer);

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return { error: "Not allowed" };
  if (script.lockedVersion !== null) return { error: "That script is locked." };

  const [style, refs, voice] = await Promise.all([
    houseStyle(viewer),
    examples(viewer, script.title),
    creatorVoiceText(viewer.tenantId),
  ]);
  const model = opts.model ?? modelFor.agent("script") ?? modelFor.drafting();

  const brief = [
    `标题：${script.title}`,
    script.angle ? `切入角度：${script.angle}` : null,
    script.targetChannel ? `平台：${script.targetChannel}${script.aspect ? `（${script.aspect}）` : ""}` : null,
    `目标时长：${formatDuration(script.targetSeconds ?? DEFAULT_TARGET_SECONDS)}（上下 ${script.tolerancePercent}%），口播一共大约 ${Math.round((script.targetSeconds ?? DEFAULT_TARGET_SECONDS) * 4.5)} 个汉字（英文约 ${Math.round((script.targetSeconds ?? DEFAULT_TARGET_SECONDS) * 2.6)} 个词），分镜要够把故事讲完`,
    script.language ? `口播语言：${script.language}` : null,
    script.subtitleLanguage ? `字幕语言：${script.subtitleLanguage}` : null,
    script.mandatoryPoints.length ? `必须讲到：\n${script.mandatoryPoints.map((p) => `- ${p}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete({
    model,
    temperature: 0.7,
    /* Room to think and still write: the drafting model reasons first, and at
       4,000 it spent the lot thinking and wrote nothing (4 Oct, a 3-minute wait). */
    maxTokens: 14000,
    messages: [
      {
        role: "system",
        content:
          DRAFT_PROMPT +
          `\n\n${disclosureForWriting(model)}` +
          `\n\n${HUMAN_STYLE_ZH}` +
          (voice ? `\n\n这条视频是给这位创作者的，下面是他自己频道的内容，说话要像他：\n${voice}` : "") +
          (style.text ? `\n\n工作室的写作规范：\n${style.text}` : ""),
      },
      {
        role: "user",
        content: [
          opts.instruction ? `提出这条需求的同事是这样说的，照着做（提到范例或附件的，就照它的写法来写）：\n${opts.instruction.slice(0, 1500)}` : null,
          brief,
          opts.sources ? `可以用的事实和新闻（用到哪条，就在画面里注明出处；不要超出这些资料）：\n${opts.sources}` : null,
          refs ? `已经批准的脚本，语气照这些来：\n${refs}` : null,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  let beats = parseBeats(out.text);
  if (!beats.length) return { error: "The model did not return a script we could read." };

  /*
   * Measured, not trusted. A three-minute brief came back as forty-five
   * seconds of voice-over more often than not: the model writes to the number
   * of beats it likes and stops. When the draft is well short of the target,
   * one more pass asks for the rest — the same facts, more of them said —
   * rather than handing over a script that the header at once marks −135 s.
   */
  const target = script.targetSeconds ?? DEFAULT_TARGET_SECONDS;
  const spoken = (list: DraftBeat[]) => list.reduce((sum, b) => sum + (b.naturalSound ? 0 : spokenSeconds(b.voiceover)), 0);
  if (target && target >= 45 && spoken(beats) < target * 0.6) {
    const have = Math.round(spoken(beats));
    const more = await complete({
      model,
      temperature: 0.7,
      maxTokens: 14000,
      messages: [
        {
          role: "system",
          content:
            DRAFT_PROMPT +
            (voice ? `\n\n这条视频是给这位创作者的，下面是他自己频道的内容，说话要像他：\n${voice}` : "") +
            (style.text ? `\n\n工作室的写作规范：\n${style.text}` : ""),
        },
        {
          role: "user",
          content: [
            brief,
            opts.sources ? `可以用的事实和新闻（不要超出这些资料）：\n${opts.sources}` : null,
            `这是初稿，口播大约 ${formatDuration(have)}，目标是 ${formatDuration(target)}。把它写到足够的长度：事实和顺序都保留，每个点多讲一些细节、数字、后果和例子，故事有空间的地方加分镜。用同样的 JSON 格式输出完整的脚本。`,
            JSON.stringify({ beats }),
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    await recordUsage({
      viewer,
      module: "script",
      provider: more.provider ?? "openrouter",
      model: more.model,
      promptTokens: more.promptTokens,
      completionTokens: more.completionTokens,
      costMicros: more.costMicros,
      requestId: more.requestId,
    });
    const longer = parseBeats(more.text);
    // Only a genuinely longer draft replaces the first; a refusal or a
    // truncated answer leaves the short one, which is at least complete.
    if (longer.length && spoken(longer) > spoken(beats) * 1.2) beats = longer;
  }

  beats = await polishBeats(viewer, beats, script.language ?? null);
  await saveBeats(viewer, scriptId, beats);
  return { ok: true, beats: beats.length, model: out.model };
}

/** Every spoken line of a fresh draft, edited for native, human Chinese (`POLISH_PROMPT`). */
async function polishBeats(viewer: Viewer, beats: DraftBeat[], language: string | null): Promise<DraftBeat[]> {
  if (language && !/zh|中文|普通话|国语|粤语|mandarin|chinese|cantonese/i.test(language)) return beats;
  const lines = beats.map((b, i) => ({ i, v: b.voiceover })).filter((x) => x.v.trim());
  if (!lines.length) return beats;
  try {
    const out = await complete({
      model: modelFor.drafting(),
      temperature: 0.4,
      maxTokens: 14000,
      messages: [
        { role: "system", content: POLISH_PROMPT },
        { role: "user", content: lines.map((x) => `[${x.i}] ${x.v}`).join("\n") },
      ],
    });
    await recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/```(?:json)?/g, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return beats;
    const raw = JSON.parse(text.slice(start, end + 1)) as { lines?: { i?: unknown; voiceover?: unknown }[] };
    const next = beats.map((b) => ({ ...b }));
    for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
      const b = next[Number(l.i)];
      const v = typeof l.voiceover === "string" ? humanize(toSimplified(l.voiceover.trim())) : "";
      if (!b || !v || !b.voiceover.trim()) continue;
      const ratio = v.length / Math.max(1, b.voiceover.length);
      if (ratio < 0.7 || ratio > 1.35) continue;
      const sameSubtitle = !b.subtitle.trim() || b.subtitle.trim() === b.voiceover.trim();
      b.voiceover = v;
      if (sameSubtitle) b.subtitle = v;
    }
    return next;
  } catch (err) {
    console.warn("[script] polish skipped:", err instanceof Error ? err.message : err);
    return beats;
  }
}

const CONFORM_PROMPT = `You check a shooting script against a Hong Kong video studio's house style, beat by beat.

Answer with a single JSON object and nothing else:
{
  "conformance": 0-100,
  "readingLevel": e.g. "Grade 8",
  "suggestions": [
    {
      "beatOrd": the beat's number, or null for the script as a whole,
      "kind": one of "house_style" | "length" | "register" | "clarity" | "sound_direction" | "fact_check",
      "label": two or three words, e.g. "time of day",
      "before": the exact text to replace, copied verbatim from the beat, or null,
      "after": what to replace it with, or null,
      "rationale": one sentence naming the rule and, where you can, the evidence for it
    }
  ]
}

Rules:
- "before" must appear **verbatim** in that beat, or the suggestion cannot be applied. If you cannot quote it exactly, set both "before" and "after" to null and make it an observation.
- Sound directions written into the voice-over column get kind "sound_direction": they belong in the shot list, not in what is spoken.
- Be specific. "Could be clearer" is not a suggestion. "morning light" → "at 6:40 am" is.
- At most twelve suggestions. Rank the ones that change meaning above the ones that change taste.
- Do not suggest changes that would break a mandatory point the brief requires.`;

/**
 * Scores the draft against the guide and writes the suggestion list.
 *
 * The score is the model's, and the screen says which guide version it was
 * scored against, so "was 76 at v3" is a comparison rather than a vibe.
 */
export async function checkConformance(viewer: Viewer, scriptId: string) {
  await assertBudget(viewer);

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return { error: "Not allowed" };

  const beats = await db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  if (!beats.length) return { error: "There is nothing to check yet." };

  const style = await houseStyle(viewer);
  const model = modelFor.utility();
  const m = measure(beats, script);

  const body = beats
    .map(
      (b) =>
        `Beat ${b.ord}${b.naturalSound ? " (natural sound)" : ""}\nVisual: ${b.visual}\nVoice-over: ${b.voiceover}\nSubtitle: ${b.subtitle}`,
    )
    .join("\n\n");

  const context = [
    script.targetSeconds
      ? `Target duration ${formatDuration(script.targetSeconds)}, currently ${formatDuration(Math.round(m.spokenSeconds))}.`
      : null,
    script.mandatoryPoints.length ? `Must cover: ${script.mandatoryPoints.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete({
    model,
    temperature: 0.2,
    maxTokens: 8000,
    messages: [
      { role: "system", content: CONFORM_PROMPT + (style.text ? `\n\nThe house style:\n${style.text}` : "") },
      { role: "user", content: [context, body].filter(Boolean).join("\n\n") },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const parsed = parseConformance(out.text);
  if (!parsed) return { error: "The check did not come back in a form we could read." };

  // A suggestion whose `before` is not actually in its beat cannot be applied,
  // and offering an Accept button that would do nothing is worse than not
  // offering one. Those are kept as observations instead.
  const byOrd = new Map(beats.map((b) => [b.ord, b]));
  const cleaned = parsed.suggestions.map((s) => {
    const beat = s.beatOrd === null ? null : byOrd.get(s.beatOrd);
    const quoted =
      s.before !== null &&
      beat !== undefined &&
      beat !== null &&
      (beat.voiceover.includes(s.before) || beat.subtitle.includes(s.before) || beat.visual.includes(s.before));
    return quoted ? s : { ...s, before: null, after: null };
  });

  await replaceSuggestions(scriptId, cleaned, out.model);

  return {
    ok: true,
    conformance: parsed.conformance,
    readingLevel: parsed.readingLevel,
    guideVersion: style.version,
    suggestions: cleaned.length,
    model: out.model,
  };
}

const REWRITE_PROMPT = `You rewrite one passage of a shooting script for a Hong Kong video studio.

Answer with the rewritten passage alone. No quotes, no preamble, no explanation, no markdown. Keep the same language and the same speaker. Do not add facts that were not in the original.`;

/** "Rewrite selection" and the Shorter / Warmer / More formal / 转做书面语
 * buttons: one passage, one instruction, the text back. */
export async function rewriteSelection(viewer: Viewer, selection: string, instruction: string) {
  await assertBudget(viewer);

  const style = await houseStyle(viewer);
  const model = modelFor.utility();

  const out = await complete({
    model,
    temperature: 0.6,
    maxTokens: 800,
    messages: [
      { role: "system", content: REWRITE_PROMPT + (style.text ? `\n\nThe house style:\n${style.text}` : "") },
      { role: "user", content: `Instruction: ${instruction}\n\nPassage:\n${selection.slice(0, 4000)}` },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const text = out.text.trim();
  if (!text) return { error: "The model returned nothing." };
  return { ok: true, text, seconds: spokenSeconds(text), model: out.model };
}

/* ------------------------------------------------------------- parsing */

function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 20000): string => (typeof v === "string" ? v.slice(0, max) : "");

function parseBeats(text: string): DraftBeat[] {
  const raw = jsonIn(text);
  const list = raw?.beats;
  if (!Array.isArray(list)) return [];

  return list
    .slice(0, 200)
    .map((b) => {
      const o = b as Record<string, unknown>;
      return {
        visual: humanize(str(o.visual, 5000)).replace(/^\s*(画面|镜头)\s*[：:]\s*/, ""),
        voiceover: humanize(str(o.voiceover)),
        subtitle: humanize(str(o.subtitle)),
        naturalSound: o.naturalSound === true,
      };
    })
    .filter((b) => b.visual || b.voiceover || b.subtitle);
}

type ParsedSuggestion = {
  beatOrd: number | null;
  kind: "house_style" | "length" | "register" | "clarity" | "sound_direction" | "fact_check";
  label: string;
  before: string | null;
  after: string | null;
  rationale: string | null;
};

const KINDS = ["house_style", "length", "register", "clarity", "sound_direction", "fact_check"] as const;

function parseConformance(
  text: string,
): { conformance: number | null; readingLevel: string | null; suggestions: ParsedSuggestion[] } | null {
  const raw = jsonIn(text);
  if (!raw) return null;

  const score = Number(raw.conformance);
  const list = Array.isArray(raw.suggestions) ? raw.suggestions : [];

  return {
    conformance: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    readingLevel: typeof raw.readingLevel === "string" ? raw.readingLevel.slice(0, 40) : null,
    suggestions: list.slice(0, 12).map((s): ParsedSuggestion => {
      const o = s as Record<string, unknown>;
      const ord = Number(o.beatOrd);
      const kind = String(o.kind ?? "");
      return {
        beatOrd: Number.isInteger(ord) ? ord : null,
        kind: (KINDS as readonly string[]).includes(kind) ? (kind as ParsedSuggestion["kind"]) : "clarity",
        label: str(o.label, 120) || "suggestion",
        before: typeof o.before === "string" && o.before ? o.before.slice(0, 2000) : null,
        after: typeof o.after === "string" && o.after ? o.after.slice(0, 2000) : null,
        rationale: typeof o.rationale === "string" && o.rationale ? o.rationale.slice(0, 600) : null,
      };
    }),
  };
}

/** "3:45", the way the artboard writes a duration. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
