import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { newId } from "@/lib/ids";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { saveTrainingText, trainingRows } from "@/lib/agents/training";
import { isTrainKey, TRAIN_BUDGET, type TrainKey } from "@/lib/agents/train-keys";
import { toSimplified } from "@/lib/text/simplified";

/**
 * How an AI employee gets better from ordinary work (30 Sep: "make AI
 * improvement better").
 *
 * 1. Feedback is kept as it happens: 有用 / 不好 under a reply, a script
 *    suggestion rejected, a 「再改改」 instruction, a step sent back, a rule
 *    taught.
 * 2. Every eight new pieces (or on request) the employee reads them against
 *    its own 工作说明 and proposes up to five concrete rules, each with the
 *    feedback it rests on.
 * 3. A person adopts or dismisses each proposal on AI 同事 › 训练. Nothing
 *    changes how an employee works until somebody says yes; an adopted rule
 *    lands in 工作说明 with its history, so it can be edited or undone.
 */
export type FeedbackKind = "good" | "bad" | "redo" | "reject" | "sendback" | "taught";
export type Feedback = { at: string; kind: FeedbackKind; text: string; by: string; context?: string };
export type Proposal = { id: string; rule: string; why: string; at: string; status: "pending" | "adopted" | "dismissed" };
type FeedbackStore = { items: Feedback[]; since: number };
type ProposalStore = { items: Proposal[]; lastRun: string | null };

const fbKey = (t: string, a: string) => `learn.feedback:${t}:${a}`;
const prKey = (t: string, a: string) => `learn.proposals:${t}:${a}`;
const REFLECT_EVERY = 8;

