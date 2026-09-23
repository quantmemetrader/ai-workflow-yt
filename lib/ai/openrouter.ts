import "server-only";
import { env } from "@/lib/env";
import { backendFor, estimateCostMicros } from "@/lib/ai/backend";

/**
 * OpenRouter client (spec §5: one aggregator, the client's own account, every
 * call metered).
 *
 * Written against the raw HTTP API rather than an SDK for three reasons: the
 * usage block carries OpenRouter's own cost figure, which is what the token
 * ledger must record; provider errors have to survive to the UI intact; and a
 * dead client dependency is one fewer thing to upgrade under a contract.
 */

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | {
      type: "usage";
      promptTokens: number;
      completionTokens: number;
      costMicros: number;
      model: string;
      /** The provider OpenRouter actually routed to, and its generation id.
       * §5 requires both in the ledger so a row can be reconciled against the
       * client's own OpenRouter activity log. */
      provider?: string;
      requestId?: string;
    }
  | { type: "error"; kind: AiErrorKind; message: string; status?: number };

/** What a provider might send back. Everything optional: this is the wire, and
 * several providers disagree about the shape even within OpenRouter. */
type ProviderPayload = {
  error?: { message?: string; code?: number | string; metadata?: unknown };
  choices?: {
    delta?: {
      content?: unknown;
      reasoning?: unknown;
      /** Fragments: providers disagree on whether `index` and `id` are sent,
       * and arguments arrive split across chunks. */
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: unknown };
      }[];
    };
    message?: {
      content?: unknown;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
    };
    error?: { message?: string; code?: number | string };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  model?: string;
  provider?: string;
  id?: string;
};

