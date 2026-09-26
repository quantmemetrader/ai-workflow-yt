import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { creatorVoiceText } from "@/lib/creator/service";
import type { HotRow, ListKey, Relevance, RelevanceMap } from "@/lib/research/platform-catalog";
import { BEAT_WORDS, DEFAULT_BEATS, activeBeats, beatsSignature, isDefaultBeat, type BeatConfig, type DefaultBeat } from "@/lib/research/beats";

/**
 * Which rows of a list are on the studio's beats (by default AI, crypto,
 * tech, business; the studio's own list since it became editable), marked
 * once at collection.
 *
 * Two kinds of list come through here. The platforms' own hot lists, read
 * hourly, where most rows are off the beat and the mark is the filter; and
 * the beat feeds (`lib/research/beat-feeds.ts`), which were searched for the
 * beats in the first place, where the mark catches what a search word
 * dragged in (an AI-drawn cat found by "AI", a cartoon found by "bitcoin")
 * and names the beat for the screen's chips.
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
 * The beats sorted into are the studio's own (`lib/research/beats.ts`): the
 * prompt lists each beat switched on, the four defaults with their written
 * definitions and a beat the studio added by its name and words, and a mark
 * is one of those keys or other. Each mark remembers which beats it was made
 * against (`Relevance.v`), so after a beat is added or switched off the rows
 * are asked once more rather than keeping a mark from before (a row marked
 * 商业 before there was a 港股 beat). Rows stored before keep their keys.
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

/**
 * B站's own sections that are never the beat, whatever the title says: an
 * AI-made short drama is filed under 影视, a game made with AI under 游戏.
 * The section is the second half of a B站 beat row's second line.
 */
const BILI_OTHER = /(影视|剧集|电影|动画|番剧|国创|综艺|游戏|电竞|音乐|舞蹈|鬼畜|仿妆|cos|萌宠|动物|美食|搞笑|明星|情感|亲子|运动|足球|篮球|健身|旅游|出行|时尚|美妆|手工|绘画|VLOG)/i;

/** A row the rules can decide, or null for the model. `keys` are the beats
 *  switched on: a rule only files into a beat the studio has. */
function byRule(platform: ListKey, row: HotRow, keys: ReadonlySet<string>): Relevance | null {
  // The coin market list is crypto by construction.
  if (platform === "beat_crypto") return keys.has("crypto") ? { t: "crypto", s: 2, tag: "行情" } : null;
  if (platform === "beat_bilibili") {
    const section = (row.extra ?? "").split(" · ").pop() ?? "";
    return section && BILI_OTHER.test(section) ? { t: "other", s: 0 } : null;
  }
  if (platform !== "dy_rising") return null;
  const tag = (row.extra ?? "").trim();
  if (tag === "财经" && keys.has("biz")) return { t: "biz", s: 2 };
  if (tag === "科技" && keys.has("tech")) return { t: "tech", s: 2 };
  if (RISING_OTHER.has(tag)) return { t: "other", s: 0 };
  /* 社会, 时政, 汽车, 交通, 军事, 文化教育 hold both kinds ("中秋月饼市场风向变了",
     "深蓝汽车官宣接入豆包大模型" next to a rescue story), so they are read. */
  return null;
}

/** What the second line of a row is, per list, so the model reads it right. */
function hintFor(platform: ListKey, row: HotRow): string {
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
    case "beat_bilibili":
      return `UP主与分区：${extra}`;
    case "beat_news":
      return `媒体：${extra}`;
    case "beat_douyin":
    case "beat_tiktok":
    case "beat_xiaohongshu":
    case "beat_weibo":
    case "beat_youtube":
      return `账号：${extra}`;
    default:
      // 抖音热搜's "1 条视频在讨论" and 小红书's "Hot" say nothing about the topic.
      return "";
  }
}

const NAMES: Partial<Record<ListKey, string>> = {
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
  beat_douyin: "抖音赛道搜索（按关键词找到的热门视频）",
  beat_xiaohongshu: "小红书赛道搜索（按关键词找到的热门笔记）",
  beat_weibo: "微博科技热搜与赛道搜索",
  beat_bilibili: "B站赛道搜索（按关键词找到的热门视频）",
  beat_tiktok: "TikTok 赛道搜索（英文关键词）",
  beat_youtube: "YouTube 赛道搜索（近三天播放最多）",
  beat_news: "港台新闻搜索",
};

