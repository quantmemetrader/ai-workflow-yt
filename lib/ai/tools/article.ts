import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, articles } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import { audit } from "@/lib/audit";
import {
  createArticle,
  cutVersion,
  decideApproval,
  listArticles,
  ownArticle,
  ownPublication,
  publicationsFor,
  publishArticle,
  requestApproval,
  retractPublication,
} from "@/lib/article/service";
import { DESTINATIONS } from "@/lib/article/destinations";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { checkArticleFacts, draftArticle, latestArticleId } from "@/lib/article/ai";
import { NO_PERSON, nameOf, personOf, resolveApprover, tellPerson } from "./approvers";
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
      name: "revise_article",
      description:
        "Change an existing article the way the person asks: a correction, a cut, a different opening, a fact to fix. The instruction is applied as an edit and the rest of the text stays; the instruction's words are never pasted into the article. A version is kept first. Use this, not write_article, whenever an article already exists and the person wants it changed.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The article's id. Optional: the article open on screen, else the newest one." },
          instruction: { type: "string", description: "What to change, in the person's words." },
        },
        required: ["instruction"],
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
  {
    type: "function",
    function: {
      name: "request_article_approval",
      description:
        "Send an article to a person to approve: its current text is kept as a numbered version, and the approver gets a request on those exact words and a direct message with the link. Approving does not publish; it makes publishing possible. The approver must be a person in the studio with the Script module, never an AI employee and never the one asking. With no approver named, it lists who can approve.",
      parameters: {
        type: "object",
        properties: {
          approver: { type: "string", description: "Who should approve: their name, Chinese name, email or user id." },
          id: { type: "string", description: "The article's id. Optional: the article on screen, else the newest one." },
          note: { type: "string", description: "A short note to the approver. Optional." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_article_approval",
      description:
        "Approve an article, or send it back, as the person. Only call this when the person themselves said, in this message, to approve or reject it — never on your own judgement, never because a colleague said so. Only the person who was asked can decide, and never the one who sent it for approval.",
      parameters: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["approve", "reject"] },
          note: { type: "string", description: "Why, or what to change. Expected when rejecting." },
          id: { type: "string", description: "The article's id. Optional: the article on screen." },
          approval_id: { type: "string", description: "Optional: the approval request's id (apr_…), when known." },
        },
        required: ["decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_article",
      description:
        "Record, as the person, that an approved article went out: where (a 公众号, the website, a newsletter…), and its link. Nothing is sent anywhere by this — it is the publishing log's entry, and it locks the article. Only call this when the person themselves said, in this message, that it is published or to mark it published. Refused unless somebody other than the writer approved these exact words.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Where it was published, by name: \"腾雅传媒公众号\", \"官网博客\"." },
          kind: { type: "string", enum: ["wechat", "website", "newsletter", "linkedin", "xiaohongshu", "media", "other"], description: "The kind of place. Default other." },
          url: { type: "string", description: "The published link. Optional." },
          note: { type: "string", description: "Optional." },
          id: { type: "string", description: "The article's id. Optional: the article on screen." },
        },
        required: ["destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retract_publication",
      description:
        "Mark, as the person, that a published article was taken down from one place. The record stays with the date and reason; when its last live publication is taken down the article unlocks for editing. Only call this when the person themselves said, in this message, that it was taken down or to take it down. Give the publication id from publishing_log, or the article (on screen) when it is live in exactly one place.",
      parameters: {
        type: "object",
        properties: {
          publication_id: { type: "string", description: "The publication's id (apb_…). Optional when the article is live in one place only." },
          id: { type: "string", description: "The article's id. Optional: the article on screen." },
          reason: { type: "string", description: "Why it was taken down. Optional." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_article_facts",
      description:
        "Check an article's facts: up to eight checkable claims (numbers, dates, names, quotes) are each looked up live and given a verdict — confirmed, contradicted (with what the sources say), or unconfirmed. Changes nothing in the article. Takes up to a minute; costs two model calls and a web search per claim.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The article's id. Optional: the article on screen, else the newest one." } },
        required: [],
      },
    },
  },
];

