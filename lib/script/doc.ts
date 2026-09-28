import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, files, scriptBeats, scriptComments, scriptVersions, scripts, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage } from "@/lib/ai/ledger";
import { canReadFiles } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { checksumOf, cutVersion, spokenSeconds } from "./service";
import { houseStyle } from "./ai";

/**
 * The script as a document (the project's 脚本 page): what the Google-Doc
 * editor, its AI copilot and its share-for-approval dialog need beyond the
 * Script module's own service.
 *
 * The client (28 Sep): "they just need a google doc with ai copilot so they
 * can share and get approve internally" — the per-second beat table read as
 * a spreadsheet nobody could type into. The beats stay the storage (Video
 * reads them, an approval names their checksum); the page shows each beat's
 * spoken line as one paragraph.
 */

/* ------------------------------------------------------------ reading */

export type DocApproval = {
  id: string;
  state: "requested" | "approved" | "rejected" | "withdrawn";
  versionNo: number | null;
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
  approverId: string | null;
  approverName: string | null;
  approverAvatar: string | null;
  requestedBy: string;
  requesterName: string | null;
  decidedBy: string | null;
  deciderName: string | null;
};

/** Approvals on a script with the names drawn beside them, newest first. */
export async function docApprovals(viewer: Viewer, scriptId: string): Promise<DocApproval[]> {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await db
    .select({
      a: approvals,
      approverName: sql<string | null>`(select coalesce(${zh ? sql`u.name_local` : sql`null`}, u.name) from users u where u.id = ${approvals.approverId})`,
      approverAvatar: sql<string | null>`(select u.avatar_url from users u where u.id = ${approvals.approverId})`,
      requesterName: sql<string | null>`(select coalesce(${zh ? sql`u.name_local` : sql`null`}, u.name) from users u where u.id = ${approvals.requestedBy})`,
      deciderName: sql<string | null>`(select coalesce(${zh ? sql`u.name_local` : sql`null`}, u.name) from users u where u.id = ${approvals.decidedBy})`,
    })
    .from(approvals)
    .where(and(eq(approvals.tenantId, viewer.tenantId), eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId)))
    .orderBy(desc(approvals.requestedAt))
    .limit(40);
  return rows.map(({ a, approverName, approverAvatar, requesterName, deciderName }) => ({
    id: a.id,
    state: a.state,
    versionNo: a.versionNo,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    note: a.note,
    approverId: a.approverId,
    approverName,
    approverAvatar,
    requestedBy: a.requestedBy,
    requesterName,
    decidedBy: a.decidedBy,
    deciderName,
  }));
}

export type DocReference = { id: string; name: string; mime: string | null; sizeBytes: number; hasText: boolean };

