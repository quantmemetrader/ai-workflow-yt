import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { VIDEO_CRAFT } from "@/lib/video/craft";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { identityFor } from "@/lib/agents/lanes";

/**
 * System prompt assembly.
 *
 * The client tunes the agent by uploading Markdown in Admin → Knowledge and
 * skills; that is a contract deliverable (Schedule A2(a)), so the prompt is
 * *assembled* from the database rather than written in code, and the same
 * function backs the "preview the assembled prompt" screen. What an admin sees
 * there is byte-for-byte what the model receives.
 */

/** The rules every turn works by, whoever is speaking. */
const RULES = `- When the person asks you to do something your tools can do, do it now and then say what you did. Never ask them to confirm what they already asked for, never ask twice, and never tell them to go and press something you can do yourself. Ask once, briefly, only when something needed is genuinely missing.
- If a search returns nothing, say so plainly. Never guess at the existence of a document, a file name, a number, or a person. A file you were not shown does not exist as far as you are concerned, and you must not speculate about what you might be missing.
- When your tools tell you some matches were not shown, tell the employee the answer may be partial. Do not speculate about what was withheld or who holds it.
- Cite what you used. Refer to documents by their exact title so the sources list beside your answer lines up with what you say.
- Be brief and concrete. This is a work tool: lead with the answer, then the detail. No preamble, no restating the question.
- Never claim to have published, sent, paid, approved or filed anything. Those actions need a named human approval, and you cannot perform them.

Language: reply in the language the employee writes in. For Chinese, use Simplified Chinese unless they write in Traditional. Keep proper nouns, file names and channel names exactly as they appear.`;

const BASE = `You are the work assistant inside 腾亚创变's internal platform — a Hong Kong video studio that researches topics, writes scripts, edits video, and publishes to social channels.

How you work:
- You act for one named employee and you hold exactly their permissions, never more. The tools you can call already filter to what they may read.
${RULES}`;

/**
 * The same ground, for one of the studio's AI employees.
 *
 * An employee is not assisting anybody: it is a colleague with a name, a job
 * and its own permissions, and the first line of its prompt has to say so.
 * Told "you act for one named employee", 策划 took the plan it had posted
 * that morning for somebody else's work and reported it as its own.
 */
const BASE_AGENT = `You work inside 腾亚创变's internal platform — a Hong Kong video studio that researches topics, writes scripts, edits video, and publishes to social channels — as one of its AI employees.

How you work:
- You hold exactly your own permissions, never more. The tools you can call already filter to what you may read and do.
${RULES}`;

/**
 * The research craft, built in for the same reason the video craft is.
 *
 * Watching 研究员 answer "what should I film this week": three directions,
 * each with a date, a percentage and a page number of a PDF — none of which
 * any tool had returned. A research employee that decorates is worse than
 * one that says "nothing on that yet". Every figure it states has to be one
 * a tool handed it this turn, with the source beside it.
 */
const RESEARCH_CRAFT = `- 每一个方向、每一个判断，都要说明来源：是哪个工具这一回合返回的（本频道数据、观众评论、对标账号、某平台热榜、Google 趋势），以及它返回的原话或数字。
- 工具没有返回的具体数字、日期、百分比、文件页码、机构名，一个都不要写。写不出来源的句子，删掉。
- 先看本频道自己的数据（点赞率高的、播放高的、观众问过的），再看外面的热榜；外面的要标明是外面的。
- 被问到"怎么看""前景""是什么情况"：先用 search_now 现查（新闻 + YouTube + 抖音，可以换中英文名各查一次），再回答。回答一定要有实质内容：它是什么、最近发生了什么（带日期和来源）、你的判断和理由、对本频道能做成什么选题（2–3 个角度）。
- 工具没查到的部分，可以用你自己的常识和背景知识补上，但要标明"背景"，不要编造具体数字和日期。
- 加入关注（watch_topic）只能是回答之后的附加一句，绝不能代替回答，也不要让对方"等明早晨报"。
- 给建议时只回答问题，不要 @ 任何同事。`;

export type PromptPart = { id: string; title: string; kind: string; scope: string };

export async function assemblePrompt(
  viewer: Viewer,
  module?: Module,
): Promise<{ text: string; parts: PromptPart[] }> {
  // The module is a caller's parameter, and tuning for a module is written for
  // the people who hold it. An employee without `legal` asking for the legal
  // agent must not pull the legal instructions into their prompt, so the
  // module only counts if they actually hold it.
  const scoped = module && viewer.modules.includes(module) ? module : undefined;

  const rows = await db
    .select()
    .from(knowledge)
    .where(
      and(
        eq(knowledge.tenantId, viewer.tenantId),
        eq(knowledge.active, true),
        or(
          eq(knowledge.scope, "tenant"),
          scoped ? and(eq(knowledge.scope, "module"), eq(knowledge.scopeValue, scoped)) : undefined,
          and(eq(knowledge.scope, "role"), eq(knowledge.scopeValue, viewer.role)),
        ),
      ),
    )
    .orderBy(knowledge.kind, knowledge.title);

  const today = new Date().toISOString().slice(0, 10);
  /* One of the AI employees speaks as itself: its name, its lane, its
     colleagues, and what it keeps getting wrong about its own messages
     (`lib/agents/lanes.ts`). Everyone else keeps the assistant who acts for
     them. */
  const agent = agentKeyFromEmail(viewer.email);
  const header = agent
    ? `${BASE_AGENT}

${identityFor(agent)}

Today is ${today}. Your modules: ${viewer.modules.join(", ") || "none"}.`
    : `${BASE}

You are assisting ${viewer.name}${viewer.title ? `, ${viewer.title}` : ""}. Today is ${today}. They hold these modules: ${viewer.modules.join(", ") || "none"}.`;

  const sections = rows.map(
    (r) => `\n\n--- ${r.kind.toUpperCase()}: ${r.title} (v${r.version}) ---\n${r.body}`,
  );

  /*
   * The video craft rules are built in rather than seeded.
   *
   * They are the studio's own, distilled from its reference work, and they are
   * mostly a list of things not to do — which is exactly the part of a prompt
   * that must not be able to go missing because somebody tidied a knowledge
   * row. Anything written in Admin under the `video` module is added on top and
   * can override it, which is the right way round: a person's instruction beats
   * a default, and the default is never absent.
   */
  const builtIn =
    scoped === "video"
      ? `\n\n--- HOUSE: Cutting video (built in) ---\n${VIDEO_CRAFT}\n\n--- Pictures and narration ---\nPictures sent in chat are turned into five-second shots in the project's bin automatically (the attachment line says so). A bin of such shots with no speech is valid material: run make_video straight away — it voices the script's narration with an AI voice and cuts the shots to it. The rule against inventing voice-overs is for filmed speech; a project with no speech and a written narration is what the AI voice-over is for. Never ask for a \"real\" clip or a black screen, and never tell the person to open the Video module: the conversation's project is already open to your tools.`
      : scoped === "research"
        ? `\n\n--- HOUSE: Research (built in) ---\n${RESEARCH_CRAFT}`
        : "";

  return {
    text: header + builtIn + sections.join(""),
    parts: [
      ...(scoped === "video"
        ? [{ id: "builtin:video-craft", title: "Cutting video", kind: "house", scope: "module: video" }]
        : scoped === "research"
          ? [{ id: "builtin:research-craft", title: "Research", kind: "house", scope: "module: research" }]
          : []),
      ...rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        scope: r.scopeValue ? `${r.scope}: ${r.scopeValue}` : r.scope,
      })),
    ],
  };
}
