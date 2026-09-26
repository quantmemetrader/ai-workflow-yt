/**
 * The studio's beats and the words each platform is searched with, in one
 * place.
 *
 * The owner: "keep it related to business and tech & crypto, AI and stuff".
 * The beat feeds (`lib/research/beat-feeds.ts`) search every platform for
 * these words at the source, instead of reading a platform's whole hot list
 * and hiding most of it on screen, which left tabs of three rows.
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
 * number of requests an hour as one word would cost.
 *
 * Pure data and arithmetic: no fetching, no secrets, safe anywhere.
 */
import type { Beat } from "@/lib/research/platform-catalog";

export type { Beat } from "@/lib/research/platform-catalog";

/** The order beats are taken in when a platform asks fewer than four per run. */
export const BEAT_ORDER: readonly Beat[] = ["ai", "crypto", "tech", "biz"];

/**
 * The words, per beat, per language.
 *
 *   zh  simplified, for 抖音, 小红书, B站 and 微博 search
 *   hk  traditional, for Google News in Hong Kong and Taiwan (its index is
 *       in traditional characters; 比特币 finds less there than 比特幣)
 *   en  for TikTok and YouTube, whose beat content is mostly English
 *
 * Order matters a little: the rotation starts at the top, so the word most
 * likely to find the day's story comes first.
 */
export const BEAT_WORDS: Record<Beat, { zh: string[]; hk: string[]; en: string[] }> = {
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

/** The platforms a beat feed searches, with the language each is searched in. */
export type BeatSource = "douyin" | "xiaohongshu" | "bilibili" | "weibo" | "tiktok" | "youtube" | "news";

/**
 * Searches per run, per platform. One TikHub request each (YouTube and
 * Google News are not TikHub; see `planBeatRun`).
 *
 *   抖音   5  one per beat and a second word for one of them (rotating):
 *            the billboard search returns up to 30 videos with plays,
 *            likes and the account's followers; a word it has little for
 *            is asked again through 抖音's own search (one more request,
 *            only then)
 *   小红书 3  20 notes each
 *   B站    3  about 40 videos each
 *   TikTok 3  30 videos each
 *   微博   2  plus its own 科技 hot list, which covers tech, so its two
 *            searches rotate over AI, crypto and business
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

/** The three-hour slot a moment falls in: the rotation's clock. */
export function beatSlot(at = Date.now(), everyHours = BEAT_EVERY_HOURS_DEFAULT): number {
  return Math.floor(at / (Math.max(1, everyHours) * 3_600_000));
}

/**
 * The channel's own subjects as search words, with the beat each belongs to.
 *
 * The subjects come from the Creator voice note (`channelFocus`): phrases
 * like "AI与未来职业", "华人创业精神", "Web3与香港机遇". A phrase is not a
 * search; "AI 未来职业" is. The joining 与/和 become a space and the
 * abstract endings (精神, 机遇, 升级…) go. Only subjects that land on a beat
 * are kept — "认知与圈子升级" is the channel's, but not a subject any
 * platform's search can find business in.
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

function wordsFor(source: BeatSource, beat: Beat, lang: "zh" | "hk" | "en", pillars: { beat: Beat; word: string }[]): string[] {
  const base = BEAT_WORDS[beat][lang];
  if (lang !== "zh") return base;
  /* The channel's own subjects join the simplified rotation of their beat.
     Not on 抖音 when they are two words: its billboard filters titles by the
     keyword as one string, and no title contains "AI 未来职业" verbatim. */
  const own = pillars.filter((p) => p.beat === beat && (source !== "douyin" || !p.word.includes(" "))).map((p) => p.word);
  return [...base, ...own];
}

/**
 * What one beat run asks, platform by platform.
 *
 * `slot` is `beatSlot()`: the same slot always plans the same searches.
 * A platform that asks n < 4 searches takes n beats starting at a point
 * that moves by one each run, so no beat is skipped two runs in a row.
 */
export function planBeatRun(slot: number, pillars: string[] = []): PlannedSearch[] {
  const pw = pillarWords(pillars);
  const plan: PlannedSearch[] = [];
  /* `round` > 0 is a second (third…) search on the same beat in one run: a
     different word of it, three along. */
  const pick = (source: BeatSource, beat: Beat, lang: "zh" | "hk" | "en", round = 0) => {
    const words = wordsFor(source, beat, lang, pw);
    return words[(slot + OFFSET[source] + round * 3) % words.length];
  };
  for (const source of ["douyin", "xiaohongshu", "bilibili", "tiktok"] as const) {
    const n = SEARCHES_PER_RUN[source];
    const lang = source === "tiktok" ? "en" : "zh";
    for (let k = 0; k < n; k++) {
      const beat = BEAT_ORDER[(slot + k) % BEAT_ORDER.length];
      plan.push({ source, beat, query: pick(source, beat, lang, Math.floor(k / BEAT_ORDER.length)), lang });
    }
  }
  /* 微博: its 科技 hot list is read every run (not a search, see
     `beat-feeds.ts`), so its searches rotate over the other three beats. */
  const weiboBeats: Beat[] = ["ai", "crypto", "biz"];
  for (let k = 0; k < SEARCHES_PER_RUN.weibo; k++) {
    const beat = weiboBeats[(slot + k) % weiboBeats.length];
    plan.push({ source: "weibo", beat, query: pick("weibo", beat, "zh"), lang: "zh" });
  }
  return plan;
}

/**
 * YouTube's two searches for a run: one in Chinese, one in English, each
 * over two beats joined with YouTube's own OR (`|`), alternating which pair
 * gets which language. So every beat is searched in both languages every
 * two runs (six hours), and a video found stays in the feed while it is
 * under three days old. Two searches are 200 units of the key's 10,000 a day.
 */
export function planYouTube(slot: number): { beats: Beat[]; q: string; lang: "zh" | "en" }[] {
  const pairs: Beat[][] = [
    ["ai", "crypto"],
    ["tech", "biz"],
  ];
  const zhPair = pairs[slot % 2];
  const enPair = pairs[(slot + 1) % 2];
  const two = (beat: Beat, lang: "zh" | "en") => {
    const words = BEAT_WORDS[beat][lang === "zh" ? "hk" : "en"];
    const i = (slot >> 1) % words.length;
    return [words[i], words[(i + 1) % words.length]];
  };
  return [
    { beats: zhPair, q: zhPair.flatMap((b) => two(b, "zh")).join("|"), lang: "zh" },
    { beats: enPair, q: enPair.flatMap((b) => two(b, "en")).join("|"), lang: "en" },
  ];
}

/** Google News: one query per beat, every run (free). Four words of the
 *  beat, OR-ed, within the last two days. */
export function planNews(slot: number): { beat: Beat; q: string }[] {
  return BEAT_ORDER.map((beat) => {
    const words = BEAT_WORDS[beat].hk;
    const start = slot % words.length;
    const four = [0, 1, 2, 3].map((k) => words[(start + k) % words.length]);
    return { beat, q: `${four.join(" OR ")} when:2d` };
  });
}
