import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversations } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import type { Module } from "@/lib/db/schema";
import { runAgent, titleConversation } from "@/lib/ai/agent";
import { newId } from "@/lib/ids";

/**
 * The agent turn, streamed.
 *
 * Server-sent events over the Node runtime: each `runAgent` event is one
 * frame, so the screen shows the tool trace and the citations at the moment
 * they happen rather than after the answer lands. If the reader disconnects,
 * the abort signal reaches the provider call and the model stops generating —
 * an abandoned tab does not keep spending the client's money.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  let body: {
    conversationId?: string;
    content?: string;
    /** What is open on screen. Every field is re-checked where it is used. */
    context?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return new Response("Empty message", { status: 400 });
  // A turn is billed to the studio's OpenRouter account, so the prompt cannot
  // be whatever size the caller feels like posting. 32k characters is longer
  // than anything anyone types and far short of a deliberate bill.
  if (content.length > 32_000) return new Response("That message is too long", { status: 413 });

  /*
   * `null` means the same thing as absent: start a new conversation. It used
   * to be neither, and a client that sent it — which every inline agent panel
   * did — got a 400 for a perfectly well-formed request.
   */
  /*
   * What the person is looking at.
   *
   * Taken as hints, never as authority: each id is checked against the viewer
   * inside the tool that uses it, so a client that names a channel it cannot
   * read gets exactly what a client that names nothing gets. Whitelisted by
   * key so an unknown field cannot reach a tool at all.
   */
  const raw = (body.context ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).slice(0, 64) : undefined);
  const context = {
    module: typeof raw.module === "string" ? (raw.module as Module) : undefined,
    channelId: pick("channelId"),
    projectId: pick("projectId"),
    topicId: pick("topicId"),
    fileId: pick("fileId"),
    scriptId: pick("scriptId"),
  };

  /*
   * Who may ask. The Chat module, or the module whose screen the question
   * came from: the assistant panel sits on every Research, Script and Video
   * screen, and a person who holds those but not Chat used to get "Forbidden"
   * from a panel that was drawn for them.
   */
  const allowed =
    viewer.modules.includes("chat") ||
    (context.module !== undefined && context.module !== "chat" && viewer.modules.includes(context.module));
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const conversationIdInput = body.conversationId ?? undefined;
  if (conversationIdInput !== undefined && typeof conversationIdInput !== "string") {
    return new Response("Bad request", { status: 400 });
  }

  // A conversation belongs to exactly one person; a supplied id is checked
  // against the caller rather than trusted.
  let conversationId = conversationIdInput;
  let isFirst = false;
  if (conversationId) {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, viewer.id)))
      .limit(1);
    if (!row) return new Response("Not found", { status: 404 });
  } else {
    conversationId = newId("cnv");
    await db.insert(conversations).values({ id: conversationId, userId: viewer.id, module: "chat" });
    isFirst = true;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "conversation", id: conversationId });

      try {
        for await (const event of runAgent({
          viewer,
          conversationId: conversationId!,
          content,
          // The screen the question came from, when it came from one: it
          // decides which module's tuning the prompt carries.
          module: context.module ?? "chat",
          context,
          signal: request.signal,
        })) {
          send(event);
        }
      } catch (err) {
        // `runAgent` shapes every expected failure into its own error event,
        // including the provider's own message, which the brief wants intact.
        // Anything that escapes to here is unexpected — a database or runtime
        // error whose text can carry internals — so it is logged and not echoed.
        console.error("[agent] stream failed", err);
        send({ type: "error", kind: "server", message: "Something went wrong." });
      } finally {
        controller.close();
      }

      // `void` here meant nothing awaited the call: the stream closes, the
      // request ends, and a standalone worker is free to reclaim the process
      // mid-flight — leaving the conversation titled "New chat" and the model
      // call unrecorded. `after` keeps the runtime alive for it, the same way
      // "last active" and "mark read" are handled.
      if (isFirst) after(() => titleConversation(viewer, conversationId!, content));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
