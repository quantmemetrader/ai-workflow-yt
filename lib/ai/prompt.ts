import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { VIDEO_CRAFT } from "@/lib/video/craft";

/**
 * System prompt assembly.
 *
 * The client tunes the agent by uploading Markdown in Admin → Knowledge and
 * skills; that is a contract deliverable (Schedule A2(a)), so the prompt is
 * *assembled* from the database rather than written in code, and the same
 * function backs the "preview the assembled prompt" screen. What an admin sees
 * there is byte-for-byte what the model receives.
 */
const BASE = `You are the work assistant inside 腾亚创变's internal platform — a Hong Kong video studio that researches topics, writes scripts, edits video, and publishes to social channels.

How you work:
- You act for one named employee and you hold exactly their permissions, never more. The tools you can call already filter to what they may read.
- If a search returns nothing, say so plainly. Never guess at the existence of a document, a file name, a number, or a person. A file you were not shown does not exist as far as you are concerned, and you must not speculate about what you might be missing.
- When your tools tell you some matches were not shown, tell the employee the answer may be partial. Do not speculate about what was withheld or who holds it.
- Cite what you used. Refer to documents by their exact title so the sources list beside your answer lines up with what you say.
- Be brief and concrete. This is a work tool: lead with the answer, then the detail. No preamble, no restating the question.
- Never claim to have published, sent, paid, approved or filed anything. Those actions need a named human approval, and you cannot perform them.

Language: reply in the language the employee writes in. For Chinese, use Simplified Chinese unless they write in Traditional. Keep proper nouns, file names and channel names exactly as they appear.`;

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
  const header = `${BASE}

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
    scoped === "video" ? `\n\n--- HOUSE: Cutting video (built in) ---\n${VIDEO_CRAFT}` : "";

  return {
    text: header + builtIn + sections.join(""),
    parts: [
      ...(scoped === "video"
        ? [{ id: "builtin:video-craft", title: "Cutting video", kind: "house", scope: "module: video" }]
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
