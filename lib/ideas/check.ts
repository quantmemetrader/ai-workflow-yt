import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages, creatorVideos, ideas, topics } from "@/lib/db/schema";
import { ulid } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import type { Idea, IdeaEvidence } from "@/lib/ideas/types";
import type { CheckLevel, CheckPrevious, TitleCheck, TitleOption } from "@/lib/ideas/check-types";
import { AiError, complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, BudgetStop, recordUsage } from "@/lib/ai/ledger";
import { agentViewer } from "@/lib/agents";
import { AGENT_KEYS, agentAliases } from "@/lib/agents/catalog";
import { creatorVoiceText } from "@/lib/creator/service";
import { PLATFORMS, type HotRow, type HotStats } from "@/lib/research/platform-catalog";
import { toSimplified } from "@/lib/text/simplified";
import { cleanCodes, numbersOf } from "@/lib/projects/topic";
import { evidencePool, ideaById, withoutPoolIds } from "@/lib/ideas/service";

/**
 * 研究员 checks a topic somebody typed on Home, before anything is written.
 *
 * The client: "it is off that without research on the title it just goes
 * straight to script generation". The ideas panel covers the ideas 研究员
 * finds; this covers the ones people bring. Home's task box sends a typed
 * topic here instead of to 编剧, and the answer is a short verdict (hot,
 * warm, cold or crowded, with numbers), three titles, the angle, the opening
 * line, the rows it stands on, the videos on the same subject that did well
 * and a risk, if any.
 *
 * Everything is read from what the studio has already stored; nothing here
 * makes a live (billed) platform read:
 *
 *   — every stored list of the last two weeks (`hot_snapshots`: the platform
 *     lists and the beat feeds), searched for the topic's words, with the
 *     classifier's business / tech mark where the list has one. Not the
 *     "search:" rows: those are the phrases somebody typed into Search &
 *     compare, cached for every studio with no owner on them, so quoting
 *     one ("抖音搜索「…」") would tell this studio what another searched
 *     for. `evidencePool` leaves them out for the same reason;
 *   — the channel's own uploads (`creator_videos`) and how the ones on this
 *     subject did against the channel's median;
 *   — the last week of morning briefs, and the backlog topics;
 *   — the Creator voice note's subjects;
 *   — and, for what is hot right now, the same pool the ideas panel is built
 *     from (`evidencePool` in lib/ideas/service.ts).
 *
 * Two model calls, both 研究员's and both in the ledger against 研究员's own
 * user row: a short one that turns the topic into search words (so "AI 会不会
 * 让普通人失业" also finds 裁员, 岗位 and 失業), and the check itself on the
 * assistant model, falling back to the utility model like the ideas service.
 * Numbers can only come from the rows: the prompt carries each row's own
 * figures and a few counts worked out here, and when the stored data barely
 * mentions the topic the answer says so rather than guessing.
 *
 * The answer is stored as an idea (seed = what was typed) in the studio's
 * latest ideas batch, so it can be started with `startFromTopicAction({ kind:
 * "idea", id })`, 编剧 then writing from its title, angle and evidence, and
 * it shows in the ideas panel beside the rest instead of replacing them. A
 * follow-up ("换个角度") rewrites the same row, unless it has been started.
 */

/* ------------------------------------------------------------ the topic */

/** How far back the stored lists are searched. */
const DAYS = 14;

/**
 * The topic as typed, without the employees' tags.
 *
 * "@研究员 AI 会不会…" and "@编剧帮我看看…" (a Chinese tag runs straight into
 * the words after it, `agentFromTag` reads it as a prefix) both leave only
 * what the person wants made. A tag must start a word, as in the chat, so
 * an e-mail address is left alone.
 */
export function topicText(raw: string): string {
  const aliases = AGENT_KEYS.flatMap((k) => agentAliases(k)).sort((a, b) => b.length - a.length);
  const out = String(raw ?? "").replace(/@([A-Za-z0-9_一-鿿-]+)/g, (whole: string, token: string, at: number, all: string) => {
    if (at > 0 && !/[\s(（【「『《,，。、;；:：!！?？~～]/.test(all[at - 1] ?? "")) return whole;
    const han = aliases.find((a) => !/^[a-z]+$/.test(a) && token.startsWith(a));
    if (han) return ` ${token.slice(han.length)}`;
    return aliases.includes(token.toLowerCase().replace(/[-_]/g, "")) ? " " : whole;
  });
  return out.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Search words in groups, one group per idea in the topic, the core subject
 * first: [["AI","人工智能","大模型"], ["失业","失業","裁员","岗位"]]. A row
 * that has a word from the first group and from most of the others is about
 * the topic; one with only the first group's is about the subject in general.
 */
type Groups = string[][];

/** Words that sit in any title and would make every row "about" the topic. */
const GENERIC = new Set(["普通人", "普通", "大家", "我们", "你们", "人们", "影响", "分析", "解读", "如何", "怎么", "为什么", "什么", "真相", "原因", "未来", "视频", "选题", "问题", "机会", "方法"]);

const cleanTerm = (v: unknown): string => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : "";
  if (!t || t.length > 16 || GENERIC.has(toSimplified(t))) return "";
  /* One Chinese character, or one Latin letter, matches everything. */
  if (/^[一-鿿]$/.test(t) || /^[a-z0-9]$/.test(t)) return "";
  return t;
};

/** Without the model: the Latin words, and the Chinese runs between the filler. */
function localGroups(text: string): Groups {
  const t = toSimplified(text).toLowerCase();
  const groups: Groups = [];
  for (const run of t
    .replace(/[a-z0-9][a-z0-9.+-]*/g, " ")
    .replace(new RegExp(`${[...GENERIC].sort((a, b) => b.length - a.length).join("|")}|会不会|是不是|能不能|一下|帮我|看看|聊聊|对于|关于|标题|的|了|吗|呢|吧|和|与|让|把|被|给|对|在|是`, "g"), " ")
    .match(/[一-鿿]{2,}/g) ?? []) {
    if (run.length <= 4) groups.push([run]);
    else groups.push(Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)));
  }
  for (const w of t.match(/[a-z][a-z0-9.+-]{1,15}/g) ?? []) groups.push([w]);
  return groups.slice(0, 4);
}