/** The files the script is written from (its `source_file_ids`) that this person may open. */
export async function docReferences(viewer: Viewer, scriptId: string): Promise<DocReference[]> {
  const [s] = await db.select({ ids: scripts.sourceFileIds }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  const ids = s?.ids ?? [];
  if (!ids.length) return [];
  const rows = await db
    .select({ id: files.id, name: files.name, mime: files.mime, sizeBytes: files.sizeBytes, hasText: sql<boolean>`coalesce(length(${files.text}), 0) > 0` })
    .from(files)
    .where(and(inArray(files.id, ids), isNull(files.deletedAt), canReadFiles(viewer)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function setReferences(viewer: Viewer, scriptId: string, change: { add?: string; remove?: string }) {
  const [s] = await db.select({ ids: scripts.sourceFileIds }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return null;
  let ids = s.ids ?? [];
  if (change.add && !ids.includes(change.add)) ids = [...ids, change.add].slice(-30);
  if (change.remove) ids = ids.filter((x) => x !== change.remove);
  await db.update(scripts).set({ sourceFileIds: ids, updatedAt: new Date() }).where(eq(scripts.id, scriptId));
  return ids;
}

/** A version's beats, for the 版本 tab's read-only view. */
export async function versionBeats(viewer: Viewer, scriptId: string, versionNo: number) {
  const [s] = await db.select({ id: scripts.id }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return null;
  const [v] = await db
    .select({ beats: scriptVersions.beats, versionNo: scriptVersions.versionNo })
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, versionNo)))
    .limit(1);
  return v ?? null;
}

/* ------------------------------------------------------------ comments */

export async function addDocComment(viewer: Viewer, scriptId: string, input: { beatOrd: number | null; quote: string | null; body: string }) {
  const [s] = await db.select({ version: scripts.version }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return null;
  const id = newId("cmt");
  await db.insert(scriptComments).values({
    id,
    scriptId,
    beatOrd: input.beatOrd,
    versionNo: s.version,
    authorId: viewer.id,
    body: input.body.trim().slice(0, 5000),
    quote: input.quote ? input.quote.slice(0, 500) : null,
  });
  return id;
}

export async function resolveDocComment(viewer: Viewer, scriptId: string, commentId: string, reopen = false) {
  const [s] = await db.select({ id: scripts.id }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return false;
  await db
    .update(scriptComments)
    .set(reopen ? { resolvedAt: null, resolvedBy: null } : { resolvedAt: new Date(), resolvedBy: viewer.id })
    .where(and(eq(scriptComments.id, commentId), eq(scriptComments.scriptId, scriptId)));
  return true;
}

/* ------------------------------------------------------------ approval */

/**
 * Ask several people to review the draft as it stands. One version is cut
 * (only when the draft moved on since the last one — sharing twice must not
 * make two versions), earlier open requests are withdrawn, and each person
 * gets their own request on that version: whoever of them approves first
 * locks it, and the others' requests are withdrawn then.
 */
export async function requestReviews(viewer: Viewer, scriptId: string, approverIds: string[], note: string | null) {
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!script || script.lockedVersion !== null) return null;

  const beats = await db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  if (!beats.length) return null;
  const snapshot = beats.map((b) => ({ ord: b.ord, visual: b.visual, voiceover: b.voiceover, subtitle: b.subtitle, naturalSound: b.naturalSound }));
  const draftSum = checksumOf(snapshot);
  const [latest] = await db
    .select({ versionNo: scriptVersions.versionNo, checksum: scriptVersions.checksum })
    .from(scriptVersions)
    .where(eq(scriptVersions.scriptId, scriptId))
    .orderBy(desc(scriptVersions.versionNo))
    .limit(1);
  let version = latest && latest.checksum === draftSum ? latest : null;
  if (!version) {
    const cut = await cutVersion(viewer, scriptId, { note: note ?? null });
    if (!cut) return null;
    const [v] = await db
      .select({ versionNo: scriptVersions.versionNo, checksum: scriptVersions.checksum })
      .from(scriptVersions)
      .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, cut.versionNo)))
      .limit(1);
    version = v ?? null;
  }
  if (!version) return null;

  await db
    .update(approvals)
    .set({ state: "withdrawn", decidedAt: new Date(), decidedBy: viewer.id })
    .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "requested")));
  const ids: string[] = [];
  for (const approverId of [...new Set(approverIds)].slice(0, 20)) {
    const id = newId("apr");
    ids.push(id);
    await db.insert(approvals).values({
      id,
      tenantId: viewer.tenantId,
      objectType: "script",
      objectId: scriptId,
      checksum: version.checksum,
      versionNo: version.versionNo,
      requestedBy: viewer.id,
      approverId,
      note,
    });
  }
  await db.update(scripts).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(scripts.id, scriptId));
  return { versionNo: version.versionNo, approvalIds: ids };
}

/** The open request this person may decide: theirs, or (an owner or admin) any. */
export async function openRequestFor(viewer: Viewer, scriptId: string) {
  const admin = viewer.role === "owner" || viewer.role === "admin";
  const rows = await db
    .select({ id: approvals.id, approverId: approvals.approverId, requestedBy: approvals.requestedBy })
    .from(approvals)
    .where(and(eq(approvals.tenantId, viewer.tenantId), eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "requested")))
    .orderBy(desc(approvals.requestedAt));
  return rows.find((r) => r.approverId === viewer.id) ?? (admin ? rows[0] : undefined) ?? null;
}

/** After one request was decided: the rest on the same script are withdrawn. */
export async function withdrawOthers(viewer: Viewer, scriptId: string, exceptId: string) {
  await db
    .update(approvals)
    .set({ state: "withdrawn", decidedAt: new Date(), decidedBy: viewer.id })
    .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "requested"), ne(approvals.id, exceptId)));
}

/* ------------------------------------------------------------ the copilot */

export type DocChange = { i: number; text: string; why: string };
export type DocInsert = { after: number; text: string; why: string };

const COPILOT_PROMPT = `你是短视频工作室的编剧，正在和同事一起改一份口播脚本。脚本按段落编号，每段是一句或几句要说的话。
按同事的指令改写。只回答一个 JSON 对象，不要 markdown，不要解释：
{"changes":[{"i":段落编号,"text":"改后的整段","why":"十五字以内说明"}],"inserts":[{"after":插在哪一段之后（-1 表示最前面）,"text":"新段落","why":"说明"}],"summary":"一句话总结改了什么"}
规则：
- 只列真的要改的段落；没改的段落不要出现。要删掉一段，text 写空字符串 ""。
- 保持原来的语言（简体/繁体）、人设和口吻，不要编造事实、数字、人名。
- 口播按每秒约 4.5 个汉字估算时长；"缩短 30 秒"就是删减约 135 个字。
- "text" 是完整的一段，不是片段。
- 扩写或改写时，优先改原段落本身（changes 里给出改后的整段），不要在原段落旁边另加一段意思相同的新段落；只有真正的新内容才用 inserts。
- 指令给了目标字数时，改完后全文总字数要落在目标上下 10% 以内：先算清楚再写。`;