export type AiErrorKind = "credit" | "rate_limit" | "provider" | "network" | "bad_request";

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    // Never an empty message: `userMessage` interpolates it, and an empty
    // interpolation renders as a failure notice that says nothing.
    super(message.trim() || `the provider returned no detail${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AiError";
  }

  /** What the user is told. The brief is explicit: when the provider account
   * is out of credit, name the account and the provider, stop retrying, and
   * say plainly that it is not a platform fault. */
  get userMessage(): string {
    switch (this.kind) {
      case "credit":
        return "The OpenRouter account funding this assistant is out of credit. This is a billing state on that account, not a fault in the platform. An admin can top it up in Admin → Channels and credentials.";
      case "rate_limit":
        return "The model provider is rate-limiting this account right now. Nothing was charged. Try again shortly.";
      case "bad_request":
        return `The request was rejected by the provider: ${this.message}`;
      default:
        return `The model provider failed: ${this.message}`;
    }
  }
}

function classify(status: number, body: string): AiError {
  const message = extractMessage(body) || body.slice(0, 400).trim() || `the provider returned HTTP ${status}`;
  if (status === 402 || /insufficient|credit|quota|billing/i.test(message)) {
    return new AiError("credit", message, status);
  }
  if (status === 429) return new AiError("rate_limit", message, status);
  if (status === 400 || status === 422) return new AiError("bad_request", message, status);
  return new AiError("provider", message, status);
}

function extractMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.message ?? "";
    return typeof msg === "string" ? msg : JSON.stringify(msg);
  } catch {
    return "";
  }
}

/**
 * Dollars to micro-dollars, without binary drift.
 *
 * OpenRouter reports cost as a decimal like `0.0000123`. `0.0000123 * 1e6` on a
 * binary float is `12.299999999999999`, so a plain multiply-and-round silently
 * loses a micro-dollar here and there — and the ledger is what the client
 * bills against. Re-render the number as the decimal it was meant to be, then
 * shift the point six places, which is an exact operation on digits.
 */
export function usdToMicros(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(n) || n === 0) return 0;

  const [whole, frac = ""] = Math.abs(n).toFixed(12).split(".");
  const micros = Number(`${whole}${frac.slice(0, 6)}`) + (Number(frac[6] ?? "0") >= 5 ? 1 : 0);
  return n < 0 ? -micros : micros;
}

/**
 * Request-level provider policy (§5).
 *
 * `require_parameters` is not optional: OpenRouter drops parameters a provider
 * does not support *silently*, so without it a tool spec can vanish and the
 * agent answers from nothing at all with no error to explain why.
 *
 * Zero data retention is the other half of §5, but it is a routing filter —
 * every `:free` endpoint currently configured is refused outright under it
 * ("No endpoints found matching your data policy"), which would take the
 * assistant down while the client's account has no credit. So it is a switch,
 * defaulting off, to be turned on with the same edit that removes the free
 * models. It is also set at account level, which is where it belongs.
 */
function providerPolicy(hasTools: boolean): Record<string, unknown> | undefined {
  const policy: Record<string, unknown> = {};
  if (hasTools) policy.require_parameters = true;
  if (process.env.AI_ZERO_DATA_RETENTION === "true") policy.zdr = true;
  return Object.keys(policy).length ? policy : undefined;
}

/** How long one model attempt may take before we move on. Long enough for a
 * slow first token on a free endpoint, short enough that a stuck provider does
 * not become a spinner nobody can explain. */
const ATTEMPT_TIMEOUT_MS = Number(process.env.AI_ATTEMPT_TIMEOUT_MS ?? 60_000);

function withDeadline(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type StreamOptions = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Stable per-user string; OpenRouter uses it for abuse tracking only. */
  user?: string;
};

/**
 * Streams one completion. Yields text as it arrives, then any tool calls the
 * model asked for, then exactly one usage event with OpenRouter's own costing.
 */
export async function* streamChat(opts: StreamOptions): AsyncGenerator<StreamEvent> {
  // Which service answers. See `ai/backend.ts`: DeepSeek while OpenRouter has
  // no credit, OpenRouter the moment it does.
  const backend = backendFor(opts.model);
  const provider = backend.key === "openrouter" ? providerPolicy(Boolean(opts.tools?.length)) : undefined;
  const body = {
    model: backend.model,
    messages: opts.messages,
    stream: true,
    // Ask OpenRouter to append a usage block to the final chunk — this is the
    // number the token ledger records, not an estimate of ours. DeepSeek has
    // no such option and ignores it; its cost is estimated from tokens.
    ...(backend.reportsCost ? { usage: { include: true } } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.user ? { user: opts.user } : {}),
    ...(provider ? { provider } : {}),
  };

  const signal = withDeadline(opts.signal);

  /**
   * The client supplied two keys. Rate limits on OpenRouter are per key, so
   * when the first is being refused the second is the cheapest thing that can
   * help — cheaper than stepping down to a weaker model. Tried once, only for
   * refusals that are about the key rather than about the request.
   */
  /*
   * Two keys on OpenRouter, because rate limits there are per key: when the
   * first is being refused the second is the cheapest thing that can help,
   * cheaper than stepping down to a weaker model. DeepSeek has one key and no
   * such limit, so there is nothing to retry with.
   */
  const keys =
    backend.key === "openrouter"
      ? [env.openrouter.apiKey, env.openrouter.backupKey].filter(Boolean)
      : [backend.apiKey];

  const send = (key: string) =>
    fetch(`${backend.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...backend.headers,
      },
      body: JSON.stringify(body),
    });

  let res: Response;
  let attempt = 0;
  try {
    res = await send(keys[attempt]);

    if ((res.status === 429 || res.status === 402) && keys.length > 1) {
      attempt = 1;
      res = await send(keys[attempt]);
    }
  } catch (err) {
    // A deadline that fired is a provider that never answered; treat it like a
    // refusal so the caller steps down to the next model.
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiError("rate_limit", `${opts.model} did not respond within ${ATTEMPT_TIMEOUT_MS / 1000}s`);
    }
    if (opts.signal?.aborted) throw err;
    throw new AiError("network", err instanceof Error ? err.message : String(err));
  }

  if (!res.ok || !res.body) {
    throw classify(res.status, await res.text().catch(() => ""));
  }

  // A provider can answer a streaming request with one plain JSON completion —
  // free endpoints do it regularly. Parsed as SSE that body has no `data:`
  // line, so the loop below would yield nothing at all: no answer, no usage,
  // no error, just a turn that ends silently having cost money.
  if (!(res.headers.get("content-type") ?? "").includes("event-stream")) {
    const text = await res.text();
    let json: ProviderPayload;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AiError("provider", `${opts.model} returned a body that is neither a stream nor JSON`);
    }
    if (json?.error) throw classify(Number(json.error.code) || res.status, text);
    yield* fromCompletion(json, opts.model);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** Tool calls arrive in fragments across chunks, keyed by index. */
  const partialTools = new Map<number | string, { id: string; name: string; arguments: string }>();
  /** Not every provider sends `index`; a fragment with neither index nor id
   * continues the call the previous fragment opened. */
  let lastToolKey: number | string = 0;
  /** Usage totals already reported to the caller. A provider that sends more
   * than one usage block sends it cumulatively, and billing an employee twice
   * for one call is worse than any rounding — only increments go out. */
  const sent = { promptTokens: 0, completionTokens: 0, costMicros: 0 };
  let sawUsage = false;

  let streamDone = false;
  while (!streamDone) {
    let value: Uint8Array | undefined;
    try {
      const read = await reader.read();
      streamDone = read.done;
      value = read.value;
    } catch (err) {
      // The deadline can also fire mid-stream, after headers arrived. Same
      // meaning: this model is not going to finish, so let the caller move on.
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new AiError("rate_limit", `${opts.model} stalled mid-answer`);
      }
      throw err;
    }
    buffer += streamDone ? decoder.decode() : decoder.decode(value!, { stream: true });
    // The last frame often arrives with no newline after it, and the last
    // frame is the one carrying `usage`. Terminate it rather than drop it.
    if (streamDone && buffer && !buffer.endsWith("\n")) buffer += "\n";

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      let chunk: ProviderPayload;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const failure = chunk.error ?? chunk.choices?.[0]?.error;
      if (failure) {
        throw classify(Number(failure.code) || 500, JSON.stringify({ error: failure }));
      }

      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) {
        yield { type: "text", text: delta.content };
      }
      if (typeof delta?.reasoning === "string" && delta.reasoning) {
        yield { type: "reasoning", text: delta.reasoning };
      }

      for (const call of delta?.tool_calls ?? []) {
        const key: number | string =
          typeof call.index === "number" ? call.index : call.id ? `id:${call.id}` : lastToolKey;
        lastToolKey = key;
        const slot = partialTools.get(key) ?? { id: "", name: "", arguments: "" };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        if (typeof call.function?.arguments === "string") slot.arguments += call.function.arguments;
        partialTools.set(key, slot);
      }

      if (chunk.usage) {
        const promptTokens = Number(chunk.usage.prompt_tokens ?? 0);
        const completionTokens = Number(chunk.usage.completion_tokens ?? 0);
        // OpenRouter reports cost in dollars; micros keeps the arithmetic exact.
        const costMicros = usdToMicros(chunk.usage.cost);
        const step = {
          promptTokens: promptTokens - sent.promptTokens,
          completionTokens: completionTokens - sent.completionTokens,
          costMicros: costMicros - sent.costMicros,
        };
        if (!sawUsage || step.promptTokens > 0 || step.completionTokens > 0 || step.costMicros > 0) {
          sawUsage = true;
          sent.promptTokens = promptTokens;
          sent.completionTokens = completionTokens;
          sent.costMicros = costMicros;
          yield {
            type: "usage",
            ...step,
            model: chunk.model ?? opts.model,
            provider: chunk.provider,
            requestId: chunk.id,
          };
        }
      }
    }
  }

  let unnamed = 0;
  for (const call of partialTools.values()) {
    if (!call.name) continue;
    // Some providers omit the call id. An empty `tool_call_id` on the reply is
    // a 400 from the next request, which would lose the tool result and fail
    // the turn, so give it one of ours.
    yield {
      type: "tool_call",
      id: call.id || `call_${++unnamed}`,
      name: call.name,
      arguments: call.arguments,
    };
  }
}

