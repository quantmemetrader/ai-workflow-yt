import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { AiError, usdToMicros } from "@/lib/ai/openrouter";
import type { Module } from "@/lib/db/schema";

/**
 * The vision gate: a model looks before anything goes on the timeline.
 *
 * Three questions, each its own call, each answered as JSON at temperature
 * zero (PLAN.md §2 Stage 0 item 6, prompts from the vision report):
 *
 *   scoreCandidates  for one spoken line, which of these thumbnails shows
 *                    the thing being said — 0–10 each, and a best pick
 *   pickWindow       inside one clip, which sampled frame to cut to, where
 *                    its subject sits left-to-right, and whether the frame
 *                    carries burned-in text
 *   checkFrame       a rendered frame: is any text on the face, cut off,
 *                    in a platform's UI band, unreadable, overlapping
 *
 * Its own `fetch` rather than `lib/ai/openrouter.ts:complete`, because that
 * client sends `messages[].content` as a string and OpenRouter's image path
 * needs the array form with `image_url` parts. Everything else follows the
 * same rules as that client: the studio's key, the backup key on a refusal,
 * a deadline on every attempt, OpenRouter's own cost figure in micros, and
 * a ledger row through `lib/ai/ledger.ts` whenever a caller says who to
 * charge.
 *
 * Models: the flash Qwen for scoring (it followed the short output format
 * exactly and rejected every one of v1's four wrong pictures with a 0); the
 * 235B Qwen VL as the fallback when the flash one fails or answers with
 * something that is not the JSON asked for; the 3.7 flash for the layout
 * check, where it found the caption on the face, the cut-off line and the
 * clean frame in three for three and the 235B did not (its sense of
 * position is poor). One provider is pinned for steady cost and latency;
 * a pinned request that OpenRouter cannot route is retried unpinned before
 * the fallback model is tried at all.
 */

export const VISION = {
  score: process.env.VISION_MODEL_SCORE || "qwen/qwen3.8-flash",
  scoreFallback: process.env.VISION_MODEL_SCORE_FALLBACK || "qwen/qwen3-vl-235b-a22b-instruct",
  check: process.env.VISION_MODEL_CHECK || "qwen/qwen3.7-flash",
  /** OpenRouter provider slug the calls are pinned to; empty string means unpinned. */
  provider: process.env.VISION_PROVIDER ?? "",
  timeoutMs: Number(process.env.VISION_TIMEOUT_MS || 60_000),
} as const;

/* ---------------------------------------------------------------- prompts */

/** The scoring prompt, as tested on qwen3.8-flash. Verbatim from the vision report. */
export const SCORE_SYSTEM =
  "You are the b-roll editor of a top-tier Chinese tech-explainer reel. For one spoken line, score each candidate cutaway 0-10 for how instantly a viewer sees what is being said. 9-10 = shows the specific thing; 6-8 = clearly illustrates the idea; 3-5 = generic topic mood; 0-2 = unrelated, misleading or cheesy. Subtract 3 if the frame is too dark or blurry to read in 2 s, has burned-in text/watermark, or looks like cheap staged stock. Be literal. JSON only, no prose.";

/** The entity clause, added to the line for a named person, company or institution. */
const ENTITY_CLAUSE =
  "A real person must be that exact person; a company or institution must be its logo, building, product or people. Anything else for this subject scores 0-2.";

const SCORE_OUTPUT = 'Output: {"s":[[id,score,"<=8 word reason"],...],"best":id|null}  (best = null when nothing scores >= 6)';

/** Same judgement, for frames of one clip; the extra fields say where to cut and where the subject is. */
const WINDOW_NOTE = "The candidates are frames of ONE clip, about a second apart. Pick the frame to cut to.";
const WINDOW_OUTPUT =
  'Output: {"s":[[id,score,"<=8 word reason"],...],"best":id|null,"subject_x":0.0-1.0,"burned_text":true|false}  (best = null when nothing scores >= 6; subject_x = horizontal centre of the main subject in the best frame, 0 = left edge, 1 = right edge; burned_text = the best frame carries burned-in captions, a logo or a watermark)';