/** The four defaults as the prompt has always defined them. */
const DEFS: Record<DefaultBeat, { name: string; def: string }> = {
  ai: {
    name: "AI",
    def: "AI 与大模型、AI 产品和工具的发布与用法、AI 公司（OpenAI、DeepSeek、英伟达的 AI 业务等）、智能体、AI 对就业、教育、社会的影响、AI 监管与风险。",
  },
  crypto: { name: "加密", def: "比特币、以太坊等加密货币的行情与事件、交易所、稳定币、Web3、区块链、链上项目、数字资产监管、币圈人物。" },
  tech: { name: "科技", def: "芯片半导体、手机电脑等消费电子新品、互联网平台与 App 功能、移动支付、新能源车与智能驾驶、机器人与自动化、航天与科研突破、通信。" },
  biz: {
    name: "商业财经",
    def: "宏观经济与政策对经济的影响、央行与利率汇率、股市楼市、黄金作为投资、油价等大宗商品、公司经营与商业模式、品牌与消费趋势、创业融资、投资理财、就业与薪资、贸易与关税。",
  },
};

/** Real rows as examples, each with the beat it shows; only the examples
 *  of beats switched on (and other) go into the prompt. */
const EXAMPLES: { t: string; line: string }[] = [
  { t: "other", line: '都有超长蛋挞是吧？我有超长纯金条 ｜账号：二十 → {"t":"other","s":0}' },
  { t: "other", line: 'A3可以适当提高exposure,但别急着满仓，先把A3沉淀稳，好吗。 ｜账号：兔八哥 → {"t":"other","s":0}' },
  { t: "biz", line: '今晚24时油价上调 国家对成品油价格实施调控 少涨约52% ｜账号：央广网 → {"t":"biz","s":3,"tag":"能源"}' },
  { t: "tech", line: '捡快递的工种都快不用人了 → {"t":"tech","s":2,"tag":"自动化"}' },
  { t: "tech", line: '台积电明年1月晶圆代工或再涨价 → {"t":"tech","s":3,"tag":"芯片"}' },
  { t: "ai", line: '小米开源MiMoV2.6大模型 登顶全球开源榜首 → {"t":"ai","s":3,"tag":"大模型"}' },
  { t: "ai", line: '应届生就敢开到三万五 还不用担心被AI取代 → {"t":"ai","s":2,"tag":"AI就业"}' },
  { t: "other", line: '#AI萌猫舞蹈教学 #抖音ai创作 → {"t":"other","s":0}' },
  { t: "crypto", line: '比特币破8.4万美元 创1月以来新高 12.6万人被爆仓 → {"t":"crypto","s":3,"tag":"比特币"}' },
  { t: "other", line: 'Part 1 - The Seal of Bitcoins #animation #storytime #fruits → {"t":"other","s":0}' },
  { t: "other", line: '小米手环听歌教程 → {"t":"other","s":0}' },
  { t: "other", line: '选三筒先看小筒，大容量、高洗净比、健康才实用！ ｜账号：家电天选指南 → {"t":"other","s":0}' },
  { t: "other", line: '厉害的人，都具备什么心态？#强者思维 #投资人 → {"t":"other","s":0}' },
  { t: "biz", line: '中美元首会谈 → {"t":"biz","s":1,"tag":"贸易"}' },
  { t: "biz", line: '中秋消费新风向 → {"t":"biz","s":2,"tag":"消费"}' },
  { t: "other", line: '陈妤颉亚运会百米夺冠 → {"t":"other","s":0}' },
  { t: "other", line: '马斯克的家人究竟有多奇葩 → {"t":"other","s":0}' },
];

/** A beat's line under 定义. */
function definition(b: BeatConfig): string {
  if (isDefaultBeat(b.key)) {
    const d = DEFS[b.key];
    const base = BEAT_WORDS[b.key];
    /* A renamed default keeps its definition under the studio's name; words
       the studio added to it are named so the model files them there. */
    const name = b.zh === DEFAULT_BEATS.find((x) => x.key === b.key)?.zh ? d.name : b.zh;
    const added = b.keywords_zh.filter((w) => !base.zh.includes(w)).concat(b.keywords_en.filter((w) => !base.en.includes(w)));
    return `- ${b.key}（${name}）：${d.def}${added.length ? `也包括：${added.join("、")}。` : ""}`;
  }
  const words = [...b.keywords_zh, ...b.keywords_en];
  return `- ${b.key}（${b.zh}${b.en && b.en !== b.zh ? ` / ${b.en}` : ""}）：工作室自己加的赛道。关键词：${words.join("、")}。条目主要在讲这些关键词代表的话题时选它。`;
}

