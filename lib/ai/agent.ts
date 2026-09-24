import "server-only";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, citations as citationsTable, files, folders, toolCalls } from "@/lib/db/schema";
import type { Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { canReadFiles, relationOn } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { AiError, streamChat, type ChatMessage, type StreamEvent } from "./openrouter";
import { BudgetStop, assertBudget, budgetState, notifyBudgetStop, recordUsage, type BudgetState } from "./ledger";
import { labelFor, modelFor } from "./models";
import { assemblePrompt } from "./prompt";
import { runTool, toolsFor } from "./tools";
import type { ToolContext } from "./tools/types";

/**
 * One turn of the employee's agent (spec §4.2, §5).
 *
 * Shape of a turn: check the budget, take the question, let the model call
 * tools until it has what it needs, stream the answer, then write down what it
 * read, what it spent and what it ran. Everything the screen shows — the
 * streaming text, the tool trace, the citation list, the cost — comes from
 * this generator, so what the user watched is exactly what got persisted.
 */
export type AgentEvent =
  | { type: "message"; id: string }
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name: string; status: "running" | "ok" | "error"; summary?: string }
  | {
      type: "citations";
      files: { id: string; name: string; kind: string; folder: string | null; relation: string | null }[];
      withheld: boolean;
    }
  | { type: "notice"; text: string }
  | {
      type: "usage";
      model: string;
      costMicros: number;
      promptTokens: number;
      completionTokens: number;
      usedMicros: number;
      capMicros: number | null;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; kind: string; message: string };

/**
 * How many times the model may call tools before it has to answer.
 *
 * Four was enough for "summarise this channel". Cutting a video is look,
 * find, cut, add, add, check — and a turn that ran out of rounds halfway
 * through "put a name on and punch in on the number" left the name on and
 * the number alone. The editing modules get more room; the others keep the
 * cost of a turn where it was.
 */
const ROUNDS_BY_MODULE: Partial<Record<Module, number>> = { video: 9, script: 6, research: 6 };
const DEFAULT_ROUNDS = 4;
const HISTORY = 20;

