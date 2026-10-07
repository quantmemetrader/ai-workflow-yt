import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AiError, type ChatMessage, type StreamEvent, type StreamOptions } from "@/lib/ai/openrouter";

/**
 * Claude straight from Anthropic (7 Oct).
 *
 * The studio's OpenRouter account is refused by Anthropic, and every gateway
 * in between is somebody else's account that can be cut off. With an
 * Anthropic API key saved (员工管理 › 渠道与凭据), `anthropic/*` models are
 * called here instead: Anthropic's own SDK and Messages API, no reseller.
 *
 * The rest of the app speaks the OpenAI chat shape (`ChatMessage`,
 * `StreamEvent`), so this file translates both ways. Three things are not a
 * straight translation, and each is here for a reason:
 *
 *   — No `temperature`. Sonnet 5.5 and Opus 5.5 answer a non-default
 *     sampling setting with a 400.
 *   — Thinking is left to the model (adaptive, the default); it cannot be
 *     switched off on these models. A short answer is asked for with low
 *     effort and enough `max_tokens` to think and still answer.
 *   — A turn that calls tools is kept exactly as Anthropic sent it and sent
 *     back unchanged on the next round. Its thinking blocks are bound to the
 *     conversation that made them; a rebuilt turn without them is rejected.
 */

export function anthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

/** Whether this model is answered by Anthropic directly. */
export function isAnthropicDirect(model: string): boolean {
  return Boolean(anthropicKey()) && model.startsWith("anthropic/");
}

/** `anthropic/claude-sonnet-5.5` is `claude-sonnet-5-5` to Anthropic. */
export function anthropicModelId(model: string): string {
  return model.replace(/^anthropic\//, "").replace(/\./g, "-");
}

/** US$ per million tokens, Anthropic's list prices (input, output). */
const PRICES: [RegExp, number, number][] = [
  [/fable|mythos/, 10, 50],
  [/opus-5-5/, 4, 20],
  [/opus/, 5, 25],
  [/sonnet-5/, 2, 10],
  [/sonnet/, 3, 15],
  [/haiku/, 1, 5],
];

function costMicros(model: string, usage: Anthropic.Usage): number {
  const [, inPerM, outPerM] = PRICES.find(([re]) => re.test(model)) ?? [/./, 4, 20];
  const fresh = usage.input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  /* Micro-dollars: tokens × $/MTok is already millionths of a dollar. */
  return Math.round(fresh * inPerM + written * inPerM * 1.25 + read * inPerM * 0.1 + (usage.output_tokens ?? 0) * outPerM);
}

/* Tool-calling turns as Anthropic sent them, by the id of their first tool call, for the next round of the same loop. */
const kept = new Map<string, Anthropic.ContentBlockParam[]>();
function keep(id: string, content: Anthropic.ContentBlock[]) {
  kept.set(id, content as unknown as Anthropic.ContentBlockParam[]);
  if (kept.size > 400) for (const k of kept.keys()) {
    kept.delete(k);
    if (kept.size <= 300) break;
  }
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "call";

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The app's chat history as Anthropic's `system` + `messages`. */
export function toAnthropic(messages: ChatMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system: string[] = [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      /* The first is the instructions; a later one is a note from the app, kept in order as a user-side note. */
      if (!out.length) system.push(m.content);
      else if (m.content.trim()) out.push({ role: "user", content: `[系统提示] ${m.content}` });
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content.trim() ? m.content : "（空）" });
    } else if (m.role === "assistant") {
      const calls = m.tool_calls ?? [];
      if (calls.length) {
        const stored = kept.get(calls[0].id);
        out.push({
          role: "assistant",
          content:
            stored ??
            [
              ...(m.content?.trim() ? [{ type: "text" as const, text: m.content }] : []),
              ...calls.map((c) => ({ type: "tool_use" as const, id: safeId(c.id), name: c.function.name, input: parseArgs(c.function.arguments) })),
            ],
        });
      } else if (m.content?.trim()) {
        out.push({ role: "assistant", content: m.content });
      }
    } else {
      /* Tool results ride in a user message; several in a row are one message, as the API expects. */
      const t = m as Extract<ChatMessage, { role: "tool" }>;
      const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: safeId(t.tool_call_id), content: t.content || "（无结果）" };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "（开始）" });
  return { system: system.join("\n\n"), messages: out };
}

function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError("provider", "Anthropic does not recognise this API key", 401);
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError("provider", `Anthropic refused this request: ${err.message}`, 403);
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate_limit", err.message, 429);
  if (err instanceof Anthropic.BadRequestError) {
    return /credit balance|billing/i.test(err.message) ? new AiError("credit", err.message, 402) : new AiError("bad_request", err.message, 400);
  }
  if (err instanceof Anthropic.APIConnectionError) return new AiError("network", err.message);
  if (err instanceof Anthropic.APIError) return new AiError("provider", err.message, typeof err.status === "number" ? err.status : undefined);
  return new AiError("network", err instanceof Error ? err.message : String(err));
}

/** One streamed answer from Anthropic, as the events the rest of the app reads. */
export async function* streamAnthropic(opts: StreamOptions): AsyncGenerator<StreamEvent> {
  const client = new Anthropic({ apiKey: anthropicKey(), maxRetries: 1 });
  const model = anthropicModelId(opts.model);
  const { system, messages } = toAnthropic(opts.messages);
  const short = Boolean(opts.maxTokens && opts.maxTokens < 1500);
  try {
    const stream = client.messages.stream(
      {
        model,
        /* Thinking shares this ceiling, so a small ask still gets room to think and answer. */
        max_tokens: Math.max(opts.maxTokens ?? 32_000, 4_000),
        ...(system ? { system } : {}),
        messages,
        ...(opts.tools?.length
          ? { tools: opts.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters as Anthropic.Tool.InputSchema })) }
          : {}),
        ...(short ? { output_config: { effort: "low" as const } } : {}),
        ...(opts.user ? { metadata: { user_id: opts.user } } : {}),
      },
      { signal: opts.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        yield { type: "text", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new AiError("provider", "Claude declined this request", 403);
    const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length) {
      /* Cut off mid-call: the arguments are not to be trusted, and the turn is not replayed. */
      if (final.stop_reason === "max_tokens") throw new AiError("provider", "Claude ran out of room in the middle of a tool call", 500);
      keep(calls[0].id, final.content);
      for (const c of calls) yield { type: "tool_call", id: c.id, name: c.name, arguments: JSON.stringify(c.input ?? {}) };
    }
    yield {
      type: "usage",
      promptTokens: (final.usage.input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0),
      completionTokens: final.usage.output_tokens ?? 0,
      costMicros: costMicros(model, final.usage),
      model: opts.model,
      provider: "Anthropic",
      requestId: final.id,
    };
  } catch (err) {
    throw toAiError(err);
  }
}

/** For the keys screen: does this key reach Claude? Free: it reads one model's description. */
export async function testAnthropicKey(key: string): Promise<{ ok: boolean; note: string }> {
  try {
    const m = await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 }).models.retrieve("claude-sonnet-5-5");
    return { ok: true, note: `有效 · 可以直接用 ${m.display_name}` };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, note: "Anthropic 不认这个密钥" };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, note: "Anthropic 拒绝了这个账号（地区或权限问题）" };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, note: "连不上 Anthropic，稍后再试" };
    return { ok: false, note: `没通过：${err instanceof Error ? err.message.slice(0, 100) : "未知错误"}` };
  }
}
