import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { studioBrief, type StudioBrief } from "@/lib/research/studio";
import { listName, type HotRow, type ListKey } from "@/lib/research/platform-catalog";
import { toSimplified } from "@/lib/text/simplified";

/**
 * 研究员 reads a platform's hot list against this channel.
 *
 * A hot list is somebody else's audience. What the studio wants to know is
 * which of those twenty lines is *theirs*: a viewer already asked about it,
 * a rival's video on it did numbers, the channel's own best-performing piece
 * is next door to it. That is a judgement, so it is the model's — made once
 * per platform per half hour for the studio, from the studio's own numbers
 * (`studioBrief`), and cached with the list it was made on.
 *
 * It marks; it does not invent. A row it cannot tie to anything in the brief
 * gets nothing, and the screen shows nothing for it.
 *
 * It reads the rows on the studio's beat (the collector passes those when
 * there are three or more, see `collectPlatform`). It used to be asked for a
 * third kind of mark too — "the row has nothing to do with business or tech,
 * but its format could be borrowed" — which put pills on dance clips and
 * made the noise look endorsed. That clause is now only asked for when a
 * caller wants it (`borrow`), and nothing on the focused view does.
 */
export type Judgement = {
  /** Two to six characters the pill shows: 「可接 RWA 选题」「观众问过」「香港本地」. */
  fit: string;
  /** One sentence on why, in the studio's words. */
  why: string;
};

export type Judged = Record<string, Judgement>;

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; judged: Judged }>();
const MAX_ROWS = 30;

/** A title reduced to what two copies of it share: no spacing, punctuation,
 *  hashtags or case, and simplified characters. */
const bare = (s: string) =>
  toSimplified(s)
    .toLowerCase()
    .replace(/#\S+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");

/**
 * The row a mark is about.
 *
 * The model answers with the row's number and, since 09-26, the opening
 * words of its title (`t`). The number alone was not enough: on the stored
 * 抖音 and 新闻 beat feeds the model numbered its own picks 1, 2, 3, 4 instead
 * of citing the list, so "加密赛道 — 比特币行情可直接覆盖" landed on an AI
 * jobs video and "香港楼市" on a story about AI taking office jobs. So the
 * echo is checked against the numbered row; when they disagree the row
 * whose title the echo opens is used instead, and a mark that matches no
 * row is dropped rather than pinned on the wrong one. An answer without an
 * echo (an older prompt, a model that ignored it) is taken by number, as
 * before.
 */
function rowFor(rows: HotRow[], n: number, echo: string): HotRow | null {
  const byNumber = Number.isInteger(n) && n >= 1 ? (rows[n - 1] ?? null) : null;
  const e = bare(echo).slice(0, 12);
  if (e.length < 2) return byNumber;
  const opens = (r: HotRow) => {
    const b = bare(r.phrase);
    // The echo is the title's start; allow a model that skipped a leading
    // bracket or two characters by also accepting it a little way in.
    const at = b.indexOf(e.slice(0, Math.min(6, e.length)));
    return at >= 0 && at <= 4;
  };
  if (byNumber && opens(byNumber)) return byNumber;
  return rows.find(opens) ?? null;
}

export async function judgeHot(
  tenantId: string,
  platform: ListKey,
  rows: HotRow[],
  fetchedAt: number,
  /* `brief`: the studio's brief from the caller, when it judges many lists
     for one studio (the collector builds it once per run); otherwise read here. */
  opts: { borrow?: boolean; brief?: () => Promise<StudioBrief> } = {},
): Promise<Judged> {
  const key = `${tenantId}:${platform}:${fetchedAt}:${rows.length}:${opts.borrow ? "b" : "f"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.judged;
  if (!rows.length) return {};

  const brief = await (opts.brief ? opts.brief() : studioBrief(tenantId));
  const list = rows.slice(0, MAX_ROWS).map((r, i) => `${i + 1}. ${r.phrase}${r.extra ? `（${r.extra}）` : ""}`);

  const prompt = [
    "你是一家香港财经科技自媒体工作室的研究员。下面是这个频道自己的数据，然后是某个平台此刻的热榜。",
    `任务：从热榜里挑出对这个频道**有用**的条目，从${opts.borrow ? "三" : "两"}个角度看：`,
    "① 内容相关：观众问过的、对标账号做过而且播放高的、跟频道自己跑得好的选题同一个方向的；",
    "② 本地相关：香港、粤港澳、华人创业者、港股楼市这类跟频道观众直接有关的；",
    ...(opts.borrow
      ? [
          "③ 形式可借：条目本身跟财经科技无关，但它的呈现方式（设问式标题、对比数字、人物故事、现场实拍）可以直接套到频道的选题上。",
          "每条标注要说清依据：①②要引用频道数据里的具体东西（哪条视频、哪位观众、哪个对标账号）；③要说清借什么、套到哪个选题。",
        ]
      : [
          "只标 AI、加密、科技、商业财经方面的条目；娱乐、体育、明星、节日这类，哪怕形式好看也不标。",
          "每条标注要说清依据：引用频道数据里的具体东西（哪条视频、哪位观众、哪个对标账号）。",
        ]),
    "宁可少标，不要硬凑；一份 20 条的榜通常标 2–5 条。",
    `输出 JSON 数组，每项 {"n": 序号, "t": "该条标题的前 12 个字，照抄", "fit": "2到6个字的标签，如 可接RWA选题 / 观众问过 / 香港本地${opts.borrow ? " / 形式可借" : ""}", "why": "一句话依据"}。n 必须是该条在下面列表里的序号，不是你挑出来的第几条。没有就输出 []。只输出 JSON。`,
    "",
    "# 频道数据",
    brief.text,
    "",
    `# ${listName(platform, true)}${platform.startsWith("beat_") ? "（按赛道搜出来的热门内容）" : " 热榜"}`,
    ...list,
  ].join("\n");

  /*
   * The answer budget. It was 900 tokens, and the utility model reasons
   * before it answers: on a thirty-row list the reasoning used the lot and
   * the answer came back empty, which read as "nothing here is the
   * channel's" — every stored list on 09-26 had zero marks for that reason,
   * not for want of fits. 3,000 leaves room for both. An answer with no
   * array at all (cut off, or refused) goes to the assistant model once.
   */
  let judged: Judged = {};
  for (const model of [...new Set([modelFor.utility(), modelFor.assistant()])]) {
    try {
      const res = await complete({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2, maxTokens: 3000 });
      const text = res.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]");
      if (start < 0 || end <= start) continue;
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const n = Number((item as { n?: unknown })?.n);
          const echo = String((item as { t?: unknown })?.t ?? "").trim();
          const fit = String((item as { fit?: unknown })?.fit ?? "").trim();
          const why = String((item as { why?: unknown })?.why ?? "").trim();
          const row = rowFor(rows.slice(0, MAX_ROWS), n, echo);
          if (!row || !fit || fit.length > 12) continue;
          judged[row.phrase] = { fit: toSimplified(fit), why: toSimplified(why).slice(0, 160) };
        }
      }
      break;
    } catch (err) {
      console.error(`[research] 研究员 could not read the hot list (${model})`, err);
      judged = {};
    }
  }

  cache.set(key, { at: Date.now(), judged });
  return judged;
}