/** The layout prompt, for qwen3.7-flash. Verbatim from the vision report. */
export const CHECK_SYSTEM =
  "You are the final QA check on a rendered frame from a 9:16 vertical reel before it is published. Look for: (a) text/captions covering the speaker's face (eyes, nose, mouth); (b) text cut off at a frame edge or truncated mid-word; (c) text inside platform UI zones (top 8%, bottom 18%, right 12% of the frame); (d) low-contrast or unreadable text; (e) overlapping on-screen elements. Do not invent problems: if the frame is fine say so. Answer with JSON only.";

const CHECK_OUTPUT =
  'OUTPUT: {"ok":bool,"issues":[{"type":"face_occluded|text_cut_off|unsafe_zone|low_contrast|overlap|other","severity":"high|med|low","detail":"<=20 words"}],"caption_text_read":"..."}';

/* ------------------------------------------------------------------ types */

/**
 * A picture for the model: a local path, an `http(s)` or `data:` URL, or the
 * bytes themselves. A path is read and inlined as a data URL, because the
 * provider cannot reach this box and a CDN link can expire between the
 * search and the call.
 */
export type VisionImage = string | Buffer | { data: Buffer; mime: string };

export type VisionUsage = {
  model: string;
  provider?: string;
  requestId?: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  /** Wall time of the attempt that answered. */
  ms: number;
  /** True when the fallback model answered, or the pin had to be dropped. */
  degraded: boolean;
};

/** Who pays. When given, every call writes one ledger row. */
export type VisionLedger = { viewer: { id: string; tenantId: string }; module?: Module };

export type VisionOptions = {
  ledger?: VisionLedger;
  signal?: AbortSignal;
};

export type CandidateScore = { index: number; score: number; reason: string };

export type ScoreResult = {
  /** One per image sent, in the order sent; an image the model skipped scores 0. */
  scores: CandidateScore[];
  /** The model's pick, as an index into `images`, or null. Callers apply their own gate on `scores`. */
  best: number | null;
  usage: VisionUsage;
  /** The model's answer as sent, for the lab's records. */
  raw: string;
};

export type WindowResult = ScoreResult & {
  /** Horizontal centre of the subject in the best frame, 0–1. 0.5 when the model gave nothing usable. */
  subjectX: number;
  /** Burned-in captions, logo or watermark in the best frame. */
  burnedText: boolean;
};

export type FrameIssueType = "face_occluded" | "text_cut_off" | "unsafe_zone" | "low_contrast" | "overlap" | "other";
export type FrameIssue = { type: FrameIssueType; severity: "high" | "med" | "low"; detail: string };

export type CheckResult = {
  ok: boolean;
  issues: FrameIssue[];
  /** What the model read as the caption, for a script to compare against the ASS. */
  captionTextRead: string;
  usage: VisionUsage;
  /** The model's answer as sent, for the lab's records. */
  raw: string;
};

export type ScoreContext = {
  /** What the frame must show, in the outline's words. */
  must?: string;
  /** What it must not show. */
  mustNot?: string;
  /** A named thing: the entity clause is added and the descriptor names it. */
  entity?: { name: string; descriptorZh?: string; romanised?: string };
};

/* ------------------------------------------------------------------ spend */

const spend = { calls: 0, promptTokens: 0, completionTokens: 0, costMicros: 0, ms: 0 };

/** What this process has spent on vision so far; the lab writes it to cost.json. */
export function visionSpend() {
  return { ...spend };
}

export function resetVisionSpend(): void {
  spend.calls = 0;
  spend.promptTokens = 0;
  spend.completionTokens = 0;
  spend.costMicros = 0;
  spend.ms = 0;
}

