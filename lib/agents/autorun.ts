import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMessages, publishPosts, scriptBeats, scripts, videoClips, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { grantOwner } from "@/lib/authz/rebac";
import { agentViewer, postAsAgent, tag } from "@/lib/agents";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { dispatchAgentMentions } from "@/lib/agents/mentions";
import { markCardDone, postMessage } from "@/lib/chat/service";
import { createScript } from "@/lib/script/service";
import { draftFromBrief } from "@/lib/script/ai";
import { formatHints } from "@/lib/projects/topic";
import { requestDirector } from "@/lib/video/service";
import { createPost, listChannels } from "@/lib/publish/service";
import { coversFor } from "@/lib/video/cover";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, recordUsage } from "@/lib/ai/ledger";
import { humanize } from "@/lib/text/human";
import { toSimplified } from "@/lib/text/simplified";

/**
 * The studio running itself (owner, 2 Oct: "except for the editor, since it
 * needs a clip from the creator, it all should run itself once one thing is
 * done"). Each step starts the next without anybody pressing a button:
 *
 *   策划's plan posted  → 文案 writes the proposed topic's first draft ahead
 *                          of time, and every other to-do goes to its owner;
 *   clips in + script approved → 剪辑师 cuts, designs and renders;
 *   render done          → 撰稿人 writes the post and puts it in 发布.
 *
 * Two gates stay with people, on purpose: approving the script, and pressing
 * 发布. Nothing here approves or publishes anything.
 */

const PLAN_TOPIC = /《([^》]{4,80})》/;

type PlanItem = { text: string; owner: string; why?: string };

function planOf(meta: unknown): { date: string; list: PlanItem[]; prepared?: { scriptId?: string } } | null {
  const plan = (meta as { plan?: { date?: unknown; list?: unknown; prepared?: unknown } } | null)?.plan;
  if (!plan || !Array.isArray(plan.list)) return null;
  const list = (plan.list as PlanItem[]).filter((x) => x && typeof x.text === "string" && x.text.trim());
  return { date: typeof plan.date === "string" ? plan.date : "", list, prepared: (plan.prepared as { scriptId?: string } | undefined) ?? undefined };
}

/* ------------------------------------------------------- after the plan */

export async function afterPlan(tenantId: string, messageId: string): Promise<{ prepared: string | null; handed: string[]; why?: string }> {
  const [msg] = await db
    .select({ id: chatMessages.id, channelId: chatMessages.channelId, meta: chatMessages.meta })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))
    .limit(1);
  const plan = msg ? planOf(msg.meta) : null;
  if (!msg || !plan) return { prepared: null, handed: [], why: "no plan on that message" };
  const topic = plan.list.map((x) => PLAN_TOPIC.exec(x.text)?.[1]).find(Boolean) ?? null;

  const [prepared, handed] = await Promise.all([
    topic && !plan.prepared?.scriptId ? prewrite(tenantId, msg.id, msg.channelId, topic, plan.list).catch((err) => {
      console.error("[autorun] the draft ahead of time failed", err);
      return null;
    }) : Promise.resolve(null),
    handOnTodos(tenantId, msg.id, msg.channelId, plan.list).catch((err) => {
      console.error("[autorun] handing the to-dos on failed", err);
      return [] as string[];
    }),
  ]);
  return { prepared, handed };
}

/**
 * Each AI colleague gets its part of today's plan, as if somebody had pressed
 * 交给… on the card: 策划 tags them in #研究日报 and they answer there. 文案's
 * part is the draft below; 剪辑师 waits for the clips, so neither is sent.
 */
async function handOnTodos(tenantId: string, messageId: string, channelId: string, list: PlanItem[]): Promise<string[]> {
  const byOwner = new Map<AgentKey, string[]>();
  for (const t of list) {
    if (!(AGENT_KEYS as readonly string[]).includes(t.owner)) continue;
    const key = t.owner as AgentKey;
    if (key === "planning" || key === "script" || key === "video") continue;
    byOwner.set(key, [...(byOwner.get(key) ?? []), t.text.trim()]);
  }
  /* The card is answered by 策划 itself, so it stops waiting on a person. */
  await markCardDone(channelId, messageId, { actionId: "auto", by: "策划", at: new Date().toISOString() }).catch(() => false);
  if (!byOwner.size) return [];
  const planner = await agentViewer(tenantId, "planning");
  const handed: string[] = [];
  for (const [key, items] of byOwner) {
    const body =
      items.length === 1 ? `${tag(key)} ${items[0]}` : [`${tag(key)} 今天这几件，麻烦你：`, ...items.map((t, n) => `${n + 1}. ${t}`)].join("\n");
    try {
      await postMessage(planner, channelId, body, { agent: "planning", mentions: [key] });
      await dispatchAgentMentions({ viewer: planner, channelId, body });
      handed.push(key);
    } catch (err) {
      console.error(`[autorun] could not hand the plan to ${key}`, err);
    }
  }
  return handed;
}

