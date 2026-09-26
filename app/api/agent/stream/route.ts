import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, files, scripts, topics } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import type { Module } from "@/lib/db/schema";
import { runAgent, titleConversation } from "@/lib/ai/agent";
import type { ToolContext } from "@/lib/ai/tools/types";
import { newId } from "@/lib/ids";
import { AGENT_KEYS, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { agentViewer } from "@/lib/agents";
import { MAX_REPLIES, later } from "@/lib/agents/mentions";
import { channelById } from "@/lib/chat/service";
import { projectById } from "@/lib/video/service";
import { relationOn } from "@/lib/authz/rebac";
import { reachableThroughProjects } from "@/lib/projects/service";

type ScreenIds = Pick<ToolContext, "channelId" | "projectId" | "topicId" | "fileId" | "scriptId">;

/**
 * What the screen says is open, kept only where the person asking may open
 * it themselves. An id that fails is dropped, as if the screen had sent
 * nothing.
 *
 * This used to be left to the tools, "checked against the viewer inside the
 * tool that uses it" — but when an employee answers ("@策划 …", or the
 * panel on Research), the viewer inside the tool is the employee, and every
 * employee is a member of every private project's chat and an editor of its
 * script. A person outside a private project could send its channel id and
 * have 策划 hand 编剧 that project's script to rewrite. So each id is
 * checked here, against the person, before any turn starts, by the rule
 * each screen itself uses:
 *
 *   - a channel: one they can read (`channelById`: public, or they are in it);
 *   - a script: in the studio, and — when it belongs to projects — through
 *     a project they may see (the Script library is the studio's; a
 *     private project's script is its members');
 *   - a video project: one they may open (`projectById`), by the same
 *     project rule;
 *   - a file: one they hold a relation on;
 *   - a research topic: one of the studio's.
 */
async function screenIds(viewer: Viewer, raw: Record<string, unknown>): Promise<ScreenIds> {
  const pick = (k: string) => (typeof raw[k] === "string" && raw[k] ? (raw[k] as string).slice(0, 64) : undefined);
  const want = { channelId: pick("channelId"), projectId: pick("projectId"), topicId: pick("topicId"), fileId: pick("fileId"), scriptId: pick("scriptId") };
  const [channelId, projectId, topicId, fileId, scriptId] = await Promise.all([
    want.channelId ? channelById(viewer, want.channelId).then((c) => c?.id) : undefined,
    want.projectId
      ? Promise.all([projectById(viewer, want.projectId, "viewer"), reachableThroughProjects(viewer, { videoProjectId: want.projectId })]).then(([p, ok]) => (p && ok ? p.id : undefined))
      : undefined,
    want.topicId
      ? db
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.id, want.topicId), eq(topics.tenantId, viewer.tenantId)))
          .limit(1)
          .then(([t]) => t?.id)
      : undefined,
    want.fileId
      ? Promise.all([
          db
            .select({ id: files.id })
            .from(files)
            .where(and(eq(files.id, want.fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
            .limit(1),
          relationOn(viewer, "file", want.fileId),
        ]).then(([[f], rel]) => (f && rel ? f.id : undefined))
      : undefined,
    want.scriptId
      ? Promise.all([
          db
            .select({ id: scripts.id })
            .from(scripts)
            .where(and(eq(scripts.id, want.scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
            .limit(1),
          reachableThroughProjects(viewer, { scriptId: want.scriptId }),
        ]).then(([[sc], ok]) => (sc && ok ? sc.id : undefined))
      : undefined,
  ]);
  return { channelId, projectId, topicId, fileId, scriptId };
}

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
    /** What is open on screen. Every id is checked against the person
     *  asking (`screenIds`) before any turn sees it. */
    context?: Record<string, unknown>;
    /** The employee who answers by default on this screen; an @ in the
     *  message picks another. Absent means the personal assistant. */
    agent?: string;
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
   * Taken as hints, never as authority: each id is checked against the
   * person asking (`screenIds`) before any turn starts, so a client that
   * names a channel it cannot read gets exactly what a client that names
   * nothing gets — whoever answers. Whitelisted by key so an unknown field
   * cannot reach a tool at all.
   */
  const raw = body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {};
  const context = { module: typeof raw.module === "string" ? (raw.module as Module) : undefined };

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

  /* Started now and awaited just before the turn, so the checks overlap the
     conversation's own reads rather than delaying the first words. */
  const checkedIds = screenIds(viewer, raw).catch((err): ScreenIds => {
    /* A check that could not run keeps nothing: an unchecked id is exactly
       what this is here to stop. */
    console.error("[agent] could not check what is on screen", err);
    return {};
  });

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

  /*
   * Who answers. "@编剧 …" in the message hands the turn to that employee;
   * otherwise the screen's own employee answers (the panel on Research is
   * 研究员's); otherwise the person's own assistant. An employee answers as
   * itself: its own prompt, its own tools and budget, in the same thread.
   */
  const tagged = parseAgentMentions(content)[0] ?? null;
  const asked = typeof body.agent === "string" && AGENT_KEYS.includes(body.agent as AgentKey) ? (body.agent as AgentKey) : null;
  const speaker: AgentKey | null = tagged ?? asked;
  const speakerViewer = speaker ? await agentViewer(viewer.tenantId, speaker) : viewer;
  const speakerModule: Module = speaker ? ({ research: "research", planning: "research", script: "script", video: "video", article: "script" } as const)[speaker] : (context.module ?? "chat");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "conversation", id: conversationId });
      send({ type: "speaker", agent: speaker });

      /*
       * Who answered, kept on the answer's own row.
       *
       * The speaker used to exist only in this stream, so a reloaded thread —
       * or the same thread picked up in a side panel — drew every employee's
       * answer as the host's. `runAgent` creates the assistant row and names
       * it in its "message" event; the speaker is written onto that row as
       * soon as it exists rather than after the turn, so an answer that is cut
       * off half way still says who was speaking. Started without waiting, so
       * the first words are not held up by a database round trip, and settled
       * before the stream closes. Null (the person's own assistant) is the
       * column's default and needs no write.
       */
      let speakerSaved: Promise<unknown> | null = null;

      try {
        const ids = await checkedIds;
        /*
         * The same bound a turn in a channel has. Without it every
         * `assign_task` here started a chain of its own with a fresh budget,
         * and nothing stopped one message from handing 编剧 the same script
         * twice: two drafts, two bills. An employee's hand-off still runs at
         * hop 1 and the person's own assistant's at hop 0, as before; now
         * they share one budget, and a colleague is asked once per turn.
         */
        const team: NonNullable<ToolContext["team"]> = {
          hop: speaker ? 0 : -1,
          spoken: [],
          budget: { left: MAX_REPLIES },
          assigned: [],
          origin: viewer.nameLocal || viewer.name,
          later,
        };
        for await (const event of runAgent({
          viewer: speakerViewer,
          conversationId: conversationId!,
          content,
          // The employee's own trade when one answers; otherwise the screen
          // the question came from decides which tuning the prompt carries.
          module: speakerModule,
          /* `asker` is the person, whoever answers: an employee's tools
             check what they pick for somebody against the one who asked,
             not only against the employee (`ToolContext.asker`). */
          context: { ...context, ...ids, asker: viewer, team },
          signal: request.signal,
        })) {
          if (event.type === "message" && speaker && !speakerSaved) {
            speakerSaved = db
              .update(agentMessages)
              .set({ speaker })
              .where(and(eq(agentMessages.id, event.id), eq(agentMessages.conversationId, conversationId!)))
              .catch((err) => console.error("[agent] could not record who answered", err));
          }
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
        if (speakerSaved) await speakerSaved;
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