function prompt(platform: ListKey, lines: string[], pillars: string[], beats: readonly BeatConfig[]): string {
  const active = activeBeats(beats);
  const keys = new Set(active.map((b) => b.key));
  const names = active.map((b) => (isDefaultBeat(b.key) && b.zh === DEFAULT_BEATS.find((x) => x.key === b.key)?.zh ? DEFS[b.key].name : b.zh));
  const custom = active.filter((b) => !isDefaultBeat(b.key));
  const first = active[0]?.key ?? "ai";
  return [
    `你是一家香港财经科技自媒体工作室的研究员。频道只做这 ${active.length} 个赛道：${names.join("、")}。任务：给下面列表的每一条分类，判断它属于哪个赛道，或者都不属于。`,
    pillars.length ? `频道做过、观众认可的方向（只作参考，判断仍按下面的定义）：${pillars.join("、")}` : "",
    "",
    "定义：",
    ...active.map(definition),
    "- other：娱乐明星、影视综艺、音乐、体育、节日祝福、美食旅行、萌宠、段子玩梗、情感生活、游戏、一般社会新闻。时政外交也算 other，除非条目本身直接说到市场、贸易、关税、制裁或科技。",
    "",
    `t 只能是 ${[...keys, "other"].join("、")} 之一。`,
    "",
    "打分 s：3 = 频道今天就能拍的硬话题（政策、价格、公司、产品、模型的实际变化）；2 = 明确属于这个赛道；1 = 只是沾边；0 = 无关，t 必须是 other。",
    "",
    "注意：",
    "- 只看条目本身在说什么，不看账号名、不看它在哪个榜或用什么词搜到的。",
    keys.has("ai") ? "- 用 AI 做出来的娱乐内容不算 AI 赛道：AI 生成的短剧、动画、萌宠、水果故事、恐怖片、翻唱，都是 other。讲 AI 怎么做这些、AI 工具评测、AIGC 行业，才算 ai。" : "",
    "- 借用金融或科技词汇玩梗、晒东西、炫富的，不算（如「我有超长纯金条」「A3可以适当提高exposure」）。以比特币为道具的动画故事也不算 crypto。",
    "- 卖货带货、直播间促销、店铺广告、产品使用教程、选购指南、开箱晒单、职场鸡汤和励志语录，都算 other 0：频道不会拍这些。例外：讲新品发布、价格变化、公司或行业本身的，照常分类（「小米18 这个价格也涨太多了」是 tech）。",
    "- 只有账号名、看不出内容的（「某某 的视频」「哇哦」「拿下」），或者只有话题标签没有内容的（「#apple」「#iphone18 #apple」），算 other 0。",
    keys.has("ai") && keys.has("tech") && keys.has("crypto")
      ? "- 一条同时沾两个赛道时，选它主要在讲的那个（「AI 芯片」是 tech 还是 ai 看重点：讲芯片算 tech，讲模型算 ai；「比特币 ETF 资金流入」算 crypto）。"
      : "- 一条同时沾两个赛道时，选它主要在讲的那个。",
    custom.length
      ? `- 工作室自己加的赛道（${custom.map((b) => b.key).join("、")}）比通用赛道更具体：一条同时符合通用赛道（如商业财经）和自己加的赛道时，选自己加的那个。`
      : "",
    "- tag 用 2 到 4 个字说是哪一块，例如：大模型、AI工具、AI就业、比特币、以太坊、稳定币、交易所、芯片、手机、汽车、机器人、宏观、央行、股市、楼市、能源、消费、公司、创业、就业、贸易。other 不写 tag。",
    "",
    "例子：",
    ...EXAMPLES.filter((e) => e.t === "other" || keys.has(e.t)).map((e) => e.line),
    "",
    `输出一个 JSON 数组，每一条都要有、按序号：[{"n":1,"t":"other","s":0},{"n":2,"t":"${first}","s":3,"tag":"${first === "ai" ? "大模型" : "公司"}"}]。只输出 JSON，不要解释。`,
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
export function parseMarks(text: string, size: number, beats: readonly BeatConfig[] = DEFAULT_BEATS): Map<number, Relevance> {
  /* A beat key the studio has switched on, or other. A model that answers
     with the beat's name ("港股", "HK stocks") is read as its key; a beat
     that is switched off is other (the row is on none of the beats the
     studio follows). Anything else is no answer, and the row is asked again. */
  const active = activeBeats(beats);
  const keyOf = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (t === "other") return "other";
    const is = (b: BeatConfig) => b.key === t || b.zh === t || b.en.toLowerCase() === t.toLowerCase();
    const hit = active.find(is);
    if (hit) return hit.key;
    return beats.some(is) ? "other" : null;
  };
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
    const t = keyOf(item.t);
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
    const own = active.find((b) => b.key === t);
    const tag = /^(财经|商业|科技|加密|ai|crypto|biz|tech|business)$/i.test(raw) || raw === own?.zh || raw === t ? "" : raw;
    out.set(n, tag ? { t, s, tag } : { t, s });
  }
  return out;
}

