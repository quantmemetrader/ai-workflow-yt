import type { Beat } from "@/lib/video/v2/types";
import type { MediaKind, ProviderKey } from "@/lib/video/v2/media-adapter";

/**
 * From a beat to the searches that find its picture.
 *
 * The outline call (W6) writes the queries — shootable phrases in both
 * languages, romanised names for people. This module does not invent
 * subjects; it normalises what the model wrote, adds the forms the sources
 * are known to need (PLAN.md §2 W3, the routing table), and decides which
 * sources to ask for which kind of thing:
 *
 *   person     抖音 first (「张一鸣 采访」), then B站 and YouTube for a longer
 *              interview, then Bing and Pinterest for a still — Pinterest
 *              with the romanised name and the organisation, because a bare
 *              Chinese name returns fan pins of actors.
 *   org        the logo or building as a picture (Bing), news or official
 *              footage as a clip; the entity route (`entities.ts`) runs
 *              beside these and is not a search.
 *   product    screen recordings — YouTube and B站 「演示」/"demo", 抖音.
 *   headline   a picture of the story (Bing), a news clip (抖音, B站).
 *   concept    explainer animation on B站/YouTube; the term card is W6's.
 *   scene      the stock libraries and Pinterest for the shootable phrase,
 *              抖音 for the Chinese-looking version of the same scene.
 *   number, compare, list, none: no search — those are graphics.
 *
 * 抖音's search is a phrase search and reads best at four words or fewer,
 * so the short-form pass takes a capped phrase; the long-form pass (B站,
 * YouTube, which are keyword searches over long descriptions) gets the
 * whole thing. Douyin/TikTok clips are capped at a minute, B站/YouTube at
 * ten (a window is cut out of them at fetch time). Orientation is never
 * forced: the layout is chosen from what comes back, not asked for.
 *
 * Pure: no IO, so a beat list can be checked for its queries in a test.
 */

export type SearchRole = "short" | "long" | "image";

export type SearchSpec = {
  role: SearchRole;
  query: { zh?: string; en?: string };
  kind: MediaKind;
  providers: ProviderKey[];
  maxDurationS?: number;
  orientation: "any" | "portrait" | "landscape";
  /** Per provider. */
  limit: number;
};

export type QueryPlan = {
  zh: string[];
  en: string[];
  /** The primary search's sources, for callers that want one list. */
  providers: ProviderKey[];
  kind: MediaKind;
  maxDurationS: number;
  orientation: "any";
  /** Every search to run for this beat, primary first. Empty for a graphics-only beat. */
  searches: SearchSpec[];
  noteZh: string;
};

/** What the outline knows about the whole video, for context in a query. */
export type OutlineHint = { topicZh?: string; topicEn?: string };

export const SHORT_MAX_S = 60;
export const LONG_MAX_S = 600;

const HAN = /[㐀-鿿]/;