/** The same events, from a provider that answered a stream request with one
 * whole completion. */
function* fromCompletion(json: ProviderPayload, fallbackModel: string): Generator<StreamEvent> {
  const message = json?.choices?.[0]?.message;
  if (typeof message?.content === "string" && message.content) {
    yield { type: "text", text: message.content };
  }
  let unnamed = 0;
  for (const call of message?.tool_calls ?? []) {
    if (!call?.function?.name) continue;
    yield {
      type: "tool_call",
      id: call.id || `call_${++unnamed}`,
      name: call.function.name,
      // Arguments are JSON text on the wire, but a provider that sends an
      // object rather than a string would otherwise reach the tool as "[object
      // Object]".
      arguments:
        typeof call.function.arguments === "string"
          ? call.function.arguments
          : call.function.arguments
            ? JSON.stringify(call.function.arguments)
            : "",
    };
  }
  if (json?.usage) {
    yield {
      type: "usage",
      promptTokens: Number(json.usage.prompt_tokens ?? 0),
      completionTokens: Number(json.usage.completion_tokens ?? 0),
      costMicros: usdToMicros(json.usage.cost),
      model: json.model ?? fallbackModel,
      provider: json.provider,
      requestId: json.id,
    };
  }
}

/** Non-streaming helper for short internal calls (titles, extraction). */
export async function complete(opts: Omit<StreamOptions, "tools">): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  model: string;
  provider?: string;
  requestId?: string;
}> {
  /*
   * Which service answers. OpenRouter normally; DeepSeek while the OpenRouter
   * account has no credit and every call would otherwise fall to a free
   * reasoning endpoint that never reaches its answer. See `ai/backend.ts`.
   */
  const backend = backendFor(opts.model);
  const provider = backend.key === "openrouter" ? providerPolicy(false) : undefined;

  let res: Response;
  try {
    res = await fetch(`${backend.baseUrl}/chat/completions`, {
      method: "POST",
      // Without a deadline a free endpoint that never answers holds this call
      // open for as long as the runtime allows.
      signal: withDeadline(opts.signal),
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        "Content-Type": "application/json",
        ...backend.headers,
      },
      body: JSON.stringify({
        model: backend.model,
        messages: opts.messages,
        // OpenRouter's own costing. DeepSeek has no such field and ignores it.
        ...(backend.reportsCost ? { usage: { include: true } } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(provider ? { provider } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiError("rate_limit", `${backend.model} did not respond within ${ATTEMPT_TIMEOUT_MS / 1000}s`);
    }
    if (opts.signal?.aborted) throw err;
    throw new AiError("network", err instanceof Error ? err.message : String(err));
  }

  const raw = await res.text();
  if (!res.ok) throw classify(res.status, raw);

  let json: ProviderPayload;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AiError("provider", `${opts.model} returned a body that is not JSON`);
  }
  // A 200 carrying an error object is how several providers refuse. Left
  // unchecked it reads as a successful call that produced nothing.
  if (json?.error) throw classify(Number(json.error.code) || 200, raw);

  const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
  const completionTokens = Number(json.usage?.completion_tokens ?? 0);

  return {
    text: typeof json.choices?.[0]?.message?.content === "string" ? json.choices[0].message.content : "",
    promptTokens,
    completionTokens,
    /* OpenRouter bills us and says what it charged, so that figure is the
       truth. DeepSeek returns tokens only, so this is our own arithmetic at
       its published rates — an estimate, and the ledger records which
       provider answered so the difference is visible. */
    costMicros: backend.reportsCost
      ? usdToMicros(json.usage?.cost)
      : estimateCostMicros(promptTokens, completionTokens),
    model: json.model ?? backend.model,
    provider: json.provider ?? backend.key,
    requestId: json.id,
  };
}
