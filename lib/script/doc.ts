import "server-only";
import { HUMAN_STYLE_ZH, humanize } from "@/lib/text/human";
import { readFileText } from "@/lib/ai/retrieval";
import { fileTextWithin } from "@/lib/files/extract";
import { toSimplified } from "@/lib/text/simplified";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, files, notifications, scriptBeats, scriptComments, scriptVersions, scripts, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { complete } from "@/lib/ai/openrouter";
import { disclosureForWriting } from "@/lib/ai/disclosure";
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
    .select({ id: scriptVersions.id, beats: scriptVersions.beats, versionNo: scriptVersions.versionNo })
    .from(scriptVersions)
    .where(and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, versionNo)))
    .limit(1);
  return v ?? null;
}

/* ------------------------------------------------------------ comments */

export async function addDocComment(viewer: Viewer, scriptId: string, input: { beatOrd: number | null; quote: string | null; body: string; parentId?: string | null; href?: string | null }) {
  input = { ...input, body: toSimplified(input.body), quote: input.quote ? toSimplified(input.quote) : input.quote };
  const [s] = await db.select({ version: scripts.version, title: scripts.title }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return null;
  /* A reply hangs under the thread's first comment: a reply to a reply joins
     the same thread, so threads stay one level deep. */
  let parent: { id: string; authorId: string | null; resolvedAt: Date | null } | null = null;
  if (input.parentId) {
    const [p] = await db
      .select({ id: scriptComments.id, parentId: scriptComments.parentId, authorId: scriptComments.authorId, resolvedAt: scriptComments.resolvedAt })
      .from(scriptComments)
      .where(and(eq(scriptComments.id, input.parentId), eq(scriptComments.scriptId, scriptId)))
      .limit(1);
    if (!p) return null;
    if (p.parentId) {
      const [root] = await db
        .select({ id: scriptComments.id, authorId: scriptComments.authorId, resolvedAt: scriptComments.resolvedAt })
        .from(scriptComments)
        .where(and(eq(scriptComments.id, p.parentId), eq(scriptComments.scriptId, scriptId)))
        .limit(1);
      if (!root) return null;
      parent = root;
    } else parent = { id: p.id, authorId: p.authorId, resolvedAt: p.resolvedAt };
  }
  const id = newId("cmt");
  await db.insert(scriptComments).values({
    id,
    scriptId,
    parentId: parent?.id ?? null,
    beatOrd: parent ? null : input.beatOrd,
    versionNo: s.version,
    authorId: viewer.id,
    body: input.body.trim().slice(0, 5000),
    quote: !parent && input.quote ? input.quote.slice(0, 500) : null,
  });
  if (parent) {
    /* Answering a resolved thread opens it again, as in Google Docs. */
    if (parent.resolvedAt) await resolveDocComment(viewer, scriptId, parent.id, true);
    if (parent.authorId && parent.authorId !== viewer.id) {
      const who = viewer.nameLocal || viewer.name;
      await db
        .insert(notifications)
        .values({
          id: newId("ntf"),
          userId: parent.authorId,
          kind: "approval",
          title: `${who} 回复了你在《${s.title}》里的批注`,
          body: input.body.trim().slice(0, 140),
          href: input.href ?? null,
          module: "script",
        })
        .catch((err) => console.error("[script] could not notify the comment's author", err));
    }
  }
  return id;
}

/** Resolving (or reopening) a thread: its first comment and every reply under it. */
export async function resolveDocComment(viewer: Viewer, scriptId: string, commentId: string, reopen = false) {
  const [s] = await db.select({ id: scripts.id }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return false;
  const [c] = await db.select({ id: scriptComments.id, parentId: scriptComments.parentId }).from(scriptComments).where(and(eq(scriptComments.id, commentId), eq(scriptComments.scriptId, scriptId))).limit(1);
  if (!c) return false;
  const root = c.parentId ?? c.id;
  await db
    .update(scriptComments)
    .set(reopen ? { resolvedAt: null, resolvedBy: null } : { resolvedAt: new Date(), resolvedBy: viewer.id })
    .where(and(eq(scriptComments.scriptId, scriptId), sql`(${scriptComments.id} = ${root} or ${scriptComments.parentId} = ${root})`));
  return true;
}

/**
 * Deleting a comment: its author's, or an owner's or admin's. A thread's
 * first comment takes its replies with it (the foreign key cascades).
 */
export async function deleteDocComment(viewer: Viewer, scriptId: string, commentId: string) {
  const [s] = await db.select({ id: scripts.id }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!s) return false;
  const [c] = await db.select({ id: scriptComments.id, authorId: scriptComments.authorId }).from(scriptComments).where(and(eq(scriptComments.id, commentId), eq(scriptComments.scriptId, scriptId))).limit(1);
  if (!c) return false;
  const admin = viewer.role === "owner" || viewer.role === "admin";
  if (c.authorId !== viewer.id && !admin) return false;
  await db.delete(scriptComments).where(eq(scriptComments.id, c.id));
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

const COPILOT_PROMPT = `你是短视频工作室的文案，正在和同事一起改一份口播脚本。脚本按段落编号，每段是一句或几句要说的话。
先判断同事这句话是在提问、讨论，还是在明确要求修改：
- 提问或讨论（例如“这稿多长”“开头怎么样”“有什么建议”“为什么这样写”“这段讲的是什么”）：只回答，不改稿。changes 和 inserts 都给空数组 []，把回答写在 "reply" 里。回答要具体，引用段落编号或原文。
- 意思不确定、像是在征求意见（例如“是不是太长了”“开头要不要改”）：不要动手改。在 "reply" 里说你的判断和打算怎么改，最后问一句“要我这样改吗？”。changes 和 inserts 给空数组。
- 明确要求修改（例如“缩短到 60 秒”“开头更抓人”“把第三段改口语一点”），或者同事回应你上一轮的提议（例如“好”“可以，改吧”）：按指令改写，在 changes / inserts 里给出改法，"reply" 用一句话说改了什么。
只回答一个 JSON 对象，不要 markdown，不要 JSON 以外的解释：
{"reply":"给同事的回答或说明","changes":[{"i":段落编号,"text":"改后的整段","why":"十五字以内说明"}],"inserts":[{"after":插在哪一段之后（-1 表示最前面）,"text":"新段落","why":"说明"}],"summary":"一句话总结改了什么（没改就留空）"}
改稿时的规则：
- 只列真的要改的段落；没改的段落不要出现。要删掉一段，text 写空字符串 ""。
- 中文一律用简体字，不要用繁体字（原文是繁体的也改成简体）。保持原来的人设和口吻，不要编造事实、数字、人名。
- 口播按每秒约 4.5 个汉字估算时长；"缩短 30 秒"就是删减约 135 个字。
- "text" 是完整的一段，不是片段。
- 扩写或改写时，优先改原段落本身（changes 里给出改后的整段），不要在原段落旁边另加一段意思相同的新段落；只有真正的新内容才用 inserts。
- 指令给了目标字数时，改完后全文总字数要落在目标上下 10% 以内：先算清楚再写。
- 编号里写“（空，现场声）”的是空段落，不算正文：指令说“第一段/开头”时，指的是第一个有文字的段落。
- 只改指令要求改的地方。除非指令要求删减、缩短或重写全文，不要删掉同事写的段落。
- “不是……而是……”这种句式最多用一次；不要口号式金句和套话（拐点、王道、战略性）；不夸大，不编数字和比喻。`;

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
 * 文案 rewrites the document to an instruction: the paragraphs it would
 * change, delete or add, for the page to show as tracked changes. Nothing is
 * saved here — the person accepts what they want.
 */
export async function copilotRewrite(viewer: Viewer, scriptId: string, paragraphs: string[], instruction: string, pick?: string | null, fileIds: string[] = [], history: { q: string; a: string }[] = []) {
  await assertBudget(viewer);
  const [script] = await db.select({ title: scripts.title, targetSeconds: scripts.targetSeconds }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!script) return { error: "Not allowed" };
  /* The house style and 文案's training (AI 训练) come in one piece from `houseStyle`. */
  const [style, refs] = await Promise.all([houseStyle(viewer, "script").catch(() => ({ text: "" })), referenceText(viewer, scriptId).catch(() => "")]);
  /* Files attached to this one instruction (a sample to follow, notes, a screenshot): read now, not kept. */
  const attached: string[] = [];
  for (const id of fileIds) {
    await fileTextWithin(id, 45_000, { ledger: { viewer, module: "script" } }).catch(() => null);
    const f = await readFileText(viewer, id, 20_000).catch(() => null);
    if (f?.text?.trim()) attached.push(`### ${f.name}\n${f.text}`);
  }
  const attachedText = attached.length ? `这次指令附的参考文件（指令说“照范例/照附件”时，学它的结构、语气、节奏和开头方式，但不要照抄它的内容）：\n${attached.join("\n\n").slice(0, 40000)}` : "";
  const model0 = pick ?? modelFor.agent("script") ?? modelFor.assistant();
  const system = [COPILOT_PROMPT, disclosureForWriting(model0), HUMAN_STYLE_ZH, style.text ? `工作室的写作规范与文案的训练：\n${style.text.slice(0, 12000)}` : "", refs, attachedText].filter(Boolean).join("\n\n");
  const total = paragraphs.reduce((n, p) => n + spokenSeconds(p), 0);
  const chars = paragraphs.reduce((n, p) => n + p.replace(/\s/g, "").length, 0);
  /* The last few turns in the side panel, so "好，改吧" answers the proposal before it. */
  const said = history.slice(-4).map((h) => `同事：${h.q.slice(0, 400)}\n文案：${h.a.slice(0, 600)}`).join("\n");
  const user = [
    `标题：${script.title}`,
    script.targetSeconds ? `目标时长：${script.targetSeconds} 秒；现在约 ${Math.round(total)} 秒，${chars} 个字，${paragraphs.filter((p) => p.trim()).length} 段` : `现在约 ${Math.round(total)} 秒，${chars} 个字，${paragraphs.filter((p) => p.trim()).length} 段`,
    said ? `之前的对话：\n${said}` : "",
    `同事这次说：${instruction.slice(0, 1000)}`,
    "",
    "脚本：",
    ...paragraphs.map((p, i) => `[${i}] ${p || "（空，现场声）"}`),
  ].join("\n");

  /* The assistant model: a copilot that takes a minute and a half (the
     drafting model reasons first, and on a long prompt ran out of room
     before the JSON) is not a copilot. One retry when the answer is not
     the JSON asked for. */
  let raw: { reply?: unknown; changes?: unknown; inserts?: unknown; summary?: unknown } | null = null;
  let model = "";
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const out = await complete({
      /* The 「模型」 picked beside the copilot, else the studio default. */
      model: pick ?? modelFor.agent("script") ?? modelFor.assistant(),
      temperature: attempt ? 0.2 : 0.5,
      maxTokens: 14000,
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
  if (!raw) return { error: "文案这次没有给出可用的改法，再试一次。" };
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const changes: DocChange[] = (Array.isArray(raw.changes) ? raw.changes : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ i: Number(c.i), text: humanize(s(c.text, 4000)), why: humanize(s(c.why, 80)) }))
    .filter((c) => Number.isInteger(c.i) && c.i >= 0 && c.i < paragraphs.length && c.text !== paragraphs[c.i]);
  const seen = new Set<number>();
  const unique = changes.filter((c) => (seen.has(c.i) ? false : (seen.add(c.i), true)));
  const inserts: DocInsert[] = (Array.isArray(raw.inserts) ? raw.inserts : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ after: Number(c.after), text: humanize(s(c.text, 4000)), why: humanize(s(c.why, 80)) }))
    .filter((c) => Number.isInteger(c.after) && c.after >= -1 && c.after < paragraphs.length && c.text)
    .slice(0, 8);
  const reply = humanize(s(raw.reply, 3000));
  /* A question answered, or a proposal put to the person: nothing is marked in the document. */
  if (!unique.length && !inserts.length) return reply ? { ok: true as const, changes: [] as DocChange[], inserts: [] as DocInsert[], summary: "", reply, model } : { error: "文案觉得按这个指令不需要改动。换个说法试试。" };
  return { ok: true as const, changes: unique, inserts, summary: s(raw.summary, 200) || reply, reply, model };
}

/**
 * 「再改改」: one suggested change, done again to a new instruction. Only
 * that paragraph comes back; the rest of the draft is not touched.
 */
export async function copilotRedo(viewer: Viewer, scriptId: string, input: { before: string; suggestion: string; instruction: string; around: string }, pick?: string | null) {
  await assertBudget(viewer);
  const [script] = await db.select({ title: scripts.title }).from(scripts).where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId))).limit(1);
  if (!script) return { error: "Not allowed" };
  const style = await houseStyle(viewer, "script").catch(() => ({ text: "" }));
  const system = [
    "你是短视频工作室的文案，正在和同事一起改一份口播脚本里的一段话。",
    "按同事的新要求，重写你之前给出的这一段改法。只输出改好的这一段正文，不要引号、不要解释、不要编号。",
    "中文一律用简体字。保持原来的人设和口吻，不要编造事实、数字、人名。",
    disclosureForWriting(pick ?? modelFor.agent("script") ?? modelFor.assistant()),
    style.text ? `工作室的写作规范与文案的训练：\n${style.text.slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n");
  const user = [
    `标题：${script.title}`,
    input.around ? `上下文（前后几段，只供参考）：\n${input.around.slice(0, 3000)}` : "",
    input.before ? `原文这一段：${input.before.slice(0, 4000)}` : "原文：（新增的一段）",
    `你上一次的改法：${input.suggestion.slice(0, 4000)}`,
    `同事的新要求：${input.instruction.slice(0, 600)}`,
  ].filter(Boolean).join("\n\n");
  const out = await complete({
    model: pick ?? modelFor.agent("script") ?? modelFor.assistant(),
    temperature: 0.5,
    maxTokens: 6000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  await recordUsage({ viewer, module: "script", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
  const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").replace(/^["“「]|["”」]$/g, "").trim().slice(0, 4000);
  if (!text) return { error: "文案这次没有给出改法，再试一次。" };
  return { ok: true as const, text: humanize(text) };
}

/** Names for the people a script's DMs and approvals mention. */
export async function peopleNames(viewer: Viewer, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await db.select({ id: users.id, name: users.name, nameLocal: users.nameLocal }).from(users).where(and(eq(users.tenantId, viewer.tenantId), inArray(users.id, ids)));
  return new Map(rows.map((r) => [r.id, (zh && r.nameLocal) || r.name]));
}