/** A term in a text: Latin words whole ("etf" is not in "netflix"), Chinese anywhere. */
function has(hay: string, term: string): boolean {
  if (!/^[a-z0-9 .+-]+$/.test(term)) return hay.includes(term);
  for (let i = hay.indexOf(term); i >= 0; i = hay.indexOf(term, i + 1)) {
    if (!/[a-z0-9]/.test(hay[i - 1] ?? " ") && !/[a-z0-9]/.test(hay[i + term.length] ?? " ")) return true;
  }
  return false;
}

type Match = { hits: boolean[]; direct: boolean; partial: boolean };

/**
 * Which groups a text hits. "Direct" is the core group and one more (the
 * core alone when the topic has one idea): a headline says "AI" and
 * "裁员", rarely every word of the topic, and asking for most of four
 * groups found one row where there were five.
 */
function matchOf(text: string, groups: Groups): Match {
  const lower = text.toLowerCase();
  const hay = `${toSimplified(lower)} ${lower}`;
  const hits = groups.map((g) => g.some((t) => has(hay, t)));
  const n = hits.filter(Boolean).length;
  const direct = groups.length > 0 && hits[0] && (groups.length === 1 || n >= 2);
  return { hits, direct, partial: !direct && Boolean(hits[0]) };
}

/** One Postgres regex for every term, Latin words between non-letters. */
function termsRegex(terms: string[]): string {
  const esc = (t: string) => t.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
  const latin = terms.filter((t) => /^[a-z0-9 .+-]+$/.test(t)).map(esc);
  const han = terms.filter((t) => !/^[a-z0-9 .+-]+$/.test(t)).map(esc);
  const parts = [latin.length ? `(^|[^a-z0-9])(${latin.join("|")})([^a-z0-9]|$)` : "", han.length ? `(${han.join("|")})` : ""].filter(Boolean);
  return parts.join("|") || "$^";
}

/* ------------------------------------------------------------ the rows */

type StoredStats = HotStats & { price?: number | null; change24h?: number | null; capRank?: number | null };
type StoredRow = Omit<HotRow, "stats"> & { stats?: StoredStats | null; list?: string | null; origin?: string | null; query?: string | null };
type Rel = { t?: string; s?: number; tag?: string } | null;

/** A row found for the topic, with the id the prompt cites it by. */
type Found = {
  id: string;
  label: string;
  platform: string | null;
  title: string;
  url: string | null;
  thumbnail: string | null;
  account: string | null;
  numbers: string;
  views: number | null;
  rel: Rel;
  /** On its list's latest snapshot. */
  onNow: boolean;
  /** How many stored snapshots it was in. */
  seen: number;
  lastSeen: Date | null;
  m: Match;
  /** Anything else the prompt should know about it. */
  note?: string;
};

