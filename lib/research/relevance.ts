import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { creatorVoiceText } from "@/lib/creator/service";
import type { HotRow, PlatformKey, Relevance, RelevanceMap } from "@/lib/research/platform-catalog";

/**
 * Which rows of a hot list are business or tech, marked once at collection.
 *
 * The client's words: "for the research, keep it related to business and
 * tech, now there is still a bit too many noise". Reading every row of the
 * stored lists by hand found about one in sixteen on the beat. Nothing in
 * the pipeline removed the rest, and the lists that sound on-topic are not:
 * 抖音's 财经 and 科技 billboards filter by the *account's* category, so the
 * "finance" list led with "我有超长纯金条" and a run of 兔八哥 jokes that
 * borrow trading words ("A3可以适当提高exposure").
 *
 * So each row gets a mark (`Relevance`: biz · tech · other, and 0-3 for how
 * squarely), stored with the list in `hot_snapshots.relevance`, and every
 * reader filters on it without asking a model again. Three sources, cheapest
 * first:
 *
 *   1. Rules. 抖音's rising list carries the platform's own topic tag on each
 *      row; 财经 and 科技 are taken at their word, and 娱乐, 旅行, 美食 and
 *      the like are other. Free.
 *   2. The last list's marks, by phrase. The lists barely move hour to hour
 *      (the billboards change a handful of rows a day), so most rows were
 *      already marked an hour ago.
 *   3. The utility model, for what is left, in batches, at temperature 0,
 *      with the definitions and real rows as examples.
 *
 * Failing is allowed to cost the filter and nothing else: if the model
 * leaves more than a quarter of a list unmarked, the whole list gets `null`
 * and every screen shows it unfiltered. Hiding a list because a classifier
 * was down would be worse than the noise. (A few rows no model would mark
 * are only left out of the filtered view, and asked again next hour.)
 */

export type ClassifyResult = {
  relevance: RelevanceMap | null;
  /** Where the marks came from, for the collector's log line. */
  counts: { rules: number; reused: number; model: number; missing: number };
};

type Usage = Awaited<ReturnType<typeof complete>>;

/** The rising list's own tags that are plainly not the beat. */
const RISING_OTHER = new Set([
  "娱乐",
  "站内玩法",
  "旅行",
  "话题互动",
  "美食",
  "体育",
  "时尚",
  "二次元",
  "游戏",
  "才艺",
  "剧情",
  "动物萌宠",
  "萌宠",
  "亲子",
  "校园",
  "音乐",
  "舞蹈",
  "搞笑",
  "情感",
  "明星",
]);

/** A row the rules can decide, or null for the model. */
function byRule(platform: PlatformKey, row: HotRow): Relevance | null {
  if (platform !== "dy_rising") return null;
  const tag = (row.extra ?? "").trim();
  if (tag === "财经") return { t: "biz", s: 2 };
  if (tag === "科技") return { t: "tech", s: 2 };
  if (RISING_OTHER.has(tag)) return { t: "other", s: 0 };
  /* 社会, 时政, 汽车, 交通, 军事, 文化教育 hold both kinds ("中秋月饼市场风向变了",
     "深蓝汽车官宣接入豆包大模型" next to a rescue story), so they are read. */
  return null;
}

/** What the second line of a row is, per list, so the model reads it right. */
function hintFor(platform: PlatformKey, row: HotRow): string {
  const extra = (row.extra ?? "").trim();
  if (!extra) return "";
  switch (platform) {
    case "google":
      return `新闻：${extra.replace(/^[A-Z]{2} · /, "")}`;
    case "youtube":
      return `频道：${extra}`;
    case "dy_breakout":
      // The appended 财经/科技 is the account's category, not the video's.
      return `账号：${extra.replace(/ · (财经|科技)$/, "")}`;
    case "dy_finance":
    case "dy_tech":
      return `账号：${extra}`;
    case "dy_rising":
      return `抖音分类：${extra}`;
    case "tiktok":
      return `账号与标签：${extra}`;
    default:
      // 抖音热搜's "1 条视频在讨论" and 小红书's "Hot" say nothing about the topic.
      return "";
  }
}