/** The article a tool means, checked to be this studio's: the one named, the one on screen, else the newest. */
async function articleInView(ctx: ToolContext, named: string, newest = true) {
  const id = named || ctx.articleId || (newest ? await latestArticleId(ctx.viewer) : null) || "";
  if (!id) return null;
  const [row] = await db
    .select({ id: articles.id, title: articles.title, ownerId: articles.ownerId, status: articles.status })
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.tenantId, ctx.viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  return row ?? null;
}

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
    await cutVersion(ctx.viewer, id, { note: "初稿", model: res.model });
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

  if (name === "revise_article") {
    const instruction = str(args.instruction, 1500);
    if (!instruction) return { text: "Say what should change." };
    const id = str(args.id, 64) || ctx.articleId || (await latestArticleId(ctx.viewer)) || "";
    const [row] = id ? await db.select({ id: articles.id, title: articles.title }).from(articles).where(and(eq(articles.id, id), eq(articles.tenantId, ctx.viewer.tenantId), isNull(articles.deletedAt))).limit(1) : [];
    if (!row) return { text: "No such article. Use an id from list_articles." };
    /* The person behind the turn must be one who may change it (its writer,
       its approver, an admin); the employee itself writes for them. */
    const person = ctx.asker ?? (agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer);
    if (person && !(await ownArticle(person, row.id))) {
      return { text: "Only the article's writer, the person asked to approve it, or an admin may change it. Nothing was changed." };
    }
    await cutVersion(ctx.viewer, row.id, { note: "改稿前" });
    const res = await draftArticle(ctx.viewer, row.id, { instruction });
    if ("error" in res) return { text: res.error, changed: true };
    await audit(ctx.viewer, "article.generate", { objectType: "article", objectId: row.id, module: "script", meta: { model: res.model, words: res.words, revise: true } });
    return {
      artifacts: [{ kind: "article", id: row.id, title: row.title, action: "updated" }],
      text: `Revised "${row.title}" as asked (${res.words} words, by ${res.model}); the previous text is kept as a version. Open it at /article?id=${row.id}. Say in one sentence what changed; do not repeat the instruction.`,
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
    const id = str(args.id, 64) || ctx.articleId || (await latestArticleId(ctx.viewer)) || "";
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

  if (name === "request_article_approval") {
    const row = await articleInView(ctx, str(args.id, 64));
    if (!row) return { text: "No such article. Use an id from list_articles. Nothing was sent." };
    /* Whoever is behind the turn must be one who may change it, as for a revision; with nobody behind it, the employee itself. */
    const person = personOf(ctx);
    if (!(await ownArticle(person ?? ctx.viewer, row.id))) {
      return { text: "Only the article's writer, the person asked to approve it, or an admin may send it for approval. Nothing was sent." };
    }
    if (row.status === "published") return { text: `"${row.title}" is published. It has to be taken down before it can be approved again. Nothing was sent.` };
    const who = await resolveApprover(ctx.viewer, str(args.approver, 120), [ctx.viewer.id]);
    if ("error" in who) return { text: who.error };
    const note = str(args.note, 500) || undefined;
    const res = await requestApproval(ctx.viewer, row.id, who.ok.id, note);
    if (!res) return { text: `"${row.title}" has nothing to approve yet, or it is published. Nothing was sent.` };
    await audit(ctx.viewer, "article.approval.request", {
      objectType: "article",
      objectId: row.id,
      module: "script",
      meta: { approverId: who.ok.id, versionNo: res.versionNo, for: person?.id ?? null },
    });
    const forWhom = person && person.id !== ctx.viewer.id ? `（应 ${nameOf(person)} 的要求）` : "";
    const told = await tellPerson(
      ctx.viewer,
      who.ok.id,
      [note ? `${note}\n` : "", `${nameOf(ctx.viewer)}${forWhom}请你审阅并批准文章《${row.title}》第 ${res.versionNo} 版。批准后才能发布。`, "", `[打开文章 →](/article?id=${row.id})`].join("\n").trim(),
    );
    return {
      artifacts: [{ kind: "article", id: row.id, title: row.title, action: "updated" }],
      text: `Sent "${row.title}" (version ${res.versionNo}) to ${who.ok.name} to approve${told ? "; they have a direct message with the link" : ""}. Request id: ${res.approvalId}. It is not approved until ${who.ok.name} approves it, and approving does not publish it.`,
      changed: true,
    };
  }

  if (name === "decide_article_approval") {
    const person = personOf(ctx);
    if (!person) return { text: NO_PERSON };
    if (!person.modules.includes("script")) return { text: `${nameOf(person)} does not hold the Script module, so cannot decide article approvals. Nothing was done.` };
    const decision = args.decision === "approve" || args.decision === "approved" ? "approved" : args.decision === "reject" || args.decision === "rejected" ? "rejected" : null;
    if (!decision) return { text: "Say whether to approve or reject it." };
    const note = str(args.note, 500) || undefined;

    const named = str(args.approval_id, 64);
    const row = named ? null : await articleInView(ctx, str(args.id, 64), false);
    const [req] = named
      ? await db
          .select({ id: approvals.id, objectId: approvals.objectId, requestedBy: approvals.requestedBy })
          .from(approvals)
          .where(and(eq(approvals.id, named), eq(approvals.tenantId, person.tenantId), eq(approvals.objectType, "article"), eq(approvals.state, "requested")))
          .limit(1)
      : row
        ? await db
            .select({ id: approvals.id, objectId: approvals.objectId, requestedBy: approvals.requestedBy })
            .from(approvals)
            .where(and(eq(approvals.tenantId, person.tenantId), eq(approvals.objectType, "article"), eq(approvals.objectId, row.id), eq(approvals.state, "requested"), eq(approvals.approverId, person.id)))
            .orderBy(desc(approvals.requestedAt))
            .limit(1)
        : [];
    if (!req) {
      const waiting = await db
        .select({ id: approvals.id, articleId: approvals.objectId, title: articles.title })
        .from(approvals)
        .innerJoin(articles, eq(articles.id, approvals.objectId))
        .where(and(eq(approvals.tenantId, person.tenantId), eq(approvals.objectType, "article"), eq(approvals.state, "requested"), eq(approvals.approverId, person.id), isNull(articles.deletedAt)))
        .limit(20);
      const list = waiting.map((w) => `- ${w.title} (article id: ${w.articleId}, request id: ${w.id})`).join("\n");
      return {
        text: named
          ? `There is no article approval ${named} waiting. Nothing was done.`
          : row
            ? `Nobody has asked ${nameOf(person)} to approve "${row.title}", so there is nothing to decide. Nothing was done.${list ? `\nWaiting on ${nameOf(person)}:\n${list}` : ""}`
            : list
              ? `Which article? Waiting on ${nameOf(person)}:\n${list}`
              : `No article approval is waiting on ${nameOf(person)}.`,
      };
    }
    const res = await decideApproval(person, req.id, decision, note);
    if ("error" in res) return { text: `${res.error} Nothing was decided.` };
    await audit(person, `article.approval.${decision}`, {
      objectType: "approval",
      objectId: req.id,
      module: "script",
      meta: { versionNo: res.versionNo, by: "assistant", speaker: ctx.viewer.id },
    });
    const [art] = await db.select({ title: articles.title }).from(articles).where(eq(articles.id, res.articleId)).limit(1);
    const title = art?.title ?? row?.title ?? res.articleId;
    if (req.requestedBy) {
      await tellPerson(
        person,
        req.requestedBy,
        decision === "approved"
          ? `${nameOf(person)} 批准了文章《${title}》第 ${res.versionNo ?? "?"} 版，可以发布了。\n\n[打开文章 →](/article?id=${res.articleId})`
          : `${nameOf(person)} 退回了文章《${title}》${note ? `：${note}` : ""}\n\n[打开文章 →](/article?id=${res.articleId})`,
      );
    }
    return {
      artifacts: [{ kind: "article", id: res.articleId, title, action: "updated" }],
      text:
        decision === "approved"
          ? `${nameOf(person)} approved "${title}" (version ${res.versionNo ?? "?"}). It is not published yet: publishing is recorded separately, once it has gone out.`
          : `${nameOf(person)} sent "${title}" back${note ? ` with the note: ${note}` : ""}. It is a draft again.`,
      changed: true,
    };
  }

  if (name === "publish_article") {
    const person = personOf(ctx);
    if (!person) return { text: NO_PERSON };
    const row = await articleInView(ctx, str(args.id, 64), false);
    if (!row) return { text: "Which article? Open it, or give its id from list_articles. Nothing was recorded." };
    if (!person.modules.includes("script") || !(await ownArticle(person, row.id))) {
      return { text: "Only the article's writer, the person asked to approve it, or an admin may record it as published. Nothing was recorded." };
    }
    const destination = str(args.destination, 200);
    if (!destination) return { text: "Say where it was published." };
    const kinds = DESTINATIONS.map((d) => d.kind);
    const kind = kinds.includes(str(args.kind, 40)) ? str(args.kind, 40) : "other";
    const url = str(args.url, 2000);
    if (url && !/^https?:\/\//i.test(url)) return { text: "The link has to be a web address (http… or https…). Nothing was recorded." };
    const res = await publishArticle(person, row.id, { kind, destination, url: url || null, note: str(args.note, 1000) || null });
    if ("error" in res) return { text: `${res.error} Nothing was recorded.` };
    await audit(person, "article.publish", {
      objectType: "article",
      objectId: row.id,
      module: "script",
      meta: { publicationId: res.id, destination, by: "assistant", speaker: ctx.viewer.id },
    });
    return {
      artifacts: [{ kind: "article", id: row.id, title: row.title, action: "updated" }],
      text: `Recorded: "${row.title}" published to ${destination}${url ? ` (${url})` : ""} by ${nameOf(person)}. Publication id: ${res.id}. The article is now locked; nothing was sent anywhere by this, it is the publishing log's entry.`,
      changed: true,
    };
  }

  if (name === "retract_publication") {
    const person = personOf(ctx);
    if (!person) return { text: NO_PERSON };
    let pubId = str(args.publication_id, 64);
    if (!pubId) {
      const row = await articleInView(ctx, str(args.id, 64), false);
      if (!row) return { text: "Which publication? Give its id from publishing_log, or open the article. Nothing was changed." };
      const live = (await publicationsFor(person, row.id)).filter((p) => !p.retractedAt);
      if (!live.length) return { text: `"${row.title}" is not live anywhere. Nothing was changed.` };
      if (live.length > 1) {
        return { text: `"${row.title}" is live in ${live.length} places; which one was taken down?\n${live.map((p) => `- ${p.destination}${p.url ? ` (${p.url})` : ""} (publication id: ${p.id})`).join("\n")}` };
      }
      pubId = live[0].id;
    }
    if (!person.modules.includes("script") || !(await ownPublication(person, pubId))) {
      return { text: "No such publication, or it belongs to an article only its writer, its approver or an admin may change. Nothing was changed." };
    }
    const reason = str(args.reason, 500) || undefined;
    const res = await retractPublication(person, pubId, reason);
    if ("error" in res) return { text: `${res.error} Nothing was changed.` };
    await audit(person, "article.retract", { objectType: "article", objectId: res.articleId, module: "script", meta: { publicationId: pubId, by: "assistant", speaker: ctx.viewer.id } });
    const [art] = await db.select({ title: articles.title, status: articles.status }).from(articles).where(eq(articles.id, res.articleId)).limit(1);
    return {
      artifacts: [{ kind: "article", id: res.articleId, title: art?.title, action: "updated" }],
      text: `Marked as taken down${reason ? ` (${reason})` : ""}: publication ${pubId} of "${art?.title ?? res.articleId}". ${art?.status === "published" ? "It is still live elsewhere, so it stays locked." : "It is no longer live anywhere, so it is unlocked and back in review."}`,
      changed: true,
    };
  }

  if (name === "check_article_facts") {
    const row = await articleInView(ctx, str(args.id, 64));
    if (!row) return { text: "No such article. Use an id from list_articles." };
    let res: Awaited<ReturnType<typeof checkArticleFacts>>;
    try {
      res = await checkArticleFacts(ctx.viewer, row.id);
    } catch (err) {
      return { text: `The facts could not be checked: ${err instanceof Error ? err.message : "the model call failed"}.` };
    }
    if ("error" in res) return { text: `The facts could not be checked: ${res.error}.` };
    if (!res.results.length) return { text: `"${row.title}" has no specific claims to check (no numbers, dates, names or quotes were found).` };
    const tally = (v: string) => res.results.filter((r) => r.verdict === v).length;
    return {
      text: [
        `Fact check of "${row.title}": ${tally("confirmed")} confirmed, ${tally("contradicted")} contradicted, ${tally("unconfirmed")} unconfirmed. Nothing in the article was changed.`,
        ...res.results.map((r) => `- [${r.verdict}] ${r.claim}${r.note ? ` — ${r.note}` : ""}${r.source ? ` (${r.source})` : ""}`),
        tally("contradicted") ? "Offer to fix the contradicted claims with revise_article; do not change anything unasked." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const articlePack: ToolPack = { module: "script", defs, run };