/* ----------------------------------------------------------------- images */

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function toDataUrl(image: VisionImage): Promise<string> {
  if (typeof image === "string") {
    if (/^(data:|https?:\/\/)/i.test(image)) return image;
    const bytes = await readFile(image);
    const mime = MIME_BY_EXT[path.extname(image).toLowerCase()] ?? "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  if (Buffer.isBuffer(image)) return `data:image/jpeg;base64,${image.toString("base64")}`;
  return `data:${image.mime};base64,${image.data.toString("base64")}`;
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Text, then `#1` image `#2` image …, then the output line. */
async function numbered(lead: string, images: VisionImage[], tail: string): Promise<Part[]> {
  const parts: Part[] = [{ type: "text", text: lead }];
  const urls = await Promise.all(images.map(toDataUrl));
  urls.forEach((url, i) => {
    parts.push({ type: "text", text: `#${i + 1}` }, { type: "image_url", image_url: { url } });
  });
  parts.push({ type: "text", text: tail });
  return parts;
}

/* ------------------------------------------------------------------- call */

type Message = { role: "system" | "user"; content: string | Part[] };

type Payload = {
  error?: { message?: string; code?: number | string };
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  model?: string;
  provider?: string;
  id?: string;
};

/** Models that spend their budget thinking unless told not to. */
const REASONING_OFF = /qwen3\.\d+-(flash|plus|max)|glm-|kimi|mimo/;

/** OpenRouter refusing to route a pinned request, which is our pin's fault and not the model's. */
const NO_ROUTE = /no endpoints found|no (available )?provider|provider.*not (found|available)|not supported by (the )?provider/i;

async function once(
  model: string,
  messages: Message[],
  maxTokens: number,
  pinned: boolean,
  signal?: AbortSignal,
): Promise<{ text: string; usage: Omit<VisionUsage, "degraded"> }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    usage: { include: true },
  };
  if (REASONING_OFF.test(model)) body.reasoning = { enabled: false };
  if (pinned && VISION.provider) body.provider = { order: [VISION.provider], allow_fallbacks: false };

  const keys = [env.openrouter.apiKey, env.openrouter.backupKey].filter(Boolean);
  const deadline = AbortSignal.timeout(VISION.timeoutMs);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;

  const send = (key: string) =>
    fetch(`${env.openrouter.baseUrl}/chat/completions`, {
      method: "POST",
      signal: abort,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Tengya director v2 vision",
      },
      body: JSON.stringify(body),
    });

  const started = Date.now();
  let res: Response;
  try {
    res = await send(keys[0]);
    if ((res.status === 429 || res.status === 402) && keys.length > 1) res = await send(keys[1]);
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiError("rate_limit", `${model} did not answer within ${VISION.timeoutMs / 1000}s`);
    }
    if (signal?.aborted) throw err;
    throw new AiError("network", err instanceof Error ? err.message : String(err));
  }

  const raw = await res.text();
  if (!res.ok) {
    let message = raw.slice(0, 400);
    try {
      const parsed = JSON.parse(raw) as Payload;
      message = String(parsed?.error?.message ?? message);
    } catch {
      /* the body was not JSON; the slice above is the best description there is */
    }
    if (res.status === 402) throw new AiError("credit", message, res.status);
    if (res.status === 429) throw new AiError("rate_limit", message, res.status);
    if (res.status === 400 || res.status === 404 || res.status === 422) throw new AiError("bad_request", message, res.status);
    throw new AiError("provider", message, res.status);
  }

  let json: Payload;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AiError("provider", `${model} returned a body that is not JSON`);
  }
  if (json.error) throw new AiError("provider", String(json.error.message ?? "the provider refused"), Number(json.error.code) || 200);

  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw new AiError("provider", `${model} answered with no content`);

  return {
    text,
    usage: {
      model: json.model ?? model,
      provider: json.provider,
      requestId: json.id,
      promptTokens: Number(json.usage?.prompt_tokens ?? 0),
      completionTokens: Number(json.usage?.completion_tokens ?? 0),
      costMicros: usdToMicros(json.usage?.cost),
      ms: Date.now() - started,
    },
  };
}

