import "server-only";
import type { Viewer } from "@/lib/auth/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { agentChannelLines, conversationDetail, conversationsWithAgent } from "@/lib/chat/service";
import { resultVideoRefs, videoRefsOf, type VideoCard, type VideoRefs } from "@/lib/chat/video-card";
import { videoCardsFor } from "@/lib/chat/videos";
import type { AgentHistory, ThreadMessage } from "@/components/canvas/AgentScreen";

/**
 * A person's conversation as the agent screen draws it, shared by the
 * thread page (`/chat/t/[id]`) and an employee's page (`/chat?agent=…`),
 * which opens the newest thread that employee answered in.
 *
 * With the renders and video files each turn names, as cards for this
 * reader: what the answer itself writes, what a tool of the turn looked up
 * (one thing, not a listing — `resultVideoRefs`), and a person's own upload
 * named in their message (`[附件] … file id fil_…`, written by the stream
 * route). Nothing on the `agent_messages` row says "attachment"; the ids in
 * the text and the tool results are the record, and `lib/chat/videos.ts`
 * checks each against the reader before it becomes a card. The same rule
 * the screen applies to a live turn (`AgentScreen`, `resultIds`).
 */
export async function threadMessagesOf(viewer: Viewer, detail: NonNullable<Awaited<ReturnType<typeof conversationDetail>>>): Promise<ThreadMessage[]> {
  const rows = detail.messages.filter((m) => m.role === "user" || m.role === "assistant");
  const videos = await videoCardsFor(
    viewer,
    rows.map((m) => {
      const refs: VideoRefs = videoRefsOf(null, m.content);
      for (const c of detail.toolCalls) {
        if (c.messageId !== m.id || c.status !== "ok" || typeof c.result !== "string") continue;
        const found = resultVideoRefs(c.result);
        refs.exportIds.push(...found.exportIds);
        refs.fileIds.push(...found.fileIds);
      }
      return { key: m.id, exportIds: [...new Set(refs.exportIds)], fileIds: [...new Set(refs.fileIds)], jobIds: refs.jobIds };
    }),
  ).catch((err) => {
    console.error("[chat] could not read the videos in the conversation", err);
    return new Map<string, VideoCard[]>();
  });

  return rows.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    status: m.status as ThreadMessage["status"],
    error: m.error,
    model: m.model,
    costMicros: Number(m.costMicros ?? 0),
    withheld: m.withheld,
    /* Who answered, as stored by the stream route. Without it a reloaded
       thread drew every employee's answer as the host's. */
    speaker: asAgentKey(m.speaker),
    createdAt: m.createdAt.toISOString(),
    citations: detail.citations
      .filter((c) => c.messageId === m.id)
      .map((c) => ({
        fileId: c.fileId,
        name: c.name,
        kind: c.kind,
        folder: c.folder,
        relation: c.relation,
      })),
    tools: detail.toolCalls
      .filter((c) => c.messageId === m.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        durationMs: c.durationMs,
        summary: summarise(c.name, c.args as Record<string, unknown>, c.durationMs),
      })),
    videos: videos.get(m.id) ?? [],
    made: madeScript(detail.toolCalls.filter((c) => c.messageId === m.id)),
    links: linksOf(detail.toolCalls.filter((c) => c.messageId === m.id)),
  }));
}

/**
 * Everything an employee's page shows around the conversation: this
 * person's other threads with that employee, and what the employee said
 * lately in the channels this person can read. `currentId` is the thread
 * on screen, if any.
 */
export async function agentHistoryFor(viewer: Viewer, agent: AgentKey, currentId: string | null): Promise<AgentHistory> {
  const [conversations, lines] = await Promise.all([conversationsWithAgent(viewer, agent, 12), agentChannelLines(viewer, agent, 6)]);
  return { agent, currentId, conversations, lines };
}

/** A stored speaker, if it still names an employee. */
export function asAgentKey(value: string | null): AgentKey | null {
  return value && (AGENT_KEYS as readonly string[]).includes(value) ? (value as AgentKey) : null;
}

