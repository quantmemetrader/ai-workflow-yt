import "server-only";
import { toSimplified } from "@/lib/text/simplified";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, knowledgeVersions, users, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { TRAIN_BUDGET, isTrainKey, type TrainKey } from "@/lib/agents/train-keys";

export { TRAIN_BUDGET, TRAIN_KEYS, isTrainKey, type TrainKey } from "@/lib/agents/train-keys";

/**
 * What the studio has taught each AI employee: standing instructions, a
 * style list, and examples to learn from (AI 训练, `/train`).
 *
 * The client (28 Sep): "they need a place where they can train each AI —
 * upload examples, give instructions, especially for script." The rows are
 * the same `knowledge` table Admin's "knowledge and skills" edits, scoped
 * `role` with the employee's key as the value (`script`, `video`, … and
 * `assistant` for everybody's own assistant) — a people role never takes one
 * of those values, so `assemblePrompt`'s role filter never picks them up by
 * accident and Admin still lists them.
 *
 *   instructions  one row, 工作说明: the rules it must follow
 *   style         one row, 风格与禁用词
 *   example       many rows, 范例: each can be switched off
 *
 * `trainingFor` is the one reader: every place an employee writes (its chat
 * prompt, the script writer, 文案's send-back edits, the article writer, the
 * video director) asks it for the same text, trimmed to a budget so a long
 * example cannot push the real task out of the prompt.
 */

export type TrainKind = "instructions" | "style" | "example";

