/**
 * The studio's beats and the words each platform is searched with, in one
 * place.
 *
 * The owner: "keep it related to business and tech & crypto, AI and stuff".
 * The beat feeds (`lib/research/beat-feeds.ts`) search every platform for
 * these words at the source, instead of reading a platform's whole hot list
 * and hiding most of it on screen, which left tabs of three rows.
 *
 * The list is the studio's own. The owner, on the chips "全部 247 · AI 58 ·
 * 加密 32 · 科技 86 · 商业 71": "let me be able to change this list too". So a
 * studio can add a beat (a name in Chinese and English, a colour, its search
 * words), rename one, change its words, turn it off, reorder the list
 * (Research → 管理赛道, `components/research/BeatsEditor.tsx`). The list is
 * kept in the settings table under `research:beats:<tenantId>`
 * (`lib/research/beat-store.ts`); a studio that never edited it reads
 * `DEFAULT_BEATS`, the four the collector always searched. Their keys (ai,
 * crypto, tech, biz) never change, so rows stored under them stay valid, and
 * a beat's key is fixed once it is made: renaming changes the words on the
 * chip, not the key rows are filed under.
 *
 * Small and high-signal on purpose. A few precise words ("大模型", "比特币",
 * "港股") find what the channel films; a broad one finds everything the word
 * appears in — "AI" on 抖音 is AI-drawn cats and AI short dramas, and on
 * TikTok "bitcoin" is half cartoon fruit. So the sets lean specific, and the
 * classifier still drops what a word dragged in.
 *
 * Coverage grows by rotation, not by spending more. Each run takes the next
 * word of each beat (`planBeatRun`, keyed on the three-hour slot, so it needs
 * no stored state and a rerun of the same slot asks the same questions), and
 * a feed keeps what earlier runs found while it is still recent. Over a day
 * every word is asked about once or twice on every platform for the same
 * number of requests an hour as one word would cost. A studio with more
 * beats pays the same: the searches per run are fixed (`SEARCHES_PER_RUN`)
 * and are shared out among the beats that are switched on, so a fifth beat
 * makes each beat come round a little less often, not the run dearer.
 *
 * Pure data and arithmetic: no fetching, no secrets, safe anywhere (the
 * editor in the browser imports the defaults, the palette and the checks).
 */
import type { Beat } from "@/lib/research/platform-catalog";

export type { Beat } from "@/lib/research/platform-catalog";

/* ------------------------------------------------------------ the list */

/**
 * The tints a beat can be drawn in: a light wash behind, a deeper ink for
 * the words, the same pairs the four beats always used plus four more. The
 * editor offers these and nothing else, so every chip stays in the page's
 * light palette.
 */
export const BEAT_COLORS = [
  { key: "violet", tint: "#f1ecfd", ink: "#6b3fd0", zh: "紫", en: "Violet" },
  { key: "amber", tint: "#fdf5dc", ink: "#8a6400", zh: "琥珀", en: "Amber" },
  { key: "blue", tint: "#e8f0fc", ink: "#0f5bd5", zh: "蓝", en: "Blue" },
  { key: "orange", tint: "#fbefe3", ink: "#9a5b13", zh: "橙", en: "Orange" },
  { key: "green", tint: "#e6f4ec", ink: "#0b7a63", zh: "绿", en: "Green" },
  { key: "teal", tint: "#e2f3f5", ink: "#0e7285", zh: "青", en: "Teal" },
  { key: "rose", tint: "#fdecef", ink: "#b4234b", zh: "玫红", en: "Rose" },
  { key: "slate", tint: "#eef0f3", ink: "#475467", zh: "灰蓝", en: "Slate" },
] as const;
export type BeatColor = (typeof BEAT_COLORS)[number]["key"];
const isColor = (v: unknown): v is BeatColor => BEAT_COLORS.some((c) => c.key === v);

/** A colour's wash and ink; an unknown one is the page's neutral grey. */
export function beatColor(color: string | null | undefined): { tint: string; ink: string } {
  const c = BEAT_COLORS.find((x) => x.key === color);
  return c ? { tint: c.tint, ink: c.ink } : { tint: "#f3f3f1", ink: "#383838" };
}

