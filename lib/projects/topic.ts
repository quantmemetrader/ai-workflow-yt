/**
 * The topic a project is about, carried from wherever it was chosen.
 *
 * Every way into a project used to lose the topic on the way: the title made
 * it, the reason, the hook, the angle and the evidence mostly did not, and
 * the brief was stored as the chat command a button typed ("@编剧 按这个选题写
 * 脚本初稿《…》"). One snapshot now travels instead. It is resolved on the
 * server from the thing that was picked (a morning-brief signal by its date
 * and place, a backlog topic, a hot-list row, an idea, a person's own pick),
 * stored in `work_projects.source`, and read back by the project page, the
 * script editor and the writer's prompt.
 *
 * Client-safe on purpose: the project page and the script editor draw it, so
 * nothing here may import the database or `server-only` code. Numbers are
 * formatted when the snapshot is made (on the server), so a screen never
 * formats a row's statistics itself.
 */

export type SourceEvidence = {
  /** Where it came from, e.g. "抖音财经热门视频" or "微博热搜". */
  label: string;
  title: string;
  url: string | null;
  /** The row's own numbers, already in words ("播放 2759万 · 点赞 49.6万（1.8%）"). */
  numbers: string;
  thumbnail?: string | null;
};

export type SourceKind = "digest" | "pick" | "own" | "hot" | "backlog" | "plan" | "audience" | "idea" | "person" | "link";

export type ProjectSource = {
  kind: SourceKind | (string & {});
  /** What the project page's topic card says it came from. */
  label?: string;
  url?: string | null;
  /**
   * What was picked, as one stable string, so choosing the same thing twice
   * opens the same project: "signal:2026-09-25:0", "topic:top_…",
   * "idea:idea_…", "hot:weibo:<phrase>", "own:2026-09-25:<text>".
   */
  key?: string | null;
  /** The backlog topic (`topics.id`), when there is one. */
  topicId?: string | null;
  /** The idea (`ideas.id`), when it came from Home's ideas. */
  ideaId?: string | null;
  /** The morning brief it came from: its Hong Kong date and the signal's place in it. */
  signal?: { date: string; index: number } | null;
  why?: string | null;
  hook?: string | null;
  angle?: string | null;
  format?: string | null;
  risk?: string | null;
  shots?: string[];
  strength?: number | null;
  evidence?: SourceEvidence[];
  /** Other ways to title it (ideas carry two or three). */
  titles?: string[];
  /**
   * A draft is being written for this project right now: when it started.
   * Set when the writer is started from the topic, cleared when the draft
   * lands or fails, and ignored once it is ten minutes old, so a server
   * restart mid-draft cannot leave the page "writing" forever.
   */
  writing?: { at: string } | null;
};

/** How to point at a topic from a button. Resolved on the server, never trusted as content. */
export type TopicRef =
  /** A morning-brief signal. `date` + `index` when the caller has them; `title` finds it in the latest briefs otherwise. */
  | { kind: "signal"; date?: string | null; index?: number | null; title?: string | null }
  /** A topic on the research board or in the backlog. */
  | { kind: "topic"; id: string }
  /** Something a person added to today's picks (or typed). */
  | { kind: "own"; text: string }
  /** A row of a stored hot list. */
  | { kind: "hot"; platform: string; phrase: string }
  /** One of 研究员's ideas on Home. */
  | { kind: "idea"; id: string }
  /** A project that already exists: write (or rewrite) its script. */
  | { kind: "project"; id: string }
  /** A suggestion strip item: a plan to-do, a backlog topic or a viewer's question. */
  | { kind: "proposal"; text: string; source: "plan" | "backlog" | "audience" };

/** The chips the research board's "write the script" sheet offers. */
export type ScriptChips = {
  angle?: string | null;
  channel?: string | null;
  aspect?: string | null;
  seconds?: number | null;
  language?: string | null;
  subtitleLanguage?: string | null;
};