/**
 * The first object in the answer, parsed.
 *
 * `json_object` mode is honoured by the models this uses, but a truncated
 * answer (the 3.7 flash hit its token limit once in testing) or a stray
 * code fence must fail here as a parse error, so the caller moves to the
 * next attempt rather than treating garbage as a score.
 */
function parseObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through to the brace scan */
  }
  const a = trimmed.indexOf("{");
  const b = trimmed.lastIndexOf("}");
  if (a >= 0 && b > a) {
    const v = JSON.parse(trimmed.slice(a, b + 1));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  throw new AiError("provider", `the answer was not a JSON object: ${trimmed.slice(0, 120)}`);
}

/**
 * Ask, with the fallbacks in order: pinned → unpinned → the fallback model.
 *
 * A credit refusal stops at once; there is no model that answers for free.
 * An abort from the caller is passed through untouched.
 */
async function ask(
  models: string[],
  messages: Message[],
  maxTokens: number,
  opts: VisionOptions,
): Promise<{ answer: Record<string, unknown>; usage: VisionUsage; raw: string }> {
  const attempts: { model: string; pinned: boolean }[] = [];
  for (const model of models) {
    if (VISION.provider) attempts.push({ model, pinned: true });
    attempts.push({ model, pinned: false });
  }

  let lastError: unknown = null;
  for (const [i, attempt] of attempts.entries()) {
    try {
      const { text, usage } = await once(attempt.model, messages, maxTokens, attempt.pinned, opts.signal);
      const answer = parseObject(text);
      const full: VisionUsage = { ...usage, degraded: i > 0 };
      await record(full, opts.ledger);
      return { answer, usage: full, raw: text };
    } catch (err) {
      lastError = err;
      if (opts.signal?.aborted) throw err;
      if (err instanceof AiError && err.kind === "credit") throw err;
      /* A pinned request nobody can route is the pin's fault: drop it and go on.
         Anything else on this model also goes on; the point of a fallback is to
         answer, and the log says which attempt did. */
      const detail = err instanceof Error ? err.message : String(err);
      const status = err instanceof AiError && err.status ? ` HTTP ${err.status}` : "";
      const routing = err instanceof AiError && err.kind === "bad_request" && NO_ROUTE.test(detail);
      console.warn(`[vision] ${attempt.model}${attempt.pinned ? ` @${VISION.provider}` : ""} failed${routing ? " (no route)" : ""}${status}: ${detail.slice(0, 200)}`);
    }
  }
  throw lastError instanceof Error ? lastError : new AiError("provider", "every vision attempt failed");
}

/** One ledger row when somebody is paying; the running tally either way. */
async function record(usage: VisionUsage, ledger?: VisionLedger): Promise<void> {
  spend.calls++;
  spend.promptTokens += usage.promptTokens;
  spend.completionTokens += usage.completionTokens;
  spend.costMicros += usage.costMicros;
  spend.ms += usage.ms;
  if (!ledger) return;
  try {
    const { recordUsage } = await import("@/lib/ai/ledger");
    await recordUsage({
      viewer: ledger.viewer,
      module: ledger.module ?? "video",
      provider: usage.provider ?? "openrouter",
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costMicros: usage.costMicros,
      latencyMs: usage.ms,
      requestId: usage.requestId,
    });
  } catch (err) {
    console.error("[vision] ledger write failed", err instanceof Error ? err.message : err);
  }
}

/* ---------------------------------------------------------------- parsing */