export async function* runAgent(opts: {
  viewer: Viewer;
  conversationId: string;
  content: string;
  module?: Module;
  /**
   * What is open on screen when they asked.
   *
   * Without it, "summarise this channel" and "cut that bit out" are
   * unanswerable: the model would have to guess an id, and a guessed id is
   * either wrong or somebody else's. Every field is re-checked against the
   * viewer inside the tool that uses it, so a client sending an id it cannot
   * read gets the same answer as one sending nothing.
   */
  context?: Omit<ToolContext, "viewer">;
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { viewer, conversationId, content, signal } = opts;
  const startedAt = Date.now();

  // 1. The question goes in the record before anything can fail — including
  //    the budget check below, which used to drop it on the floor so a person
  //    at their cap reloaded the thread and found their own message gone.
  await db.insert(agentMessages).values({
    id: newId("am"),
    conversationId,
    role: "user",
    content,
    status: "complete",
  });

  // A turn whose process died — a deploy, a pm2 reload, a crash — leaves its
  // assistant row `streaming` for ever, and the thread renders a spinner that
  // never resolves. Nothing sweeps them, so close out what this conversation
  // left behind before opening a new one. Older than `maxDuration`, so a turn
  // that is genuinely still running is not shot in the back.
  await db
    .update(agentMessages)
    .set({ status: "failed", error: "The answer was interrupted before it finished." })
    .where(
      and(
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.status, "streaming"),
        lt(agentMessages.createdAt, new Date(Date.now() - 300_000)),
      ),
    );

  // 2. The cap is a stop, not a warning (§4.11).
  let budget: BudgetState;
  try {
    budget = await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) {
      // Telling people must not itself be able to break the telling.
      await notifyBudgetStop(viewer, err.state).catch((e) =>
        console.error("[agent] budget notification failed", e),
      );
      yield {
        type: "error",
        kind: "budget",
        message:
          "Your AI budget for this period is used up, so the assistant has stopped. An admin can raise the cap in Admin → Budgets.",
      };
      return;
    }
    throw err;
  }

  const assistantId = newId("am");
  await db.insert(agentMessages).values({
    id: assistantId,
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
    module: opts.module,
  });
  yield { type: "message", id: assistantId };

  // The most recent HISTORY messages, back in order. Ordering ascending and
  // taking the first HISTORY rows froze the context at the opening of a long
  // thread — past twenty messages the model stopped being shown the question
  // it was being asked, and answered an old one instead.
  const history = (
    await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(HISTORY)
  ).reverse();

  const { text: system } = await assemblePrompt(viewer, opts.module);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history
      .filter((m) => m.id !== assistantId && m.content.trim() && (m.role === "user" || m.role === "assistant"))
      .map((m) =>
        m.role === "user"
          ? ({ role: "user", content: m.content } as ChatMessage)
          : ({ role: "assistant", content: m.content } as ChatMessage),
      ),
  ];

  const tools = toolsFor(viewer);
  const citedFileIds = new Set<string>();
  let answer = "";
  let withheldAny = false;
  let model = modelFor.assistant();
  /** Models still untried if the current one refuses. */
  const fallbacks = modelFor.fallbacks().filter((m) => m !== model);
  let toldAboutFallback = false;
  let totalCost = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  /** The first out-of-credit refusal seen, kept so the chain can end with the
   * message §5 requires rather than whatever the last free model said. */
  let creditError: AiError | null = null;
  /** What this turn may still spend. The cap is checked once before the turn,
   * but a turn is up to five model calls, so without this an employee one cent
   * under their cap could walk a long way past it before the next check. */
  const allowance = budget.remainingMicros;
  let budgetStopped = false;
  /** What the tools changed this turn, in their own words. */
  const changes: string[] = [];

  /** Every model call goes through here, so none of them can escape the
   * ledger (§5): user, module, model, provider, tokens, cost, request id. */
  const meter = async (ev: Extract<StreamEvent, { type: "usage" }>) => {
    totalCost += ev.costMicros;
    totalPrompt += ev.promptTokens;
    totalCompletion += ev.completionTokens;
    model = ev.model || model;
    await recordUsage({
      viewer,
      module: opts.module ?? "chat",
      model: ev.model,
      provider: ev.provider,
      promptTokens: ev.promptTokens,
      completionTokens: ev.completionTokens,
      costMicros: ev.costMicros,
      latencyMs: Date.now() - startedAt,
      conversationId,
      messageId: assistantId,
      requestId: ev.requestId,
    });
  };

  const outOfAllowance = () => allowance !== null && totalCost >= allowance;

  const MAX_ROUNDS = (opts.module && ROUNDS_BY_MODULE[opts.module]) || DEFAULT_ROUNDS;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal?.aborted) break;
      if (outOfAllowance()) {
        budgetStopped = true;
        break;
      }

      const pendingCalls: { id: string; name: string; arguments: string }[] = [];
      let roundText = "";

      const stream = streamChat({ model, messages, tools, signal, user: viewer.id });

      try {
        for await (const ev of stream) {
          if (ev.type === "text") {
            roundText += ev.text;
            answer += ev.text;
            yield { type: "delta", text: ev.text };
          } else if (ev.type === "tool_call") {
            pendingCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
          } else if (ev.type === "usage") {
            await meter(ev);
          }
        }
      } catch (err) {
        const aiErr = err instanceof AiError ? err : null;
        if (aiErr?.kind === "credit" && !creditError) creditError = aiErr;

        // Out of credit, or the provider is refusing: step down the fallback
        // chain rather than leaving the employee with nothing, and say why.
        // But only while this round has said nothing — earlier rounds are
        // already in `messages`, so the next model continues from them, while
        // re-running a round that had begun speaking restarts the sentence and
        // saves a message spliced together from two different attempts.
        const retryable = aiErr !== null && (aiErr.kind === "credit" || aiErr.kind === "rate_limit");
        if (retryable && fallbacks.length && !roundText) {
          const next = fallbacks.shift()!;
          const reason = aiErr.kind === "credit" ? "is out of credit" : "is being rate-limited";
          model = next;
          if (!toldAboutFallback) {
            toldAboutFallback = true;
            yield {
              type: "notice",
              text: `The OpenRouter account ${reason}, so this answer is using a free fallback model. Quality is lower and it may refuse under load. An admin can top the account up in Admin → Channels and credentials.`,
            };
          }
          // Re-run this round against the next model; nothing was charged.
          // Bounded: each pass consumes one entry from a finite chain.
          round--;
          continue;
        }
        // §5: when the account is out of credit, say so and stop. If the chain
        // began with a credit refusal, that is what the employee is told —
        // not whatever the last free model happened to say on the way down.
        throw creditError ?? err;
      }

      if (!pendingCalls.length) break;

      const lastRound = round === MAX_ROUNDS - 1;

      messages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: pendingCalls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      });

      for (const call of pendingCalls) {
        const rowId = newId("tc");
        yield { type: "tool", id: rowId, name: call.name, status: "running" };
        const began = Date.now();

        let result;
        let failed: string | null = null;
        try {
          result = await runTool(viewer, call.name, call.arguments, opts.context ?? {});
        } catch (err) {
          failed = err instanceof Error ? err.message : String(err);
          result = { text: `The tool failed: ${failed}` };
        }

        result.citations?.forEach((id) => citedFileIds.add(id));
        if (result.withheld) withheldAny = true;
        /* A tool that changed something, and what it says it did. If the model
           then says nothing, this is what the person is told — because
           "nothing was lost, ask again" after a lower third has been added is
           how you end up with two lower thirds. */
        if (result.changed && !failed) changes.push(result.text.trim());

        // The trace is a record of the turn, not part of it: if writing the
        // row fails, the tool result still has to reach the model below.
        try {
          await db.insert(toolCalls).values({
            id: rowId,
            messageId: assistantId,
            name: call.name,
            module: opts.module,
            args: safeParse(call.arguments),
            result: result.text.slice(0, 4000),
            status: failed ? "error" : "ok",
            error: failed,
            durationMs: Date.now() - began,
          });
        } catch (err) {
          console.error("[agent] failed to record tool call", err);
        }

        yield {
          type: "tool",
          id: rowId,
          name: call.name,
          status: failed ? "error" : "ok",
          summary: summarise(call.name, call.arguments, result.text),
        };

        messages.push({ role: "tool", content: result.text, tool_call_id: call.id });
      }

      if (lastRound && !signal?.aborted) {
        if (outOfAllowance()) {
          budgetStopped = true;
          break;
        }
        // Tools are withdrawn for the closing call: the model has everything it
        // is going to get, and its job now is to answer. It used to have no
        // fallback of its own, so a single refusal here threw away four rounds
        // of tool work and handed the employee an error instead of an answer
        // drawn from everything that had already been read.
        let closingText = "";
        for (;;) {
          try {
            for await (const ev of streamChat({ model, messages, signal, user: viewer.id })) {
              if (ev.type === "text") {
                closingText += ev.text;
                answer += ev.text;
                yield { type: "delta", text: ev.text };
              } else if (ev.type === "usage") {
                await meter(ev);
              }
            }
            break;
          } catch (err) {
            const aiErr = err instanceof AiError ? err : null;
            if (aiErr?.kind === "credit" && !creditError) creditError = aiErr;
            const retryable = aiErr !== null && (aiErr.kind === "credit" || aiErr.kind === "rate_limit");
            if (!retryable || !fallbacks.length || closingText) throw creditError ?? err;
            model = fallbacks.shift()!;
          }
        }
      }
    }

    if (budgetStopped) {
      const state = await budgetState(viewer);
      await notifyBudgetStop(viewer, state).catch((e) =>
        console.error("[agent] budget notification failed", e),
      );
      yield {
        type: "notice",
        text: "This answer stopped part-way: the AI budget for this period is now used up. An admin can raise the cap in Admin → Budgets.",
      };
    }

    // 3. Citations: the files this answer actually rests on, re-checked so a
    // file whose access changed mid-turn cannot slip into the list.
    const folderNames = new Map<string, string>(
      (
        await db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(eq(folders.tenantId, viewer.tenantId))
      ).map((f) => [f.id, f.name]),
    );

    const cited = citedFileIds.size
      ? await db
          .select({ id: files.id, name: files.name, kind: files.kind, folderId: files.folderId })
          .from(files)
          // The re-check the comment promises, actually made: the reader's own
          // predicate, so a grant revoked during the turn takes the title back
          // out of the list. §2.2.4 — a leaked title discloses that a document
          // exists, and this query used to fetch by id alone.
          .where(
            and(
              inArray(files.id, [...citedFileIds]),
              eq(files.tenantId, viewer.tenantId),
              isNull(files.deletedAt),
              canReadFiles(viewer),
            ),
          )
      : [];
    if (cited.length < citedFileIds.size) withheldAny = true;

    if (cited.length) {
      await db.insert(citationsTable).values(
        cited.map((c) => ({ id: newId("cit"), messageId: assistantId, fileId: c.id })),
      );

      // The sources panel names the relation the reader holds on each file, so
      // "why am I allowed to see this" is answerable without leaving the chat.
      const withRelation = await Promise.all(
        cited.map(async (c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          folder: c.folderId ? folderNames.get(c.folderId) ?? null : null,
          relation: await relationOn(viewer, "file", c.id),
        })),
      );
      yield { type: "citations", files: withRelation, withheld: withheldAny };
    } else if (withheldAny) {
      // Nothing citable, but matches were filtered out. The employee still has
      // to know the answer is partial (brief: Chat states) — without that the
      // banner only ever appeared on answers that found something.
      yield { type: "citations", files: [], withheld: true };
    }

    /*
     * Asked to answer, one more time, with nothing to hide behind.
     *
     * A round can come back with neither a sentence nor a tool call — an empty
     * assistant message, which several endpoints produce under load and
     * qwen3-max produces often enough to matter. The loop reads that as "it
     * has finished" and breaks, and the turn ends silent although everything
     * it needed was already in `messages`. This is one more call with the
     * tools withdrawn, which is the same thing the last round would have done.
     *
     * Once, and only when the turn has nothing at all to show: it costs a
     * short completion, and the alternative is an AI employee that answers a
     * tag with "I could not answer just now".
     */
    if (!answer.trim() && !changes.length && !budgetStopped && !signal?.aborted && !outOfAllowance()) {
      try {
        for await (const ev of streamChat({ model, messages, signal, user: viewer.id })) {
          if (ev.type === "text") {
            answer += ev.text;
            yield { type: "delta", text: ev.text };
          } else if (ev.type === "usage") {
            await meter(ev);
          }
        }
      } catch (err) {
        // The error the turn reports below is the better one: this was a
        // second chance, not the attempt.
        console.error("[agent] the closing retry failed", err);
      }
    }

    /*
     * Silent, but it did something.
     *
     * A model that calls two tools and then produces no closing sentence is
     * common on the cheaper endpoints. The work happened, so the turn reports
     * it rather than erroring: an "ask again" after a change has been written
     * invites somebody to make the same change twice.
     */
    if (!answer.trim() && changes.length && !signal?.aborted) {
      answer = changes.join(" ");
      yield { type: "delta", text: answer };
    }

    if (!answer.trim() && !signal?.aborted) {
      yield {
        type: "error",
        kind: "empty",
        message: toldAboutFallback
          ? "The model returned nothing. Free fallback models refuse under load — an admin can top up the OpenRouter account in Admin → Channels and credentials for a reliable one."
          : `${labelFor(model)} returned no answer. Nothing was lost — ask again.`,
      };
    }

    await db
      .update(agentMessages)
      .set({
        content: answer,
        status: signal?.aborted ? "stopped" : answer.trim() ? "complete" : "failed",
        model,
        promptTokens: totalPrompt,
        completionTokens: totalCompletion,
        costMicros: totalCost,
        latencyMs: Date.now() - startedAt,
        withheld: withheldAny,
      })
      .where(eq(agentMessages.id, assistantId));

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    const state = await budgetState(viewer);
    yield {
      type: "usage",
      model,
      costMicros: totalCost,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      usedMicros: state.usedMicros,
      capMicros: state.capMicros,
    };
    yield { type: "done", messageId: assistantId };

    await audit(viewer, "agent.answer", {
      objectType: "conversation",
      objectId: conversationId,
      module: opts.module ?? "chat",
      meta: { model, costMicros: totalCost, tools: citedFileIds.size },
    });
  } catch (err) {
    // The reader pressed stop, or closed the tab. The provider call was
    // aborted with them, nothing is wrong, and calling it a provider failure —
    // which is what "The operation was aborted" rendered as — is a lie told to
    // the next person who opens the thread. Keep what was streamed, record
    // what it cost, and say it was stopped.
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      await db
        .update(agentMessages)
        .set({
          content: answer,
          status: "stopped",
          model,
          promptTokens: totalPrompt,
          completionTokens: totalCompletion,
          costMicros: totalCost,
          latencyMs: Date.now() - startedAt,
          withheld: withheldAny,
        })
        .where(eq(agentMessages.id, assistantId));
      return;
    }

    const aiErr = err instanceof AiError ? err : null;
    const raw = aiErr ? aiErr.userMessage : err instanceof Error ? err.message : String(err);
    // An empty error would render as a message that silently says nothing;
    // the screen must always be able to state what went wrong.
    const message =
      raw.trim() ||
      "The model provider stopped without saying why. Nothing was charged — try again.";

    await db
      .update(agentMessages)
      .set({
        content: answer,
        status: "failed",
        error: message,
        model,
        // A turn that failed half-way still spent what it spent. Leaving these
        // at zero made the message disagree with the ledger it is billed from.
        promptTokens: totalPrompt,
        completionTokens: totalCompletion,
        costMicros: totalCost,
        latencyMs: Date.now() - startedAt,
        withheld: withheldAny,
      })
      .where(eq(agentMessages.id, assistantId));

    yield { type: "error", kind: aiErr?.kind ?? "provider", message };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return { raw: s };
  }
}