async function read<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1).catch(() => []);
  return row?.value && typeof row.value === "object" ? (row.value as T) : fallback;
}
async function write(key: string, value: unknown, by: string) {
  await db.insert(settings).values({ key, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

/** Keep one piece of feedback; returns true when it is time for the employee to reflect. */
export async function recordFeedback(viewer: Viewer, agent: TrainKey, fb: { kind: FeedbackKind; text?: string; context?: string }): Promise<boolean> {
  const store = await read<FeedbackStore>(fbKey(viewer.tenantId, agent), { items: [], since: 0 });
  const item: Feedback = {
    at: new Date().toISOString(),
    kind: fb.kind,
    text: toSimplified(String(fb.text ?? "").replace(/\s+/g, " ").trim()).slice(0, 400),
    by: viewer.nameLocal || viewer.name,
    ...(fb.context ? { context: toSimplified(fb.context.replace(/\s+/g, " ").trim()).slice(0, 400) } : {}),
  };
  const next: FeedbackStore = { items: [...(store.items ?? []), item].slice(-300), since: (store.since ?? 0) + (fb.kind === "good" ? 0 : 1) };
  await write(fbKey(viewer.tenantId, agent), next, viewer.id);
  return next.since >= REFLECT_EVERY;
}

const LABEL: Record<FeedbackKind, string> = { good: "说有用", bad: "说不好", redo: "要求再改", reject: "拒绝了改法", sendback: "退回", taught: "直接教了规则" };

/** The employee reads its recent feedback and proposes rules (pending until a person adopts them). */
export async function reflect(viewer: Viewer, agent: TrainKey): Promise<{ added: number; error?: string }> {
  const fb = await read<FeedbackStore>(fbKey(viewer.tenantId, agent), { items: [], since: 0 });
  const items = (fb.items ?? []).slice(-80);
  if (!items.filter((i) => i.kind !== "good").length) return { added: 0, error: "还没有可以总结的反馈" };
  const rows = await trainingRows(viewer.tenantId, agent);
  const instructions = rows.find((r) => r.kind === "instructions")?.body ?? "";
  const pr = await read<ProposalStore>(prKey(viewer.tenantId, agent), { items: [], lastRun: null });
  const known = (pr.items ?? []).map((p) => p.rule);
  const lines = items.map((i) => `- [${LABEL[i.kind]}] ${i.text}${i.context ? `（针对：${i.context.slice(0, 160)}）` : ""}`).join("\n");
  const out = await complete({
    model: modelFor.agent(agent) ?? modelFor.assistant(),
    temperature: 0.3,
    maxTokens: 1500,
    messages: [
      { role: "system", content: "你在帮一位 AI 员工从同事的反馈里改进自己的做法。只根据反馈里反复出现、或同事明确要求的问题，写出最多 5 条新的工作规则：每条一句话、具体、可以照着做，不要空话，不要重复现有工作说明里已有的内容，也不要重复已经提过的建议。每条附一句依据（引用反馈的原话或事实）。中文一律用简体字。只回答 JSON：{\"rules\":[{\"rule\":\"…\",\"why\":\"…\"}]}。没有值得加的规则就回答 {\"rules\":[]}。" },
      { role: "user", content: `现有工作说明：\n${instructions || "（还没有）"}\n\n已经提过的建议：\n${known.slice(-20).map((k) => `- ${k}`).join("\n") || "（没有）"}\n\n最近的反馈：\n${lines}` },
    ],
  });
  await recordUsage({ viewer, module: "chat", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
  let rules: { rule: string; why: string }[] = [];
  try {
    const t = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/```(?:json)?/g, "");
    const parsed = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as { rules?: unknown };
    rules = (Array.isArray(parsed.rules) ? parsed.rules : [])
      .map((r) => r as Record<string, unknown>)
      .map((r) => ({ rule: toSimplified(String(r.rule ?? "")).trim().slice(0, 200), why: toSimplified(String(r.why ?? "")).trim().slice(0, 200) }))
      .filter((r) => r.rule && !known.includes(r.rule))
      .slice(0, 5);
  } catch {
    return { added: 0, error: "这次没总结出来，稍后再试" };
  }
  const now = new Date().toISOString();
  await write(prKey(viewer.tenantId, agent), { items: [...(pr.items ?? []), ...rules.map((r) => ({ id: newId("sug"), rule: r.rule, why: r.why, at: now, status: "pending" as const }))].slice(-100), lastRun: now }, viewer.id);
  await write(fbKey(viewer.tenantId, agent), { items: fb.items ?? [], since: 0 }, viewer.id);
  return { added: rules.length };
}

/** 采纳 appends the rule to 工作说明; 忽略 puts it away. */
export async function decideProposal(viewer: Viewer, agent: TrainKey, id: string, adopt: boolean): Promise<{ error?: string }> {
  const pr = await read<ProposalStore>(prKey(viewer.tenantId, agent), { items: [], lastRun: null });
  const p = (pr.items ?? []).find((x) => x.id === id);
  if (!p || p.status !== "pending") return { error: "这条建议已经处理过了" };
  if (adopt) {
    const rows = await trainingRows(viewer.tenantId, agent);
    const now = (rows.find((r) => r.kind === "instructions")?.body ?? "").trimEnd();
    const next = now ? `${now}\n- ${p.rule}` : `- ${p.rule}`;
    if (next.length > TRAIN_BUDGET.instructions) return { error: "工作说明已经很长了，先整理一下再采纳" };
    await saveTrainingText(viewer, agent, "instructions", next, "采纳了从反馈里总结的规则");
  }
  await write(prKey(viewer.tenantId, agent), { ...pr, items: (pr.items ?? []).map((x) => (x.id === id ? { ...x, status: adopt ? "adopted" : "dismissed" } : x)) }, viewer.id);
  return {};
}

export type LearningState = { recent: Feedback[]; counts: Record<FeedbackKind, number>; pending: Proposal[]; adopted: number; lastRun: string | null; since: number };

export async function learningState(tenantId: string, agent: string): Promise<LearningState> {
  const counts: Record<FeedbackKind, number> = { good: 0, bad: 0, redo: 0, reject: 0, sendback: 0, taught: 0 };
  if (!isTrainKey(agent)) return { recent: [], counts, pending: [], adopted: 0, lastRun: null, since: 0 };
  const fb = await read<FeedbackStore>(fbKey(tenantId, agent), { items: [], since: 0 });
  const pr = await read<ProposalStore>(prKey(tenantId, agent), { items: [], lastRun: null });
  const month = Date.now() - 30 * 86_400_000;
  for (const i of fb.items ?? []) if (Date.parse(i.at) > month) counts[i.kind]++;
  return {
    recent: (fb.items ?? []).slice(-8).reverse(),
    counts,
    pending: (pr.items ?? []).filter((p) => p.status === "pending").reverse(),
    adopted: (pr.items ?? []).filter((p) => p.status === "adopted").length,
    lastRun: pr.lastRun ?? null,
    since: fb.since ?? 0,
  };
}