/**
 * One beat as the studio configured it.
 *
 *   key          fixed once made; what rows are stored under (`HotRow.beat`,
 *                `Relevance.t`). The four defaults are ai, crypto, tech, biz.
 *   zh, en       the chip's name in each language
 *   keywords_zh  searched on 抖音, 小红书, B站 and 微博 (and, in Traditional
 *                form, on Google News Hong Kong and Taiwan)
 *   keywords_en  searched on TikTok and on YouTube in English
 *   enabled      off: not searched, not classified into, no chip. Rows stored
 *                under it stay in the database and come back if it is
 *                switched on again.
 */
export type BeatConfig = {
  key: string;
  zh: string;
  en: string;
  color: BeatColor;
  keywords_zh: string[];
  keywords_en: string[];
  enabled: boolean;
};

export const DEFAULT_KEYS = ["ai", "crypto", "tech", "biz"] as const;
export type DefaultBeat = (typeof DEFAULT_KEYS)[number];
export const isDefaultBeat = (v: unknown): v is DefaultBeat => typeof v === "string" && (DEFAULT_KEYS as readonly string[]).includes(v);

/**
 * The default words, per beat, per language.
 *
 *   zh  simplified, for 抖音, 小红书, B站 and 微博 search
 *   hk  traditional, for Google News in Hong Kong and Taiwan (its index is
 *       in traditional characters; 比特币 finds less there than 比特幣).
 *       Hand-picked for the four defaults, with the region's own words
 *       (晶片, 機械人, 虛擬資產); a beat the studio adds gets its Chinese
 *       words turned into Traditional instead (`lib/research/traditional.ts`)
 *   en  for TikTok and YouTube, whose beat content is mostly English
 *
 * Order matters a little: the rotation starts at the top, so the word most
 * likely to find the day's story comes first.
 */
export const BEAT_WORDS: Record<DefaultBeat, { zh: string[]; hk: string[]; en: string[] }> = {
  ai: {
    zh: ["大模型", "人工智能", "AI工具", "ChatGPT", "DeepSeek", "AI就业", "智能体", "OpenAI", "AI失业", "英伟达"],
    hk: ["人工智能", "AI", "大模型", "ChatGPT", "OpenAI", "DeepSeek"],
    en: ["AI news", "ChatGPT", "OpenAI", "AI jobs", "AI agent", "Nvidia", "AI tools"],
  },
  crypto: {
    zh: ["比特币", "以太坊", "加密货币", "币圈", "稳定币", "Web3", "区块链", "虚拟货币"],
    hk: ["比特幣", "以太坊", "加密貨幣", "虛擬資產", "穩定幣", "Web3"],
    en: ["bitcoin", "crypto news", "ethereum", "stablecoin", "crypto market", "solana"],
  },
  tech: {
    zh: ["芯片", "华为", "苹果", "小米", "新能源车", "机器人", "手机", "科技"],
    hk: ["晶片", "科技", "手機", "電動車", "機械人", "蘋果"],
    en: ["tech news", "iPhone 18", "Tesla", "humanoid robot", "semiconductor", "Apple"],
  },
  biz: {
    zh: ["创业", "财经", "经济", "美股", "港股", "A股", "楼市", "理财", "投资", "工资"],
    hk: ["財經", "經濟", "港股", "美股", "樓市", "創業"],
    en: ["stock market", "business news", "startup", "economy", "investing", "Wall Street"],
  },
};

/** The four the collector always searched, and what a studio that never
 *  edited its list reads. */
export const DEFAULT_BEATS: readonly BeatConfig[] = [
  { key: "ai", zh: "AI", en: "AI", color: "violet", keywords_zh: BEAT_WORDS.ai.zh, keywords_en: BEAT_WORDS.ai.en, enabled: true },
  { key: "crypto", zh: "加密", en: "Crypto", color: "amber", keywords_zh: BEAT_WORDS.crypto.zh, keywords_en: BEAT_WORDS.crypto.en, enabled: true },
  { key: "tech", zh: "科技", en: "Tech", color: "blue", keywords_zh: BEAT_WORDS.tech.zh, keywords_en: BEAT_WORDS.tech.en, enabled: true },
  { key: "biz", zh: "商业", en: "Business", color: "orange", keywords_zh: BEAT_WORDS.biz.zh, keywords_en: BEAT_WORDS.biz.en, enabled: true },
];

