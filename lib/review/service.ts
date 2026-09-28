import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledge, knowledgeVersions, ownAccountSnapshots, projectPostMetrics, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { ulid } from "@/lib/ids";
import { OWN_ACCOUNTS, type OwnAccount } from "@/lib/social/own-accounts";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { readPublication, publishPlatformName } from "@/lib/projects/publication";
import { addOwnPick } from "@/lib/research/own-picks";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { ManualOnly, READABLE_POST_PLATFORMS, postIdOf, readAccount, readPost } from "@/lib/review/platforms";
import {
  ACCOUNT_OF_PLATFORM,
  EMPTY_STATS,
  STAT_KEYS,
  readReview,
  type AccountPost,
  type AccountStats,
  type AccountView,
  type PostView,
  type ProjectReview,
  type Stats,
} from "@/lib/review/types";

/**
 * 复盘: the numbers behind the studio's videos, and the researcher's read of them.
 *
 * Readings are cached in the database (`lib/db/schema/review.ts`) because
 * TikHub bills every call: an account is read at most every six hours and a
 * post every hour unless somebody presses 刷新. Pages only ever read the
 * tables; the refresh actions are the only way out to TikHub.
 */

export const ACCOUNT_TTL_MS = 6 * 3600_000;
export const POST_TTL_MS = 3600_000;

