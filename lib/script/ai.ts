import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, scriptBeats, scripts } from "@/lib/db/schema";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage, assertBudget } from "@/lib/ai/ledger";
import { searchFiles, type Hit } from "@/lib/ai/retrieval";
import type { Viewer } from "@/lib/auth/dal";
import { measure, replaceSuggestions, saveBeats, spokenSeconds } from "./service";

/**
 * Writing and checking scripts (spec §4.4).
 *
 * House style is a **prompt and a corpus**, not a fine-tune — the brief is
 * explicit about that, and it is also the only version that a studio can
 * change on a Tuesday afternoon. The style guide lives in the `knowledge`
 * table (Admin, "Knowledge and skills"), and the examples come from the
 * approved scripts the writer is allowed to read, through the same
 * permission-filtered retrieval the agent uses. A writer never sees an
 * "approved example" drawn from a file they have no access to.
 *
 * Every call here is metered and budget-checked like any other (spec §5).
 */

/** The active house-style guide, assembled from the knowledge table. */
export async function houseStyle(viewer: Viewer): Promise<{ text: string; version: string | null }> {
  const rows = await db
    .select({ title: knowledge.title, body: knowledge.body, version: knowledge.version, kind: knowledge.kind })
    .from(knowledge)
    .where(
      and(
        eq(knowledge.tenantId, viewer.tenantId),
        eq(knowledge.active, true),
        eq(knowledge.scope, "module"),
        eq(knowledge.scopeValue, "script"),
      ),
    );

  if (!rows.length) return { text: "", version: null };

  const style = rows.find((r) => r.kind === "style");
  return {
    text: rows.map((r) => `## ${r.title}\n${r.body}`).join("\n\n"),
    version: style ? `v${style.version}` : null,
  };
}

/**
 * Approved reference scripts the writer may read, as examples.
 *
 * `searchFiles` filters by the *writer's* own access, not by the module's, so
 * a house-style example can never be drawn from a document the person asking
 * cannot open. The `withheld` count it returns is deliberately ignored here:
 * telling a writer that examples exist which they may not see would leak the
 * fact of them.
 */
async function examples(viewer: Viewer, query: string): Promise<string> {
  const found = await searchFiles(viewer, query, 4).catch(() => ({ hits: [] as Hit[], withheld: 0 }));
  if (!found.hits.length) return "";
  return found.hits.map((f) => `### ${f.name}\n${f.snippet.slice(0, 1200)}`).join("\n\n");
}

const DRAFT_PROMPT = `You write shooting scripts for a Hong Kong video studio.

A script is a list of beats. Each beat has three parts:
  "visual"    what is on screen: framing, camera, archive credits, on-screen text
  "voiceover" what is spoken, in the script's own language
  "subtitle"  the subtitle line, in the subtitle language

Answer with a single JSON object and nothing else:
{ "beats": [ { "visual": "...", "voiceover": "...", "subtitle": "...", "naturalSound": false } ] }

Rules:
- Write to the target duration. Roughly 4.5 Chinese characters or 2.6 English words per second of voiceover.
- Open on an image, not on narration. The first beat is usually natural sound: set "naturalSound": true and leave "voiceover" empty.
- Name concrete things: an hour, a street, a number, a person. Never "recently", never "many people".
- Cover every mandatory point the brief lists.
- Credit any archive or third-party footage in the "visual" field.
- Do not invent facts, names, dates or quotes. If the brief does not give you a fact, write the beat without it.`;

type DraftBeat = { visual: string; voiceover: string; subtitle: string; naturalSound: boolean };

/**
 * Writes a draft from the brief.
 *
 * Replaces the working beats wholesale, which is what "Generate v5 from brief"
 * on the artboard means. The version that was there is not lost: the caller
 * cuts a version first, and every version is immutable.
 */
