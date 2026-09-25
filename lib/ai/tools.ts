import "server-only";
import { desc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { createDocument } from "@/lib/files/service";
import { budgetState, formatUsd } from "./ledger";
import { readFileText, searchFiles } from "./retrieval";
import type { ToolDef } from "./openrouter";
import { agentKeyFromEmail, type AgentKey } from "@/lib/agents/catalog";
import { holdsPack, type ToolPack } from "./tools/types";
import { chatPack } from "./tools/chat";
import { researchPack } from "./tools/research";
import { VIDEO_READ_ONLY, videoPack } from "./tools/video";
import { creatorPack } from "./tools/creator";
import { scriptPack } from "./tools/script";
import { articlePack } from "./tools/article";
import { teamPack } from "./tools/team";

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
const PACKS: ToolPack[] = [chatPack, teamPack, researchPack, scriptPack, articlePack, videoPack, creatorPack];

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
        "Read the full text of one document by its id, as returned by search_files or list_recent_files.",
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
        "Write a Markdown document into the employee's own file space — a summary, a brief, a research note. Returns the id so you can tell them where it is. Use it when the employee asks for something written down, not for every answer.",
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
      const doc = await readFileText(viewer, id);
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
      const doc = await createDocument(viewer, {
        name: title.endsWith(".md") ? title : `${title}.md`,
        text: body,
        tags: ["agent"],
      });
      return {
        text: `Saved as "${doc.name}" (id: ${doc.id}) in their files.`,
        citations: [doc.id],
        changed: true,
        artifacts: [{ kind: "file", id: doc.id, title: doc.name, action: "created" }],
      };
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
  const base = viewer.modules.includes("files")
    ? TOOL_DEFS
    : TOOL_DEFS.filter(
        (t) =>
          !["search_files", "read_file", "list_recent_files", "create_document"].includes(t.function.name),
      );

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
  "send_message",
  "assign_task",
  "watch_topic",
  "suggest_angles",
  "decide_topic",
  "watch_channel",
  "write_script",
  "write_article",
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
 */
const DENIED: Partial<Record<AgentKey, ReadonlySet<string>>> = {
  planning: new Set(["write_script", "write_article", "create_document", ...VIDEO_WRITES]),
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
