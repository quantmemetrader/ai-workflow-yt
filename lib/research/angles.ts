import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { seriesCache, topics } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { houseStyle } from "@/lib/script/ai";

/**
 * Angles for a topic, from what the sources actually published.
 *
 * The detail pane has said "No angles yet. Ask your agent to suggest some from
 * what it has read" since the artboard was transcribed, and there was no way
 * to ask: `topics.angles` was read in four places and written in none. This is
 * the missing half.
 *
 * It reads only the headlines already cached for the phrase — the same ones
 * the pane lists under "links to primary sources". Nothing is fetched here, so
 * the answer is about what the studio has in front of it, and a model that
 * invents a story has nowhere to hide: every angle has to stand on a headline
 * a reader can click.
 */
const PROMPT = `You help a Hong Kong video studio decide what to make about a subject in the news.

You are given a phrase the studio watches and the headlines collected for it.

Answer with a single JSON object and nothing else. Do not explain your
reasoning, do not show your working, and do not write anything before or after
the object — the first character of your answer must be an opening brace.

The shape:
{
  "summary": "one sentence, under 30 words, on what is actually happening",
  "angles": ["3 to 5 angles, each under 14 words"]
}

Rules:
 - Every angle must be supported by at least one of the headlines. If the
   headlines do not support an angle, do not write it.
 - An angle is a way in, not a topic: "Why TSMC's 2nm delay hits phone prices",
   not "TSMC news".
 - No clickbait, no questions as titles, no "you won't believe".
 - If the headlines are too thin to say anything, return {"summary": "", "angles": []}.`;

export async function suggestAngles(
  viewer: Viewer,
  topicId: string,
): Promise<{ angles: string[]; summary: string | null } | { error: string }> {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)))
    .limit(1);
  if (!topic) return { error: "Topic not found" };

  const [cached] = await db
    .select()
    .from(seriesCache)
    .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
    .limit(1);

  const articles = cached?.articles ?? [];
  if (articles.length === 0) {
    return {
      error: "Nothing has been collected for this topic yet — angles would be invented, not read.",
    };
  }

  const style = await houseStyle(viewer);
  const headlines = articles
    .slice(0, 40)
    .map((a) => `- ${a.title} (${a.domain}, ${a.at.slice(0, 10)})`)
    .join("\n");

  const out = await complete({
    model: modelFor.assistant(),
    temperature: 0.6,
    /*
     * Room for a reasoning model to think first.
     *
     * The assistant model on this deployment is a free reasoning model, and it
     * writes its working before its answer whatever the prompt says. At 700
     * tokens it used the whole budget on the thinking and the JSON never
     * arrived — which read, wrongly, as "too little has been collected". The
     * thinking is thrown away in `parse`; it just has to fit first.
     */
    maxTokens: 2400,
    messages: [
      {
        role: "system",
        content: PROMPT + (style.text ? `\n\nThe studio's house style:\n${style.text}` : ""),
      },
      {
        role: "user",
        content: `Phrase: ${topic.name}${topic.name === topic.query ? "" : ` (searched as "${topic.query}")`}\n\nHeadlines:\n${headlines}`,
      },
    ],
  });

  await recordUsage({
    viewer,
    module: "research",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const parsed = parse(out.text);
  if (!parsed) return { error: "The model did not answer in a shape we could read." };
  if (parsed.angles.length === 0) {
    return { error: "Too little has been collected to say anything worth making." };
  }

  await db
    .update(topics)
    .set({
      angles: parsed.angles,
      // A summary already written by hand is not overwritten by a guess.
      ...(topic.summary ? {} : parsed.summary ? { summary: parsed.summary } : {}),
    })
    .where(eq(topics.id, topicId));

  await audit(viewer, "topic.angles", {
    objectType: "topic",
    objectId: topicId,
    module: "research",
    meta: { model: out.model, angles: parsed.angles.length },
  });

  return { angles: parsed.angles, summary: topic.summary ?? parsed.summary ?? null };
}

/**
 * The JSON out of the answer, however it was wrapped.
 *
 * Three things arrive in practice: the bare object, the object inside a
 * ```json fence, and the object after a page of the model reasoning aloud. The
 * last one is why this scans from the end: the thinking often contains braces
 * of its own ("a JSON object with {summary, angles}"), and the answer is the
 * last complete object in the text, not the first thing that looks like one.
 */
function parse(text: string): { summary: string | null; angles: string[] } | null {
  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const raw = candidate(fenced ? fenced[1] : body);
  if (raw === null) return null;
  const obj = raw as { summary?: unknown; angles?: unknown };
  const angles = Array.isArray(obj.angles)
    ? obj.angles
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.length <= 160)
        .slice(0, 5)
    : [];
  const summary =
    typeof obj.summary === "string" && obj.summary.trim().length > 0 ? obj.summary.trim().slice(0, 300) : null;
  return { summary, angles };
}

/** The last complete `{…}` in a piece of text, parsed, or null. */
function candidate(text: string): Record<string, unknown> | null {
  for (let end = text.lastIndexOf("}"); end !== -1; end = text.lastIndexOf("}", end - 1)) {
    // Walk back to each opening brace before this one and take the first that
    // parses. The right object is the shortest one that does.
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") {
        depth--;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(i, end + 1)) as unknown;
            if (typeof value === "object" && value !== null && "angles" in value) {
              return value as Record<string, unknown>;
            }
          } catch {
            // Not it; keep walking outwards.
          }
          break;
        }
      }
    }
  }
  return null;
}