/** The default order, for the readers that only know the four. */
export const BEAT_ORDER: readonly Beat[] = DEFAULT_KEYS;

/**
 * How far the list may go. Eight beats keep the chips on one line and each
 * beat still searched on every platform within a day at the fixed number of
 * searches per run; three words is the least a rotation can rotate over,
 * twenty the most a day of runs gets round to.
 */
export const BEAT_LIMITS = { beats: 8, keywordsMin: 3, keywordsMax: 20, keywordLen: 24, zhName: 8, enName: 20 } as const;

/** A beat key: short, lower-case Latin, so it is safe as a JSON key, a URL
 *  parameter and a model's answer. "all" and "other" mean something else. */
export const BEAT_KEY_RE = /^[a-z][a-z0-9]{1,15}$/;
const RESERVED = new Set(["all", "other", "none", "focus"]);

/**
 * A key for a new beat, from its English name ("HK stocks" → "hkstocks"),
 * or a short made-up one when the name has no Latin letters or the key is
 * taken. Made once, when the beat is added; never changed after.
 */
export function makeBeatKey(en: string, taken: readonly string[]): string {
  const slug = en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 12);
  if (BEAT_KEY_RE.test(slug) && !RESERVED.has(slug) && !taken.includes(slug)) return slug;
  for (let n = 1; ; n++) {
    const k = `${slug && BEAT_KEY_RE.test(slug) ? slug.slice(0, 10) : "beat"}${n}`;
    if (!taken.includes(k) && !RESERVED.has(k)) return k;
  }
}

/** The beats that are switched on, in the studio's order. */
export const activeBeats = (beats: readonly BeatConfig[]): BeatConfig[] => beats.filter((b) => b.enabled);

/**
 * What a set of marks was made against: the keys switched on. Marks carry it
 * (`Relevance.v`) so a mark made before a beat was added or switched off is
 * asked again rather than reused — a row marked 商业 before there was a 港股
 * beat may be 港股 now. The four defaults sign as "" so every mark stored
 * before beats were editable stays valid for a studio that never edits.
 * Changing a beat's words does not change it: the beat is the same subject.
 */
export function beatsSignature(beats: readonly BeatConfig[]): string {
  const keys = activeBeats(beats)
    .map((b) => b.key)
    .sort()
    .join(",");
  return keys === [...DEFAULT_KEYS].sort().join(",") ? "" : keys;
}

const chars = (s: string) => Array.from(s).length;

/**
 * A list as sent by the editor (or read back from storage), checked and
 * cleaned: names trimmed, words de-duplicated, sizes within `BEAT_LIMITS`.
 * The error is in both languages; the editor shows the one the page is in.
 */
