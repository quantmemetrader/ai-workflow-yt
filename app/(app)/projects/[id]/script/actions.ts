"use server";

import { startFromTopicAction } from "@/app/(app)/projects/actions";
import { toSimplified } from "@/lib/text/simplified";
import { pickedModel } from "@/lib/ai/chat-models";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, scriptBeats, scriptVersions, scripts, users, workProjects } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { BudgetStop } from "@/lib/ai/ledger";
import { visibleProject, linkedProject } from "@/lib/projects/service";
import { dmChannelWith, postMessage } from "@/lib/chat/service";
import { tagProjectFile } from "@/lib/projects/files";
import { ensureFileText } from "@/lib/files/extract";
import { importableHtml } from "@/lib/files/doc-edit";
import { htmlToRichDoc, lineCount } from "@/lib/script/html-import";
import { beatsFromDoc, isRichDoc, docForBeats, withUnitTexts, type RichDoc, type RichNode } from "@/lib/script/rich";
import { asc, desc } from "drizzle-orm";
import { readSentBack, recordSendBack, settleSendBack } from "@/lib/projects/sendback";
import { checksumOf, createScript, cutVersion, decideApproval, requestApproval, restoreVersion, saveBeats, unlock, versionDoc } from "@/lib/script/service";
import { addDocComment, copilotRedo, deleteDocComment, copilotRewrite, openRequestFor, requestReviews, resolveDocComment, setReferences, versionBeats, withdrawOthers } from "@/lib/script/doc";

/**
 * What the project's 脚本 page (the script as a document) can do.
 *
 * Every action re-reads the viewer and resolves the project through
 * `visibleProject`, so a project id from the browser only ever reaches a
 * project this person may see; the script is always the project's own,
 * never an id the browser sent.
 */

type Ctx = { viewer: Viewer; zh: boolean; project: NonNullable<Awaited<ReturnType<typeof visibleProject>>> };

async function ctx(projectId: unknown, needScript = false): Promise<Ctx | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  if (needScript && !viewer.modules.includes("script")) return { error: zh ? "改脚本需要脚本模块的权限" : "Editing needs the Script module" };
  const id = typeof projectId === "string" && projectId.length < 64 ? projectId : null;
  /* A member, or someone who opened it by its link (有链接的人): 可编辑 for edits, either for reading. */
  const project = id ? ((await visibleProject(viewer, id)) ?? (await linkedProject(viewer, id, needScript ? "edit" : "view"))) : null;
  if (!project) return { error: id && needScript && (await linkedProject(viewer, id, "view")) ? (zh ? "你通过链接打开，只有查看权限" : "You opened this by its link and can only view it") : zh ? "没有这个项目" : "No such project" };
  return { viewer, zh, project };
}

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

function asMessage(err: unknown): string {
  if (err instanceof BudgetStop) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

const scriptUrl = (projectId: string) => `/projects/${projectId}/script`;

type BeatIn = { visual?: unknown; voiceover?: unknown; subtitle?: unknown; naturalSound?: unknown };

/** Autosave: the document's paragraphs, as the beats they are. */
export async function saveDocAction(projectId: unknown, beats: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId || !Array.isArray(beats)) return { error: "Not allowed" };
  const clean = (beats as BeatIn[]).slice(0, 200).map((b) => ({
    visual: typeof b.visual === "string" ? b.visual : "",
    voiceover: typeof b.voiceover === "string" ? b.voiceover : "",
    subtitle: typeof b.subtitle === "string" ? b.subtitle : "",
    naturalSound: b.naturalSound === true,
  }));
  const res = await saveBeats(c.viewer, c.project.scriptId, clean);
  if (!res) return { error: c.zh ? "脚本已批准锁定，先点「继续编辑」" : "The script is locked" };
  return { ok: true as const, at: new Date().toISOString() };
}

/** Editing an approved script: unlock it into a new draft (it will need approving again). */
export async function unlockDocAction(projectId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  await unlock(c.viewer, c.project.scriptId);
  await audit(c.viewer, "script.unlock", { objectType: "script", objectId: c.project.scriptId, module: "script", meta: { from: "doc" } });
  refresh(c.project.id);
  return { ok: true as const };
}