const idOf = (p: string) => `${p}_${ulid()}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ------------------------------------------------------------------ accounts

type SnapRow = typeof ownAccountSnapshots.$inferSelect;

export async function accountViews(tenantId: string): Promise<AccountView[]> {
  const rows = await db
    .select()
    .from(ownAccountSnapshots)
    .where(eq(ownAccountSnapshots.tenantId, tenantId))
    .orderBy(desc(ownAccountSnapshots.fetchedAt))
    .limit(400);
  return OWN_ACCOUNTS.map((a) => viewOf(a, rows.filter((r) => r.platform === a.platform && r.accountId === a.id)));
}

function viewOf(a: OwnAccount, rows: SnapRow[]): AccountView {
  const good = rows.filter((r) => !r.error);
  const latest = good[0] ?? null;
  const newest = rows[0] ?? null;
  const followers = (r: SnapRow) => (typeof r.stats.followers === "number" ? r.stats.followers : null);
  const prev = good.slice(1).find((r) => followers(r) !== null) ?? null;
  const series = good
    .filter((r) => followers(r) !== null)
    .slice(0, 30)
    .reverse()
    .map((r) => ({ at: r.fetchedAt.toISOString(), v: followers(r)! }));
  /* Posts from the newest reading that has any (a manual reading has none). */
  const withPosts = good.find((r) => Array.isArray(r.posts) && r.posts.length > 0);
  return {
    platform: a.platform,
    zh: a.zh,
    en: a.en,
    name: a.name,
    accountId: a.id,
    url: a.url,
    stats: latest ? (latest.stats as AccountStats) : null,
    source: latest ? (latest.source as "tikhub" | "manual") : null,
    at: latest ? latest.fetchedAt.toISOString() : null,
    prevFollowers: prev ? followers(prev) : null,
    followersSeries: series,
    posts: (withPosts?.posts ?? []) as AccountPost[],
    error: newest?.error && newest !== latest ? newest.error : null,
    errorAt: newest?.error && newest !== latest ? newest.fetchedAt.toISOString() : null,
    manualOnly: Boolean(newest?.error?.includes("手动")) || (latest?.source === "manual" && !good.some((r) => r.source === "tikhub")),
  };
}

/**
 * Read each account again if its newest attempt (good or failed) is older
 * than the limit, or all of them when `force`. One row per attempt.
 */
export async function refreshAccounts(viewer: Viewer, opts: { force?: boolean } = {}): Promise<{ read: number; failed: number }> {
  const recent = await db
    .select({ platform: ownAccountSnapshots.platform, at: sql<Date>`max(${ownAccountSnapshots.fetchedAt})` })
    .from(ownAccountSnapshots)
    .where(and(eq(ownAccountSnapshots.tenantId, viewer.tenantId), eq(ownAccountSnapshots.source, "tikhub")))
    .groupBy(ownAccountSnapshots.platform);
  const lastAt = new Map(recent.map((r) => [r.platform, new Date(r.at).getTime()]));
  let read = 0;
  let failed = 0;
  await Promise.all(
    OWN_ACCOUNTS.map(async (a) => {
      const last = lastAt.get(a.platform) ?? 0;
      if (!opts.force && Date.now() - last < ACCOUNT_TTL_MS) return;
      try {
        const r = await readAccount(a);
        await db.insert(ownAccountSnapshots).values({ id: idOf("oas"), tenantId: viewer.tenantId, platform: a.platform, accountId: a.id, source: "tikhub", stats: r.stats, posts: r.posts, fetchedBy: viewer.id });
        read += 1;
      } catch (e) {
        failed += 1;
        await db.insert(ownAccountSnapshots).values({ id: idOf("oas"), tenantId: viewer.tenantId, platform: a.platform, accountId: a.id, source: "tikhub", error: e instanceof ManualOnly ? e.message : `读取失败：${errText(e)}`, fetchedBy: viewer.id });
      }
    }),
  );
  return { read, failed };
}

/** Numbers typed in for an account (视频号, or any account TikHub got wrong). */
export async function saveManualAccount(viewer: Viewer, platform: string, stats: AccountStats): Promise<void> {
  const a = OWN_ACCOUNTS.find((x) => x.platform === platform);
  if (!a) throw new Error("没有这个账号");
  await db.insert(ownAccountSnapshots).values({ id: idOf("oas"), tenantId: viewer.tenantId, platform: a.platform, accountId: a.id, source: "manual", stats, fetchedBy: viewer.id });
}

/** The newest attempt of any account, for "更新于". */
export function newestAccountAt(views: AccountView[]): string | null {
  return views.map((v) => v.at).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
}

export function accountsStale(views: AccountView[]): boolean {
  return views.some((v) => !v.manualOnly && (!v.at || Date.now() - Date.parse(v.at) > ACCOUNT_TTL_MS) && !(v.errorAt && Date.now() - Date.parse(v.errorAt) < ACCOUNT_TTL_MS));
}

function median(list: number[]): number | null {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** The account's typical post (median of each number over its latest posts). */
export function typicalPost(posts: AccountPost[]): Stats | null {
  if (!posts.length) return null;
  const out: Stats = { ...EMPTY_STATS };
  for (const k of STAT_KEYS) out[k] = median(posts.map((p) => p.stats[k]).filter((v): v is number => typeof v === "number"));
  return out;
}

// ------------------------------------------------------------------ one project's posts

type Tracked = { platform: string; url: string | null };

async function projectRow(viewer: Viewer, projectId: string) {
  const [p] = await db
    .select({ id: workProjects.id, title: workProjects.title, brief: workProjects.brief, status: workProjects.status, source: workProjects.source, createdBy: workProjects.createdBy })
    .from(workProjects)
    .where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .limit(1);
  return p ?? null;
}

/** The posts this project is tracked on: its 已发布 links, and any added on the review page. */
async function trackedPosts(viewer: Viewer, projectId: string, source: unknown): Promise<Tracked[]> {
  const pub = readPublication(source);
  const out: Tracked[] = [];
  const seen = new Set<string>();
  const push = (t: Tracked) => {
    const k = `${t.platform}|${t.url ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const p of pub?.platforms ?? []) if (p.key !== "other" || p.url) push({ platform: p.key, url: p.url });
  const extra = await db
    .selectDistinct({ platform: projectPostMetrics.platform, url: projectPostMetrics.url })
    .from(projectPostMetrics)
    .where(and(eq(projectPostMetrics.projectId, projectId), eq(projectPostMetrics.tenantId, viewer.tenantId)));
  for (const e of extra) push({ platform: e.platform, url: e.url });
  /* A platform named without a link, once the same platform has a link, is the same post. */
  return out.filter((t) => t.url || !out.some((o) => o.platform === t.platform && o.url));
}