/* ------------------------------------------------------------- helpers */

const EVIDENCE_LINES = 5;
const SOURCES_CHARS = 600;

/** A brief's evidence codes ("[B3]", "（证据2）") mean nothing outside the brief. */
export function cleanCodes(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\[[A-Z]\d{1,2}\]\s*/g, "")
    .replace(/（证据\d+）/g, "")
    .replace(/@\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const wan = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e6 ? 0 : 1)}万` : String(Math.round(n)));

type StatsLike = { views?: number | null; likes?: number | null; likeRate?: number | null; comments?: number | null; fans?: number | null; videos?: number | null; rankUp?: number | null } | null | undefined;

/**
 * A row's numbers in words, from the row itself: plays or the platform's
 * heat, likes with the rate, the account's followers. The same wording the
 * morning brief uses (`evidenceNumbers`), without the "3 days ago" part,
 * which would go stale in a stored snapshot.
 */
export function numbersOf(stats: StatsLike, heat?: number | null, heatLabel?: string | null, max = 3): string {
  const s = stats ?? {};
  const parts: string[] = [];
  if (s.views != null) parts.push(`播放 ${wan(s.views)}`);
  else if (heatLabel) parts.push(`热度 ${heatLabel}`);
  else if (heat != null) parts.push(`热度 ${wan(heat)}`);
  if (s.likes != null) parts.push(`点赞 ${wan(s.likes)}${s.likeRate != null ? `（${(s.likeRate * 100).toFixed(1)}%）` : ""}`);
  else if (s.likeRate != null) parts.push(`点赞率 ${(s.likeRate * 100).toFixed(1)}%`);
  if (s.comments != null) parts.push(`评论 ${wan(s.comments)}`);
  if (s.fans != null) parts.push(`账号粉丝 ${wan(s.fans)}`);
  if (s.videos != null) parts.push(`相关视频 ${wan(s.videos)}`);
  if (s.rankUp) parts.push(`排名上升 ${s.rankUp}`);
  return parts.slice(0, max).join(" · ");
}

const clip = (s: string | null | undefined, n: number) => {
  const v = String(s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

/* ------------------------------------------------------------ builders */

/** A signal as the morning brief stores it (`chat_messages.meta.digest.signals[]`). */
export type SignalLike = {
  title: string;
  whyNow?: string | null;
  hook?: string | null;
  angle?: string | null;
  format?: string | null;
  risk?: string | null;
  shots?: unknown;
  strength?: number | null;
  evidence?: { source?: string | null; phrase?: string | null; url?: string | null; thumbnail?: string | null; heat?: number | null; heatLabel?: string | null; stats?: Record<string, unknown> | null }[];
};

export function fromSignal(sg: SignalLike, date: string, index: number): ProjectSource {
  const evidence = (Array.isArray(sg.evidence) ? sg.evidence : []).slice(0, EVIDENCE_LINES).map((e) => ({
    label: String(e.source ?? "").replace(/（.*?）/g, "").trim() || "榜单",
    title: clip(e.phrase, 60),
    url: e.url ?? null,
    numbers: numbersOf(e.stats as StatsLike, e.heat ?? null, e.heatLabel ?? null),
    thumbnail: e.thumbnail ?? null,
  }));
  return {
    kind: "digest",
    label: "晨报信号",
    url: evidence[0]?.url ?? null,
    key: `signal:${date}:${index}`,
    signal: { date, index },
    why: cleanCodes(sg.whyNow) || null,
    hook: cleanCodes(sg.hook) || null,
    angle: cleanCodes(sg.angle) || null,
    format: cleanCodes(sg.format) || null,
    risk: cleanCodes(sg.risk) || null,
    shots: Array.isArray(sg.shots) ? (sg.shots as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 6) : [],
    strength: typeof sg.strength === "number" ? Math.max(1, Math.min(5, Math.round(sg.strength))) : null,
    evidence,
  };
}

/** A watched or backlog topic, with the headlines collected for it. */
export type TopicLike = { id: string; name: string; summary?: string | null; angles?: string[] | null; heat?: number | null; change14d?: number | null; flagged?: boolean; flagReason?: string | null };
export type ArticleLike = { title: string; url: string; domain: string; at: string };

export function fromTopicRow(topic: TopicLike, articles: ArticleLike[]): ProjectSource {
  const angles = (topic.angles ?? []).filter(Boolean);
  return {
    kind: "backlog",
    label: "选题储备",
    key: `topic:${topic.id}`,
    topicId: topic.id,
    why: clip(topic.summary, 240) || null,
    angle: angles[0] ?? null,
    risk: topic.flagged ? topic.flagReason || "已标记为敏感" : null,
    evidence: articles.slice(0, EVIDENCE_LINES).map((a) => ({ label: a.domain, title: clip(a.title, 60), url: a.url, numbers: String(a.at ?? "").slice(0, 10) })),
  };
}

/** A row of a stored hot list, with 研究员's mark on it when there is one. */
export type HotRowLike = { phrase: string; url?: string | null; thumbnail?: string | null; extra?: string | null; heat?: number | null; heatLabel?: string | null; stats?: StatsLike };

export function fromHotRow(row: HotRowLike, platform: string, platformName: string, judgedWhy?: string | null): ProjectSource {
  return {
    kind: "hot",
    label: `${platformName}热榜`,
    url: row.url ?? null,
    key: `hot:${platform}:${row.phrase.slice(0, 120)}`,
    why: judgedWhy ? clip(judgedWhy, 240) : null,
    evidence: [{ label: platformName, title: clip(row.phrase, 60), url: row.url ?? null, numbers: numbersOf(row.stats, row.heat ?? null, row.heatLabel ?? null), thumbnail: row.thumbnail ?? null }],
  };
}

/** One of Home's ideas (`lib/ideas/types.ts`), structurally. */
export type IdeaLike = { id: string; title: string; titles?: string[]; angle: string | null; why: string | null; hook: string | null; format: string | null; strength: number | null; evidence: SourceEvidence[] };

export function fromIdea(idea: IdeaLike): ProjectSource {
  return {
    kind: "idea",
    label: "研究员的选题灵感",
    url: idea.evidence[0]?.url ?? null,
    key: `idea:${idea.id}`,
    ideaId: idea.id,
    why: idea.why,
    hook: idea.hook,
    angle: idea.angle,
    format: idea.format,
    strength: idea.strength,
    titles: (idea.titles ?? []).filter((x) => x && x !== idea.title).slice(0, 3),
    evidence: idea.evidence.slice(0, EVIDENCE_LINES).map((e) => ({ label: e.label, title: clip(e.title, 60), url: e.url, numbers: e.numbers, thumbnail: e.thumbnail ?? null })),
  };
}

/* ------------------------------------------------------------- reading */

/**
 * The project's brief, in words a person would write: why now, the opening
 * line, the angle. Never the chat command a button used to type.
 */
export function briefText(s: ProjectSource | null | undefined, title?: string): string {
  if (!s) return title ?? "";
  const lines = [
    s.why ? cleanCodes(s.why) : "",
    s.hook ? `开头：「${cleanCodes(s.hook)}」` : "",
    s.angle ? `角度：${cleanCodes(s.angle)}` : "",
    s.format ? `格式：${cleanCodes(s.format)}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n").slice(0, 1000) : (title ?? s.label ?? "");
}