/** One line the UI can show next to a tool chip — what it did, not how. */
function summarise(name: string, args: string, result: string): string {
  const a = safeParse(args);
  switch (name) {
    case "search_files":
      return `Searched files for “${a.query ?? ""}” · ${result.startsWith("No documents") ? "no matches" : `${result.split("\n- ").length - 1 || 1} result(s)`}`;
    case "read_file":
      return `Read ${result.split("\n")[0].replace(/^#\s*/, "") || "a document"}`;
    case "list_recent_files":
      return "Listed recent files";
    case "create_document":
      return result;
    case "check_ai_spend":
      return result;
    case "describe_timeline":
      return "Looked at the timeline";
    case "find_in_transcript":
      return `Searched the transcript for “${a.query ?? ""}”`;
    case "list_clips":
      return "Listed the clips in the bin";
    case "list_pictures":
    case "find_a_picture":
      return `Looked for a picture${a.query ? ` of “${a.query}”` : ""}`;
    case "creator_videos":
      return `Looked at the channel's own videos${a.query ? ` for “${a.query}”` : ""}`;
    case "creator_video":
      return "Read one of the channel's videos";
    case "list_topics":
      return "Listed the watched topics";
    case "read_topic":
      return `Read the topic “${a.phrase ?? ""}”`;
    case "list_scripts":
      return "Listed the scripts";
    case "read_script":
      return "Read the script";
    default:
      /* Anything that changed something says what it did in its own words:
         "Cut 0:14–0:19", "Punch in ×1.15 at 1:02", "Written: …". */
      return result.split("\n")[0].slice(0, 160) || name;
  }
}