const NAMES: Partial<Record<PlatformKey, string>> = {
  google: "Google 香港热搜",
  youtube: "YouTube 香港热门",
  dy_breakout: "抖音低粉爆款",
  dy_finance: "抖音财经榜（按账号类目）",
  dy_tech: "抖音科技榜（按账号类目）",
  dy_rising: "抖音上升热点",
  douyin: "抖音热搜",
  xiaohongshu: "小红书创作灵感",
  weibo: "微博热搜",
  bilibili: "B站热搜",
  tiktok: "TikTok 推荐",
};

function prompt(platform: PlatformKey, lines: string[], pillars: string[]): string {
  return [
    "你是一家香港财经科技自媒体工作室的研究员。任务：给下面热榜的每一条分类，判断它说的是不是「财经/商业」或「科技」话题。",
    pillars.length ? `频道做过、观众认可的方向（只作参考，判断仍按下面的定义）：${pillars.join("、")}` : "",
    "",
    "定义：",
    "- biz（财经/商业）：宏观经济与政策对经济的影响、央行与利率汇率、股市楼市、黄金作为投资、油价等大宗商品价格、公司经营与商业模式、品牌与消费趋势、创业融资、投资理财、就业与薪资、贸易与关税。",
    "- tech（科技）：AI 与大模型、芯片半导体、互联网平台与 App 功能、移动支付与金融科技（包括现金、支付方式的变化）、手机电脑等消费电子新品、机器人与自动化、新能源车与智能驾驶、航天与科研突破、Web3 与加密货币。",
    "- other：娱乐明星、影视综艺、音乐演唱会、体育赛事、节日祝福、美食旅行、萌宠、段子玩梗、情感生活、游戏、一般社会新闻。时政外交也算 other，除非条目本身直接说到市场、贸易、关税、制裁或科技。",
    "",
    "打分 s：3 = 频道今天就能拍的财经科技硬话题（政策、价格、公司、产品的实际变化）；2 = 明确是财经或科技话题；1 = 只是沾边（元首会谈可能影响贸易、企业家的私生活、生活视频里出现了新手机）；0 = 无关，t 必须是 other。",
    "",
    "注意：",
    "- 只看条目本身在说什么，不看账号名、不看它在哪个榜。抖音的「财经」「科技」榜是按账号类目收的，里面大量是段子。",
    "- 借用金融或科技词汇玩梗、晒东西、炫富的，不算（如「我有超长纯金条」「A3可以适当提高exposure」）。",
    "- 只有账号名、看不出内容的（「某某 的视频」「哇哦」「拿下」），算 other 0。",
    "- tag 用 2 到 4 个字说是哪一块，例如：宏观、央行、股市、楼市、黄金、能源、消费、零售、公司、创业、就业、贸易、AI、芯片、手机、互联网、机器人、自动化、汽车、航天、加密。other 不写 tag。",
    "",
    "例子：",
    '都有超长蛋挞是吧？我有超长纯金条 ｜账号：二十 → {"t":"other","s":0}',
    'A3可以适当提高exposure,但别急着满仓，先把A3沉淀稳，好吗。 ｜账号：兔八哥 → {"t":"other","s":0}',
    '今晚24时油价上调 国家对成品油价格实施调控 少涨约52% ｜账号：央广网 → {"t":"biz","s":3,"tag":"能源"}',
    '捡快递的工种都快不用人了 → {"t":"tech","s":2,"tag":"自动化"}',
    '台积电明年1月晶圆代工或再涨价 → {"t":"tech","s":3,"tag":"芯片"}',
    '中美元首会谈 → {"t":"biz","s":1,"tag":"贸易"}',
    '中秋消费新风向 → {"t":"biz","s":2,"tag":"消费"}',
    '陈妤颉亚运会百米夺冠 → {"t":"other","s":0}',
    '马斯克的家人究竟有多奇葩 → {"t":"other","s":0}',
    '你怎么跟我比，我出场自带bgm ｜账号：我不说 → {"t":"other","s":0}',
    "",
    '输出一个 JSON 数组，每一条都要有、按序号：[{"n":1,"t":"other","s":0},{"n":2,"t":"biz","s":3,"tag":"能源"}]。只输出 JSON，不要解释。',
    "",
    `# ${NAMES[platform] ?? platform}`,
    ...lines,
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
}

/**
 * The model's answer, read one object at a time.
 *
 * Not `JSON.parse` on the whole array: a long answer cut off at the token
 * limit, or one stray comma, would lose every mark in it. Each `{…}` stands
 * on its own, so a truncated answer still yields the rows it got through.
 */
export function parseMarks(text: string, size: number): Map<number, Relevance> {
  const out = new Map<number, Relevance>();
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  for (const m of body.matchAll(/\{[^{}]*\}/g)) {
    let item: { n?: unknown; t?: unknown; s?: unknown; tag?: unknown };
    try {
      item = JSON.parse(m[0]) as typeof item;
    } catch {
      continue;
    }
    const n = Number(item.n);
    if (!Number.isInteger(n) || n < 1 || n > size || out.has(n)) continue;
    const t = item.t === "biz" || item.t === "tech" || item.t === "other" ? item.t : null;
    if (!t) continue;
    const s = Math.max(0, Math.min(3, Math.round(Number(item.s) || 0))) as Relevance["s"];
    /* "other" is 0 whatever score came with it, and a business or tech mark
       at 0 is a contradiction the model resolves as "not the beat". */
    if (t === "other" || s === 0) {
      out.set(n, { t: "other", s: 0 });
      continue;
    }
    const raw = typeof item.tag === "string" ? item.tag.trim().replace(/["“”「」]/g, "").slice(0, 6) : "";
    // "科技 · 科技" says nothing twice; a tag that only names the type is dropped.
    const tag = /^(财经|商业|科技|biz|tech|business)$/i.test(raw) ? "" : raw;
    out.set(n, tag ? { t, s, tag } : { t, s });
  }
  return out;
}

const BATCH = 50;

/** One batch through the model chain. Null when no model would mark it. */
async function markBatch(
  platform: PlatformKey,
  rows: HotRow[],
  pillars: string[],
  onUsage?: (res: Usage) => Promise<void> | void,
): Promise<Map<number, Relevance> | null> {
  const lines = rows.map((r, i) => {
    const hint = hintFor(platform, r);
    return `${i + 1}. ${r.phrase.replace(/\s+/g, " ").slice(0, 90)}${hint ? ` ｜${hint.slice(0, 40)}` : ""}`;
  });
  const content = prompt(platform, lines, pillars);
  const chain = [...new Set([modelFor.utility(), modelFor.assistant()])];
  for (const model of chain) {
    try {
      const res = await complete({ model, messages: [{ role: "user", content }], temperature: 0, maxTokens: 4000 });
      await onUsage?.(res);
      const marks = parseMarks(res.text, rows.length);
      /* An answer that covers most of the batch is kept; the rows it skipped
         are asked again on their own below. One that covers little is a
         refusal or a derailment, and the next model gets the batch. */
      if (marks.size >= Math.ceil(rows.length * 0.6)) return marks;
      console.error(`[research] relevance for ${platform} by ${model}: ${marks.size}/${rows.length} rows marked`);
    } catch (err) {
      console.error(`[research] relevance for ${platform} by ${model}`, err);
    }
  }
  return null;
}

/**
 * Mark every row of a list, or return null to show it unfiltered.
 *
 * `prev` is any earlier map (the platform's last list, plus whatever this
 * collection run already marked on other lists); a phrase found there is
 * not asked again. `pillars` are the channel's own subjects
 * (`channelFocus`), given to the model as context.
 */
export async function classifyHot(
  platform: PlatformKey,
  rows: HotRow[],
  opts: { prev?: RelevanceMap | null; pillars?: string[]; onUsage?: (res: Usage) => Promise<void> | void } = {},
): Promise<ClassifyResult> {
  const counts = { rules: 0, reused: 0, model: 0, missing: 0 };
  if (!rows.length) return { relevance: null, counts };

  const map: RelevanceMap = {};
  const ask: HotRow[] = [];
  for (const row of rows) {
    if (map[row.phrase] || ask.some((r) => r.phrase === row.phrase)) continue;
    const rule = byRule(platform, row);
    if (rule) {
      map[row.phrase] = rule;
      counts.rules++;
      continue;
    }
    const known = opts.prev?.[row.phrase];
    if (known && (known.t === "biz" || known.t === "tech" || known.t === "other")) {
      map[row.phrase] = known;
      counts.reused++;
      continue;
    }
    ask.push(row);
  }

  const pillars = opts.pillars ?? [];
  /*
   * How many rows may stay unmarked before the list is shown unfiltered
   * instead: a quarter of it. Most hours only a handful of new rows go to
   * the model, and when those are the ones a model will not touch (a summit
   * on 微博 trips some filters) they stay unmarked — out of the filtered
   * view, asked again next hour — rather than costing the eighty rows that
   * kept their marks from the last list. A model that is down, with the
   * whole list to mark, is past the quarter at the first batch.
   */
  const tolerance = Math.floor((Object.keys(map).length + ask.length) / 4);
  const failed: HotRow[] = [];
  let pending = ask;
  /* Two passes: the whole remainder in batches, then once more for any row
     the first answer skipped. A batch no model would mark is not asked
     twice. */
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const skipped: HotRow[] = [];
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const marks = await markBatch(platform, batch, pillars, opts.onUsage);
      if (!marks) {
        failed.push(...batch);
        // Better the whole list unfiltered than a good part of it hidden.
        if (failed.length > tolerance) return { relevance: null, counts: { ...counts, missing: failed.length } };
        continue;
      }
      batch.forEach((row, k) => {
        const mark = marks.get(k + 1);
        if (mark) {
          map[row.phrase] = mark;
          counts.model++;
        } else skipped.push(row);
      });
    }
    pending = skipped;
  }
  counts.missing = pending.length + failed.length;
  if (counts.missing > tolerance) return { relevance: null, counts };
  return { relevance: Object.keys(map).length ? map : null, counts };
}

/* ------------------------------------------------------ the channel's beat */

/** What the morning brief listed before the channel's own note existed. */
export const FOCUS_FALLBACK = ["香港机会", "Web3 与 AI", "投资与职涯", "财经科技", "人物对话"];

/**
 * The subjects under `## Subjects` in a creator-voice note.
 *
 * The note is Markdown written by `renderVoice` (lib/creator/service.ts) and
 * editable in Admin → Knowledge, so this reads it loosely: the heading in
 * English or Chinese, list items with - or *, and stops at the next heading.
 */
export function subjectsFrom(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s*(subjects|题材|主题|选题方向)\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const m = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (m) out.push(m[1].trim().slice(0, 40));
  }
  return out.filter(Boolean).slice(0, 8);
}

const FOCUS_TTL_MS = 10 * 60_000;
const focusMemo = new Map<string, { at: number; pillars: string[] }>();

/**
 * The channel's own subjects, from its creator-voice note.
 *
 * The morning brief used to carry them typed into its prompt ("香港机会、
 * Web3 与 AI…"); the note is written from the channel's uploads and kept
 * current by the creator sync, so it is the better source. The hardcoded
 * list stays as the fallback for a studio with no note, or one switched off.
 */
export async function channelFocus(tenantId: string): Promise<string[]> {
  const hit = focusMemo.get(tenantId);
  if (hit && Date.now() - hit.at < FOCUS_TTL_MS) return hit.pillars;
  let pillars = FOCUS_FALLBACK;
  try {
    const found = subjectsFrom(await creatorVoiceText(tenantId));
    if (found.length) pillars = found;
  } catch (err) {
    console.error("[research] channel focus", err);
  }
  focusMemo.set(tenantId, { at: Date.now(), pillars });
  return pillars;
}