/** A blank script to type into (自己写). */
export async function startBlankAction(projectId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  let scriptId = c.project.scriptId;
  if (!scriptId) {
    scriptId = await createScript(c.viewer, { title: c.project.title });
    await db.update(workProjects).set({ scriptId, updatedAt: new Date() }).where(eq(workProjects.id, c.project.id));
  }
  const [has] = await db.select({ id: scriptBeats.id }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).limit(1);
  if (!has) await saveBeats(c.viewer, scriptId, [{ visual: "", voiceover: "", subtitle: "" }]);
  refresh(c.project.id);
  return { ok: true as const };
}

/** The AI copilot: 编剧's tracked changes for an instruction. Nothing is saved. */
export async function copilotAction(projectId: unknown, paragraphs: unknown, instruction: unknown, model?: unknown, fileIds?: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  if (typeof instruction !== "string" || !instruction.trim()) return { error: c.zh ? "写下要怎么改" : "Say what to change" };
  if (!Array.isArray(paragraphs) || !paragraphs.length) return { error: c.zh ? "脚本还是空的" : "The script is empty" };
  const list = paragraphs.slice(0, 200).map((p) => (typeof p === "string" ? p.slice(0, 4000) : ""));
  try {
    const files = Array.isArray(fileIds) ? fileIds.filter((x): x is string => typeof x === "string" && /^fil_[0-9a-z]+$/i.test(x)).slice(0, 5) : [];
    return await copilotRewrite(c.viewer, c.project.scriptId, list, instruction, pickedModel(model), files);
  } catch (err) {
    return { error: asMessage(err) };
  }
}

/** 「再改改」: redo one suggested change to a new instruction. Nothing is saved. */
export async function copilotRedoAction(projectId: unknown, input: unknown, model?: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
  const instruction = str(v.instruction, 600).trim();
  if (!instruction) return { error: c.zh ? "写下这一段想怎么改" : "Say how to change it" };
  try {
    return await copilotRedo(c.viewer, c.project.scriptId, { before: str(v.before, 4000), suggestion: str(v.suggestion, 4000), instruction, around: str(v.around, 3000) }, pickedModel(model));
  } catch (err) {
    return { error: asMessage(err) };
  }
}

/**
 * An instruction typed into the AI bar while the page is empty: 编剧 writes the
 * first draft from it, with any attached files as the script's 参考资料
 * (谢总, 1 Oct: pressed send on an empty page and nothing happened).
 */
export async function draftWithInstructionAction(projectId: unknown, instruction: unknown, fileIds?: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  if (typeof instruction !== "string" || !instruction.trim()) return { error: c.zh ? "写下想要什么样的稿子" : "Say what the draft should be" };
  const ids = Array.isArray(fileIds) ? fileIds.filter((x): x is string => typeof x === "string" && /^fil_[0-9a-z]+$/i.test(x)).slice(0, 5) : [];
  for (const id of ids) {
    if (await tagProjectFile(c.viewer, c.project.id, id, "reference").catch(() => false)) await setReferences(c.viewer, c.project.scriptId, { add: id }).catch(() => null);
  }
  const r = await startFromTopicAction({ kind: "project", id: c.project.id }, { write: true, instruction: instruction.trim() });
  refresh(c.project.id);
  if ("error" in r && r.error) return { error: r.error };
  return { ok: true as const };
}

/** A file just uploaded (or picked) into the script's 参考资料. */
export async function addReferenceAction(projectId: unknown, fileId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof fileId !== "string") return { error: "Not allowed" };
  const ok = await tagProjectFile(c.viewer, c.project.id, fileId, "reference");
  if (!ok) return { error: c.zh ? "这个文件打不开" : "That file cannot be opened" };
  await setReferences(c.viewer, c.project.scriptId, { add: fileId });
  refresh(c.project.id);
  return { ok: true as const };
}

export async function removeReferenceAction(projectId: unknown, fileId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof fileId !== "string") return { error: "Not allowed" };
  await setReferences(c.viewer, c.project.scriptId, { remove: fileId });
  refresh(c.project.id);
  return { ok: true as const };
}