/* Quotes, brackets, hashes and sentence punctuation are not search terms. */
const PUNCT = /[【】「」『』“”"'‘’`,.。，、！!?？:：;；()（）#《》<>\[\]{}|/\\]+/g;

export function normaliseQuery(text: string | undefined | null): string {
  return (text ?? "").replace(PUNCT, " ").replace(/\s+/g, " ").trim();
}

let segmenter: Intl.Segmenter | null = null;

/** The words of a Chinese phrase, as the ICU segmenter reads them; Latin runs and numbers count as one word each. */
export function zhWords(text: string): string[] {
  segmenter ??= new Intl.Segmenter("zh", { granularity: "word" });
  const out: string[] = [];
  for (const s of segmenter.segment(text)) {
    if (s.isWordLike && s.segment.trim()) out.push(s.segment.trim());
  }
  return out;
}

/** A phrase capped at `n` words, for 抖音's phrase search. */
export function capTokens(text: string, n = 4): string {
  const words = zhWords(text);
  if (words.length <= n) return text.trim();
  return words.slice(0, n).join(HAN.test(text) ? "" : " ").trim();
}

function uniq(list: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = normaliseQuery(raw);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** The model's queries, each in the list its script belongs to (a Latin-only "zh" is an en query, and the other way round). */
function sortByScript(zh: string[], en: string[]): { zh: string[]; en: string[] } {
  const z: string[] = [];
  const e: string[] = [];
  for (const q of [...zh, ...en]) (HAN.test(q) ? z : e).push(q);
  return { zh: uniq(z), en: uniq(e) };
}

const pick = (list: string[], i: number) => list[i] ?? list[0];

function spec(role: SearchRole, kind: MediaKind, providers: ProviderKey[], zh: string | undefined, en: string | undefined, maxDurationS?: number, limit = 5): SearchSpec | null {
  const query = { zh: zh?.trim() || undefined, en: en?.trim() || undefined };
  if (!query.zh && !query.en) return null;
  return { role, query, kind, providers, maxDurationS, orientation: "any", limit };
}

export function beatQueries(beat: Beat, outline: OutlineHint = {}): QueryPlan {
  const given = sortByScript(beat.queries?.zh ?? [], beat.queries?.en ?? []);
  const ent = beat.entity;
  const name = ent?.name ?? "";
  const roman = ent?.romanised ?? "";
  const org = ent?.org ?? "";
  const kind = ent?.kind;
  const intent = beat.intent;
  const searches: (SearchSpec | null)[] = [];
  let zh = given.zh;
  let en = given.en;
  let noteZh = "";

  const graphicsOnly = intent === "number" || intent === "compare" || intent === "list" || intent === "none";
  if (graphicsOnly) {
    return { zh, en, providers: [], kind: "image", maxDurationS: 0, orientation: "any", searches: [], noteZh: "数字、对比、列表用图形卡，不找素材" };
  }

  if (intent === "person" || kind === "person") {
    /* The plan's forms: 「张一鸣 采访」 for 抖音; "Zhang Yiming ByteDance interview" for the English sources (romanised + organisation). */
    zh = uniq([name && `${name} 采访`, ...zh, name && `${name} 演讲`]);
    en = uniq([roman && `${[roman, org].filter(Boolean).join(" ")} interview`, ...en, roman && `${[roman, org].filter(Boolean).join(" ")} speech`]);
    searches.push(spec("short", "video", ["douyin"], capTokens(pick(zh, 0)), pick(en, 0), SHORT_MAX_S));
    searches.push(spec("long", "video", ["bilibili", "youtube"], pick(zh, 1), pick(en, 1), LONG_MAX_S));
    searches.push(spec("image", "image", ["bing", "pinterest"], name || pick(zh, 0), roman ? [roman, org].filter(Boolean).join(" ") : pick(en, 0), undefined, 6));
    noteZh = `找${name || pick(zh, 0)}本人的采访或发言片段，其次找一张本人照片`;
  } else if (intent === "product" || kind === "product") {
    /* A named product gets the 「演示」/"demo" forms added; a beat with no entity is trusted to have written them. */
    const subjectEn = roman || name;
    if (name) {
      zh = uniq([...zh, `${name} 演示`, `${name} 使用 界面`]);
      en = uniq([...en, `${subjectEn} demo`, `${subjectEn} app screen recording`]);
    }
    const subject = name || pick(zh, 0) || pick(en, 0) || "";
    searches.push(spec("long", "video", ["youtube", "bilibili"], pick(zh, 0), pick(en, 0), LONG_MAX_S));
    searches.push(spec("short", "video", ["douyin"], capTokens(pick(zh, 0)), pick(en, 0), SHORT_MAX_S));
    searches.push(spec("image", "image", ["bing"], undefined, name ? `${subjectEn} app screenshot` : pick(en, 1) ?? pick(en, 0), undefined, 5));
    noteZh = `找${subject}的产品界面演示，其次找界面截图`;
  } else if (intent === "org" || (ent && kind !== undefined)) {
    const cn = /中国|中方|商务部|外交部|人民/.test(name) || /China|Chinese/i.test(org);
    const label = roman || name;
    if (kind === "agency" || kind === "legislature") {
      const what = kind === "legislature" ? "听证会" : "大楼";
      zh = uniq([...zh, name && `${name} ${what}`]);
      en = uniq([...en, label && `${label} ${kind === "legislature" ? "hearing chamber" : "headquarters building"}`]);
      searches.push(spec("image", "image", ["bing"], pick(zh, 0), pick(en, 0), undefined, 6));
      searches.push(spec("long", "video", cn ? ["douyin", "bilibili"] : ["youtube", "bilibili"], cn ? capTokens(`${name} 回应`) : pick(zh, 1), pick(en, 1), cn ? SHORT_MAX_S : LONG_MAX_S));
      noteZh = `找${name}的大楼或现场画面，不用徽章`;
    } else if (kind === "publication") {
      zh = uniq([...zh, name && `${name} 杂志 封面`]);
      en = uniq([...en, label && `${label} journal cover`, label && `${label} magazine logo`]);
      searches.push(spec("image", "image", ["bing"], pick(zh, 0), pick(en, 0), undefined, 6));
      noteZh = `找${name}的封面或标志`;
    } else {
      /* A company: its logo as a picture, its own or news footage as a clip. */
      zh = uniq([...zh, name && `${name} 标志`, name && `${name} 公司`]);
      en = uniq([...en, label && `${label} logo`, label && `${label} ${ent?.descriptorZh ? "company" : "headquarters"}`]);
      searches.push(spec("image", "image", ["bing"], pick(zh, 0), pick(en, 0), undefined, 6));
      searches.push(spec("long", "video", ["youtube", "bilibili"], pick(zh, 1), pick(en, 1), LONG_MAX_S));
      noteZh = `找${name}的标志、办公楼或官方画面`;
    }
  } else if (intent === "headline") {
    const h = beat.headline;
    const story = h ? normaliseQuery(`${h.outlet} ${h.quoteZh}`) : "";
    zh = uniq([...zh, story, h?.quoteZh]);
    en = uniq([...en]);
    searches.push(spec("image", "image", ["bing"], pick(zh, 0), pick(en, 0), undefined, 6));
    searches.push(spec("long", "video", ["douyin", "bilibili"], capTokens(pick(zh, 1) ?? pick(zh, 0), 6), pick(en, 0), LONG_MAX_S));
    noteZh = `找这条新闻的报道画面；找不到就用新闻卡`;
  } else if (intent === "concept") {
    const term = pick(zh, 0) ?? beat.must ?? "";
    zh = uniq([...zh, term && `${term} 动画 讲解`]);
    en = uniq([...en, pick(en, 0) && `${pick(en, 0)} animation explainer`]);
    searches.push(spec("long", "video", ["bilibili", "youtube"], pick(zh, 1) ?? pick(zh, 0), pick(en, 1) ?? pick(en, 0), LONG_MAX_S));
    noteZh = `术语卡优先；找${term}的讲解动画作备选`;
  } else {
    /* scene, metaphor: a shootable phrase, English for the libraries and Pinterest, Chinese for 抖音. The
       libraries are the natural home of a scene, so they get the deeper page and a second phrasing. */
    searches.push(spec("short", "video", ["stock", "pinterest", "douyin"], capTokens(pick(zh, 0) ?? ""), pick(en, 0), SHORT_MAX_S, 10));
    if (en[1]) searches.push(spec("short", "video", ["stock"], undefined, en[1], SHORT_MAX_S, 8));
    searches.push(spec("image", "image", ["stock"], undefined, pick(en, 1) ?? pick(en, 0), undefined, 5));
    noteZh = `找一个具体场景：${pick(en, 0) ?? pick(zh, 0) ?? ""}`;
  }

  const list = searches.filter((s): s is SearchSpec => Boolean(s));
  /* Whatever was added above, a zh query has Han in it and an en query has none (PLAN.md §2 W6 rule). */
  zh = zh.filter((q) => HAN.test(q));
  en = en.filter((q) => !HAN.test(q));
  if (outline.topicEn && list.length === 0 && en.length === 0) en = uniq([outline.topicEn]);
  const primary = list[0];
  return {
    zh,
    en,
    providers: primary?.providers ?? [],
    kind: primary?.kind ?? "video",
    maxDurationS: primary?.maxDurationS ?? SHORT_MAX_S,
    orientation: "any",
    searches: list,
    noteZh,
  };
}
