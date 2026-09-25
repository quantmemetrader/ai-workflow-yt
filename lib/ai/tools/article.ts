import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import { audit } from "@/lib/audit";
import { createArticle, cutVersion, listArticles, publicationsFor } from "@/lib/article/service";
import { draftArticle, latestArticleId } from "@/lib/article/ai";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Articles, by conversation.
 *
 * "Write me a piece on the Hang Seng's worst week since March, angle: the
 * mainland money left first" is the whole brief. The Article screen can do
 * this in three fields; this is the same move in a sentence, from any screen,
 * and it lands in the Article library where the versions, the approval and the
 * publishing log already are.
 *
 * Gated on the Script module, because Article is the writing module's other
 * surface — a person who may write a script may write an article.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "write_article",
      description:
        "Write a full article into the Article library and return its link. Give the subject, and optionally the angle, the language and the tags. The article is a draft: somebody still has to approve it before it can be published. Takes about half a minute. Costs one drafting-model call.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "What it is about. Becomes the working headline." },
          angle: { type: "string", description: "The way in — the argument the piece makes. Optional." },
          language: { type: "string", description: "Chinese, English… Optional; defaults to the language of the subject." },
          tags: { type: "array", items: { type: "string" }, description: "Optional." },
          sources: { type: "string", description: "Facts the article may draw on, if you have gathered any. Optional." },
        },
        required: ["subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_articles",
      description: "The articles in the library, newest first, with their state: draft, in review, or published.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Default 15." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_article",
      description: "One article in full. Use the id from list_articles; with no id, the one most recently worked on.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "publishing_log",
      description:
        "What the studio has published and where: every article publication, newest first, with the destination, the link, who published it and whether it has since been taken down.",
      parameters: { type: "object", properties: { limit: { type: "number", description: "Default 20." } }, required: [] },
    },
  },
];

const day = (d: Date) => d.toISOString().slice(0, 10);

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "write_article") {
    const subject = str(args.subject, 300);
    if (!subject) return { text: "Say what the article is about." };

    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string").slice(0, 10) : [];
    const id = await createArticle(ctx.viewer, {
      title: subject,
      angle: str(args.angle, 400) || null,
      language: str(args.language, 40) || null,
      tags,
    });

    const res = await draftArticle(ctx.viewer, id, { sources: str(args.sources, 8000) || null });
    if ("error" in res) return { text: res.error, changed: true };

    // The first draft is a version straight away, so the thing an approver is
    // later asked about exists as a snapshot and not only as a live row.
    await cutVersion(ctx.viewer, id, { note: "first draft", model: res.model });
    await audit(ctx.viewer, "article.generate", {
      objectType: "article",
      objectId: id,
      module: "script",
      meta: { model: res.model, words: res.words },
    });

    const [row] = await db.select({ title: articles.title }).from(articles).where(eq(articles.id, id)).limit(1);
    return {
      /* The receipt, only here: a draft that failed above left an empty row
         behind, which is not an article anybody may say was written. */
      artifacts: [{ kind: "article", id, title: row?.title ?? subject, action: "created" }],
      text: [
        `Written: "${row?.title ?? subject}" — about ${res.words} words, by ${res.model}.`,
        `Open it at /article?id=${id} (id: ${id}).`,
        "It is a draft. Somebody other than the writer has to approve it before it can be published.",
      ].join("\n"),
      changed: true,
    };
  }

  if (name === "list_articles") {
    const rows = await listArticles(ctx.viewer);
    if (!rows.length) return { text: "The article library is empty." };
    return {
      text: rows
        .slice(0, Math.min(40, Math.max(1, num(args.limit, 15))))
        .map(
          (a) =>
            `- ${a.title} (id: ${a.id}) — ${a.status.replace("_", " ")}${a.wordCount ? ` · ${a.wordCount} words` : ""}${a.publications ? ` · published in ${a.publications} place(s)` : ""} · ${day(a.updatedAt)}`,
        )
        .join("\n"),
    };
  }

  if (name === "read_article") {
    const id = str(args.id, 64) || (await latestArticleId(ctx.viewer)) || "";
    const [row] = id
      ? await db
          .select()
          .from(articles)
          .where(and(eq(articles.id, id), eq(articles.tenantId, ctx.viewer.tenantId), isNull(articles.deletedAt)))
          .limit(1)
      : [];
    if (!row) return { text: "No such article. Use an id from list_articles." };
    return {
      text: [
        `# ${row.title} (${row.status.replace("_", " ")}${row.wordCount ? ` · ${row.wordCount} words` : ""})`,
        row.angle ? `Angle: ${row.angle}` : "",
        row.summary ? `Standfirst: ${row.summary}` : "",
        "",
        row.body || "(nothing written yet)",
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  if (name === "publishing_log") {
    const rows = await publicationsFor(ctx.viewer, undefined, Math.min(100, Math.max(1, num(args.limit, 20))));
    if (!rows.length) return { text: "Nothing has been published yet." };
    return {
      text: rows
        .map(
          (p) =>
            `- ${day(p.publishedAt)} · ${p.articleTitle} → ${p.destination}${p.url ? ` (${p.url})` : ""}${p.publishedBy ? ` · by ${p.publishedBy}` : ""}${p.retractedAt ? ` · TAKEN DOWN ${day(p.retractedAt)}` : ""}`,
        )
        .join("\n"),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const articlePack: ToolPack = { module: "script", defs, run };