const PLATFORM_NAME = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.zh])) as Record<string, string>;

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万` : String(Math.round(n)));
const clip = (s: string | null | undefined, n: number) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
/** A play count in words; a small one with its unit, "26" alone reads as nothing. */
const plays = (n: number) => (n >= 1e4 ? wan(n) : `${Math.round(n)} 次`);
/** "9月26日", in Hong Kong time. */
const hkDate = (d: Date | string) => {
  const [, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date(d)).split("-");
  return `${Number(m)}月${Number(day)}日`;
};

/** Where a stored row came from, in words: the platform list or a beat feed. */
function sourceOf(platform: string, row: StoredRow): { label: string; platform: string | null } {
  if (platform.startsWith("beat_")) {
    const list = typeof row.list === "string" ? row.list : null;
    if (list && PLATFORM_NAME[list]) return { label: PLATFORM_NAME[list], platform: list };
    const p = platform.slice(5);
    if (p === "crypto") return { label: row.origin === "search" ? "加密新闻" : "加密行情", platform: null };
    if (p === "news") return { label: row.extra ? `新闻 · ${clip(row.extra, 12)}` : "财经新闻", platform: null };
    if (p === "all") return { label: "赛道榜", platform: null };
    /* A beat feed's search on a platform: named by what it searched. */
    const words = typeof row.query === "string" ? row.query.split(/\s+OR\s+|\|/).map((w) => w.trim()).filter(Boolean) : [];
    /* Named by its query only when it searched one thing: with several
       ("DeepSeek|bitcoin|…") the first is not what found this row. */
    const q = words.length === 1 ? words[0] : "";
    const name = PLATFORM_NAME[p] ?? p;
    return { label: row.origin === "search" ? (q ? `${name}搜索「${clip(q, 10)}」` : `${name}搜索`) : `${name} · 赛道`, platform: PLATFORM_NAME[p] ? p : null };
  }
  return { label: PLATFORM_NAME[platform] ?? platform, platform };
}

/** A row's own numbers in words; a coin's price, or a news item's date, when that is all it has. */
function numbersOfRow(row: StoredRow): string {
  const st = row.stats ?? {};
  if (typeof st.price === "number") {
    const price = st.price >= 100 ? Math.round(st.price).toLocaleString("en-US") : String(st.price);
    return [`价格 $${price}`, row.heatLabel ? `24小时 ${row.heatLabel}` : "", st.capRank ? `市值第 ${st.capRank}` : ""].filter(Boolean).join(" · ");
  }
  /* Some feeds put the likes in `heat` too; said once, as likes. */
  const heat = st.views == null && row.heat != null && row.heat === st.likes ? null : row.heat;
  const n = numbersOf(st, heat, row.heatLabel, 3);
  if (n) return n;
  return st.publishedAt ? `${hkDate(st.publishedAt)}发布` : "";
}

/**
 * The stored list rows about the topic: every snapshot of the last two
 * weeks searched in Postgres by one regex, one row per link (its latest
 * appearance, with how often it was on a list), then matched here by group
 * with the Traditional folded to Simplified.
 */
async function listMatches(groups: Groups): Promise<{ found: Omit<Found, "id">[]; snapshots: number; lists: number; since: Date | null }> {
  const terms = [...new Set(groups.flat())];
  const since = sql.raw(`interval '${DAYS} days'`);
  const [hits, meta] = await Promise.all([
    terms.length
      ? db.execute<{ platform: string; fetched_at: string | Date; row: StoredRow; rel: Rel; seen: number | string }>(sql`
          with m as (
            select h.platform, h.fetched_at, r.value as row, h.relevance -> (r.value ->> 'phrase') as rel,
                   coalesce(nullif(r.value ->> 'url', ''), h.platform || ':' || (r.value ->> 'phrase')) as k
              from hot_snapshots h
              cross join lateral jsonb_array_elements(case when jsonb_typeof(h.rows) = 'array' then h.rows else '[]'::jsonb end) r
             where h.fetched_at > now() - ${since}
               and h.platform not like 'search:%'
               and (coalesce(r.value ->> 'phrase', '') || ' ' || coalesce(r.value ->> 'extra', '')) ~* ${termsRegex(terms)}
          ), d as (
            select distinct on (k) k, platform, fetched_at, row, rel, count(*) over (partition by k) as seen
              from m
             order by k, fetched_at desc
          )
          select platform, fetched_at, row, rel, seen from d order by fetched_at desc limit 800
        `)
      : Promise.resolve({ rows: [] as { platform: string; fetched_at: string | Date; row: StoredRow; rel: Rel; seen: number | string }[] }),
    db.execute<{ platform: string; latest: string | Date; first: string | Date; n: number | string }>(sql`
      select platform, max(fetched_at) as latest, min(fetched_at) as first, count(*) as n
        from hot_snapshots
       where fetched_at > now() - ${since}
         and platform not like 'search:%'
       group by platform
    `),
  ]);
  const latest = new Map(meta.rows.map((r) => [r.platform, new Date(r.latest).getTime()]));
  const first = meta.rows.reduce<number | null>((min, r) => {
    const t = new Date(r.first).getTime();
    return min === null || t < min ? t : min;
  }, null);
  const found: Omit<Found, "id">[] = [];
  for (const h of hits.rows) {
    const row = h.row;
    if (!row || typeof row.phrase !== "string" || !row.phrase.trim()) continue;
    /* The title, and its second line where that is words about it (a
       news source, a headline). A video's second line is its account:
       "AI野兽妹妹" made a video about slang "about AI". Never a beat
       feed's search words, which say what was searched for. */
    const views = typeof row.stats?.views === "number" ? row.stats.views : null;
    const m = matchOf(views == null ? `${row.phrase} ${row.extra ?? ""}` : row.phrase, groups);
    if (!m.direct && !m.partial) continue;
    const src = sourceOf(h.platform, row);
    found.push({
      label: src.label,
      platform: src.platform,
      title: row.phrase.replace(/\s+/g, " ").trim(),
      url: row.url ?? null,
      thumbnail: row.thumbnail ?? null,
      account: views != null && row.extra ? clip(row.extra.split(" · ")[0], 20) : null,
      numbers: numbersOfRow(row),
      views,
      rel: h.rel ?? null,
      onNow: new Date(h.fetched_at).getTime() === latest.get(h.platform),
      seen: Number(h.seen) || 1,
      lastSeen: new Date(h.fetched_at),
      m,
    });
  }
  /* The same headline on two lists (a beat feed repeats the platform's row)
     is one piece of evidence. */
  const seenTitle = new Set<string>();
  const unique = found.filter((f) => {
    const key = toSimplified(f.title).replace(/\s+/g, "").slice(0, 40);
    if (seenTitle.has(key)) return false;
    seenTitle.add(key);
    return true;
  });
  return { found: unique, snapshots: meta.rows.reduce((s, r) => s + (Number(r.n) || 0), 0), lists: meta.rows.length, since: first === null ? null : new Date(first) };
}

const popularity = (f: Omit<Found, "id">) => (f.views ?? 0) * 10 + (f.onNow ? 1e7 : 0) + f.seen;

/** The channel's own uploads on the subject, and the channel's median. */
async function channelMatches(tenantId: string, groups: Groups) {
  const vids = await db
    .select({ id: creatorVideos.id, platform: creatorVideos.platform, title: creatorVideos.title, tags: creatorVideos.tags, views: creatorVideos.views, likes: creatorVideos.likes, externalId: creatorVideos.externalId, publishedAt: creatorVideos.publishedAt, thumbnailUrl: creatorVideos.thumbnailUrl })
    .from(creatorVideos)
    .where(eq(creatorVideos.tenantId, tenantId))
    .orderBy(sql`${creatorVideos.publishedAt} desc nulls last`)
    .limit(400);
  const recent = vids.filter((v) => v.publishedAt && Date.now() - v.publishedAt.getTime() < 180 * 86_400_000);
  const base = (recent.length >= 5 ? recent : vids).map((v) => v.views).sort((a, b) => a - b);
  const median = base.length ? base[Math.floor(base.length / 2)] : 0;
  const found: Omit<Found, "id">[] = [];
  for (const v of vids) {
    const m = matchOf(`${v.title} ${(v.tags ?? []).slice(0, 12).join(" ")}`, groups);
    if (!m.direct && !m.partial) continue;
    const likeRate = v.views > 0 ? v.likes / v.views : null;
    found.push({
      label: "本频道",
      platform: v.platform,
      title: v.title.replace(/\s+/g, " ").trim(),
      /* A watch link only where the id is a YouTube one. */
      url: v.platform === "youtube" ? `https://www.youtube.com/watch?v=${v.externalId}` : null,
      thumbnail: v.thumbnailUrl ?? null,
      account: null,
      numbers: numbersOf({ views: v.views, likes: v.likes, likeRate }, null, null, 2),
      views: v.views,
      rel: null,
      onNow: false,
      seen: 1,
      lastSeen: v.publishedAt,
      m,
      note: [v.publishedAt ? v.publishedAt.toISOString().slice(0, 10) : "", median > 0 ? `是频道中位数的 ${(v.views / median).toFixed(1)} 倍` : ""].filter(Boolean).join(" ｜ "),
    });
  }
  found.sort((a, b) => Number(b.m.direct) - Number(a.m.direct) || (b.views ?? 0) - (a.views ?? 0));
  return { found, total: vids.length, median };
}