/** `{"s":[[id,score,"reason"],…]}` with 1-based ids into 0-based, clamped, one row per image. */
function readScores(answer: Record<string, unknown>, count: number): CandidateScore[] {
  const rows = new Map<number, CandidateScore>();
  const s = answer.s ?? answer.scores;
  if (Array.isArray(s)) {
    for (const row of s) {
      let id: number, score: number, reason: string;
      if (Array.isArray(row)) {
        [id, score, reason] = [Number(row[0]), Number(row[1]), String(row[2] ?? "")];
      } else if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        id = Number(r.id ?? r.index);
        score = Number(r.score);
        reason = String(r.reason ?? "");
      } else continue;
      const index = id - 1;
      if (!Number.isInteger(index) || index < 0 || index >= count) continue;
      rows.set(index, { index, score: clampScore(score), reason: reason.slice(0, 120) });
    }
  }
  return Array.from({ length: count }, (_, i) => rows.get(i) ?? { index: i, score: 0, reason: "not scored" });
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

function readBest(answer: Record<string, unknown>, scores: CandidateScore[]): number | null {
  const raw = answer.best;
  const id = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : null;
  if (id === null) return null;
  const index = id - 1;
  return index >= 0 && index < scores.length ? index : null;
}

/* --------------------------------------------------------------- the three */

/**
 * Score candidate thumbnails against one spoken line.
 *
 * `images` is the contact-sheet order; the result's `scores[i]` is for
 * `images[i]`. Send eight to ten at most: past that the flash model starts
 * skipping rows, and the prefilter should have done its job.
 */
export async function scoreCandidates(
  line: string,
  context: string,
  images: VisionImage[],
  ctx: ScoreContext = {},
  opts: VisionOptions = {},
): Promise<ScoreResult> {
  if (!images.length) throw new Error("scoreCandidates: no images");
  const lead = [`Line: 「${line.trim()}」`, `Context: ${context.trim() || "(none)"}`];
  if (ctx.entity) {
    const who = [ctx.entity.name, ctx.entity.romanised, ctx.entity.descriptorZh].filter(Boolean).join(" / ");
    lead.push(`Named subject: ${who}. ${ENTITY_CLAUSE}`);
  }
  if (ctx.must) lead.push(`Must show: ${ctx.must}`);
  if (ctx.mustNot) lead.push(`Must not show: ${ctx.mustNot}`);

  const messages: Message[] = [
    { role: "system", content: SCORE_SYSTEM },
    { role: "user", content: await numbered(lead.join("\n"), images, SCORE_OUTPUT) },
  ];
  const { answer, usage, raw } = await ask([VISION.score, VISION.scoreFallback], messages, 700, opts);
  const scores = readScores(answer, images.length);
  return { scores, best: readBest(answer, scores), usage, raw };
}

/**
 * Pick the frame to cut to inside one clip.
 *
 * `frames` are samples of the same clip in time order (one a second is the
 * plan's rate); the index that comes back is the second to start at.
 */
export async function pickWindow(
  line: string,
  frames: VisionImage[],
  ctx: ScoreContext & { context?: string } = {},
  opts: VisionOptions = {},
): Promise<WindowResult> {
  if (!frames.length) throw new Error("pickWindow: no frames");
  const lead = [`Line: 「${line.trim()}」`, `Context: ${(ctx.context ?? "").trim() || "(none)"}`, WINDOW_NOTE];
  if (ctx.entity) {
    const who = [ctx.entity.name, ctx.entity.romanised, ctx.entity.descriptorZh].filter(Boolean).join(" / ");
    lead.push(`Named subject: ${who}. ${ENTITY_CLAUSE}`);
  }
  if (ctx.must) lead.push(`Must show: ${ctx.must}`);
  if (ctx.mustNot) lead.push(`Must not show: ${ctx.mustNot}`);

  const messages: Message[] = [
    { role: "system", content: SCORE_SYSTEM },
    { role: "user", content: await numbered(lead.join("\n"), frames, WINDOW_OUTPUT) },
  ];
  const { answer, usage, raw } = await ask([VISION.score, VISION.scoreFallback], messages, 700, opts);
  const scores = readScores(answer, frames.length);
  const x = Number(answer.subject_x ?? answer.subjectX);
  return {
    scores,
    best: readBest(answer, scores),
    subjectX: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5,
    burnedText: answer.burned_text === true || answer.burnedText === true || String(answer.burned_text).toLowerCase() === "true",
    usage,
    raw,
  };
}