/** A comment on selected words (批注). Anyone who can see the project may comment. */
export async function docCommentAction(projectId: unknown, beatOrd: unknown, quote: unknown, body: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  if (typeof body !== "string" || !body.trim()) return { error: c.zh ? "写点什么" : "Write something first" };
  const ord = Number(beatOrd);
  const id = await addDocComment(c.viewer, c.project.scriptId, {
    beatOrd: Number.isInteger(ord) && ord >= 0 ? ord : null,
    quote: typeof quote === "string" && quote.trim() ? quote.trim() : null,
    body,
  });
  refresh(c.project.id);
  return id ? { ok: true as const, id } : { error: "Not allowed" };
}

export async function resolveCommentAction(projectId: unknown, commentId: unknown, reopen?: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof commentId !== "string") return { error: "Not allowed" };
  await resolveDocComment(c.viewer, c.project.scriptId, commentId, reopen === true);
  refresh(c.project.id);
  return { ok: true as const };
}

/** A reply under a comment (Ryan's team, 2 Oct: talk a point through where it was made). Whoever may comment may reply. */
export async function replyCommentAction(projectId: unknown, parentId: unknown, body: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof parentId !== "string" || parentId.length > 64) return { error: "Not allowed" };
  if (typeof body !== "string" || !body.trim()) return { error: c.zh ? "写点什么" : "Write something first" };
  const id = await addDocComment(c.viewer, c.project.scriptId, { beatOrd: null, quote: null, body, parentId, href: scriptUrl(c.project.id) });
  refresh(c.project.id);
  return id ? { ok: true as const, id } : { error: c.zh ? "这条批注已经不在了" : "That comment is gone" };
}

/** Deleting a comment (its author, or an owner or admin). A thread's first comment takes its replies with it. */
export async function deleteCommentAction(projectId: unknown, commentId: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof commentId !== "string" || commentId.length > 64) return { error: "Not allowed" };
  const ok = await deleteDocComment(c.viewer, c.project.scriptId, commentId);
  if (!ok) return { error: c.zh ? "只能删除自己写的批注" : "You can only delete your own comments" };
  refresh(c.project.id);
  return { ok: true as const };
}

/** One version's text, for the 版本 tab. */
export async function versionBeatsAction(projectId: unknown, versionNo: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  const n = Number(versionNo);
  if (!c.project.scriptId || !Number.isInteger(n)) return { error: "Not allowed" };
  const v = await versionBeats(c.viewer, c.project.scriptId, n);
  if (!v) return { error: "Not found" };
  /* The version's rich document too, when it kept one, so the preview shows
     its headings and bold (QA, 2 Oct). */
  const kept = await versionDoc(v.id).catch(() => null);
  return { ok: true as const, beats: v.beats.map((b) => ({ visual: b.visual, voiceover: b.voiceover, naturalSound: b.naturalSound })), doc: kept?.doc ?? null };
}

/**
 * The draft as it stands kept as a version, unless the newest version
 * already says exactly this (an approved script reopened, a second press).
 */
async function keepDraft(c: Ctx, scriptId: string, note: string) {
  const beats = await db
    .select({ ord: scriptBeats.ord, visual: scriptBeats.visual, voiceover: scriptBeats.voiceover, subtitle: scriptBeats.subtitle, naturalSound: scriptBeats.naturalSound })
    .from(scriptBeats)
    .where(eq(scriptBeats.scriptId, scriptId))
    .orderBy(asc(scriptBeats.ord));
  if (!beats.some((b) => b.voiceover.trim() || b.visual.trim())) return null;
  const [latest] = await db.select({ checksum: scriptVersions.checksum }).from(scriptVersions).where(eq(scriptVersions.scriptId, scriptId)).orderBy(desc(scriptVersions.versionNo)).limit(1);
  if (latest?.checksum === checksumOf(beats)) return null;
  return cutVersion(c.viewer, scriptId, { note });
}