async function referenceText(viewer: Viewer, scriptId: string): Promise<string> {
  const [s] = await db.select({ ids: scripts.sourceFileIds }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  const ids = s?.ids ?? [];
  if (!ids.length) return "";
  const rows = await db
    .select({ name: files.name, text: files.text })
    .from(files)
    .where(and(inArray(files.id, ids), isNull(files.deletedAt), canReadFiles(viewer)));
  const parts = rows.filter((r) => r.text && r.text.trim()).map((r) => `### ${r.name}\n${r.text!.slice(0, 3000)}`);
  return parts.length ? `参考资料（同事上传的，可以引用其中的事实）：\n${parts.join("\n\n").slice(0, 9000)}` : "";
}

/**
 * 编剧 rewrites the document to an instruction: the paragraphs it would
 * change, delete or add, for the page to show as tracked changes. Nothing is
 * saved here — the person accepts what they want.
 */
export async function copilotRewrite(viewer: Viewer, scriptId: string, paragraphs: string[], instruction: string, pick?: string | null) {
  await assertBudget(viewer);
  const [script] = await db.select({ title: scripts.title, targetSeconds: scripts.targetSeconds }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!script) return { error: "Not allowed" };
  /* The house style and 编剧's training (AI 训练) come in one piece from `houseStyle`. */
  const [style, refs] = await Promise.all([houseStyle(viewer, "script").catch(() => ({ text: "" })), referenceText(viewer, scriptId).catch(() => "")]);
  const system = [COPILOT_PROMPT, style.text ? `工作室的写作规范与编剧的训练：\n${style.text.slice(0, 12000)}` : "", refs].filter(Boolean).join("\n\n");
  const total = paragraphs.reduce((n, p) => n + spokenSeconds(p), 0);
  const user = [
    `标题：${script.title}`,
    script.targetSeconds ? `目标时长：${script.targetSeconds} 秒；现在约 ${Math.round(total)} 秒` : `现在约 ${Math.round(total)} 秒`,
    `指令：${instruction.slice(0, 1000)}`,
    "",
    "脚本：",
    ...paragraphs.map((p, i) => `[${i}] ${p || "（空，现场声）"}`),
  ].join("\n");

  /* The assistant model: a copilot that takes a minute and a half (the
     drafting model reasons first, and on a long prompt ran out of room
     before the JSON) is not a copilot. One retry when the answer is not
     the JSON asked for. */
  let raw: { changes?: unknown; inserts?: unknown; summary?: unknown } | null = null;
  let model = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const out = await complete({
      /* The 「模型」 picked beside the copilot, else the studio default. */
      model: pick ?? modelFor.assistant(),
      temperature: attempt ? 0.2 : 0.5,
      maxTokens: 6000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    await recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    model = out.model;
    const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/```(?:json)?/g, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      raw = null;
    }
  }
  if (!raw) return { error: "编剧这次没有给出可用的改法，再试一次。" };
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const changes: DocChange[] = (Array.isArray(raw.changes) ? raw.changes : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ i: Number(c.i), text: s(c.text, 4000), why: s(c.why, 80) }))
    .filter((c) => Number.isInteger(c.i) && c.i >= 0 && c.i < paragraphs.length && c.text !== paragraphs[c.i]);
  const seen = new Set<number>();
  const unique = changes.filter((c) => (seen.has(c.i) ? false : (seen.add(c.i), true)));
  const inserts: DocInsert[] = (Array.isArray(raw.inserts) ? raw.inserts : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ after: Number(c.after), text: s(c.text, 4000), why: s(c.why, 80) }))
    .filter((c) => Number.isInteger(c.after) && c.after >= -1 && c.after < paragraphs.length && c.text)
    .slice(0, 8);
  if (!unique.length && !inserts.length) return { error: "编剧觉得按这个指令不需要改动。换个说法试试。" };
  return { ok: true as const, changes: unique, inserts, summary: s(raw.summary, 200), model };
}

/** Names for the people a script's DMs and approvals mention. */
export async function peopleNames(viewer: Viewer, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await db.select({ id: users.id, name: users.name, nameLocal: users.nameLocal }).from(users).where(and(eq(users.tenantId, viewer.tenantId), inArray(users.id, ids)));
  return new Map(rows.map((r) => [r.id, (zh && r.nameLocal) || r.name]));
}