/** The one-line trace the artboard shows beside a tool chip. */
function summarise(name: string, args: Record<string, unknown>, ms: number | null): string {
  const secs = ms ? ` · ${(ms / 1000).toFixed(1)} s` : "";
  switch (name) {
    case "search_files":
      return `查找文件「${args.query ?? ""}」${secs}`;
    case "read_file":
      return `读了一个文件${secs}`;
    case "list_recent_files":
      return `看了最近的文件${secs}`;
    case "create_document":
      return `写了「${args.title ?? "一个文件"}」${secs}`;
    case "check_ai_spend":
      return `查了 AI 花费${secs}`;
    default:
      return name + secs;
  }
}

/** The script a turn wrote, from its write_script receipt ("Open it at /script/scr_…"). */
function madeScript(calls: { name: string; status: string; result?: unknown }[]): { scriptId: string; projectId: string | null; title: string } | null {
  for (const c of [...calls].reverse()) {
    if (c.name !== "write_script" || c.status !== "ok" || typeof c.result !== "string") continue;
    const id = /\/script\/(scr_[0-9a-z]+)/i.exec(c.result)?.[1];
    if (!id) continue;
    return { scriptId: id, projectId: /\/projects\/(wp_[0-9a-z]+)/i.exec(c.result)?.[1] ?? null, title: /Written: "(.+?)"/.exec(c.result)?.[1] ?? "" };
  }
  return null;
}

/**
 * What a turn made or changed, as links under its answer, from the
 * receipts the tools wrote ("Open it at /article?id=art_…"): the article it
 * wrote or revised. The screen draws the same links live from the tool
 * events; this keeps them when the thread is read back (an article written
 * from chat used to be named and not linked, 2 Oct).
 */
export function linksOf(calls: { name: string; status: string; result?: unknown }[]): { kind: string; id: string; title?: string }[] {
  const out: { kind: string; id: string; title?: string }[] = [];
  for (const c of calls) {
    if (c.status !== "ok" || typeof c.result !== "string") continue;
    if (c.name === "write_article" || c.name === "revise_article") {
      const id = /\/article\?id=(art_[0-9a-z]+)/i.exec(c.result)?.[1];
      if (id && !out.some((l) => l.id === id)) out.push({ kind: "article", id, title: /(?:Written|Revised):? "(.+?)"/.exec(c.result)?.[1] });
    }
    /* The project a topic started and the script in it (Avon, 8 Oct: "the link the agent gave can't be opened": the links were drawn live, then lost when the thread reloaded under its own address). */
    const add = (kind: string, id: string | undefined, title?: string) => {
      if (id && !out.some((l) => l.kind === kind && l.id === id)) out.push({ kind, id, ...(title ? { title } : {}) });
    };
    if (c.name === "start_project_from_topic") {
      const title = /(?:Started the project|already started from this topic:) "(.+?)"/.exec(c.result)?.[1];
      add("work_project", /\/projects\/([a-z]+_[0-9a-z]+)/i.exec(c.result)?.[1], title);
    }
    if (c.name === "revise_script" || c.name === "request_script_approval" || c.name === "decide_script_approval") {
      add("work_project", /\/projects\/([a-z]+_[0-9a-z]+)/i.exec(c.result)?.[1]);
      add("script", /\/script\/(scr_[0-9a-z]+)/i.exec(c.result)?.[1]);
    }
    if (c.name === "create_document") {
      const id = /\/docs\/(fil_[0-9a-z]+)/i.exec(c.result)?.[1];
      const title = /document "(.+?)"/.exec(c.result)?.[1];
      add("doc", id, title);
      add("doc_word", id, title);
    }
    if (c.name === "create_word_from_template") {
      const id = /\/files\/(fil_[0-9a-z]+)/i.exec(c.result)?.[1];
      const title = /Word file "(.+?)"/.exec(c.result)?.[1];
      add("file", id, title);
      add("file_download", id, title);
    }
  }
  return out;
}