export async function projectPostViews(viewer: Viewer, projectId: string, source: unknown, accounts: AccountView[]): Promise<PostView[]> {
  const tracked = await trackedPosts(viewer, projectId, source);
  if (!tracked.length) return [];
  const rows = await db
    .select()
    .from(projectPostMetrics)
    .where(and(eq(projectPostMetrics.projectId, projectId), eq(projectPostMetrics.tenantId, viewer.tenantId)))
    .orderBy(desc(projectPostMetrics.fetchedAt))
    .limit(500);
  return tracked.map((t) => {
    const mine = rows.filter((r) => r.platform === t.platform && (r.url ?? null) === (t.url ?? null));
    const good = mine.filter((r) => !r.error && r.source !== "link");
    const latest = good[0] ?? null;
    const newest = mine[0] ?? null;
    const val = (r: (typeof mine)[number]) => {
      const s = r.stats as Stats;
      return typeof s.plays === "number" ? s.plays : typeof s.likes === "number" ? s.likes : null;
    };
    const acct = accounts.find((a) => a.platform === ACCOUNT_OF_PLATFORM[t.platform]);
    return {
      platform: t.platform,
      url: t.url,
      title: latest?.title ?? newest?.title ?? null,
      stats: latest ? (latest.stats as Stats) : null,
      source: latest?.source ?? null,
      at: latest?.fetchedAt.toISOString() ?? null,
      error: newest?.error && newest !== latest ? newest.error : null,
      series: good
        .filter((r) => val(r) !== null)
        .slice(0, 30)
        .reverse()
        .map((r) => ({ at: r.fetchedAt.toISOString(), v: val(r)! })),
      median: acct ? typicalPost(acct.posts) : null,
    };
  });
}

async function readOne(viewer: Viewer, projectId: string, t: Tracked, accounts: AccountView[]): Promise<void> {
  if (!t.url) return;
  const base = { id: idOf("ppm"), tenantId: viewer.tenantId, projectId, platform: t.platform, url: t.url, fetchedBy: viewer.id };
  /* Free first: the post may be one of the account's latest, already read. */
  const acct = accounts.find((a) => a.platform === ACCOUNT_OF_PLATFORM[t.platform]);
  const pid = acct ? await postIdOf(t.platform, t.url) : null;
  const hit = pid ? acct!.posts.find((p) => p.id === pid) : null;
  /* …unless the account's list is missing numbers the post itself has (B站's list gives plays, not likes). */
  const complete = hit && STAT_KEYS.filter((k) => k !== "plays").some((k) => typeof hit.stats[k] === "number") && (READABLE_POST_PLATFORMS.has(t.platform) ? typeof hit.stats.likes === "number" : true);
  if (hit && complete && acct?.at && Date.now() - Date.parse(acct.at) < POST_TTL_MS) {
    await db.insert(projectPostMetrics).values({ ...base, title: hit.title, source: "account", stats: hit.stats });
    return;
  }
  if (!READABLE_POST_PLATFORMS.has(t.platform)) return;
  try {
    const r = await readPost(t.platform, t.url);
    await db.insert(projectPostMetrics).values({ ...base, title: r.title, source: "tikhub", stats: r.stats });
  } catch (e) {
    await db.insert(projectPostMetrics).values({ ...base, source: "tikhub", error: e instanceof ManualOnly ? e.message : `读取失败：${errText(e)}` });
  }
}