/** 恢复此版本: the draft as it stands is kept as a version first, then the old one comes back. */
export async function restoreDocVersionAction(projectId: unknown, versionNo: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  const n = Number(versionNo);
  const scriptId = c.project.scriptId;
  if (!scriptId || !Number.isInteger(n) || n < 1) return { error: "Not allowed" };
  const [s] = await db.select({ locked: scripts.lockedVersion }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (s?.locked !== null && s?.locked !== undefined) await unlock(c.viewer, scriptId);
  await cutVersion(c.viewer, scriptId, { note: c.zh ? "恢复旧版本前的稿子" : "Before restoring an earlier version" });
  const res = await restoreVersion(c.viewer, scriptId, n);
  if (!res) return { error: c.zh ? "这个版本不存在" : "That version does not exist" };
  await audit(c.viewer, "script.restore", { objectType: "script", objectId: scriptId, module: "script", meta: { versionNo: n, from: "doc" } });
  refresh(c.project.id);
  /* The restored document goes back to the page, which loads it at once (QA round 2:
     the page kept the typed text and its next autosave wrote over the restore). */
  const [after] = await db.select({ doc: scripts.doc }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  return { ok: true as const, doc: (after?.doc as Record<string, unknown> | null) ?? null };
}

/**
 * 分享: send the script to colleagues as a DM in the workspace chat, with a
 * link to open it — and, asked to review, a request each of them can
 * approve from the page. The project's own chat gets one line saying who it
 * went to, so the flow shows where the script is.
 */
export async function shareScriptAction(projectId: unknown, input: { userIds?: unknown; ask?: unknown; message?: unknown }) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId) return { error: "Not allowed" };
  const ask = input.ask === "review" ? "review" : "view";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 1000) : "";
  const ids = Array.isArray(input.userIds) ? [...new Set(input.userIds.filter((x): x is string => typeof x === "string"))].slice(0, 20) : [];
  if (!ids.length) return { error: c.zh ? "选要发给谁" : "Choose who to send it to" };

  const people = await db
    .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, isAgent: users.isAgent, status: users.status, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.tenantId, c.viewer.tenantId));
  const byId = new Map(people.filter((u) => !u.isAgent && u.status === "active").map((u) => [u.id, u]));
  const targets = ids.filter((id) => byId.has(id) && id !== c.viewer.id);
  if (!targets.length) return { error: c.zh ? "选的人不在这个工作室" : "Those people are not in this studio" };

  let versionNo: number | null = null;
  if (ask === "review") {
    const [s] = await db.select({ locked: scripts.lockedVersion }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
    if (s?.locked !== null && s?.locked !== undefined) return { error: c.zh ? "脚本已经批准了；要再审，先继续编辑出新版本" : "Already approved" };
    const r = await requestReviews(c.viewer, scriptId, targets, message || null);
    if (!r) return { error: c.zh ? "脚本还是空的，写几句再请人审" : "The script is empty" };
    versionNo = r.versionNo;
  }

  const me = (c.zh && c.viewer.nameLocal) || c.viewer.name;
  const link = scriptUrl(c.project.id);
  const lead =
    ask === "review"
      ? c.zh
        ? `${me} 请你审阅并批准脚本《${c.project.title}》${versionNo ? `（第 ${versionNo} 版）` : ""}。打开后可以直接改、加批注，看完按「批准」或「提修改意见」。`
        : `${me} asks you to review and approve the script “${c.project.title}”${versionNo ? ` (v${versionNo})` : ""}.`
      : c.zh
        ? `${me} 把脚本《${c.project.title}》分享给你。`
        : `${me} shared the script “${c.project.title}” with you.`;
  const body = [message ? `${message}\n` : "", lead, "", `[${c.zh ? "打开脚本 →" : "Open the script →"}](${link})`].join("\n").trim();

  let sent = 0;
  for (const id of targets) {
    const dm = await dmChannelWith(c.viewer, id);
    if (!dm) continue;
    await postMessage(c.viewer, dm.channel.id, body, { share: { kind: "script", projectId: c.project.id, scriptId, ask, versionNo } });
    sent += 1;
  }
  const names = targets.map((id) => { const u = byId.get(id)!; return (c.zh && u.nameLocal) || u.name; }).join("、");
  await postMessage(
    c.viewer,
    c.project.channelId,
    ask === "review" ? (c.zh ? `把脚本${versionNo ? `第 ${versionNo} 版` : ""}发给 ${names} 审阅。` : `Sent the script to ${names} for review.`) : c.zh ? `把脚本分享给了 ${names}。` : `Shared the script with ${names}.`,
    { flow: true },
  ).catch(() => null);
  await audit(c.viewer, "script.share", { objectType: "script", objectId: scriptId, module: "script", meta: { ask, to: targets, versionNo } });
  refresh(c.project.id);
  return { ok: true as const, sent, versionNo };
}