/** The last week of morning briefs: the signals on the subject. */
async function briefMatches(tenantId: string, groups: Groups) {
  const rows = await db
    .select({ meta: chatMessages.meta })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(and(eq(chatChannels.tenantId, tenantId), sql`${chatMessages.deletedAt} is null`, sql`(${chatMessages.meta} -> 'digest' ->> 'date') is not null`))
    .orderBy(desc(chatMessages.createdAt))
    .limit(7);
  type Sig = { title?: string; whyNow?: string; evidence?: { source?: string; phrase?: string; url?: string | null; thumbnail?: string | null; heat?: number | null; heatLabel?: string | null; stats?: Record<string, unknown> | null }[] };
  const found: Omit<Found, "id">[] = [];
  for (const r of rows) {
    const d = (r.meta as { digest?: { date?: string; signals?: Sig[] } } | null)?.digest;
    for (const s of Array.isArray(d?.signals) ? d!.signals : []) {
      if (typeof s?.title !== "string") continue;
      const m = matchOf(`${s.title} ${s.whyNow ?? ""}`, groups);
      if (!m.direct && !m.partial) continue;
      const e = s.evidence?.[0];
      found.push({
        label: `${d?.date ? `${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8, 10))}日` : ""}晨报`,
        platform: null,
        title: s.title.trim(),
        url: e?.url ?? null,
        thumbnail: e?.thumbnail ?? null,
        account: null,
        numbers: e ? numbersOf(e.stats as Parameters<typeof numbersOf>[0], e.heat ?? null, e.heatLabel ?? null) : "",
        views: null,
        rel: null,
        onNow: false,
        seen: 1,
        lastSeen: null,
        m,
        note: clip(cleanCodes(s.whyNow ?? ""), 90),
      });
    }
  }
  return found.sort((a, b) => Number(b.m.direct) - Number(a.m.direct)).slice(0, 4);
}

/** Backlog topics on the subject: so 研究员 can say "we already have this". */
async function backlogMatches(tenantId: string, groups: Groups) {
  const rows = await db
    .select({ id: topics.id, name: topics.name, nameLocal: topics.nameLocal, query: topics.query, status: topics.status, summary: topics.summary })
    .from(topics)
    .where(and(eq(topics.tenantId, tenantId), sql`${topics.status} in ('adopted', 'saved', 'new')`))
    .orderBy(desc(topics.heat))
    .limit(300);
  const found: Omit<Found, "id">[] = [];
  for (const t of rows) {
    const name = t.nameLocal || t.name;
    const m = matchOf(`${name} ${t.name} ${t.query}`, groups);
    if (!m.direct && !m.partial) continue;
    found.push({ label: "选题储备", platform: null, title: name, url: null, thumbnail: null, account: null, numbers: "", views: null, rel: null, onNow: false, seen: 1, lastSeen: null, m, note: clip(t.summary ?? "", 60) });
  }
  return found.sort((a, b) => Number(b.m.direct) - Number(a.m.direct)).slice(0, 4);
}

/** The creator voice note's "Subjects" section: the channel's own pillars. */
function pillarsOf(voice: string): string {
  const m = voice.match(/##\s*Subjects\s*\n([\s\S]*?)(?:\n##\s|$)/i);
  return (m?.[1] ?? "").trim().slice(0, 500);
}

/* ------------------------------------------------------------ the model */

const REFUSAL = /无法回答|不能回答|无法提供|换个话题|I can.t|I cannot/;

function parseObject(text: string): Record<string, unknown> | null {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  for (const c of [clean, start >= 0 && end > start ? clean.slice(start, end + 1) : ""]) {
    if (!c) continue;
    try {
      const j = JSON.parse(c) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      /* the next shape */
    }
  }
  return null;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? toSimplified(v.replace(/\s+/g, " ").trim()).slice(0, n) : "");

type Usage = Awaited<ReturnType<typeof complete>>;

/** One model call as 研究员: the ledger row written when the result is kept. */
async function ask(researcher: Viewer, model: string, prompt: string, opts: { temperature: number; maxTokens: number; store: boolean; signal?: AbortSignal }): Promise<Usage> {
  const out = await complete({ model, messages: [{ role: "user", content: prompt }], temperature: opts.temperature, maxTokens: opts.maxTokens, signal: opts.signal });
  if (opts.store) {
    await recordUsage({
      viewer: researcher,
      module: "research",
      provider: out.provider ?? "openrouter",
      model: out.model,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
      costMicros: out.costMicros,
      requestId: out.requestId,
    });
  }
  return out;
}

/**
 * Search groups as a model (or a page, sending the last round's back) gave
 * them. A term that runs two ideas together ("比特币etf" beside an "etf"
 * group) also gives its core on its own ("比特币"): a headline says 比特币
 * and ETF apart far more often than as one word.
 */
export function cleanGroups(v: unknown): Groups {
  const groups = (Array.isArray(v) ? v : [])
    .map((g) => [...new Set((Array.isArray(g) ? g : []).map(cleanTerm).filter(Boolean))])
    .filter((g) => g.length)
    .slice(0, 4);
  const others = groups.slice(1).flat();
  return groups.map((g, i) => {
    if (i > 0 || !others.length) return g.slice(0, 10);
    const split = g.flatMap((t) => others.filter((o) => o !== t && t.includes(o)).map((o) => cleanTerm(t.replace(o, " ").replace(/\s+/g, " ").trim())));
    return [...new Set([...g, ...split.filter(Boolean)])].slice(0, 12);
  });
}

/** The prompt's example answer; also how an answer that only repeats it is recognised. */
const EXAMPLE_GROUPS = [["比特币", "比特幣", "BTC", "Bitcoin"], ["ETF", "现货ETF", "現貨ETF"]];

/**
 * The topic as search groups, by the utility model; the local split when it
 * fails or is slow.
 *
 * From the topic alone, every round: with the follow-up line in the prompt
 * ("再短一点") the utility model thought for 26 seconds and answered
 * nothing, where the topic alone takes two. A follow-up changes the titles,
 * not what the rows are searched for.
 */
async function searchGroups(researcher: Viewer, text: string, store: boolean): Promise<Groups> {
  const prompt = [
    "把下面这个短视频选题拆成 1 到 3 个检索概念，用来在热榜标题里做“包含”匹配。",
    "第一个概念必须是题目的核心对象（事件、公司、技术、资产、政策）。人群（普通人、散户、年轻人、老百姓）不要单独做概念，标题里很少写。",
    "每个概念给 3 到 8 个检索词：短词（2 到 6 个字，或一个英文词/缩写），包括同义词、常见说法、英文缩写；简体和繁体写法不同的，两种都给（比如 失业、失業）。",
    "不要给整句，不要给“影响”“分析”“普通人”这类放在哪个标题里都成立的泛词。一个词只含一个概念：不要写“比特币ETF”，写成“比特币”和“ETF”两组。",
    `选题：「${text}」`,
    `只回答一个 JSON 对象：${JSON.stringify({ groups: EXAMPLE_GROUPS })}`,
  ]
    .filter(Boolean)
    .join("\n");
  /* The utility model sometimes spends its whole answer thinking and
     returns nothing; the assistant model is asked once more before the
     local split. */
  const plain = `${toSimplified(text).toLowerCase()} ${text.toLowerCase()}`;
  const example = new Set(cleanGroups(EXAMPLE_GROUPS).flat());
  for (const model of [...new Set([modelFor.utility(), modelFor.assistant()])]) {
    try {
      const out = await ask(researcher, model, prompt, { temperature: 0.2, maxTokens: 600, store, signal: AbortSignal.timeout(15_000) });
      const groups = cleanGroups(parseObject(out.text)?.groups);
      /* Not the example handed back. Given something it could not read as
         a topic (an instruction typed into the box), the model answered with
         the prompt's own example, and the whole check then researched 比特币
         ETF under somebody else's words. Its own guess at a vague topic
         ("最近能拍点啥") is kept: that is still about what was typed. */
      const flat = groups.flat();
      const echoed = flat.length > 0 && flat.every((term) => example.has(term)) && !flat.some((term) => has(plain, toSimplified(term)));
      if (groups.length && !echoed) return groups;
      console.warn(`[ideas/check] search words: nothing usable from ${model} (${out.text.length} chars${echoed ? ", the prompt's example repeated" : ""})`);
    } catch (err) {
      console.error(`[ideas/check] search words by ${model}`, err);
    }
  }
  return localGroups(text);
}

/* ------------------------------------------------------------ the check */

export type CheckResult = { ok: true; check: TitleCheck } | { ok: false; error: string };

const LEVELS: CheckLevel[] = ["hot", "warm", "cold", "crowded"];

/**
 * The whole check's time on the model. A first check takes 10 to 20
 * seconds; this is the ceiling for a slow provider, so the card on Home says
 * "didn't finish" within about two minutes instead of counting on. The
 * card's own deadline (`TitleCheckCard`) sits just above it.
 */
const CHECK_BUDGET_MS = 100_000;

/**
 * A failed model call in the person's words. The provider's own message
 * ("qwen/qwen3-max did not respond within 60s") is logged, not shown: the
 * card says what happened (too slow, rate-limited, out of credit) and that
 * trying again is the way out.
 */
function failWords(err: unknown, zh: boolean): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (err instanceof AiError && err.kind === "credit") return zh ? "AI 账户的额度用完了，不是研究员的问题；管理员充值后再试。" : "The AI account is out of credit; an admin needs to top it up.";
  if (/did not respond within|TimeoutError|timed? ?out/i.test(text)) return zh ? "研究员这次没在时间内看完（模型太慢），再试一次。" : "The researcher ran out of time (the model was too slow); try again.";
  if (err instanceof AiError && err.kind === "rate_limit") return zh ? "模型这会儿在限流，没有扣费，稍后再试。" : "The model is rate-limiting right now; nothing was charged. Try again shortly.";
  return zh ? "研究员这次没看完（模型出错），再试一次。" : "The researcher could not finish (a model error); try again.";
}