export type TrainRow = {
  id: string;
  kind: TrainKind;
  title: string;
  body: string;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

const TITLES: Record<"instructions" | "style", string> = { instructions: "工作说明", style: "风格与禁用词" };

const scoped = (tenantId: string, key: TrainKey) =>
  and(eq(knowledge.tenantId, tenantId), eq(knowledge.scope, "role"), eq(knowledge.scopeValue, key), inArray(knowledge.kind, ["instructions", "style", "example"]));

/** Everything taught to one employee, switched on or off, newest added first
 * (not last edited: switching an example off must not move it in the list,
 * and "newest first" for the budget means the latest one added). */
export async function trainingRows(tenantId: string, key: TrainKey): Promise<TrainRow[]> {
  const rows = await db
    .select({ k: knowledge, byName: users.name, byLocal: users.nameLocal })
    .from(knowledge)
    .leftJoin(users, eq(users.id, knowledge.updatedBy))
    .where(scoped(tenantId, key))
    .orderBy(desc(knowledge.createdAt));
  return rows.map((r) => ({
    id: r.k.id,
    kind: r.k.kind as TrainKind,
    title: r.k.title,
    body: r.k.body,
    version: r.k.version,
    active: r.k.active,
    createdAt: r.k.createdAt.toISOString(),
    updatedAt: r.k.updatedAt.toISOString(),
    updatedByName: r.byLocal || r.byName || null,
  }));
}

export type TrainSummary = { key: TrainKey; instructionChars: number; styleChars: number; examples: number; examplesOff: number; updatedAt: string | null; updatedByName: string | null };

/** For the overview: how much each employee has been taught, and when. */
export async function trainingSummaries(tenantId: string): Promise<TrainSummary[]> {
  const rows = await db
    .select({ k: knowledge, byName: users.name, byLocal: users.nameLocal })
    .from(knowledge)
    .leftJoin(users, eq(users.id, knowledge.updatedBy))
    .where(and(eq(knowledge.tenantId, tenantId), eq(knowledge.scope, "role"), inArray(knowledge.kind, ["instructions", "style", "example"])))
    .orderBy(desc(knowledge.updatedAt));
  const keys: TrainKey[] = ["assistant", ...AGENT_KEYS];
  return keys.map((key) => {
    const mine = rows.filter((r) => r.k.scopeValue === key);
    const text = (kind: string) => mine.find((r) => r.k.kind === kind && r.k.active)?.k.body.trim().length ?? 0;
    return {
      key,
      instructionChars: text("instructions"),
      styleChars: text("style"),
      examples: mine.filter((r) => r.k.kind === "example" && r.k.active).length,
      examplesOff: mine.filter((r) => r.k.kind === "example" && !r.k.active).length,
      updatedAt: mine[0]?.k.updatedAt.toISOString() ?? null,
      updatedByName: mine[0] ? mine[0].byLocal || mine[0].byName || null : null,
    };
  });
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export type Training = {
  /** Ready to append to a system prompt; empty when nothing is taught. */
  text: string;
  /** What went in, for the Admin preview's list of parts. */
  parts: { id: string; title: string; kind: string; scope: string }[];
};

/**
 * The taught text for one employee, as a prompt reads it: the instructions
 * (up to 3,000 characters), the style list (1,500) and the switched-on
 * examples, newest first, until 6,000 characters of them are in.
 */
export async function trainingFor(tenantId: string, key: TrainKey): Promise<Training> {
  let rows: TrainRow[];
  try {
    rows = (await trainingRows(tenantId, key)).filter((r) => r.active && r.body.trim());
  } catch (err) {
    /* Training is extra: a failed read must never stop an employee working. */
    console.warn("[training] could not read", key, err instanceof Error ? err.message : err);
    return { text: "", parts: [] };
  }
  if (!rows.length) return { text: "", parts: [] };
  const instructions = rows.find((r) => r.kind === "instructions");
  const style = rows.find((r) => r.kind === "style");
  const examples = rows.filter((r) => r.kind === "example");

  const blocks: string[] = [];
  const parts: Training["parts"] = [];
  if (instructions) {
    blocks.push(`--- 训练 · 工作说明（团队写给你的长期要求，每次都要遵守；和下面的任务冲突时以任务为准）---\n${clip(instructions.body, TRAIN_BUDGET.instructions)}`);
    parts.push({ id: instructions.id, title: instructions.title, kind: "instructions", scope: `role: ${key}` });
  }
  if (style) {
    blocks.push(`--- 训练 · 风格与禁用词 ---\n${clip(style.body, TRAIN_BUDGET.style)}`);
    parts.push({ id: style.id, title: style.title, kind: "style", scope: `role: ${key}` });
  }
  if (examples.length) {
    let room = TRAIN_BUDGET.examples;
    const shown: string[] = [];
    for (const e of examples) {
      if (room < 200) break;
      const body = clip(e.body, room);
      room -= body.length;
      shown.push(`### ${e.title}\n${body}`);
      parts.push({ id: e.id, title: e.title, kind: "example", scope: `role: ${key}` });
    }
    blocks.push(`--- 训练 · 范例（学它们的结构、口吻、节奏和长度；不要照抄里面的内容、事实和数字）---\n${shown.join("\n\n")}`);
  }
  return { text: blocks.join("\n\n"), parts };
}

/* ------------------------------------------------------------ editing */

export class TrainError extends Error {}

/** Anybody on the team may teach the employees; a guest may only look. */
export function mayTrain(viewer: Viewer): boolean {
  return viewer.role !== "guest";
}

function guard(viewer: Viewer, key: unknown): asserts key is TrainKey {
  if (!mayTrain(viewer)) throw new TrainError("访客不能修改训练内容");
  if (!isTrainKey(key)) throw new TrainError("没有这位员工");
}

const AUDIT_MODULE: Module = "chat";

async function ownRow(viewer: Viewer, id: string) {
  const [row] = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.id, id), eq(knowledge.tenantId, viewer.tenantId), eq(knowledge.scope, "role")))
    .limit(1);
  if (!row || !isTrainKey(row.scopeValue)) throw new TrainError("找不到这一条");
  return row;
}

/** Bump a row to a new body, keeping the old one as a version to go back to. */
async function rewrite(viewer: Viewer, row: typeof knowledge.$inferSelect, patch: { title?: string; body: string; note?: string }) {
  await db
    .insert(knowledgeVersions)
    .values({ id: newId("kn"), knowledgeId: row.id, version: row.version, body: row.body, note: patch.note ?? null, authorId: viewer.id })
    .onConflictDoNothing();
  await db
    .update(knowledge)
    .set({ title: patch.title ?? row.title, body: patch.body, version: row.version + 1, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(knowledge.id, row.id));
}

/**
 * Save 工作说明 or 风格与禁用词. One row per employee and kind; an empty box
 * switches it off rather than deleting it, so its history stays.
 */
export async function saveTrainingText(viewer: Viewer, key: unknown, kind: "instructions" | "style", body: string, note?: string) {
  guard(viewer, key);
  const text = toSimplified(body.replace(/\r\n/g, "\n")).slice(0, 20_000);
  const [row] = await db.select().from(knowledge).where(and(scoped(viewer.tenantId, key), eq(knowledge.kind, kind))).orderBy(desc(knowledge.updatedAt)).limit(1);
  const active = text.trim().length > 0;
  if (row) {
    if (row.body === text && row.active === active) return row.id;
    if (row.body !== text) await rewrite(viewer, row, { body: text, note });
    if (row.active !== active) await db.update(knowledge).set({ active, updatedBy: viewer.id, updatedAt: new Date() }).where(eq(knowledge.id, row.id));
    await audit(viewer, "train.update", { objectType: "knowledge", objectId: row.id, module: AUDIT_MODULE, meta: { key, kind } });
    return row.id;
  }
  if (!active) return null;
  const id = newId("kn");
  await db.insert(knowledge).values({ id, tenantId: viewer.tenantId, kind, scope: "role", scopeValue: key, title: TITLES[kind], body: text, updatedBy: viewer.id });
  await audit(viewer, "train.create", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE, meta: { key, kind } });
  return id;
}