/** One line per piece of evidence, for a person or a prompt. */
export function evidenceLine(e: SourceEvidence): string {
  return `${e.label} · 「${e.title}」${e.numbers ? ` · ${e.numbers}` : ""}`;
}

/**
 * What the writer is handed as facts (`draftFromBrief({ sources })`): why,
 * the hook to open on, the angle, the risk to avoid, and the evidence rows
 * with their own numbers. Capped (about five lines, 600 characters) so a
 * brief with ten rows cannot crowd the prompt.
 */
export function draftSources(s: ProjectSource | null | undefined): string {
  if (!s) return "";
  const head = [
    s.why ? `为什么现在做：${cleanCodes(s.why)}` : "",
    s.hook ? `建议开头：「${cleanCodes(s.hook)}」` : "",
    s.angle ? `角度：${cleanCodes(s.angle)}` : "",
    s.risk ? `注意：${cleanCodes(s.risk)}` : "",
  ].filter(Boolean);
  const rows = (s.evidence ?? []).slice(0, EVIDENCE_LINES).map((e) => `- ${evidenceLine(e)}${e.url ? ` (${e.url.slice(0, 80)})` : ""}`);
  const out: string[] = [];
  let used = 0;
  for (const line of [...head, ...(rows.length ? ["证据（平台自己的数字）："] : []), ...rows]) {
    if (used + line.length > SOURCES_CHARS && out.length) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

/**
 * The few lines the project chat's description carries about the topic:
 * the hook and at most three evidence one-liners. Read with every question
 * an employee is asked in the room, so it stays short.
 */
export function channelNote(s: ProjectSource | null | undefined, brief?: string | null): string {
  const why = cleanCodes(s?.why ?? brief ?? "").split("\n")[0] ?? "";
  const parts = [
    why ? `起因：${clip(why, 120)}` : "",
    s?.hook ? `开头：「${clip(cleanCodes(s.hook), 60)}」` : "",
    ...(s?.evidence ?? []).slice(0, 3).map((e) => `证据：${clip(evidenceLine(e), 80)}`),
  ].filter(Boolean);
  return parts.join("；");
}

/** A draft counts as "being written" for this long after it was started. */
export const WRITING_TTL_MS = 10 * 60_000;

/** Whether a snapshot says a draft is being written right now (server-side: uses the clock). */
export function isWriting(s: ProjectSource | null | undefined, now: number): boolean {
  const at = s?.writing?.at ? Date.parse(s.writing.at) : NaN;
  return Number.isFinite(at) && now - at < WRITING_TTL_MS;
}

/**
 * What a signal's "format" says about the script: "竖版 90 秒" is a 9:16
 * script of about ninety seconds, "横版 3 分钟" a 16:9 one of three minutes.
 * Only what the words say; anything else is left to the brief.
 */
export function formatHints(format: string | null | undefined): { aspect: string | null; seconds: number | null } {
  const f = String(format ?? "");
  const aspect = /竖|9\s*[:：]\s*16|short|reel|抖音|视频号/i.test(f) ? "9:16" : /横|16\s*[:：]\s*9/.test(f) ? "16:9" : null;
  const min = f.match(/(\d+(?:\.\d+)?)\s*分钟/);
  const sec = f.match(/(\d+)\s*秒/);
  const seconds = min ? Math.round(Number(min[1]) * 60) + (sec ? Number(sec[1]) : 0) : sec ? Number(sec[1]) : null;
  return { aspect, seconds: seconds && seconds >= 15 && seconds <= 3600 ? seconds : null };
}

/**
 * A topic picker's choice id, as `/api/projects/[id]/choices` writes it,
 * back into a pointer: "signal:<date>:<n>", "topic:<id>", "idea:<id>",
 * "own:<text>".
 */
export function refFromChoice(id: string): TopicRef | null {
  const m = String(id ?? "").match(/^(signal|topic|idea|own):(.+)$/);
  if (!m) return null;
  if (m[1] === "signal") {
    const s = m[2].match(/^(\d{4}-\d{2}-\d{2}):(\d+)$/);
    return s ? { kind: "signal", date: s[1], index: Number(s[2]) } : null;
  }
  if (m[1] === "topic") return { kind: "topic", id: m[2] };
  if (m[1] === "idea") return { kind: "idea", id: m[2] };
  return { kind: "own", text: m[2] };
}