/**
 * 文案 writes the proposed topic's first draft as soon as the plan is out
 * (owner, 2 Oct: "once the idea of the day is confirmed its script should
 * already be ready"). The draft waits, out of every list, until somebody
 * presses 用这个做一条视频; that project then opens on it (`takePreparedDraft`).
 */
async function prewrite(tenantId: string, messageId: string, channelId: string, topic: string, list: PlanItem[]): Promise<string | null> {
  /* Already a project about it: nothing to write ahead. */
  const [made] = await db
    .select({ id: workProjects.id })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.title, toSimplified(topic).slice(0, 80)), isNull(workProjects.deletedAt)))
    .limit(1);
  if (made) return null;

  const writer = await agentViewer(tenantId, "script");
  await assertBudget(writer);
  const hints = formatHints(null);
  const id = await createScript(writer, { title: toSimplified(topic), aspect: hints.aspect, targetSeconds: hints.seconds });
  const digest = await digestOf(channelId);
  const sources = [
    `选题：《${topic}》`,
    ...list.filter((x) => x.text.includes(topic) || x.owner === "script").map((x) => `策划的说明：${x.text}${x.why ? `（${x.why}）` : ""}`),
    digest ? `今天早上研究员的晨报（只用和这个选题直接相关的事实）：\n${digest.slice(0, 3500)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let beats = 0;
  for (const wait of [0, 10_000, 45_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await draftFromBrief(writer, id, { sources }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
    if (!("error" in res) && res.beats > 0) {
      beats = res.beats;
      break;
    }
  }
  /* Out of the lists until it is taken; a draft that did not land is just gone. */
  await db.update(scripts).set({ deletedAt: new Date() }).where(eq(scripts.id, id));
  if (!beats) return null;

  await db.execute(sql`
    update ${chatMessages}
       set meta = jsonb_set(meta, '{plan,prepared}', ${JSON.stringify({ topic, scriptId: id, beats, at: new Date().toISOString() })}::jsonb)
     where id = ${messageId}
  `);
  await postAsAgent(tenantId, "script", "digest", `《${topic}》的初稿我已经提前写好了，${beats} 个分镜。点「用这个做一条视频」，打开就是写好的稿子，直接看、直接改。`).catch(() => null);
  return id;
}

async function digestOf(channelId: string): Promise<string | null> {
  const { rows } = await db.execute<{ body: string }>(sql`
    select body from ${chatMessages}
     where channel_id = ${channelId} and deleted_at is null and (meta -> 'digest') is not null
     order by created_at desc limit 1
  `);
  return rows[0]?.body ?? null;
}

const norm = (s: string) => toSimplified(s).replace(/[\s《》「」『』"“”'‘’,，。.!！?？:：、（）()·\-—]/g, "").toLowerCase();

/**
 * The draft 文案 wrote ahead for this topic, handed to the person starting
 * the project: it becomes theirs and the project's script. Taken once.
 */
export async function takePreparedDraft(viewer: Viewer, title: string): Promise<string | null> {
  const want = norm(title);
  if (!want) return null;
  const { rows } = await db.execute<{ id: string; p: { topic?: string; scriptId?: string } }>(sql`
    select m.id, m.meta -> 'plan' -> 'prepared' as p
      from ${chatMessages} m
      join chat_channels c on c.id = m.channel_id
     where c.tenant_id = ${viewer.tenantId}
       and m.deleted_at is null
       and m.created_at > now() - interval '3 days'
       and (m.meta -> 'plan' -> 'prepared' ->> 'scriptId') is not null
       and (m.meta -> 'plan' -> 'prepared' ->> 'takenBy') is null
     order by m.created_at desc
     limit 5
  `);
  for (const r of rows) {
    const topic = norm(r.p?.topic ?? "");
    if (!topic || !r.p?.scriptId || !(topic === want || want.includes(topic) || topic.includes(want))) continue;
    const claimed = await db.execute<{ id: string }>(sql`
      update ${chatMessages}
         set meta = jsonb_set(meta, '{plan,prepared,takenBy}', to_jsonb(${viewer.id}::text))
       where id = ${r.id} and (meta -> 'plan' -> 'prepared' ->> 'takenBy') is null
      returning id
    `);
    if (!claimed.rows.length) continue;
    const [s] = await db
      .select({ id: scripts.id, locked: scripts.lockedVersion })
      .from(scripts)
      .where(and(eq(scripts.id, r.p.scriptId), eq(scripts.tenantId, viewer.tenantId)))
      .limit(1);
    if (!s || s.locked !== null) continue;
    await db.update(scripts).set({ deletedAt: null, ownerId: viewer.id, title: toSimplified(title).slice(0, 300), updatedAt: new Date() }).where(eq(scripts.id, s.id));
    await grantOwner(viewer.id, { type: "script", id: s.id });
    return s.id;
  }
  return null;
}

/* ----------------------------------------------------- clips → the cut */

/**
 * 剪辑师 starts on its own once both halves are there: an approved script
 * and footage in the bin. Called when footage has been read and when a
 * script is approved, so either order starts it, and only ever once.
 */
export async function autoCut(videoProjectId: string): Promise<{ started: boolean; why?: string }> {
  const [vp] = await db
    .select({ id: videoProjects.id, tenantId: videoProjects.tenantId, scriptId: videoProjects.scriptId, director: videoProjects.director })
    .from(videoProjects)
    .where(and(eq(videoProjects.id, videoProjectId), isNull(videoProjects.deletedAt)))
    .limit(1);
  if (!vp?.scriptId) return { started: false, why: "no script" };
  const state = (vp.director as { state?: string } | null)?.state;
  if (state) return { started: false, why: `the cut has already been asked for (${state})` };
  const [s] = await db.select({ title: scripts.title, locked: scripts.lockedVersion, aspect: scripts.aspect }).from(scripts).where(eq(scripts.id, vp.scriptId)).limit(1);
  if (!s || s.locked === null) return { started: false, why: "script not approved yet" };
  const [clip] = await db.select({ id: videoClips.id }).from(videoClips).where(eq(videoClips.projectId, vp.id)).limit(1);
  if (!clip) return { started: false, why: "no footage yet" };
  const [wp] = await db
    .select({ createdBy: workProjects.createdBy })
    .from(workProjects)
    .where(and(eq(workProjects.videoProjectId, vp.id), isNull(workProjects.deletedAt)))
    .limit(1);
  const owner = wp?.createdBy ? await viewerById(wp.createdBy) : null;
  if (!owner) return { started: false, why: "nobody to cut it for" };
  await requestDirector(owner, vp.id, {
    brief: `按锁定的第 ${s.locked} 版脚本《${s.title}》出成片：转写素材、粗剪、配字幕和图形、渲染。`,
    aspect: s.aspect ?? "9:16",
    render: true,
  });
  return { started: true };
}

/* -------------------------------------------------- render → the post */

const POST_PROMPT = `你是工作室的撰稿人，给一条刚剪好的短视频写发布文案。像真人运营写的，不像 AI。

要求：
- 标题：20 字以内，具体、有钩子，不标题党，不用感叹号堆砌。
- 正文：80 到 150 字，口语，讲清这条视频看点，结尾一个让人想评论的问题。
- 标签：3 到 6 个，和内容直接相关，不带 # 号。
- 不要破折号（——、—），不要“首先、总之、赋能、重磅、颠覆、让我们”。
- 只用口播稿里有的事实，不编数字、人名和日期。
- 一律简体中文。

只输出 JSON：{"title":"...","body":"...","tags":["..."]}`;

/** 撰稿人 writes the post for a finished render and puts it in 发布, ready to send. Once per project. */
export async function autoPublishCopy(exportId: string): Promise<{ postId: string | null; why?: string }> {
  const [ex] = await db
    .select({ projectId: videoExports.projectId, fileId: videoExports.fileId, state: videoExports.state })
    .from(videoExports)
    .where(eq(videoExports.id, exportId))
    .limit(1);
  if (!ex || ex.state !== "done" || !ex.fileId) return { postId: null, why: "no finished render" };
  const [vp] = await db.select({ tenantId: videoProjects.tenantId, scriptId: videoProjects.scriptId }).from(videoProjects).where(eq(videoProjects.id, ex.projectId)).limit(1);
  const [wp] = await db
    .select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, createdBy: workProjects.createdBy })
    .from(workProjects)
    .where(and(eq(workProjects.videoProjectId, ex.projectId), isNull(workProjects.deletedAt)))
    .limit(1);
  if (!vp || !wp) return { postId: null, why: "not in a project" };
  const [already] = await db
    .select({ id: publishPosts.id })
    .from(publishPosts)
    .where(and(eq(publishPosts.tenantId, vp.tenantId), isNull(publishPosts.deletedAt), vp.scriptId ? or(eq(publishPosts.fileId, ex.fileId), eq(publishPosts.scriptId, vp.scriptId)) : eq(publishPosts.fileId, ex.fileId)))
    .limit(1);
  if (already) return { postId: null, why: "the project already has a post" };
  const owner = wp.createdBy ? await viewerById(wp.createdBy) : null;
  if (!owner) return { postId: null, why: "nobody to post for" };

  const writer = await agentViewer(vp.tenantId, "article", owner.id);
  await assertBudget(writer);
  const lines = vp.scriptId
    ? await db.select({ v: scriptBeats.voiceover }).from(scriptBeats).where(eq(scriptBeats.scriptId, vp.scriptId)).orderBy(asc(scriptBeats.ord))
    : [];
  const spoken = lines.map((l) => l.v.trim()).filter(Boolean).join("\n").slice(0, 4000);
  const out = await complete({
    model: modelFor.agent("article") ?? modelFor.assistant(),
    temperature: 0.6,
    maxTokens: 1500,
    user: writer.id,
    messages: [
      { role: "system", content: POST_PROMPT },
      { role: "user", content: `视频：《${wp.title}》\n口播稿：\n${spoken || "（没有口播稿，只按标题写，不要编事实）"}` },
    ],
  });
  await recordUsage({ viewer: writer, module: "publish", model: out.model, provider: out.provider ?? "openrouter", promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId }).catch(() => {});
  const json = /\{[\s\S]*\}/.exec(out.text.replace(/<think>[\s\S]*?<\/think>/g, ""))?.[0];
  let copy: { title?: unknown; body?: unknown; tags?: unknown } = {};
  try {
    copy = json ? JSON.parse(json) : {};
  } catch {
    copy = {};
  }
  const title = humanize(toSimplified(typeof copy.title === "string" && copy.title.trim() ? copy.title.trim() : wp.title)).slice(0, 100);
  const body = humanize(toSimplified(typeof copy.body === "string" ? copy.body.trim() : ""));
  const tags = (Array.isArray(copy.tags) ? copy.tags : []).filter((t): t is string => typeof t === "string").map((t) => toSimplified(t.replace(/^#/, "").trim())).filter(Boolean).slice(0, 6);
  const channels = (await listChannels(owner).catch(() => [])).filter((c) => c.canPost && !c.needsReconnect).map((c) => c.id);
  const cover = (await coversFor(owner, wp.id).catch(() => []))[0] ?? null;
  const postId = await createPost(owner, { title, body, tags, fileId: ex.fileId, coverFileId: cover?.fileId ?? null, scriptId: vp.scriptId, channelIds: channels });

  const article = await agentViewer(vp.tenantId, "article", owner.id);
  await postMessage(
    article,
    wp.channelId,
    [`成片好了，发布文案我写好了，放在「发布」里：`, `标题：${title}`, body ? `正文：${body}` : "", tags.length ? `标签：${tags.join("、")}` : "", channels.length ? `会发到已连接的 ${channels.length} 个账号。看一眼，没问题就点发布。` : "还没有连接发布账号，先在「发布」里连上账号再发。", `/publish`]
      .filter(Boolean)
      .join("\n"),
    { agent: "article" },
  ).catch(() => {});
  return { postId };
}

/** The newest live work project for a video project (used by the worker's follow-ups). */
export async function exportOfJob(result: unknown, payload: unknown): Promise<string | null> {
  const r = (result ?? {}) as { exportId?: unknown };
  const p = (payload ?? {}) as { exportId?: unknown };
  const id = typeof r.exportId === "string" ? r.exportId : typeof p.exportId === "string" ? p.exportId : null;
  if (!id) return null;
  const [ex] = await db.select({ id: videoExports.id }).from(videoExports).where(eq(videoExports.id, id)).orderBy(desc(videoExports.id)).limit(1);
  return ex?.id ?? null;
}