async function tell(c: Ctx, userId: string, body: string) {
  if (userId === c.viewer.id) return;
  const dm = await dmChannelWith(c.viewer, userId).catch(() => null);
  if (dm) await postMessage(c.viewer, dm.channel.id, body, { share: { kind: "script", projectId: c.project.id } }).catch(() => null);
}

/** 批准: approve and lock the version asked about (a requested reviewer, or an owner/admin). */
export async function approveDocAction(projectId: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId) return { error: "Not allowed" };
  const admin = c.viewer.role === "owner" || c.viewer.role === "admin";
  let req = await openRequestFor(c.viewer, scriptId);
  if (!req) {
    /* 我自己审阅通过: an owner or admin, or anybody who writes scripts,
       may approve without asking someone else (the owner, 29 Sep: "or do
       review yourself"). The record still names who approved it. */
    if (!admin && !c.viewer.modules.includes("script")) return { error: c.zh ? "没有请你审阅这份脚本" : "You were not asked to review this" };
    const r = await requestApproval(c.viewer, scriptId, c.viewer.id);
    if (!r) return { error: c.zh ? "脚本还是空的，或者已经批准了" : "Nothing to approve" };
    req = { id: r.approvalId, approverId: c.viewer.id, requestedBy: c.viewer.id };
  }
  const res = await decideApproval(c.viewer, req.id, "approved");
  if ("error" in res) return { error: res.error };
  await withdrawOthers(c.viewer, scriptId, req.id);
  const [row] = await db.select({ source: workProjects.source }).from(workProjects).where(eq(workProjects.id, c.project.id)).limit(1);
  if (readSentBack(row?.source).script && readSentBack(row?.source).script!.state !== "done") await settleSendBack(c.project.id, "script", "done");
  await audit(c.viewer, "script.approval.approved", { objectType: "approval", objectId: req.id, module: "script", meta: { versionNo: res.versionNo, from: "doc" } });
  const me = (c.zh && c.viewer.nameLocal) || c.viewer.name;
  await tell(c, req.requestedBy, c.zh ? `${me} 批准了脚本《${c.project.title}》第 ${res.versionNo} 版，可以开拍、剪辑了。\n\n[打开项目 →](/projects/${c.project.id}/edit)` : `${me} approved the script “${c.project.title}” (v${res.versionNo}).\n\n[Open the project →](/projects/${c.project.id}/edit)`);
  refresh(c.project.id);
  return { ok: true as const, versionNo: res.versionNo };
}

/** 提修改意见: send it back with a note — kept on the project (with 编剧's concrete edits), said in its chat, and as a comment. */
export async function requestChangesAction(projectId: unknown, note: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId) return { error: "Not allowed" };
  const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  if (!text) return { error: c.zh ? "写下要改什么" : "Say what to change" };
  const req = await openRequestFor(c.viewer, scriptId);
  if (req) {
    await decideApproval(c.viewer, req.id, "rejected", text).catch(() => null);
    await withdrawOthers(c.viewer, scriptId, req.id);
  }
  await addDocComment(c.viewer, scriptId, { beatOrd: null, quote: null, body: c.zh ? `修改意见：${text}` : `Changes requested: ${text}` });
  const kept = await recordSendBack(c.viewer, c.project, "script", text);
  await postMessage(c.viewer, c.project.channelId, c.zh ? `脚本退回修改：${text}` : `Script sent back: ${text}`, { flow: true, sentBack: "script" }).catch(() => null);
  const me = (c.zh && c.viewer.nameLocal) || c.viewer.name;
  if (req) await tell(c, req.requestedBy, c.zh ? `${me} 对脚本《${c.project.title}》提了修改意见：${text}\n\n[打开脚本 →](${scriptUrl(c.project.id)})` : `${me} requested changes to “${c.project.title}”: ${text}\n\n[Open the script →](${scriptUrl(c.project.id)})`);
  refresh(c.project.id);
  return { ok: true as const, suggestions: kept.suggestions?.length ?? 0 };
}

/** The sent-back note's edits were taken (accepted into the document): off the open list. */
export async function settleDocSendBackAction(projectId: unknown, state: unknown) {
  const c = await ctx(projectId);
  if ("error" in c) return c;
  await settleSendBack(c.project.id, "script", state === "applied" ? "applied" : "done");
  refresh(c.project.id);
  return { ok: true as const };
}

