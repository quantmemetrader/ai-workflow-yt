import "server-only";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { studioBrief } from "@/lib/research/studio";
import type { HotRow, PlatformKey } from "@/lib/research/platform-catalog";
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

export async function judgeHot(
  tenantId: string,
  platform: PlatformKey,
  rows: HotRow[],
  fetchedAt: number,
  opts: { borrow?: boolean } = {},
): Promise<Judged> {
  const key = `${tenantId}:${platform}:${fetchedAt}:${rows.length}:${opts.borrow ? "b" : "f"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.judged;
  if (!rows.length) return {};

  const brief = await studioBrief(tenantId);
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
          "只标财经、商业、科技方面的条目；娱乐、体育、明星、节日这类，哪怕形式好看也不标。",
          "每条标注要说清依据：引用频道数据里的具体东西（哪条视频、哪位观众、哪个对标账号）。",
        ]),
    "宁可少标，不要硬凑；一份 20 条的榜通常标 2–5 条。",
    `输出 JSON 数组，每项 {"n": 序号, "fit": "2到6个字的标签，如 可接RWA选题 / 观众问过 / 香港本地${opts.borrow ? " / 形式可借" : ""}", "why": "一句话依据"}。没有就输出 []。只输出 JSON。`,
    "",
    "# 频道数据",
    brief.text,
    "",
    `# ${platform} 热榜`,
    ...list,
  ].join("\n");

  let judged: Judged = {};
  try {
    const res = await complete({
      model: modelFor.utility(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 900,
    });
    const text = res.text.trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    const parsed = start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as unknown) : [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const n = Number((item as { n?: unknown })?.n);
        const fit = String((item as { fit?: unknown })?.fit ?? "").trim();
        const why = String((item as { why?: unknown })?.why ?? "").trim();
        const row = rows[n - 1];
        if (!row || !fit || fit.length > 12) continue;
        judged[row.phrase] = { fit: toSimplified(fit), why: toSimplified(why).slice(0, 160) };
      }
    }
  } catch (err) {
    console.error("[research] 研究员 could not read the hot list", err);
    judged = {};
  }

  cache.set(key, { at: Date.now(), judged });
  return judged;
}