/**
 * Check a typed topic, or have another round on one already checked.
 *
 * `previous` is the idea the last round stored and `instruction` what the
 * person said about it ("再短一点"); the new answer replaces that row unless
 * it has been started, in which case it is a new row. `store: false` does
 * everything but the writes (the row, the ledger), for trying the prompt.
 */
export async function checkTitle(
  viewer: Viewer,
  input: { text: string; previous?: CheckPrevious | null; instruction?: string | null },
  opts: { store?: boolean } = {},
): Promise<CheckResult> {
  const store = opts.store !== false;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const began = Date.now();
  const text = topicText(input.text);
  if (!text) return { ok: false, error: zh ? "先写下想做的题目。" : "Write the topic first." };
  const instruction = (input.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || null;

  const researcher = await agentViewer(viewer.tenantId, "research");
  try {
    await assertBudget(researcher);
  } catch (err) {
    if (err instanceof BudgetStop) return { ok: false, error: zh ? "研究员本期的 AI 额度已经用完。" : "The researcher's AI budget for this period is used up." };
    throw err;
  }

  /* The round before, read from the row itself: what the page sends is only
     which row, and the person's own earlier words. Only a check of this
     same topic (its seed is what was typed): an id from anywhere else, say
     one of 研究员's generated ideas, is not rewritten by a follow-up, and
     the round starts fresh instead. */
  const prevId = input.previous && typeof input.previous.id === "string" ? input.previous.id.slice(0, 64) : null;
  const [prevRow] = prevId ? await db.select().from(ideas).where(and(eq(ideas.id, prevId), eq(ideas.tenantId, viewer.tenantId), eq(ideas.seed, text))).limit(1) : [];
  const earlier = (Array.isArray(input.previous?.instructions) ? input.previous!.instructions : [])
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .slice(-3)
    .map((x) => x.trim().slice(0, 80));

  const [groups, pool, voice] = await Promise.all([
    /* A follow-up searches with the words the first round used. */
    cleanGroups(input.previous?.groups).length ? Promise.resolve(cleanGroups(input.previous?.groups)) : searchGroups(researcher, text, store),
    evidencePool(viewer).catch((err) => {
      console.error("[ideas/check] pool", err);
      return { rows: [], text: "", counts: {} };
    }),
    creatorVoiceText(viewer.tenantId).catch(() => ""),
  ]);
  const [lists, channel, briefs, backlog] = await Promise.all([
    listMatches(groups),
    channelMatches(viewer.tenantId, groups),
    briefMatches(viewer.tenantId, groups),
    backlogMatches(viewer.tenantId, groups),
  ]);

  /* The rows the prompt gets, each with an id no pool id can be ("TM3"). */
  const direct = lists.found.filter((f) => f.m.direct).sort((a, b) => popularity(b) - popularity(a));
  const partial = lists.found.filter((f) => f.m.partial).sort((a, b) => popularity(b) - popularity(a));
  const withIds = <T extends Omit<Found, "id">>(rows: T[], prefix: string): Found[] => rows.map((r, i) => ({ ...r, id: `${prefix}${i + 1}` }));
  const tm = withIds([...direct.slice(0, 20), ...partial.slice(0, 8)], "TM");
  const tv = withIds(channel.found.slice(0, 5), "TV");
  const ts = withIds(briefs, "TS");
  const tk = withIds(backlog, "TK");

  /* The counts worked out here, which the verdict may quote. */
  const directVideos = direct.filter((f) => f.views != null);
  const top = directVideos.reduce<Omit<Found, "id"> | null>((best, f) => (!best || (f.views ?? 0) > (best.views ?? 0) ? f : best), null);
  const accounts = new Set(directVideos.map((f) => f.account).filter(Boolean)).size;
  const byList = Object.entries(direct.reduce<Record<string, number>>((acc, f) => ((acc[f.label] = (acc[f.label] ?? 0) + 1), acc), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} ${v}`)
    .join("、");
  const partialVideos = partial.filter((f) => f.views != null);
  const partialTop = partialVideos.reduce<Omit<Found, "id"> | null>((best, f) => (!best || (f.views ?? 0) > (best.views ?? 0) ? f : best), null);
  const ownDirect = channel.found.filter((f) => f.m.direct);
  const ownAvg = ownDirect.length ? ownDirect.reduce((s, f) => s + (f.views ?? 0), 0) / ownDirect.length : 0;
  const thinData = direct.length + ownDirect.length + briefs.filter((b) => b.m.direct).length < 2;
  const sinceWord = lists.since ? `${hkDate(lists.since)}以来` : `近 ${DAYS} 天`;
  const stats = [
    `- ${sinceWord}存下来的 ${lists.lists} 个榜（${lists.snapshots} 份快照）里，跟这个题直接相关的 ${direct.length} 条，其中此刻还在榜上的 ${direct.filter((f) => f.onNow).length} 条${byList ? `（${byList}）` : ""}。`,
    `- 只沾到核心词（${groups[0]?.slice(0, 3).join("/") || "—"}）、没说到这个角度的 ${partial.length} 条，此刻在榜 ${partial.filter((f) => f.onNow).length} 条${partialTop ? `，其中视频最高播放 ${plays(partialTop.views ?? 0)}` : ""}。`,
    directVideos.length
      ? `- 直接相关的视频 ${directVideos.length} 条，最高播放 ${plays(top?.views ?? 0)}（${top?.label}「${clip(top?.title, 24)}」），播放过百万的 ${directVideos.filter((f) => (f.views ?? 0) >= 1e6).length} 条，来自 ${accounts} 个不同账号。`
      : "- 直接相关的条目里没有带播放数的视频。",
    `- 本频道 ${channel.total} 条视频里直接相关的 ${ownDirect.length} 条${ownDirect.length ? `，平均播放 ${plays(ownAvg)}` : ""}；频道近半年播放中位数 ${plays(channel.median)}。`,
    `- 近 7 期晨报提到过 ${briefs.length} 次；选题储备里相近的题 ${backlog.length} 个。`,
  ].join("\n");

  const line = (f: Found) =>
    `[${f.id}] ${f.label} ｜ ${clip(f.title, 70)}${f.account ? ` ｜ @${f.account}` : ""} ｜ ${f.numbers || "—"}${f.onNow ? " ｜ 此刻在榜" : f.lastSeen && f.label !== "本频道" ? ` ｜ 最后在榜 ${hkDate(f.lastSeen)}` : ""}${f.seen > 1 ? ` ｜ 上榜 ${f.seen} 次` : ""}${f.rel?.t ? ` ｜ ${f.rel.t === "other" ? "非财经科技" : `${f.rel.t === "biz" ? "财经" : f.rel.t === "tech" ? "科技" : f.rel.t === "crypto" ? "加密" : f.rel.t}${f.rel.tag ? `·${f.rel.tag}` : ""}`}` : ""}${f.m.partial ? " ｜ 只沾核心词" : ""}${f.note ? ` ｜ ${f.note}` : ""}`;
  const section = (title: string, rows: Found[], empty: string) => [`### ${title}`, ...(rows.length ? rows.map(line) : [empty])].join("\n");

  const pillars = pillarsOf(voice);
  const prompt = [
    "你是一家香港财经科技自媒体工作室的研究员。主持人在首页写下一个想做的选题，想先听你的判断，再决定要不要让编剧写脚本。",
    `主持人写的是：「${text}」`,
    prevRow
      ? [
          `上一轮你给的是：主标题《${prevRow.title}》${(prevRow.titles ?? []).length ? `，备选${(prevRow.titles ?? []).map((t) => `《${t}》`).join("")}` : ""}${prevRow.angle ? `；角度：${prevRow.angle}` : ""}${prevRow.why ? `；判断：${clip(prevRow.why, 120)}` : ""}${prevRow.format ? `；形式：${prevRow.format}` : ""}。`,
          earlier.length ? `主持人之前说过：${earlier.map((x) => `「${x}」`).join("、")}。` : "",
          instruction
            ? `主持人这次说：「${instruction}」。这句话默认是针对标题说的：「再短一点」是三个标题都比上一轮短、每个 14 个字以内；「换个角度」是换一个切入点，角度和标题都换；「更适合抖音」是更口语、更有冲突、竖版 60 秒以内。照这句话改，三个标题都要看得出改过；没被要求改的（判断、证据）可以保留。reply 说这次改了什么。`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    pillars ? `本频道已经验证过的题材：\n${pillars}` : "本频道的题材：香港机会、Web3 与 AI、投资与职涯、财经科技、人物对话。",
    "",
    "下面是工作室已经存下来的数据。每条前面是编号，数字是平台自己的，不要改。",
    "## 跟这个选题直接相关的（程序按关键词从存下来的数据里找的）",
    `检索词：${groups.map((g) => g.slice(0, 5).join("/")).join(" + ") || "—"}`,
    "统计（程序数出来的，可以照抄）：",
    stats,
    section("榜单里的相关条目", tm, "（没有找到）"),
    section("本频道做过的相关视频", tv, "（没有）"),
    section("晨报里提过的", ts, "（没有）"),
    section("选题储备里相近的", tk, "（没有）"),
    pool.text ? `\n## 此刻的大盘（参考；只有真的相关才引用）\n${pool.text}` : "",
    "",
    "任务：判断这个题值不值得做，并给出更好的标题。规则：",
    "1. verdict.level 只能是 hot（正在热、还没被做滥）、warm（有热度但一般）、cold（存下来的数据里几乎没人讨论）、crowded（很热，但同题视频已经很多，要换角度才有机会）之一。verdict.line 一句话，40 字以内，必须带上面统计或证据里的真实数字。",
    "   直接相关的少、只沾核心词的多，说明大主题有热度、这个具体角度还没人做：判 warm（大主题此刻在榜很热时可以判 hot），verdict.line 把两个数字都说出来。两样都少才判 cold。",
    thinData
      ? "2. 注意：存下来的数据里这个题的直接证据很少。要老实说“存下来的数据里直接证据很少”，不要编数字，strength 不超过 3，thin 为 true。可以用大盘或本频道的数据说明为什么冷、怎么换角度更有机会。"
      : "2. 证据少时要老实说，不要编数字；证据够时 thin 为 false。",
    "3. 给 3 个标题，按你推荐的顺序，每个配一句理由（20 字以内）。标题像本频道的标题：具体、有冲突或有数字，简体中文，20 字左右。标题里的数字只能用证据里有的，没有就不用数字。",
    "4. evidence 引 0 到 3 条最能支持判断的编号，优先引跟这个题直接相关的（TM、TV、TS 开头）；大盘的条目只有说的是这个题或它的核心对象才能引，没有相关的就给空数组，不要拿无关的热门凑数；similar 引最多 3 条做得好的同题视频（只能选 TM、TV 开头、带播放数、说的是同一件事的条目），没有就给空数组。",
    "5. risk：事实、合规、时效上要注意的一句话（比如涉及投资建议、数据可能过时），没有就 null。",
    "6. reply：像同事在对话里回的一句话，30 字以内，说结论或这次改了什么。why 不要重复 verdict.line，说 verdict 没说到的理由。",
    "7. title、why、angle、hook、reply、verdict.line 里都不要写编号（TM3、H5 这类），编号只放在 evidence 和 similar 里。",
    "8. 只做判断和标题，不写脚本。",
    "",
    "只回答一个 JSON 对象，不要任何别的文字：",
    '{"verdict":{"level":"hot","line":"一句话结论，带数字"},"reply":"……","titles":[{"title":"……","why":"……"},{"title":"……","why":"……"},{"title":"……","why":"……"}],"angle":"切入角度，一句话","why":"为什么现在做（或为什么要换角度），一两句，带证据里的数字","hook":"视频第一句话","format":"竖版 60 秒 / 横版 8 分钟 之类","strength":3,"evidence":["TM1"],"similar":["TM2"],"risk":null,"thin":false}',
  ]
    .filter((l) => l !== "")
    .join("\n");

  let raw: Record<string, unknown> | null = null;
  let used: string | null = null;
  let lastError = zh ? "研究员这次没有给出能读的判断，再试一次。" : "The researcher's answer could not be read; try again.";
  for (const model of [...new Set([modelFor.assistant(), modelFor.utility()])]) {
    /* What is left of the budget; a fallback with a few seconds left is not tried. */
    const left = CHECK_BUDGET_MS - (Date.now() - began);
    if (left < 8_000) break;
    try {
      const out = await ask(researcher, model, prompt, { temperature: 0.5, maxTokens: 1800, store, signal: AbortSignal.timeout(Math.min(60_000, left)) });
      if (REFUSAL.test(out.text.slice(0, 80))) continue;
      const j = parseObject(out.text);
      if (j && Array.isArray(j.titles) && j.titles.length) {
        raw = j;
        used = out.model;
        break;
      }
    } catch (err) {
      lastError = failWords(err, zh);
      console.error(`[ideas/check] ${model}`, err);
    }
  }
  if (!raw || !used) return { ok: false, error: lastError };

  /* The rows the answer may cite: the topic's own, and the pool's. */
  const byId = new Map<string, { label: string; title: string; url: string | null; numbers: string; thumbnail?: string | null; platform?: string | null; views?: number | null }>();
  for (const f of [...tm, ...tv, ...ts, ...tk]) byId.set(f.id, { label: f.label, title: clip(f.title, 80), url: f.url, numbers: f.numbers, thumbnail: f.thumbnail, platform: f.platform, views: f.views });
  for (const r of pool.rows) if (!byId.has(r.id)) byId.set(r.id, { label: r.label, title: r.title, url: r.url, numbers: r.numbers, thumbnail: r.thumbnail ?? null, platform: r.platform ?? null, views: null });
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).map((e) => String(e).trim().replace(/^\[|\]$/g, "")).filter((id) => byId.has(id));
  const toEvidence = (id: string): IdeaEvidence => {
    const r = byId.get(id)!;
    return { label: r.label, title: r.title, url: r.url, numbers: r.numbers, thumbnail: r.thumbnail ?? null, platform: r.platform ?? null };
  };
  /* The topic's own rows were found by its words; a pool row counts only
     when it has one of them too. With nothing on the topic the model padded
     the evidence with the day's biggest rows on anything ("捡快递" behind a
     question about SaaS security), which the card would show as proof and
     编剧 would be handed as facts. None left: the card says there is no
     direct evidence, which is the honest answer. */
  const ownIds = new Set([...tm, ...tv, ...ts, ...tk].map((f) => f.id));
  const onTopic = (id: string) => ownIds.has(id) || matchOf(byId.get(id)!.title, groups).hits.some(Boolean);
  const evidenceIds = [...new Set(ids(raw.evidence))].filter(onTopic).slice(0, 3);
  /* Similar videos: the topic's own rows with plays (never the pool's: asked
     for "did well", the model reached for the day's biggest video on any
     subject), not already shown as evidence. */
  const topicIds = new Set([...tm, ...tv].map((f) => f.id));
  const similarIds = [...new Set(ids(raw.similar))].filter((id) => topicIds.has(id) && byId.get(id)?.views != null && !evidenceIds.includes(id)).slice(0, 3);
  /* The prose, without the codes: the pool ids the answer cites, and every
     one of this check's own ("TM3" is no word). Not every pool id: "H20"
     or "C1驾照" would lose their names to the hot rows' H1 to H60. */
  const cited = [...new Set([...evidenceIds, ...similarIds, ...[...tm, ...tv, ...ts, ...tk].map((f) => f.id)])];
  const prose = (v: unknown, n: number) => withoutPoolIds(cleanCodes(str(v, n)), cited);

  const options: TitleOption[] = [];
  for (const t of raw.titles as unknown[]) {
    const o = t && typeof t === "object" ? (t as { title?: unknown; why?: unknown }) : { title: t };
    const title = prose(o.title, 80).replace(/^[《「“"]+|[》」”"]+$/g, "");
    if (title && !options.some((x) => x.title === title)) options.push({ title, why: prose(o.why, 60) });
  }
  if (!options.length) return { ok: false, error: lastError };

  const verdictRaw = raw.verdict && typeof raw.verdict === "object" ? (raw.verdict as { level?: unknown; line?: unknown }) : {};
  const levelGuess: CheckLevel = direct.length === 0 ? "cold" : directVideos.length >= 6 && accounts >= 4 ? "crowded" : direct.filter((f) => f.onNow).length >= 2 ? "hot" : "warm";
  const level = LEVELS.includes(verdictRaw.level as CheckLevel) ? (verdictRaw.level as CheckLevel) : levelGuess;
  const thin = thinData || raw.thin === true;
  const verdictLine = prose(verdictRaw.line, 80) || (thin ? "存下来的数据里这个题的直接证据很少。" : "");
  const strengthRaw = Number(raw.strength);
  const strength = Number.isFinite(strengthRaw) ? Math.max(1, Math.min(thin ? 3 : 5, Math.round(strengthRaw))) : null;
  const risk = prose(raw.risk, 120) || null;
  const why = prose(raw.why, 300);
  /* No similar video named, while the rows have some on the topic that did
     well: the most-watched of them, so the card always shows what worked. */
  if (!similarIds.length) {
    /* Only rows on this very angle: a row that shares just the core word
       ("AI") can be about anything. */
    for (const f of [...tm, ...tv].filter((x) => x.m.direct && (x.views ?? 0) >= 10_000).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))) {
      if (similarIds.length >= 2) break;
      if (!evidenceIds.includes(f.id)) similarIds.push(f.id);
    }
  }
  /* One headline once: the topic's rows and the pool can both carry the
     same video (from two lists), and the model may cite both. */
  const shown = new Set<string>();
  const once = (e: IdeaEvidence) => {
    const key = toSimplified(e.title).replace(/\s+/g, "").slice(0, 30);
    if (shown.has(key)) return false;
    shown.add(key);
    return true;
  };
  const evidence = evidenceIds.map(toEvidence).filter(once);
  const similar = similarIds.map(toEvidence).filter(once);

  /* The row: the verdict leads its "why" (the ideas panel's grey line), the
     risk closes it (the writer is handed it as a fact), and the similar
     videos follow the evidence, labelled, so 编剧 sees them too. */
  const values = {
    seed: text,
    title: options[0].title,
    titles: options.slice(1, 3).map((o) => o.title),
    angle: prose(raw.angle, 200) || null,
    why: [verdictLine, why, risk ? `注意：${risk}` : ""].filter(Boolean).join(" ").slice(0, 480) || null,
    hook: prose(raw.hook, 120) || null,
    format: str(raw.format, 40) || null,
    strength,
    evidence: [...evidence, ...similar.map((s) => ({ ...s, label: `对标 · ${s.label}` }))].slice(0, 5),
  };

  let idea: Idea;
  const now = new Date();
  if (!store) {
    idea = { id: prevRow?.id ?? `idea_${ulid()}`, batchId: prevRow?.batchId ?? "ib_preview", ...values, status: "new", projectId: null, createdAt: now.toISOString() };
  } else {
    let id: string | null = null;
    if (prevRow && prevRow.status !== "started") {
      /* Another round on the same topic: the same row, rewritten. */
      const [row] = await db
        .update(ideas)
        .set({ ...values, status: prevRow.status === "dismissed" ? "new" : prevRow.status, updatedAt: now })
        .where(and(eq(ideas.id, prevRow.id), eq(ideas.tenantId, viewer.tenantId), sql`${ideas.status} <> 'started'`))
        .returning({ id: ideas.id });
      id = row?.id ?? null;
    }
    if (!id) {
      /* Into the studio's latest batch, so the ideas panel shows it beside
         the others rather than as a batch of one that hides them. */
      const [latest] = await db.select({ batchId: ideas.batchId }).from(ideas).where(eq(ideas.tenantId, viewer.tenantId)).orderBy(desc(ideas.createdAt)).limit(1);
      id = `idea_${ulid()}`;
      await db.insert(ideas).values({ id, tenantId: viewer.tenantId, batchId: latest?.batchId ?? `ib_${ulid()}`, createdBy: viewer.id, ...values, status: "new", createdAt: now, updatedAt: now });
    }
    const stored = await ideaById(viewer, id);
    if (!stored) return { ok: false, error: zh ? "存不下这次的判断，再试一次。" : "The check could not be saved; try again." };
    idea = stored;
  }

  return {
    ok: true,
    check: {
      idea,
      text,
      verdict: { level, line: verdictLine },
      options: options.slice(0, 3),
      evidence,
      similar,
      risk,
      thin,
      reply: prose(raw.reply, 80) || verdictLine,
      scanned: { snapshots: lists.snapshots, lists: lists.lists, related: direct.length, channel: channel.total, days: DAYS },
      terms: groups.map((g) => g.slice(0, 3).join("/")),
      groups,
      model: used,
    },
  };
}

/**
 * The title the person picked becomes the idea's title, before it is
 * started: `startFromTopicAction` reads the title from the row, so the
 * project, its script and 编剧's draft get the one chosen. Only one of the
 * idea's own titles, and not once it has been started.
 */
export async function chooseCheckTitle(viewer: Viewer, id: string, title: string): Promise<Idea | null> {
  const [row] = await db.select().from(ideas).where(and(eq(ideas.id, id), eq(ideas.tenantId, viewer.tenantId))).limit(1);
  if (!row) return null;
  const want = String(title ?? "").trim();
  const all = [row.title, ...(row.titles ?? [])];
  if (want && want !== row.title && all.includes(want) && row.status !== "started") {
    await db
      .update(ideas)
      .set({ title: want, titles: all.filter((t) => t !== want), updatedAt: new Date() })
      .where(and(eq(ideas.id, row.id), eq(ideas.tenantId, viewer.tenantId), sql`${ideas.status} <> 'started'`));
  }
  return ideaById(viewer, row.id);
}
