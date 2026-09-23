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

const ARTICLE_PROMPT = `You write finance and current-affairs commentary for a Hong Kong studio.

Answer with a single JSON object and nothing else:
{ "title": "...", "summary": "...", "body": "..." }

  "title"   the headline. Plain, concrete, no colon-subtitle, no clickbait.
  "summary" one or two sentences under the headline: what the piece argues and why now.
  "body"    the article itself, in Markdown. Use "## " subheadings, short paragraphs,
            and lists only where a list is genuinely the clearest form.

Rules:
- Write in the language the brief asks for. When it does not say, write in the language of the title.
- Lead with the thing that happened, not with background. The first paragraph earns the second.
- Name concrete things: an hour, a street, a number, a person, a filing. Never "recently", never "many people".
- An argument, not a summary of the news. Say what it means and what follows, and be willing to be wrong in public.
- Do not invent facts, names, dates, quotes or figures. If the brief does not give you a fact, write without it.
- Attribute every figure and quote to the source the brief names.
- No headline in the body: the body starts at the first paragraph.`;

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
    houseStyle(viewer),
    examples(viewer, article.title),
    creatorVoiceText(viewer.tenantId),
    article.scriptId ? scriptText(viewer, article.scriptId) : Promise.resolve(""),
  ]);

  const model = modelFor.drafting();
  const brief = [
    `Headline to work from: ${article.title}`,
    article.angle ? `Angle: ${article.angle}` : null,
    article.summary ? `Standfirst so far: ${article.summary}` : null,
    article.language ? `Language: ${article.language}` : null,
    article.tags.length ? `Tags: ${article.tags.join(", ")}` : null,
    opts.instruction ? `This pass, specifically: ${opts.instruction}` : null,
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
          fromScript ? `The studio's own script on this subject. These are the facts and the order they were told in:\n${fromScript}` : null,
          opts.sources ? `Further facts you may draw on (do not go beyond them):\n${opts.sources}` : null,
          article.body.trim() ? `What is written so far — rewrite it rather than starting over:\n${article.body.slice(0, 12_000)}` : null,
          refs ? `Approved work to match in tone:\n${refs}` : null,
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

  const drafted = parseArticle(out.text);
  if (!drafted || !drafted.body.trim()) return { error: "The model did not return an article we could read." };

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