/** Read this project's posts again (those older than an hour, or all when `force`). */
export async function refreshProjectPosts(viewer: Viewer, projectId: string, opts: { force?: boolean } = {}): Promise<{ error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  const accounts = await accountViews(viewer.tenantId);
  const tracked = await trackedPosts(viewer, projectId, p.source);
  const last = await db
    .select({ platform: projectPostMetrics.platform, url: projectPostMetrics.url, at: sql<Date>`max(${projectPostMetrics.fetchedAt})` })
    .from(projectPostMetrics)
    .where(and(eq(projectPostMetrics.projectId, projectId), inArray(projectPostMetrics.source, ["tikhub", "account"])))
    .groupBy(projectPostMetrics.platform, projectPostMetrics.url);
  const lastAt = new Map(last.map((r) => [`${r.platform}|${r.url ?? ""}`, new Date(r.at).getTime()]));
  await Promise.all(
    tracked
      .filter((t) => t.url && (opts.force || Date.now() - (lastAt.get(`${t.platform}|${t.url}`) ?? 0) > POST_TTL_MS))
      .map((t) => readOne(viewer, projectId, t, accounts)),
  );
  return {};
}

/** Track one more post of this project by its link, and read it once. */
export async function addPostLink(viewer: Viewer, projectId: string, url: string, platform: string): Promise<{ error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  await db.insert(projectPostMetrics).values({ id: idOf("ppm"), tenantId: viewer.tenantId, projectId, platform, url, source: "link", fetchedBy: viewer.id });
  const accounts = await accountViews(viewer.tenantId);
  await readOne(viewer, projectId, { platform, url }, accounts);
  return {};
}

/** Link one of the account's latest posts to this project (no TikHub call: the numbers are already read). */
export async function linkAccountPost(viewer: Viewer, projectId: string, platform: string, post: AccountPost): Promise<{ error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  await db.insert(projectPostMetrics).values({ id: idOf("ppm"), tenantId: viewer.tenantId, projectId, platform, url: post.url, title: post.title, source: "account", stats: post.stats, fetchedBy: viewer.id });
  return {};
}

export async function saveManualPost(viewer: Viewer, projectId: string, platform: string, url: string | null, stats: Stats): Promise<{ error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  await db.insert(projectPostMetrics).values({ id: idOf("ppm"), tenantId: viewer.tenantId, projectId, platform, url, source: "manual", stats, fetchedBy: viewer.id });
  return {};
}

/** Stop tracking a post added on this page (its readings go; a 已发布 link stays on the project). */
export async function removePost(viewer: Viewer, projectId: string, platform: string, url: string | null): Promise<void> {
  const p = await projectRow(viewer, projectId);
  if (!p) return;
  await db
    .delete(projectPostMetrics)
    .where(and(eq(projectPostMetrics.projectId, projectId), eq(projectPostMetrics.tenantId, viewer.tenantId), eq(projectPostMetrics.platform, platform), url ? eq(projectPostMetrics.url, url) : isNull(projectPostMetrics.url)));
}

// ------------------------------------------------------------------ the researcher's review

const REVIEW_PROMPT = `你是短视频工作室的研究员，负责发布后的复盘。根据下面这条视频在各平台的数据、账号近期作品的中位数，写一份简短、具体的复盘。
只回答 JSON：{"verdict":"一两句话：这条表现如何，和账号平时比高还是低（引用具体数字）","good":["做得好的，最多3条"],"improve":["可以改进的，最多3条，要可执行"],"ideas":[{"title":"下一条选题的标题，20字以内","why":"为什么值得做，一句话"}]}
- ideas 正好 3 个，要贴近这个账号的定位（从作品标题判断），不要空泛。
- 没有数据的平台不要编数字；数据很少时直说"数据还少"。
- 不要 markdown，只要 JSON。`;

function statLine(s: Stats | null): string {
  if (!s) return "无数据";
  const parts = STAT_KEYS.map((k) => (typeof s[k] === "number" ? `${k}=${s[k]}` : null)).filter(Boolean);
  return parts.length ? parts.join(", ") : "无数据";
}