const BATCH = 50;

/** One batch through the model chain. Null when no model would mark it. */
async function markBatch(
  platform: ListKey,
  rows: HotRow[],
  pillars: string[],
  beats: readonly BeatConfig[],
  onUsage?: (res: Usage) => Promise<void> | void,
): Promise<Map<number, Relevance> | null> {
  const lines = rows.map((r, i) => {
    const hint = hintFor(platform, r);
    return `${i + 1}. ${r.phrase.replace(/\s+/g, " ").slice(0, 90)}${hint ? ` ｜${hint.slice(0, 40)}` : ""}`;
  });
  const content = prompt(platform, lines, pillars, beats);
  const chain = [...new Set([modelFor.utility(), modelFor.assistant()])];
  for (const model of chain) {
    try {
      const res = await complete({ model, messages: [{ role: "user", content }], temperature: 0, maxTokens: 4000 });
      await onUsage?.(res);
      const marks = parseMarks(res.text, rows.length, beats);
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
 * not asked again, as long as it was marked against the same beats
 * (`Relevance.v`). `pillars` are the channel's own subjects
 * (`channelFocus`), given to the model as context. `beats` is the studio's
 * list (`readBeats`); the four defaults when not given.
 */
export async function classifyHot(
  platform: ListKey,
  rows: HotRow[],
  opts: { prev?: RelevanceMap | null; pillars?: string[]; beats?: readonly BeatConfig[]; onUsage?: (res: Usage) => Promise<void> | void } = {},
): Promise<ClassifyResult> {
  const counts = { rules: 0, reused: 0, model: 0, missing: 0 };
  if (!rows.length) return { relevance: null, counts };
  const beats = opts.beats ?? DEFAULT_BEATS;
  const keys = new Set(activeBeats(beats).map((b) => b.key));
  const sig = beatsSignature(beats);
  /* Every mark made here carries the signature, so the next list knows what
     it was made against; with the defaults it is left off, as before. */
  const signed = (m: Relevance): Relevance => (sig ? { ...m, v: sig } : m);

  const map: RelevanceMap = {};
  const ask: HotRow[] = [];
  for (const row of rows) {
    if (map[row.phrase] || ask.some((r) => r.phrase === row.phrase)) continue;
    const rule = byRule(platform, row, keys);
    if (rule) {
      map[row.phrase] = signed(rule);
      counts.rules++;
      continue;
    }
    const known = opts.prev?.[row.phrase];
    if (known && (known.t === "other" || keys.has(known.t)) && (known.v ?? "") === sig) {
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
      const marks = await markBatch(platform, batch, pillars, beats, opts.onUsage);
      if (!marks) {
        failed.push(...batch);
        // Better the whole list unfiltered than a good part of it hidden.
        if (failed.length > tolerance) return { relevance: null, counts: { ...counts, missing: failed.length } };
        continue;
      }
      batch.forEach((row, k) => {
        const mark = marks.get(k + 1);
        if (mark) {
          map[row.phrase] = signed(mark);
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