/** Withdraw the open review requests (取消审阅). */
export async function withdrawReviewAction(projectId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId) return { error: "Not allowed" };
  await db
    .update(approvals)
    .set({ state: "withdrawn", decidedAt: new Date(), decidedBy: c.viewer.id })
    .where(and(eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId), eq(approvals.state, "requested")));
  await db.update(scripts).set({ status: "drafting", updatedAt: new Date() }).where(and(eq(scripts.id, scriptId), eq(scripts.status, "awaiting_approval")));
  refresh(c.project.id);
  return { ok: true as const };
}

/**
 * 导入: a document someone uploads becomes the script's page, replacing what is
 * there or added after it. A Word file keeps its headings, bold, italic,
 * links and lists (QA, 2 Oct: it came in as plain lines); anything else the
 * reader understands (`lib/files/extract.ts`) comes in as its lines. Allowed
 * any time: an approved script is reopened as a new version first. The file
 * goes into the project's files (其他), and into 参考资料 only when the person
 * ticked that (QA, 2 Oct: it appeared there unasked).
 */
export async function importDocAction(projectId: unknown, fileId: unknown, mode: unknown, asReference?: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId || typeof fileId !== "string") return { error: "Not allowed" };
  const keep = asReference === true;
  if (!(await tagProjectFile(c.viewer, c.project.id, fileId, keep ? "reference" : "other"))) return { error: c.zh ? "打不开这个文件" : "That file cannot be opened" };
  const html = await importableHtml(c.viewer, fileId).catch(() => null);
  let incoming: RichNode[] = html ? (htmlToRichDoc(html).content ?? []).filter((n) => lineCount(n) > 0) : [];
  if (!incoming.length) {
    const text = await ensureFileText(fileId, { ledger: { viewer: c.viewer, module: "script" } });
    incoming = (text ?? "")
      .split(/\n/)
      .map((l) => l.replace(/\s+$/g, "").trim())
      .filter((l) => l && !/^【第 \d+ 页】$/.test(l))
      .slice(0, 400)
      .map((l) => ({ type: "paragraph", content: [{ type: "text", text: toSimplified(l) }] }));
  }
  if (!incoming.length) return { error: c.zh ? "这个文件里读不出文字" : "No text could be read from that file" };
  const scriptId = c.project.scriptId;
  const [s] = await db.select({ status: scripts.status, doc: scripts.doc }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  if (s?.status === "locked") await unlock(c.viewer, scriptId);
  let next: RichDoc;
  if (mode === "append") {
    /* Added to the rich document as it is, so the headings and bold already
       there stay (QA, 2 Oct: append rebuilt the page from plain beats). */
    const beatsNow = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
    const base = docForBeats((s?.doc ?? null) as RichNode | null, beatsNow);
    const kept = (base.content ?? []).filter((n, i, all) => !(all.length === 1 && n.type === "paragraph" && !n.content?.length && !n.attrs?.shot));
    next = { type: "doc", content: [...kept, ...incoming] };
  } else {
    /* The confirm promises the old text is in 版本记录: keep it there first (QA, 2 Oct). */
    await keepDraft(c, scriptId, c.zh ? "用文件替换前的稿子" : "Before replacing it with a file");
    next = { type: "doc", content: incoming };
  }
  const saved = await saveRichAction(c.project.id, next, null);
  if ("error" in saved) return { error: saved.error ?? (c.zh ? "没能写进稿子" : "Could not write it into the script") };
  if (keep) await setReferences(c.viewer, scriptId, { add: fileId }).catch(() => null);
  const paragraphs = incoming.reduce((n, x) => n + lineCount(x), 0);
  await audit(c.viewer, "script.import", { objectType: "script", objectId: scriptId, module: "script", meta: { fileId, mode, paragraphs, rich: Boolean(html), reference: keep } });
  refresh(c.project.id);
  return { ok: true as const, paragraphs, reference: keep, doc: next };
}