export async function draftFromBrief(viewer: Viewer, scriptId: string) {
  await assertBudget(viewer);

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return { error: "Not allowed" };
  if (script.lockedVersion !== null) return { error: "That script is locked." };

  const [style, refs] = await Promise.all([houseStyle(viewer), examples(viewer, script.title)]);
  const model = modelFor.drafting();

  const brief = [
    `Title: ${script.title}`,
    script.angle ? `Angle: ${script.angle}` : null,
    script.targetChannel ? `Channel: ${script.targetChannel}${script.aspect ? ` (${script.aspect})` : ""}` : null,
    script.targetSeconds ? `Target duration: ${formatDuration(script.targetSeconds)} (±${script.tolerancePercent}%)` : null,
    script.language ? `Spoken language: ${script.language}` : null,
    script.subtitleLanguage ? `Subtitle language: ${script.subtitleLanguage}` : null,
    script.mandatoryPoints.length ? `Must cover:\n${script.mandatoryPoints.map((p) => `- ${p}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete({
    model,
    temperature: 0.7,
    maxTokens: 4000,
    messages: [
      { role: "system", content: DRAFT_PROMPT + (style.text ? `\n\nThe studio's house style:\n${style.text}` : "") },
      {
        role: "user",
        content: [brief, refs ? `Approved scripts to match in tone:\n${refs}` : null].filter(Boolean).join("\n\n"),
      },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const beats = parseBeats(out.text);
  if (!beats.length) return { error: "The model did not return a script we could read." };

  await saveBeats(viewer, scriptId, beats);
  return { ok: true, beats: beats.length, model: out.model };
}

const CONFORM_PROMPT = `You check a shooting script against a Hong Kong video studio's house style, beat by beat.

Answer with a single JSON object and nothing else:
{
  "conformance": 0-100,
  "readingLevel": e.g. "Grade 8",
  "suggestions": [
    {
      "beatOrd": the beat's number, or null for the script as a whole,
      "kind": one of "house_style" | "length" | "register" | "clarity" | "sound_direction" | "fact_check",
      "label": two or three words, e.g. "time of day",
      "before": the exact text to replace, copied verbatim from the beat, or null,
      "after": what to replace it with, or null,
      "rationale": one sentence naming the rule and, where you can, the evidence for it
    }
  ]
}

Rules:
- "before" must appear **verbatim** in that beat, or the suggestion cannot be applied. If you cannot quote it exactly, set both "before" and "after" to null and make it an observation.
- Sound directions written into the voice-over column get kind "sound_direction": they belong in the shot list, not in what is spoken.
- Be specific. "Could be clearer" is not a suggestion. "morning light" → "at 6:40 am" is.
- At most twelve suggestions. Rank the ones that change meaning above the ones that change taste.
- Do not suggest changes that would break a mandatory point the brief requires.`;

/**
 * Scores the draft against the guide and writes the suggestion list.
 *
 * The score is the model's, and the screen says which guide version it was
 * scored against, so "was 76 at v3" is a comparison rather than a vibe.
 */
export async function checkConformance(viewer: Viewer, scriptId: string) {
  await assertBudget(viewer);

  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)))
    .limit(1);
  if (!script) return { error: "Not allowed" };

  const beats = await db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  if (!beats.length) return { error: "There is nothing to check yet." };

  const style = await houseStyle(viewer);
  const model = modelFor.utility();
  const m = measure(beats, script);

  const body = beats
    .map(
      (b) =>
        `Beat ${b.ord}${b.naturalSound ? " (natural sound)" : ""}\nVisual: ${b.visual}\nVoice-over: ${b.voiceover}\nSubtitle: ${b.subtitle}`,
    )
    .join("\n\n");

  const context = [
    script.targetSeconds
      ? `Target duration ${formatDuration(script.targetSeconds)}, currently ${formatDuration(Math.round(m.spokenSeconds))}.`
      : null,
    script.mandatoryPoints.length ? `Must cover: ${script.mandatoryPoints.join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await complete({
    model,
    temperature: 0.2,
    maxTokens: 2500,
    messages: [
      { role: "system", content: CONFORM_PROMPT + (style.text ? `\n\nThe house style:\n${style.text}` : "") },
      { role: "user", content: [context, body].filter(Boolean).join("\n\n") },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const parsed = parseConformance(out.text);
  if (!parsed) return { error: "The check did not come back in a form we could read." };

  // A suggestion whose `before` is not actually in its beat cannot be applied,
  // and offering an Accept button that would do nothing is worse than not
  // offering one. Those are kept as observations instead.
  const byOrd = new Map(beats.map((b) => [b.ord, b]));
  const cleaned = parsed.suggestions.map((s) => {
    const beat = s.beatOrd === null ? null : byOrd.get(s.beatOrd);
    const quoted =
      s.before !== null &&
      beat !== undefined &&
      beat !== null &&
      (beat.voiceover.includes(s.before) || beat.subtitle.includes(s.before) || beat.visual.includes(s.before));
    return quoted ? s : { ...s, before: null, after: null };
  });

  await replaceSuggestions(scriptId, cleaned, out.model);

  return {
    ok: true,
    conformance: parsed.conformance,
    readingLevel: parsed.readingLevel,
    guideVersion: style.version,
    suggestions: cleaned.length,
    model: out.model,
  };
}

const REWRITE_PROMPT = `You rewrite one passage of a shooting script for a Hong Kong video studio.

Answer with the rewritten passage alone. No quotes, no preamble, no explanation, no markdown. Keep the same language and the same speaker. Do not add facts that were not in the original.`;

/** "Rewrite selection" and the Shorter / Warmer / More formal / 轉做書面語
 * buttons: one passage, one instruction, the text back. */
export async function rewriteSelection(viewer: Viewer, selection: string, instruction: string) {
  await assertBudget(viewer);

  const style = await houseStyle(viewer);
  const model = modelFor.utility();

  const out = await complete({
    model,
    temperature: 0.6,
    maxTokens: 800,
    messages: [
      { role: "system", content: REWRITE_PROMPT + (style.text ? `\n\nThe house style:\n${style.text}` : "") },
      { role: "user", content: `Instruction: ${instruction}\n\nPassage:\n${selection.slice(0, 4000)}` },
    ],
  });

  await recordUsage({
    viewer,
    module: "script",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const text = out.text.trim();
  if (!text) return { error: "The model returned nothing." };
  return { ok: true, text, seconds: spokenSeconds(text), model: out.model };
}

/* ------------------------------------------------------------- parsing */

function jsonIn(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 20000): string => (typeof v === "string" ? v.slice(0, max) : "");

function parseBeats(text: string): DraftBeat[] {
  const raw = jsonIn(text);
  const list = raw?.beats;
  if (!Array.isArray(list)) return [];

  return list
    .slice(0, 200)
    .map((b) => {
      const o = b as Record<string, unknown>;
      return {
        visual: str(o.visual, 5000),
        voiceover: str(o.voiceover),
        subtitle: str(o.subtitle),
        naturalSound: o.naturalSound === true,
      };
    })
    .filter((b) => b.visual || b.voiceover || b.subtitle);
}

type ParsedSuggestion = {
  beatOrd: number | null;
  kind: "house_style" | "length" | "register" | "clarity" | "sound_direction" | "fact_check";
  label: string;
  before: string | null;
  after: string | null;
  rationale: string | null;
};

const KINDS = ["house_style", "length", "register", "clarity", "sound_direction", "fact_check"] as const;

function parseConformance(
  text: string,
): { conformance: number | null; readingLevel: string | null; suggestions: ParsedSuggestion[] } | null {
  const raw = jsonIn(text);
  if (!raw) return null;

  const score = Number(raw.conformance);
  const list = Array.isArray(raw.suggestions) ? raw.suggestions : [];

  return {
    conformance: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    readingLevel: typeof raw.readingLevel === "string" ? raw.readingLevel.slice(0, 40) : null,
    suggestions: list.slice(0, 12).map((s): ParsedSuggestion => {
      const o = s as Record<string, unknown>;
      const ord = Number(o.beatOrd);
      const kind = String(o.kind ?? "");
      return {
        beatOrd: Number.isInteger(ord) ? ord : null,
        kind: (KINDS as readonly string[]).includes(kind) ? (kind as ParsedSuggestion["kind"]) : "clarity",
        label: str(o.label, 120) || "suggestion",
        before: typeof o.before === "string" && o.before ? o.before.slice(0, 2000) : null,
        after: typeof o.after === "string" && o.after ? o.after.slice(0, 2000) : null,
        rationale: typeof o.rationale === "string" && o.rationale ? o.rationale.slice(0, 600) : null,
      };
    }),
  };
}

/** "3:45", the way the artboard writes a duration. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
