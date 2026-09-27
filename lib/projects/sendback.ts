import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";

/**
 * A step sent back with a note, kept on the project until somebody deals
 * with it — so the note is in front of whoever holds that step, on that
 * step's card, not three screens up a chat.
 *
 * A script sent back gets more than the note: 编剧 reads it against the
 * beats and answers with the edits it means, beat by beat (「文字再精简一些」
 * becomes "第 2 镜：原句 → 改后"), which the card shows with one press to have
 * them made. "The suggestion is make text more concise; the AI already gives
 * specific edit suggestions to the person in charge of the script."
 *
 * Stored in `work_projects.source.sentBack`, one per step, the newest
 * replacing the last: a second note on the same step is the one that counts.
 */
export type StepKey = "topic" | "script" | "clips" | "edit" | "deliver";
export type EditSuggestion = { ord: number; before: string; after: string; why: string };
export type SentBack = {
  step: StepKey;
  note: string;
  by: string;
  byName: string;
  at: string;
  /** 编剧's edits, for a script; null for any other step, or when it could not say. */
  suggestions: EditSuggestion[] | null;
  /** open until someone has the edits made (applied) or marks it dealt with (done). */
  state: "open" | "applied" | "done";
};

const STEPS: StepKey[] = ["topic", "script", "clips", "edit", "deliver"];

export function readSentBack(source: unknown): Partial<Record<StepKey, SentBack>> {
  const raw = source && typeof source === "object" ? (source as { sentBack?: unknown }).sentBack : null;
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<StepKey, SentBack>> = {};
  for (const k of STEPS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v && typeof v === "object" && typeof (v as SentBack).note === "string") out[k] = v as SentBack;
  }
  return out;
}

async function write(projectId: string, step: StepKey, value: SentBack) {
  await db
    .update(workProjects)
    .set({
      source: sql`(case when jsonb_typeof(${workProjects.source}) = 'object' then ${workProjects.source} else '{}'::jsonb end)
        || jsonb_build_object('sentBack', coalesce(${workProjects.source} -> 'sentBack', '{}'::jsonb) || jsonb_build_object(${step}::text, ${JSON.stringify(value)}::jsonb))`,
      updatedAt: new Date(),
    })
    .where(eq(workProjects.id, projectId));
}

const SUGGEST_PROMPT = `你是短视频工作室的编剧。有人把脚本退回，附了一句修改意见。请把这句意见落实成具体的逐镜修改建议。
只回答 JSON：{"suggestions":[{"ord":镜号,"before":"原句，一字不改地从脚本里复制","after":"改后的句子","why":"一句话说明，十五字以内"}]}
- 只改口播（voiceover）。只列真的需要改的镜，最多 6 条；意见只涉及一处就只写一处。
- before 必须是那一镜口播的原文（可以是其中一句），after 是完整的改写。
- 不要解释，不要 markdown，只要 JSON。`;

async function suggestEdits(viewer: Viewer, scriptId: string, note: string): Promise<EditSuggestion[] | null> {
  const beats = await db
    .select({ ord: scriptBeats.ord, voiceover: scriptBeats.voiceover, visual: scriptBeats.visual })
    .from(scriptBeats)
    .where(eq(scriptBeats.scriptId, scriptId))
    .orderBy(scriptBeats.ord);
  const spoken = beats.filter((b) => (b.voiceover ?? "").trim());
  if (!spoken.length) return null;
  try {
    const out = await complete({
      model: modelFor.assistant(),
      temperature: 0.3,
      maxTokens: 1600,
      messages: [
        { role: "system", content: SUGGEST_PROMPT },
        { role: "user", content: `修改意见：${note}\n\n脚本（镜号 | 口播）：\n${spoken.map((b) => `${b.ord} | ${b.voiceover}`).join("\n")}` },
      ],
    });
    await recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    const text = out.text.replace(/<\/?think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { suggestions?: { ord?: unknown; before?: unknown; after?: unknown; why?: unknown }[] };
    const byOrd = new Map(spoken.map((b) => [b.ord, b.voiceover ?? ""]));
    /* Only edits to a beat that exists, whose "before" is really in it: an
       invented line shown struck through would be a quote the script never had. */
    const list = (parsed.suggestions ?? [])
      .map((s) => ({ ord: Number(s.ord), before: String(s.before ?? "").trim(), after: String(s.after ?? "").trim(), why: String(s.why ?? "").trim().slice(0, 60) }))
      .filter((s) => byOrd.has(s.ord) && s.after && s.before && s.after !== s.before && (byOrd.get(s.ord) ?? "").includes(s.before.slice(0, 12)))
      .slice(0, 6);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** Keep a step's note (and, for a script, 编剧's edits). */
export async function recordSendBack(viewer: Viewer, project: { id: string; scriptId: string | null }, step: StepKey, note: string): Promise<SentBack> {
  const value: SentBack = {
    step,
    note: note.slice(0, 1000),
    by: viewer.id,
    byName: viewer.nameLocal || viewer.name,
    at: new Date().toISOString(),
    suggestions: step === "script" && project.scriptId ? await suggestEdits(viewer, project.scriptId, note) : null,
    state: "open",
  };
  await write(project.id, step, value);
  return value;
}

/** Applied (the edits handed to 编剧) or done (dealt with): off the card's red list. */
export async function settleSendBack(projectId: string, step: StepKey, state: "applied" | "done"): Promise<SentBack | null> {
  const [row] = await db.select({ source: workProjects.source }).from(workProjects).where(and(eq(workProjects.id, projectId), isNull(workProjects.deletedAt))).limit(1);
  const current = readSentBack(row?.source)[step];
  if (!current) return null;
  const next = { ...current, state };
  await write(projectId, step, next);
  return next;
}

export const isStepKey = (v: unknown): v is StepKey => typeof v === "string" && (STEPS as string[]).includes(v);