export async function trainingHistory(viewer: Viewer, id: string) {
  const row = await ownRow(viewer, id);
  const rows = await db
    .select({ v: knowledgeVersions, byName: users.name, byLocal: users.nameLocal })
    .from(knowledgeVersions)
    .leftJoin(users, eq(users.id, knowledgeVersions.authorId))
    .where(eq(knowledgeVersions.knowledgeId, row.id))
    .orderBy(desc(knowledgeVersions.version))
    .limit(30);
  return rows.map((r) => ({ version: r.v.version, body: r.v.body, note: r.v.note, byName: r.byLocal || r.byName || null, at: r.v.createdAt.toISOString() }));
}

/** Go back to an older version — as a new version, so nothing is lost. */
export async function restoreTraining(viewer: Viewer, id: string, version: number) {
  if (!mayTrain(viewer)) throw new TrainError("访客不能修改训练内容");
  const row = await ownRow(viewer, id);
  const [old] = await db.select().from(knowledgeVersions).where(and(eq(knowledgeVersions.knowledgeId, id), eq(knowledgeVersions.version, version))).limit(1);
  if (!old) throw new TrainError("没有这个版本");
  await rewrite(viewer, row, { body: old.body, note: `恢复到第 ${version} 版` });
  if (!row.active && old.body.trim()) await db.update(knowledge).set({ active: true }).where(eq(knowledge.id, id));
  await audit(viewer, "train.restore", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE, meta: { version } });
}

export async function addExample(viewer: Viewer, key: unknown, title: string, body: string) {
  guard(viewer, key);
  const t = title.trim().slice(0, 120) || "范例";
  const b = body.replace(/\r\n/g, "\n").trim().slice(0, 40_000);
  if (!b) throw new TrainError("范例是空的");
  const id = newId("kn");
  await db.insert(knowledge).values({ id, tenantId: viewer.tenantId, kind: "example", scope: "role", scopeValue: key, title: t, body: b, updatedBy: viewer.id });
  await audit(viewer, "train.example.add", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE, meta: { key, chars: b.length } });
  return id;
}

export async function updateExample(viewer: Viewer, id: string, title: string, body: string) {
  if (!mayTrain(viewer)) throw new TrainError("访客不能修改训练内容");
  const row = await ownRow(viewer, id);
  if (row.kind !== "example") throw new TrainError("找不到这一条");
  const b = body.replace(/\r\n/g, "\n").trim().slice(0, 40_000);
  if (!b) throw new TrainError("范例是空的");
  await rewrite(viewer, row, { title: title.trim().slice(0, 120) || row.title, body: b });
  await audit(viewer, "train.example.update", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE });
}

export async function setExampleActive(viewer: Viewer, id: string, active: boolean) {
  if (!mayTrain(viewer)) throw new TrainError("访客不能修改训练内容");
  const row = await ownRow(viewer, id);
  await db.update(knowledge).set({ active, updatedBy: viewer.id, updatedAt: new Date() }).where(eq(knowledge.id, row.id));
  await audit(viewer, active ? "train.example.on" : "train.example.off", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE });
}

/** Delete an example for good (the person pressed 删除 and confirmed). */
export async function deleteExample(viewer: Viewer, id: string) {
  if (!mayTrain(viewer)) throw new TrainError("访客不能修改训练内容");
  const row = await ownRow(viewer, id);
  if (row.kind !== "example") throw new TrainError("只能删除范例");
  await db.delete(knowledge).where(eq(knowledge.id, row.id));
  await audit(viewer, "train.example.delete", { objectType: "knowledge", objectId: id, module: AUDIT_MODULE, meta: { title: row.title } });
}

export const agentOf = (key: TrainKey): AgentKey | null => (key === "assistant" ? null : key);