export function normalizeBeats(input: unknown): { beats: BeatConfig[] } | { error: string; errorEn: string } {
  const fail = (zh: string, en: string) => ({ error: zh, errorEn: en });
  if (!Array.isArray(input) || input.length === 0) return fail("赛道列表是空的。", "The list of beats is empty.");
  if (input.length > BEAT_LIMITS.beats) return fail(`最多 ${BEAT_LIMITS.beats} 个赛道。`, `At most ${BEAT_LIMITS.beats} beats.`);
  const out: BeatConfig[] = [];
  for (const [i, raw] of input.entries()) {
    const b = (raw ?? {}) as Record<string, unknown>;
    const key = typeof b.key === "string" ? b.key.trim() : "";
    if (!BEAT_KEY_RE.test(key) || RESERVED.has(key)) return fail(`第 ${i + 1} 个赛道的标识不对。`, `Beat ${i + 1} has an invalid key.`);
    if (out.some((x) => x.key === key)) return fail(`赛道标识 ${key} 重复了。`, `The key ${key} is used twice.`);
    const zh = typeof b.zh === "string" ? b.zh.replace(/\s+/g, " ").trim() : "";
    const en = (typeof b.en === "string" ? b.en.replace(/\s+/g, " ").trim() : "") || zh;
    if (!zh) return fail(`第 ${i + 1} 个赛道还没有中文名。`, `Beat ${i + 1} needs a Chinese name.`);
    if (chars(zh) > BEAT_LIMITS.zhName) return fail(`「${zh}」太长了，中文名最多 ${BEAT_LIMITS.zhName} 个字。`, `"${zh}" is too long: at most ${BEAT_LIMITS.zhName} characters.`);
    if (chars(en) > BEAT_LIMITS.enName) return fail(`「${en}」太长了，英文名最多 ${BEAT_LIMITS.enName} 个字母。`, `"${en}" is too long: at most ${BEAT_LIMITS.enName} characters.`);
    if (out.some((x) => x.zh.toLowerCase() === zh.toLowerCase())) return fail(`有两个赛道都叫「${zh}」。`, `Two beats are both called "${zh}".`);
    const words = (v: unknown): string[] | null => {
      if (v == null) return [];
      if (!Array.isArray(v)) return null;
      const seen = new Set<string>();
      const list: string[] = [];
      for (const w of v) {
        if (typeof w !== "string") return null;
        const t = w.replace(/\s+/g, " ").trim();
        if (!t) continue;
        if (chars(t) > BEAT_LIMITS.keywordLen) return null;
        if (seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        list.push(t);
      }
      return list;
    };
    const kz = words(b.keywords_zh);
    const ke = words(b.keywords_en);
    if (!kz || !ke) return fail(`「${zh}」的关键词里有太长或不是文字的，每个最多 ${BEAT_LIMITS.keywordLen} 个字。`, `A keyword of "${en}" is too long or not text (at most ${BEAT_LIMITS.keywordLen} characters each).`);
    if (kz.length > BEAT_LIMITS.keywordsMax || ke.length > BEAT_LIMITS.keywordsMax)
      return fail(`「${zh}」的关键词太多了，中文和英文各最多 ${BEAT_LIMITS.keywordsMax} 个。`, `"${en}" has too many keywords: at most ${BEAT_LIMITS.keywordsMax} per language.`);
    if (kz.length + ke.length < BEAT_LIMITS.keywordsMin)
      return fail(`「${zh}」至少要 ${BEAT_LIMITS.keywordsMin} 个关键词（中英文合计），轮换才有得换。`, `"${en}" needs at least ${BEAT_LIMITS.keywordsMin} keywords (both languages together).`);
    out.push({
      key,
      zh,
      en,
      color: isColor(b.color) ? b.color : BEAT_COLORS[i % BEAT_COLORS.length].key,
      keywords_zh: kz,
      keywords_en: ke,
      enabled: b.enabled !== false,
    });
  }
  if (!out.some((b) => b.enabled)) return fail("至少留一个开着的赛道。", "Keep at least one beat switched on.");
  return { beats: out };
}

/**
 * A beat's search words per language, with the gaps filled: a beat with only
 * Chinese words searches TikTok and YouTube with them too, and one with only
 * English words searches the Chinese platforms with those. `trad` turns
 * Simplified into Traditional for Google News (`toTraditional`, passed in by
 * the server so the browser never loads the table).
 */
export function beatWords(b: BeatConfig, trad: (s: string) => string = (s) => s): { zh: string[]; hk: string[]; en: string[] } {
  const zh = b.keywords_zh.length ? b.keywords_zh : b.keywords_en;
  const en = b.keywords_en.length ? b.keywords_en : b.keywords_zh;
  const uniq = (list: string[]) => [...new Set(list)];
  if (isDefaultBeat(b.key)) {
    /* The hand-picked Traditional words stay; a word the studio added to a
       default beat joins them in Traditional. */
    const base = BEAT_WORDS[b.key];
    const added = b.keywords_zh.filter((w) => !base.zh.includes(w));
    return { zh, hk: uniq([...base.hk, ...added.map(trad)]), en };
  }
  return { zh, hk: uniq(zh.map(trad)), en };
}

/* ------------------------------------------------------------ the runs */

/** The platforms a beat feed searches, with the language each is searched in. */
export type BeatSource = "douyin" | "xiaohongshu" | "bilibili" | "weibo" | "tiktok" | "youtube" | "news";

/**
 * Searches per run, per platform. One TikHub request each (YouTube and
 * Google News are not TikHub; see `planBeatRun`). Fixed, whatever the number
 * of beats: they are shared out among the beats switched on.
 *
 *   抖音   5  with the four defaults, one per beat and a second word for one
 *            of them (rotating): the billboard search returns up to 30
 *            videos with plays, likes and the account's followers; a word it
 *            has little for is asked again through 抖音's own search (one
 *            more request, only then)
 *   小红书 3  20 notes each
 *   B站    3  about 40 videos each
 *   TikTok 3  30 videos each
 *   微博   2  plus its own 科技 hot list, which covers tech, so its two
 *            searches rotate over the other beats (with 科技 switched off the
 *            list is not read and 微博 gets a third search instead)
 *
 * 16 searches and the one 微博 list: 17 TikHub requests a run, up to 22
 * when 抖音 falls back for every word.
 */
export const SEARCHES_PER_RUN: Record<"douyin" | "xiaohongshu" | "bilibili" | "weibo" | "tiktok", number> = {
  douyin: 5,
  xiaohongshu: 3,
  bilibili: 3,
  tiktok: 3,
  weibo: 2,
};

/** Hours between beat runs. The collector runs hourly and does the beats
 *  when the newest feed is this old (less ten minutes of slack). */
export const BEAT_EVERY_HOURS_DEFAULT = 3;

/** The minute past each hour the collector starts (`aura-hot` in
 *  ecosystem.config.cjs, "50 * * * *"). */
export const COLLECT_MINUTE = 50;

/** The three-hour slot a moment falls in: the rotation's clock. */
export function beatSlot(at = Date.now(), everyHours = BEAT_EVERY_HOURS_DEFAULT): number {
  return Math.floor(at / (Math.max(1, everyHours) * 3_600_000));
}

/**
 * When the next beat run starts, from when the feeds were last collected:
 * the first :50 at which they are due again (`everyHours` less ten minutes
 * after the last run, the collector's own age guard). For "下一轮收集后出现
 * （约 N 分钟）" under a beat that has no rows yet.
 */
export function nextBeatRun(lastAt: number | null, now = Date.now(), everyHours = BEAT_EVERY_HOURS_DEFAULT): number {
  const gap = Math.max(20, everyHours * 60 - 10) * 60_000;
  const due = Math.max(now, (lastAt ?? now) + gap);
  let at = Math.floor(due / 3_600_000) * 3_600_000 + COLLECT_MINUTE * 60_000;
  if (at < due) at += 3_600_000;
  return at;
}

/** Is the 微博 科技 hot list read? Only while 科技 is switched on. */
export const weiboTechList = (beats: readonly BeatConfig[]): boolean => activeBeats(beats).some((b) => b.key === "tech");

/**
 * The channel's own subjects as search words, with the beat each belongs to.
 *
 * The subjects come from the Creator voice note (`channelFocus`): phrases
 * like "AI与未来职业", "华人创业精神", "Web3与香港机遇". A phrase is not a
 * search; "AI 未来职业" is. The joining 与/和 become a space and the
 * abstract endings (精神, 机遇, 升级…) go. Only subjects that land on a beat
 * are kept — "认知与圈子升级" is the channel's, but not a subject any
 * platform's search can find business in. They only join the four default
 * beats (whose subjects these phrases are), and only while those are on.
 */
export function pillarWords(pillars: string[]): { beat: Beat; word: string }[] {
  const out: { beat: Beat; word: string }[] = [];
  for (const raw of pillars) {
    const word = raw
      .replace(/[（(].*?[）)]/g, "")
      .replace(/\s*(与|和|及|&|and)\s*/gi, " ")
      .replace(/(精神|机遇|机会|升级|选择|底线|之路|趋势)(?=\s|$)/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
    if (word.length < 2) continue;
    const beat: Beat | null = /web3|加密|币|区块链/i.test(word)
      ? "crypto"
      : /ai|人工智能|大模型|智能/i.test(word)
        ? "ai"
        : /芯片|科技|手机|机器人|汽车/.test(word)
          ? "tech"
          : /创业|商业|投资|理财|财经|经济|职场|职涯|就业|赚钱|企业/.test(word)
            ? "biz"
            : null;
    if (beat && !out.some((x) => x.word === word)) out.push({ beat, word });
  }
  return out.slice(0, 6);
}

/** One request the run will make. */
export type PlannedSearch = { source: BeatSource; beat: Beat; query: string; lang: "zh" | "hk" | "en" };

/** A stable per-platform offset, so two platforms asked about the same beat
 *  in the same run search different words of it. */
const OFFSET: Record<BeatSource, number> = { douyin: 0, xiaohongshu: 1, bilibili: 2, weibo: 3, tiktok: 1, youtube: 2, news: 0 };

type Words = Map<string, { zh: string[]; hk: string[]; en: string[] }>;

function wordsFor(source: BeatSource, beat: Beat, lang: "zh" | "hk" | "en", pillars: { beat: Beat; word: string }[], words: Words): string[] {
  const base = words.get(beat)?.[lang] ?? [];
  if (lang !== "zh") return base;
  /* The channel's own subjects join the simplified rotation of their beat.
     Not on 抖音 when they are two words: its billboard filters titles by the
     keyword as one string, and no title contains "AI 未来职业" verbatim. */
  const own = pillars.filter((p) => p.beat === beat && (source !== "douyin" || !p.word.includes(" "))).map((p) => p.word);
  return [...base, ...own];
}

/**
 * How many runs before `slot` asked about the beat at position `pos`, on a
 * platform that asks `n` of `cycle` beats a run (run s asks positions s,
 * s+1 … s+n-1, wrapping).
 *
 * The rotation's clock for words. Indexing a beat's words by the slot itself
 * skipped words for good: on 小红书, which asks three of the four beats a
 * run, 科技 is left out every fourth slot, and with eight 科技 words the
 * slots it is asked in always landed on the same six — 芯片 and 机器人 were
 * never searched there; on 微博 (two of three beats) 加密货币 and Web3 never
 * came round. Counting the times a beat was actually asked makes each ask
 * take the next word, so every word comes round in turn.
 */
export function timesAsked(slot: number, pos: number, n: number, cycle: number): number {
  if (n >= cycle) return slot;
  const base = Math.floor(slot / cycle) * cycle;
  let k = Math.floor(slot / cycle) * n;
  for (let s = base; s < slot; s++) if ((((pos - s) % cycle) + cycle) % cycle < n) k++;
  return k;
}

/**
 * What one beat run asks, platform by platform.
 *
 * `slot` is `beatSlot()`: the same slot always plans the same searches.
 * A platform that asks n searches of N beats takes n beats starting at a
 * point that moves by one each run, so no beat is skipped two runs in a
 * row, and each time a beat is asked it takes the beat's next word
 * (`timesAsked`). With more searches than beats (抖音's five over four), the
 * extra ones are a second word of a beat, three along. With the four
 * defaults this plans exactly what the collector planned before beats were
 * editable.
 */
export function planBeatRun(slot: number, pillars: string[] = [], beats: readonly BeatConfig[] = DEFAULT_BEATS): PlannedSearch[] {
  const active = activeBeats(beats);
  if (!active.length) return [];
  const order = active.map((b) => b.key);
  const words: Words = new Map(active.map((b) => [b.key, beatWords(b)]));
  const pw = pillarWords(pillars).filter((p) => words.has(p.beat));
  const plan: PlannedSearch[] = [];
  /* `asked` is how many times this platform asked about the beat before;
     `round` > 0 is a second (third…) search on the same beat in one run: a
     different word of it, three along. */
  const pick = (source: BeatSource, beat: Beat, lang: "zh" | "hk" | "en", asked: number, round = 0) => {
    const list = wordsFor(source, beat, lang, pw, words);
    return list[(asked + OFFSET[source] + round * 3) % list.length];
  };
  for (const source of ["douyin", "xiaohongshu", "bilibili", "tiktok"] as const) {
    const n = SEARCHES_PER_RUN[source];
    const lang = source === "tiktok" ? "en" : "zh";
    for (let k = 0; k < n; k++) {
      const pos = (slot + k) % order.length;
      const beat = order[pos];
      plan.push({ source, beat, query: pick(source, beat, lang, timesAsked(slot, pos, n, order.length), Math.floor(k / order.length)), lang });
    }
  }
  /* 微博: its 科技 hot list is read every run while 科技 is on (not a search,
     see `beat-feeds.ts`), so its searches rotate over the other beats. With
     科技 off the list's request goes to one more search. */
  const techList = weiboTechList(beats);
  const weiboBeats = order.filter((k) => !(techList && k === "tech"));
  const wn = SEARCHES_PER_RUN.weibo + (techList ? 0 : 1);
  for (let k = 0; k < wn && weiboBeats.length; k++) {
    const pos = (slot + k) % weiboBeats.length;
    const beat = weiboBeats[pos];
    plan.push({ source: "weibo", beat, query: pick("weibo", beat, "zh", timesAsked(slot, pos, wn, weiboBeats.length), Math.floor(k / weiboBeats.length)), lang: "zh" });
  }
  return plan;
}

/**
 * YouTube's two searches for a run: one in Chinese, one in English, each
 * over two beats joined with YouTube's own OR (`|`). The beats are paired in
 * the studio's order (the four defaults: AI with crypto, tech with
 * business) and the pairs take turns, so with four beats every beat is
 * searched in both languages every two runs (six hours), with six every
 * three. A video found stays in the feed while it is under three days old.
 * Two searches are about 200 units (204 with the videos' numbers and their
 * channels) of the key's 10,000 a day, whatever the number of beats.
 */
export function planYouTube(slot: number, beats: readonly BeatConfig[] = DEFAULT_BEATS, trad?: (s: string) => string): { beats: Beat[]; q: string; lang: "zh" | "en" }[] {
  const active = activeBeats(beats);
  if (!active.length) return [];
  const words: Words = new Map(active.map((b) => [b.key, beatWords(b, trad)]));
  const pairs: Beat[][] = [];
  for (let i = 0; i < active.length; i += 2) pairs.push(active.slice(i, i + 2).map((b) => b.key));
  const zhPair = pairs[slot % pairs.length];
  const enPair = pairs[(slot + 1) % pairs.length];
  const two = (beat: Beat, lang: "zh" | "en") => {
    const list = words.get(beat)![lang === "zh" ? "hk" : "en"];
    const i = (slot >> 1) % list.length;
    return [...new Set([list[i], list[(i + 1) % list.length]])];
  };
  return [
    { beats: zhPair, q: zhPair.flatMap((b) => two(b, "zh")).join("|"), lang: "zh" },
    { beats: enPair, q: enPair.flatMap((b) => two(b, "en")).join("|"), lang: "en" },
  ];
}

/** Google News: one query per beat switched on, every run (free). Four
 *  words of the beat, OR-ed, within the last two days. */
export function planNews(slot: number, beats: readonly BeatConfig[] = DEFAULT_BEATS, trad?: (s: string) => string): { beat: Beat; q: string }[] {
  return activeBeats(beats).map((b) => {
    const words = beatWords(b, trad).hk;
    const start = slot % words.length;
    const four = [...new Set([0, 1, 2, 3].map((k) => words[(start + k) % words.length]))];
    return { beat: b.key, q: `${four.join(" OR ")} when:2d` };
  });
}

/* ------------------------------------------------------ "现在收集" */

/**
 * One beat collected now, once, rather than waiting its turn in the
 * rotation — the "现在收集" button under a beat that has no rows yet
 * (`startBeatNow` and `runBeatNow` in `beat-feeds.ts`). Two words each on 抖音, 小红书 and
 * B站, one on 微博 and one (English) on TikTok: 8 TikHub requests, up to 10
 * when 抖音's billboard has little and its own search is asked too, under
 * a hard cap of `NOW_TIKHUB_CAP`. One YouTube search (102 units) and one
 * free Google News query in each edition. At most once per beat per half
 * hour (`NOW_EVERY_MS`).
 */
export const NOW_SEARCHES: Record<"douyin" | "xiaohongshu" | "bilibili" | "weibo" | "tiktok", number> = {
  douyin: 2,
  xiaohongshu: 2,
  bilibili: 2,
  weibo: 1,
  tiktok: 1,
};
export const NOW_TIKHUB_CAP = 12;
export const NOW_EVERY_MS = 30 * 60_000;

/** What "现在收集" asks for one beat: its first words, spread so two
 *  platforms search different ones. */
export function planBeatNow(b: BeatConfig): PlannedSearch[] {
  const w = beatWords(b);
  const out: PlannedSearch[] = [];
  for (const source of Object.keys(NOW_SEARCHES) as (keyof typeof NOW_SEARCHES)[]) {
    const lang = source === "tiktok" ? "en" : "zh";
    const list = w[lang];
    for (let k = 0; k < NOW_SEARCHES[source]; k++) {
      const query = list[(OFFSET[source] + k) % list.length];
      if (!out.some((x) => x.source === source && x.query === query)) out.push({ source, beat: b.key, query, lang });
    }
  }
  return out;
}