/**
 * The rich document saved (the Google-Docs-style page): its JSON and HTML on
 * the script, and the beats it stands for (`lib/script/rich.ts`) written in
 * the same breath, so the video, the 剪辑 page, versions and approvals keep
 * reading `script_beats`. A subtitle typed separately for an unchanged line
 * is kept.
 */
export async function saveRichAction(projectId: unknown, doc: unknown, html: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId || !isRichDoc(doc)) return { error: "Not allowed" };
  /* Simplified whatever the browser did to it (Chrome translating into Traditional). */
  const clean = JSON.parse(toSimplified(JSON.stringify(doc))) as RichDoc;
  if (typeof html === "string") html = toSimplified(html);
  const json = JSON.stringify(clean);
  if (json.length > 3_000_000) return { error: c.zh ? "文档太大了" : "The document is too large" };
  const before = await db.select({ voiceover: scriptBeats.voiceover, subtitle: scriptBeats.subtitle }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  const subtitleOf = new Map(before.filter((b) => b.subtitle && b.subtitle !== b.voiceover).map((b) => [b.voiceover, b.subtitle]));
  const beats = beatsFromDoc(clean)
    .slice(0, 400)
    .map((b) => ({ ...b, subtitle: subtitleOf.get(b.voiceover) ?? b.subtitle }));
  const res = await saveBeats(c.viewer, scriptId, beats.length ? beats : [{ visual: "", voiceover: "", subtitle: "", naturalSound: false }]);
  if (!res) return { error: c.zh ? "脚本已批准锁定，先点「继续编辑」" : "The script is locked" };
  const cleanHtml = typeof html === "string" ? html.slice(0, 3_000_000).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "") : null;
  await db.update(scripts).set({ doc: clean as unknown as Record<string, unknown>, docHtml: cleanHtml }).where(eq(scripts.id, scriptId));
  return { ok: true as const, at: new Date().toISOString() };
}

/** The chat's 直接编辑: new words for the script's spoken lines, saved into the document. */
export async function saveLinesAction(projectId: unknown, texts: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  const scriptId = c.project.scriptId;
  if (!scriptId || !Array.isArray(texts) || texts.length > 400) return { error: "Not allowed" };
  const lines = texts.map((x) => (typeof x === "string" ? x.slice(0, 4000) : ""));
  const [row] = await db.select({ doc: scripts.doc }).from(scripts).where(eq(scripts.id, scriptId)).limit(1);
  const beats = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  const base = docForBeats((row?.doc ?? null) as RichNode | null, beats);
  const res = await saveRichAction(projectId, withUnitTexts(base, lines), null);
  if ("ok" in res) refresh(c.project.id);
  return res;
}

/** 重命名: the document's title is the script's (and the project's) name. */
export async function renameScriptAction(projectId: unknown, title: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  const name = typeof title === "string" ? toSimplified(title.trim()).slice(0, 200) : "";
  if (!name) return { error: c.zh ? "标题不能是空的" : "The title cannot be empty" };
  if (c.project.scriptId) await db.update(scripts).set({ title: name, updatedAt: new Date() }).where(eq(scripts.id, c.project.scriptId));
  refresh(c.project.id);
  return { ok: true as const };
}

/** A picture put into the document: kept in the project's files (其他). */
export async function docImageAction(projectId: unknown, fileId: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (typeof fileId !== "string") return { error: "Not allowed" };
  const ok = await tagProjectFile(c.viewer, c.project.id, fileId, "other");
  return ok ? { ok: true as const, src: `/api/files/${fileId}/download` } : { error: c.zh ? "这张图打不开" : "That picture cannot be opened" };
}

/** 保存为新版本: the draft as it is now, kept as a numbered version (with an optional note). */
export async function saveVersionAction(projectId: unknown, note?: unknown) {
  const c = await ctx(projectId, true);
  if ("error" in c) return c;
  if (!c.project.scriptId) return { error: "Not allowed" };
  const res = await cutVersion(c.viewer, c.project.scriptId, { note: typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null });
  if (!res) return { error: c.zh ? "稿子是空的，或者已经批准锁定了" : "Nothing to save, or the script is locked" };
  await audit(c.viewer, "script.version.saved", { objectType: "script", objectId: c.project.scriptId, module: "script", meta: { versionNo: res.versionNo } });
  refresh(c.project.id);
  return { ok: true as const, versionNo: res.versionNo };
}