/**
 * The issue type, from whatever the model wrote.
 *
 * Asked for `face_occluded|text_cut_off|…` it mostly complies, but it has
 * also answered with the prompt's own letters ("(a)") and with prose
 * ("text covering the face"), and a real finding filed under `other` would
 * slip past a gate that counts face occlusions. So the type is read from
 * the type *and* the detail, by keyword, and `other` is only for a finding
 * that matches none of the five.
 */
function issueType(type: unknown, detail: string): FrameIssueType {
  const t = `${String(type ?? "")} ${detail}`.toLowerCase();
  if (/face_occl|\bface\b|eyes|nose|mouth|\(a\)/.test(t)) return "face_occluded";
  if (/cut_off|cut off|truncat|clipped|\bedge\b|\(b\)/.test(t)) return "text_cut_off";
  if (/unsafe|ui zone|platform ui|\(c\)/.test(t)) return "unsafe_zone";
  if (/contrast|unreadable|illegible|\(d\)/.test(t)) return "low_contrast";
  if (/overlap|\(e\)/.test(t)) return "overlap";
  return "other";
}

/** Width and height from a JPEG or PNG header, for the prompt; null for anything else. */
function imageSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * The layout check on one rendered frame.
 *
 * The lead-in names the frame's size and the caption the way the report's
 * test did ("Frame (720x1280) from a talking-head reel with a burned-in
 * caption:"); with a plainer lead-in the same model called a caption on the
 * chest an occlusion of the mouth. The prompt is the thing that was tested.
 */
export async function checkFrame(image: VisionImage, opts: VisionOptions = {}): Promise<CheckResult> {
  const url = await toDataUrl(image);
  let size: { w: number; h: number } | null = null;
  if (url.startsWith("data:")) {
    const b64 = url.slice(url.indexOf(",") + 1);
    size = imageSize(Buffer.from(b64.slice(0, 4096), "base64"));
  }
  const lead = `Frame${size ? ` (${size.w}x${size.h})` : ""} from a talking-head reel with a burned-in caption:`;
  const messages: Message[] = [
    { role: "system", content: CHECK_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: lead },
        { type: "image_url", image_url: { url } },
        { type: "text", text: CHECK_OUTPUT },
      ],
    },
  ];
  const { answer, usage, raw } = await ask([VISION.check, VISION.scoreFallback], messages, 600, opts);
  const issues: FrameIssue[] = [];
  if (Array.isArray(answer.issues)) {
    for (const item of answer.issues) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const detail = String(r.detail ?? "").slice(0, 200);
      const severity = r.severity === "high" || r.severity === "med" || r.severity === "low" ? r.severity : "med";
      issues.push({ type: issueType(r.type, detail), severity, detail });
    }
  }
  /* `ok` is the model's word, but an answer that lists a high issue and says ok is not ok. */
  const ok = answer.ok === true && !issues.some((i) => i.severity === "high");
  return { ok, issues, captionTextRead: String(answer.caption_text_read ?? answer.captionTextRead ?? ""), usage, raw };
}

/**
 * Read pictures into text for the file reader (`lib/files/extract.ts`): the
 * text in them copied out and what they show, as the instruction asks. The
 * answer rides in a JSON field because every call here asks for JSON.
 */
export async function readImages(images: VisionImage[], instruction: string, opts: VisionOptions = {}): Promise<string> {
  const parts = await numbered(instruction, images, 'OUTPUT: {"text":"<everything asked for, as plain text>"}');
  const { answer, raw } = await ask([VISION.scoreFallback, VISION.score], [{ role: "user", content: parts }], 6000, opts);
  const text = typeof answer.text === "string" ? answer.text : raw;
  return text.trim();
}