/** A conversation gets its title from its first exchange, in the background —
 * a cheap model, and a failure here never touches the answer. */
export async function titleConversation(viewer: Viewer, conversationId: string, firstMessage: string) {
  const { complete } = await import("./openrouter");
  try {
    // Cheap is not free, and §5 admits no unmetered call. A person at their
    // cap does not get a titling call charged to them behind the answer that
    // was already refused.
    const state = await budgetState(viewer);
    if (state.stopped) return;

    const res = await complete({
      model: modelFor.utility(),
      // Six words fit in 24 tokens, but a reasoning model — which is what the
      // free utility slot currently is — spends its whole allowance thinking
      // and returns empty content, so every conversation stayed "New chat"
      // and every one of those calls was billed for nothing. Room to think,
      // and the title is taken from the first line it actually writes.
      maxTokens: 160,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Title this work conversation in at most six words, in the language of the message. No quotes, no trailing punctuation.",
        },
        { role: "user", content: firstMessage.slice(0, 500) },
      ],
    });

    // Recorded whether or not a usable title came back: the call happened and
    // was billed either way, and metering it only on success is exactly how a
    // ledger stops matching the provider's invoice.
    await recordUsage({
      viewer,
      module: "chat",
      model: res.model,
      provider: res.provider,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costMicros: res.costMicros,
      conversationId,
      requestId: res.requestId,
    });

    // First line only, and only as many words as were asked for: a weak model
    // answers the question instead of titling it, and a sentence cut off at 80
    // characters reads worse in the thread list than no title at all.
    const title = (res.text.split("\n").map((l) => l.trim()).find(Boolean) ?? "")
      .replace(/^["“']+|["”']+$/g, "")
      .split(/\s+/)
      .slice(0, 8)
      .join(" ")
      .replace(/[,.;:，。、]+$/, "")
      .slice(0, 80);
    if (title) {
      await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
    }
  } catch {
    // A conversation with a default title is not a failure worth surfacing.
  }
}
