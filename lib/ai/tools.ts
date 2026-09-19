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

/**
 * What the agent can do. Each tool is a thin wrapper over the same service the
 * screens use, called with the *employee's* viewer — so an agent physically
 * cannot reach further than the person who invoked it (spec §2).
 *
 * Every tool returns text for the model plus the file ids it touched; those
 * ids become the citation list beside the answer, which is how a reader
 * checks the work.
 */
export type ToolResult = { text: string; citations?: string[]; withheld?: number };

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
): Promise<ToolResult> {
  // `toolsFor` decides what is *offered*; a model is perfectly capable of
  // calling something it was never offered, and nothing downstream would have
  // noticed. The entitlement is enforced here, where the work happens.
  if (!toolsFor(viewer).some((t) => t.function.name === name)) {
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

/** Tool names a person actually holds. Nothing is offered that their
 * entitlements would refuse. */
export function toolsFor(viewer: Viewer): ToolDef[] {
  if (!viewer.modules.includes("files")) {
    return TOOL_DEFS.filter((t) => !["search_files", "read_file", "list_recent_files", "create_document"].includes(t.function.name));
  }
  return TOOL_DEFS;
}
