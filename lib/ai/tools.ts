import { markdownToHtml } from "@/lib/files/markdown";
import { toSimplified } from "@/lib/text/simplified";
import "server-only";
import { fileTextWithin } from "@/lib/files/extract";
import { desc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { createDocument } from "@/lib/files/service";
import { describeTemplate, fillTemplate, type TemplateBlock } from "@/lib/docs/word-template";
import { budgetState, formatUsd } from "./ledger";
import { readFileText, searchFiles } from "./retrieval";
import type { ToolDef } from "./openrouter";
import { agentKeyFromEmail, type AgentKey } from "@/lib/agents/catalog";
import { publishPack } from "./tools/publish";
import { filesPack } from "./tools/files";
import { projectsPack } from "./tools/projects";
import { hrPack } from "./tools/hr";
import { accountingPack } from "./tools/accounting";
import { holdsPack, type ToolPack } from "./tools/types";
import { chatPack } from "./tools/chat";
import { researchPack } from "./tools/research";
import { VIDEO_READ_ONLY, videoPack } from "./tools/video";
import { creatorPack } from "./tools/creator";
import { scriptPack } from "./tools/script";
import { articlePack } from "./tools/article";
import { teamPack } from "./tools/team";
import { legalPack } from "./tools/legal";
import { financePack } from "./tools/finance";

/**
 * What the agent can do. Each tool is a thin wrapper over the same service the
 * screens use, called with the *employee's* viewer — so an agent physically
 * cannot reach further than the person who invoked it (spec §2).
 *
 * Every tool returns text for the model plus the file ids it touched; those
 * ids become the citation list beside the answer, which is how a reader
 * checks the work.
 */
export type { ToolResult, ToolContext } from "./tools/types";
import type { ToolContext, ToolResult } from "./tools/types";

/**
 * Every module's pack, in the order they are offered.
 *
 * Files first because almost everything refers to a document eventually, then
 * the modules in the order the rail lists them. A person is offered exactly
 * the packs they hold, and `runTool` re-checks — a model is perfectly capable
 * of calling something it was never shown.
 */
const PACKS: ToolPack[] = [chatPack, teamPack, projectsPack, filesPack, researchPack, scriptPack, articlePack, publishPack, videoPack, creatorPack, financePack, legalPack, hrPack, accountingPack];

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search the studio's documents and media by keyword or phrase. Works in English and Chinese. Returns titles and matching snippets. Use this before answering anything about the studio's own work.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords or a phrase. Short queries work best." },
          limit: { type: "integer", description: "How many results, 1-12. Default 6." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read any file by its id: documents, slides, spreadsheets, PDFs (scans too), pictures and screenshots (the text in them and what they show), audio and video (a transcript), zip archives. Use it for every [附件] file id whose content is not already under the message, and for ids from search_files or list_recent_files.",
      parameters: {
        type: "object",
        properties: { file_id: { type: "string", description: "The file id, e.g. fil_01k…" } },
        required: ["file_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_files",
      description: "List the documents and media most recently changed that this employee can see.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", description: "How many, 1-20. Default 10." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_document",
      description:
        "Write a document into the employee's own files — a summary, a brief, a weekly report, a research note. Write the body in Markdown; it is saved as a formatted document that opens in the browser's document editor and downloads as Word (.docx) or PDF. Use it whenever they ask for a document, a Word file or something written down. Afterwards give them the two links from the result. Never tell them to convert Markdown themselves. When they give a sample Word file to follow (\"same format as this weekly report\", a fixed header and footer), use read_word_template and create_word_from_template instead.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string", description: "Markdown." },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_word_template",
      description:
        "Read a sample Word (.docx) file's layout before writing a new file in the same format: every body paragraph and table, numbered, with its style, alignment, size and text, plus the header and footer text. Use it when someone gives or names a Word file to follow (a weekly report, a letter, a form) and asks for a new one like it.",
      parameters: {
        type: "object",
        properties: { file_id: { type: "string", description: "The sample's file id (fil_…), from an attachment, search_files or list_recent_files." } },
        required: ["file_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_word_from_template",
      description:
        "Write a new Word (.docx) file in exactly the format of a sample Word file and save it in their files: the sample's page setup, header, footer, logo, fonts and styles are kept; only the body is new. Call read_word_template on the sample first. Give the new body as blocks in order: a paragraph is {like: n, text} where n is the number of the sample paragraph whose formatting it should copy (a heading like the sample's heading, body text like its body text); **bold** works inside text. A table is {table_like: n, rows: [[header cells], [cells]…]} copying sample table n; a line break inside a cell is \\n. A paragraph or table (a masthead, a slogan, a logo box) that stays the same is {keep_paragraph: n} or {keep_table: n}. Header/footer text that must change (issue number, date) goes in replace. Afterwards give them the two links from the result.",
      parameters: {
        type: "object",
        properties: {
          template_file_id: { type: "string" },
          name: { type: "string", description: "The new file's name, without .docx." },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                like: { type: "number", description: "Sample paragraph number to copy the formatting of." },
                keep_paragraph: { type: "number", description: "Sample paragraph number to copy exactly as it is (an unchanged line)." },
                keep_table: { type: "number", description: "Sample table number to copy exactly as it is: a masthead, a slogan box, a box with a logo." },
                text: { type: "string" },
                table_like: { type: "number", description: "Sample table number, for a table block." },
                rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "Table rows, first row the header." },
              },
            },
          },
          replace: {
            type: "array",
            items: { type: "object", properties: { find: { type: "string" }, with: { type: "string" } }, required: ["find", "with"] },
            description: "Optional. Text to swap in the header and footer.",
          },
        },
        required: ["template_file_id", "name", "blocks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_ai_spend",
      description: "Report this employee's AI spend for the current period against their cap.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export async function runTool(
  viewer: Viewer,
  name: string,
  rawArgs: string,
  /** What is on screen, so "this channel" and "this video" mean something. */
  context: Omit<ToolContext, "viewer"> = {},
): Promise<ToolResult> {
  // `toolsFor` decides what is *offered*; a model is perfectly capable of
  // calling something it was never offered, and nothing downstream would have
  // noticed. The entitlement is enforced here, where the work happens.
  const named = (t: ToolDef) => t.function.name === name;
  if (!toolsFor(viewer, { readOnly: context.readOnly }).some(named)) {
    /* Held but withheld is worth saying differently from "no such tool": the
       model then knows the work exists and whose it is, rather than
       concluding it cannot be done at all. */
    if (allTools(viewer).some(named)) {
      return {
        text: toolsFor(viewer).some(named)
          ? `${name} changes things, and this turn only looks things up. Say what you found; if something needs doing, say who should do it.`
          : AGENTS_NEVER.has(name)
            ? `${name} is not for employees: what you answer is posted for you, and work for a colleague goes through assign_task.`
            : `${name} is not part of your job. Hand the work to the colleague whose job it is with assign_task.`,
      };
    }
    return { text: `Unknown tool ${name}.` };
  }

  // Whatever the model produced. Every read below coerces, because none of it
  // is trustworthy.
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { text: "The arguments were not valid JSON. Try again with a single JSON object." };
  }

  /*
   * A module's pack, if this is one of its tools. The entitlement was checked
   * above against the offered set; this finds who owns the name.
   */
  const pack = PACKS.find(
    (p) => holdsPack(viewer.modules, p) && p.defs.some((d) => d.function.name === name),
  );
  if (pack) {
    try {
      return await pack.run({ ...context, viewer }, name, args);
    } catch (err) {
      // Returned, not thrown: a tool that refused is something the model can
      // work around, and a turn that dies takes the conversation with it.
      return { text: `That failed: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  }

  switch (name) {
    case "search_files": {
      const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 12);
      const { hits, withheld } = await searchFiles(viewer, String(args.query ?? ""), limit);
      await audit(viewer, "agent.search", { module: "chat", meta: { query: args.query, hits: hits.length } });

      if (!hits.length) {
        return {
          text:
            "No documents matched" +
            (withheld > 0 ? ", and some matches exist that this employee may not read." : "."),
          withheld,
        };
      }

      const lines = hits.map(
        (h) =>
          `- ${h.name} (id: ${h.fileId}, ${h.kind}, updated ${h.updatedAt.toISOString().slice(0, 10)})\n  ${h.snippet.replace(/\s+/g, " ").slice(0, 240)}`,
      );
      return {
        text:
          lines.join("\n") +
          (withheld > 0
            ? `\n\n(${withheld} further match${withheld === 1 ? "" : "es"} exist that this employee may not read. Say the answer may be partial; do not describe them.)`
            : ""),
        citations: hits.map((h) => h.fileId),
        withheld,
      };
    }

    case "read_file": {
      const id = String(args.file_id ?? "");
      let doc = await readFileText(viewer, id);
      /* Not read yet (uploaded a moment ago, or before files were read on
         upload): read it now, then look again. */
      if (doc && !doc.text.trim()) {
        await fileTextWithin(id, 120_000, { ledger: { viewer, module: "chat" } }).catch(() => null);
        doc = await readFileText(viewer, id);
      }
      if (!doc) {
        // Indistinguishable from "does not exist" on purpose (§2.2.4).
        return { text: `No document with id ${id} is available.` };
      }
      await audit(viewer, "agent.read", { objectType: "file", objectId: id, module: "chat" });
      return {
        text: `# ${doc.name}\n\n${doc.text}${doc.truncated ? "\n\n[truncated]" : ""}`,
        citations: [id],
      };
    }

    case "list_recent_files": {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
      const rows = await db
        .select({ id: files.id, name: files.name, kind: files.kind, updatedAt: files.updatedAt })
        .from(files)
        .where(and(eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
        .orderBy(desc(files.updatedAt))
        .limit(limit);

      if (!rows.length) return { text: "This employee has no files yet." };
      return {
        text: rows
          .map((r) => `- ${r.name} (id: ${r.id}, ${r.kind}, ${r.updatedAt.toISOString().slice(0, 10)})`)
          .join("\n"),
        citations: rows.map((r) => r.id),
      };
    }

    case "create_document": {
      const title = String(args.title ?? "Untitled").slice(0, 200);
      const body = String(args.body ?? "");
      if (!body.trim()) return { text: "Nothing to write — the body was empty." };
      /* A formatted document, not a .md file (Avon, 7 Oct: "I can't create or download a Word doc"). */
      const name = title.replace(/\.(md|markdown|docx?|txt)$/i, "");
      const doc = await createDocument(viewer, { name, text: body, tags: ["agent"] });
      await db.update(files).set({ docHtml: toSimplified(markdownToHtml(body)) }).where(eq(files.id, doc.id));
      return {
        text: `Saved as the document "${doc.name}" in their files. Give them both links exactly: [打开文档](/docs/${doc.id}) and [下载 Word](/api/docs/${doc.id}/export?format=docx).`,
        citations: [doc.id],
        changed: true,
        artifacts: [{ kind: "file", id: doc.id, title: doc.name, action: "created" }],
      };
    }

    case "read_word_template": {
      const id = String(args.file_id ?? "");
      if (!/^fil_[0-9a-z]+$/i.test(id)) return { text: "Give the sample's file id (fil_…)." };
      try {
        return { text: await describeTemplate(viewer, id), citations: [id] };
      } catch (err) {
        return { text: `Could not read that file as a Word template: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "create_word_from_template": {
      const id = String(args.template_file_id ?? "");
      if (!/^fil_[0-9a-z]+$/i.test(id)) return { text: "Give the sample's file id (fil_…)." };
      const blocks = (Array.isArray(args.blocks) ? args.blocks : []).filter((b): b is TemplateBlock => Boolean(b) && typeof b === "object");
      if (!blocks.length) return { text: "Nothing to write: blocks was empty." };
      const replace = (Array.isArray(args.replace) ? args.replace : [])
        .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
        .filter((r) => typeof r.find === "string" && typeof r.with === "string")
        .map((r) => ({ find: String(r.find), with: toSimplified(String(r.with)) }));
      try {
        const out = await fillTemplate(viewer, {
          templateId: id,
          name: toSimplified(String(args.name ?? "新文件")),
          blocks: blocks.map((b) => ({ ...b, text: typeof b.text === "string" ? toSimplified(b.text) : b.text, rows: Array.isArray(b.rows) ? b.rows.map((r) => (Array.isArray(r) ? r.map((c) => toSimplified(String(c ?? ""))) : [])) : undefined })),
          replace,
        });
        return {
          text: `Saved the Word file "${out.name}" in their files, in the sample's format (${out.paragraphs} paragraphs, ${out.tables} tables${replace.length ? `, ${out.replaced} header/footer swaps` : ""}). Give them both links exactly: [打开文件](/files/${out.id}) and [下载 Word](/api/files/${out.id}/download?download=1).`,
          citations: [out.id, id],
          changed: true,
          artifacts: [{ kind: "file", id: out.id, title: out.name, action: "created" }],
        };
      } catch (err) {
        return { text: `Could not write the file: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "check_ai_spend": {
      const state = await budgetState(viewer);
      if (state.capMicros === null) {
        return { text: `Used ${formatUsd(state.usedMicros)} this period. No cap is set.` };
      }
      return {
        text:
          `Used ${formatUsd(state.usedMicros)} of ${formatUsd(state.capMicros)} this period (${Math.round(state.fraction * 100)}%).` +
          (state.stopped
            ? " The cap is reached, so the assistant has stopped until an admin raises it."
            : ""),
      };
    }

    default:
      return { text: `Unknown tool ${name}.` };
  }
}

/**
 * What this person's agent can do.
 *
 * The base tools minus the file ones if they do not hold `files`, plus one
 * pack per module they do hold. The result is that the *same* agent, on any
 * screen, can summarise a channel, watch a topic or cut a video — and that a
 * person without the Video module is not offered a single video tool.
 */
export function toolsFor(viewer: Viewer, opts: { readOnly?: boolean } = {}): ToolDef[] {
  const key = agentKeyFromEmail(viewer.email);
  const denied = key ? DENIED[key] : undefined;
  return allTools(viewer).filter((t) => {
    const name = t.function.name;
    if (opts.readOnly && WRITES.has(name)) return false;
    if (key && AGENTS_NEVER.has(name)) return false;
    return !denied?.has(name);
  });
}

/** Everything the viewer's modules would bring, before any employee's lane
 * or a read-only turn narrows it. */
function allTools(viewer: Viewer): ToolDef[] {
  /* An AI employee always reads files (what a person attached is shared to
     it); a person without the Files module gets none of the file tools. */
  const employee = Boolean(agentKeyFromEmail(viewer.email));
  const withheld = viewer.modules.includes("files") ? [] : employee ? ["create_document", "create_word_from_template"] : ["search_files", "read_file", "list_recent_files", "create_document", "read_word_template", "create_word_from_template"];
  const base = TOOL_DEFS.filter((t) => !withheld.includes(t.function.name));

  const packs = PACKS.filter((p) => holdsPack(viewer.modules, p)).flatMap((p) => p.defs);
  return [...base, ...packs];
}

/** The video tools that change the project: all of them but the looking. */
const VIDEO_WRITES = videoPack.defs.map((d) => d.function.name).filter((n) => !VIDEO_READ_ONLY.includes(n));

/**
 * Every tool that changes something. A read-only turn is offered none of
 * them. A tool not listed is treated as a read, so a new tool that writes
 * belongs here too.
 */
const WRITES = new Set<string>([
  "create_document",
  "create_word_from_template",
  "send_message",
  "assign_task",
  "watch_topic",
  "suggest_angles",
  "decide_topic",
  "watch_channel",
  "write_script",
  "write_article",
  "draft_contract",
  "review_contract",
  "raise_spend_request",
  /* 4 Oct: the side assistant does what its screen does. */
  "revise_article",
  "create_post", "request_post_approval", "decide_post",
  "revise_script", "request_script_approval", "decide_script_approval",
  "request_article_approval", "decide_article_approval", "publish_article", "retract_publication",
  "create_folder", "rename_file", "move_files", "delete_files", "restore_files", "share_file", "set_file_access",
  "move_topic_stage", "plan_topic", "start_project_from_topic",
  "decide_spend_request", "mark_spend_paid", "add_actual", "set_budget_line",
  "update_contract", "acknowledge_finding", "save_checklist_run",
  "request_leave", "decide_leave", "add_candidate", "set_candidate_stage",
  "save_entry", "post_entry", "export_period",
  /* Not finance_report: it reads the latest report and, asked to, writes a
     new one, and it refuses the writing itself on a read-only turn. */
  ...VIDEO_WRITES,
]);

/**
 * What an AI employee is not given, whatever its modules say.
 *
 * Modules are coarse: 策划 holds Script and Video because it has to *read*
 * the scripts and the projects to plan, and holding them offered it every
 * writing and cutting tool as well. It used them — and when it had not, it
 * said it had. The planner decides and assigns; the work itself is the
 * colleagues', reached through `assign_task`. Removing the module would not
 * do it (`ensureAgent` only ever adds entitlements, never takes them away),
 * and would take the reading with it.
 *
 * 法务 and 财务 need no line here. Their modules are Legal and Finance alone,
 * so no video or script pack is ever offered to them, and no other employee
 * holds either module, so neither pack reaches 剪辑师 or 文案: the
 * entitlement does the scoping that a module like the planner's could not.
 */
const DENIED: Partial<Record<AgentKey, ReadonlySet<string>>> = {
  planning: new Set(["write_script", "write_article", "revise_script", "revise_article", "create_document", "create_word_from_template", ...VIDEO_WRITES]),
};

/**
 * What no AI employee is given.
 *
 * `send_message` posts straight into a channel, around the check every
 * employee's reply goes through before it is posted (`lib/agents/mentions.ts`)
 * — an unverified "done" and an unverified `@` by the side door. An
 * employee's words reach a channel as its reply, and work reaches a colleague
 * through `assign_task`.
 */
const AGENTS_NEVER: ReadonlySet<string> = new Set(["send_message"]);