export async function writeReview(viewer: Viewer, projectId: string): Promise<{ review?: ProjectReview; error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  const accounts = await accountViews(viewer.tenantId);
  const posts = await projectPostViews(viewer, projectId, p.source, accounts);
  const acctLines = accounts
    .map((a) => {
      const med = typicalPost(a.posts);
      const titles = a.posts.slice(0, 5).map((x) => `《${x.title.slice(0, 30)}》${statLine(x.stats)}`).join("；");
      return `${a.zh}（${a.name}）：粉丝 ${a.stats?.followers ?? "?"}；近期作品中位数 ${statLine(med)}；最近作品：${titles || "无"}`;
    })
    .join("\n");
  const postLines = posts.length
    ? posts.map((x) => `${publishPlatformName(x.platform, true)}：${statLine(x.stats)}${x.at ? `（读取于 ${x.at.slice(0, 16)}）` : ""}${x.url ? ` ${x.url}` : ""}`).join("\n")
    : "还没有任何平台的数据";
  try {
    const out = await complete({
      model: modelFor.assistant(),
      temperature: 0.4,
      maxTokens: 1400,
      messages: [
        { role: "system", content: REVIEW_PROMPT },
        { role: "user", content: `视频：《${p.title}》\n简介：${(p.brief ?? "").slice(0, 300)}\n\n这条视频的数据：\n${postLines}\n\n账号概况：\n${acctLines}` },
      ],
    });
    await recordUsage({ viewer, module: "research", provider: out.provider ?? "openrouter", model: out.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, costMicros: out.costMicros, requestId: out.requestId });
    const text = out.text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Partial<ProjectReview>;
    const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, n) : []);
    const review: ProjectReview = {
      at: new Date().toISOString(),
      by: viewer.id,
      byName: viewer.nameLocal || viewer.name,
      verdict: String(parsed.verdict ?? "").trim().slice(0, 600) || "数据还少，暂时看不出结论。",
      good: strs(parsed.good, 3),
      improve: strs(parsed.improve, 3),
      ideas: (Array.isArray(parsed.ideas) ? parsed.ideas : [])
        .map((i) => ({ title: String((i as { title?: unknown })?.title ?? "").trim().slice(0, 60), why: String((i as { why?: unknown })?.why ?? "").trim().slice(0, 160) }))
        .filter((i) => i.title)
        .slice(0, 3),
      handedAt: null,
    };
    await saveReview(projectId, review);
    return { review };
  } catch (e) {
    return { error: `研究员没写出来：${errText(e)}` };
  }
}

async function saveReview(projectId: string, review: ProjectReview) {
  await db
    .update(workProjects)
    .set({
      source: sql`(case when jsonb_typeof(${workProjects.source}) = 'object' then ${workProjects.source} else '{}'::jsonb end) || jsonb_build_object('review', ${JSON.stringify(review)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(workProjects.id, projectId));
}

const LESSONS_TITLE = "作品复盘 · 选题参考（自动）";
const LESSONS_MAX = 4000;

/**
 * 把建议交给选题: the three topic ideas go into today's 选题 list (the
 * "picked for today" list the research page and the project's topic picker
 * both read, `lib/research/own-picks.ts`), and the lessons are kept in one
 * knowledge note scoped to the research module — which `assemblePrompt`
 * puts into the prompt of anyone working in research, the researcher
 * included — newest first, capped.
 */
export async function handReviewToResearch(viewer: Viewer, projectId: string): Promise<{ error?: string }> {
  const p = await projectRow(viewer, projectId);
  if (!p) return { error: "找不到这个项目" };
  const review = readReview(p.source);
  if (!review) return { error: "还没有复盘" };
  for (const i of review.ideas) await addOwnPick(viewer, i.title);

  const day = review.at.slice(0, 10);
  const entry = [`【${day}《${p.title}》】${review.verdict}`, review.good.length ? `做得好：${review.good.join("；")}` : "", review.improve.length ? `可改进：${review.improve.join("；")}` : "", review.ideas.length ? `建议选题：${review.ideas.map((i) => i.title).join("；")}` : ""]
    .filter(Boolean)
    .join("\n");
  const [current] = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.tenantId, viewer.tenantId), eq(knowledge.scope, "module"), eq(knowledge.scopeValue, "research"), eq(knowledge.title, LESSONS_TITLE)))
    .limit(1);
  const head = "以下是已发布作品的复盘心得，提选题时参考：什么题材、开头、形式在这个账号上表现好或差。";
  if (current) {
    const rest = current.body.replace(head, "").trim();
    const body = `${head}\n\n${entry}\n\n${rest}`.slice(0, LESSONS_MAX);
    await db.insert(knowledgeVersions).values({ id: `kn_${ulid()}`, knowledgeId: current.id, version: current.version, body: current.body, note: "复盘交给选题", authorId: viewer.id }).onConflictDoNothing();
    await db.update(knowledge).set({ body, version: current.version + 1, active: true, updatedBy: viewer.id, updatedAt: new Date() }).where(eq(knowledge.id, current.id));
  } else {
    await db.insert(knowledge).values({ id: `kn_${ulid()}`, tenantId: viewer.tenantId, kind: "instructions", scope: "module", scopeValue: "research", title: LESSONS_TITLE, body: `${head}\n\n${entry}`, updatedBy: viewer.id });
  }
  await saveReview(projectId, { ...review, handedAt: new Date().toISOString(), handedBy: viewer.nameLocal || viewer.name });
  return {};
}

// ------------------------------------------------------------------ studio-wide

export type PublishedRow = { id: string; title: string; publishedAt: string | null; platforms: string[]; totals: Stats; reviewed: boolean; lastReadAt: string | null };

/** Every published project this person may see, newest first, with its latest numbers added up. */
export async function publishedProjects(viewer: Viewer, limit = 60): Promise<PublishedRow[]> {
  const projects = await db
    .select({ id: workProjects.id, title: workProjects.title, source: workProjects.source })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), eq(workProjects.status, "done"), projectsVisibleTo(viewer)))
    .orderBy(desc(sql`coalesce(${workProjects.source} -> 'published' ->> 'at', ${workProjects.updatedAt}::text)`))
    .limit(limit);
  if (!projects.length) return [];
  const metrics = await db
    .select()
    .from(projectPostMetrics)
    .where(and(eq(projectPostMetrics.tenantId, viewer.tenantId), inArray(projectPostMetrics.projectId, projects.map((p) => p.id))))
    .orderBy(desc(projectPostMetrics.fetchedAt));
  return projects.map((p) => {
    const pub = readPublication(p.source);
    const latestBy = new Map<string, (typeof metrics)[number]>();
    for (const m of metrics) if (m.projectId === p.id && !m.error && m.source !== "link" && !latestBy.has(`${m.platform}|${m.url ?? ""}`)) latestBy.set(`${m.platform}|${m.url ?? ""}`, m);
    const totals: Stats = { ...EMPTY_STATS };
    for (const m of latestBy.values()) for (const k of STAT_KEYS) {
      const v = (m.stats as Stats)[k];
      if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
    }
    const at = [...latestBy.values()].map((m) => m.fetchedAt.toISOString()).sort().pop() ?? null;
    return {
      id: p.id,
      title: p.title,
      publishedAt: pub?.at ?? null,
      platforms: [...new Set([...(pub?.platforms ?? []).map((x) => x.key), ...[...latestBy.values()].map((m) => m.platform)])].filter((k) => k !== "other"),
      totals,
      reviewed: Boolean(readReview(p.source)),
      lastReadAt: at,
    };
  });
}

/** Everything the project's 复盘 page draws, read from the tables (never TikHub). */
export async function projectReviewData(viewer: Viewer, projectId: string) {
  const p = await projectRow(viewer, projectId);
  if (!p) return null;
  const accounts = await accountViews(viewer.tenantId);
  const posts = await projectPostViews(viewer, projectId, p.source, accounts);
  return { accounts, posts, review: readReview(p.source), published: readPublication(p.source), status: p.status };
}
