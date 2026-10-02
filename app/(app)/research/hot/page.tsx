import { requireModule } from "@/lib/auth/dal";
import { ResearchShell } from "@/components/research/ResearchShell";
import { HotBoard } from "@/components/research/HotBoard";
import { storedAll } from "@/lib/research/platforms";
import { readBeatsWithOrigin } from "@/lib/research/beat-store";
import { BEAT_FEEDS } from "@/lib/research/platform-catalog";
import { acrossPlatforms, tabRows, type BeatRow, type Lists } from "@/lib/research/beat-view";
import { toSimplified } from "@/lib/text/simplified";
import { hiddenHot } from "@/lib/research/hot-hidden";
import type { ShownRow } from "@/components/research/HotBoard";

export const metadata = { title: "热点榜" };

/** The four beats the studio makes videos on (the owner: "crypto, tech, business, AI only"). */
const FOUR = ["ai", "crypto", "tech", "biz"] as const;

/* (QA, 2 Oct) Consumer and lifestyle stories the marker files under 商业
   (房贷贴息, 女装退货, a burger chain's data leak) still reached the list.
   Read on the mark's tag and the headline; property-market analysis such
   as 楼市/地产 stays, the studio makes those. */
const OFF_BEAT = /房贷|贴息|公积金|装修|女装|服装|退货|穿搭|美妆|美食|餐饮|外卖|汉堡|漢堡|奶茶|天气|天氣|旅游|旅遊|育儿|彩票|个资|個資|一卡通/; // zh-ok: both spellings, as the lists carry them

/** 「普 发 一 万」: spaces some feeds put between Chinese characters. */
const tidy = (s: string) => s.replace(/([㐀-鿿])[ 　]+(?=[㐀-鿿])/g, "$1").trim();
/** Google's rows carry the region they came from ("TW · …"); the list is one region already. */
const noRegion = (s: string) => s.replace(/^[A-Z]{2} · /, "");

/**
 * 选题 · 热点榜: every platform's hottest posts on the studio's four beats.
 *
 * Built here, on the server, and sent with the page: it used to fetch 317 KB
 * of every list after the page had loaded and sort it in the browser, so the
 * table sat on 「正在读取…」 for a round trip and a crunch (the owner, 29 Sep:
 * "why is this page so slow"). Only rows on AI · 加密 · 科技 · 商业 are kept.
 */
export default async function HotPage() {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [all, { beats }, hidden] = await Promise.all([storedAll(), readBeatsWithOrigin(viewer.tenantId, {}), hiddenHot(viewer.tenantId)]);
  const lists: Lists = {};
  for (const [k, v] of Object.entries(all ?? {})) if (v) lists[k as keyof Lists] = { rows: v.rows ?? [], relevance: (v.relevance as never) ?? null, fetchedAt: v.fetchedAt ?? null } as never;
  const keys = beats.filter((b) => b.enabled && (FOUR as readonly string[]).includes(b.key)).map((b) => b.key);
  let hiddenCount = 0;
  const onBeat = (r: BeatRow) => {
    if (hidden.has(r.phrase)) {
      hiddenCount++;
      return false;
    }
    if (OFF_BEAT.test(r.mark?.tag ?? "") || OFF_BEAT.test(r.phrase)) return false;
    return Boolean(r.beat && keys.includes(r.beat));
  };
  /* Everything shown in Simplified (the owner, 29 Sep: "simplified chinese for all"). */
  const shown = (rows: BeatRow[]): ShownRow[] => rows.map((r) => ({ ...r, label: tidy(toSimplified(r.phrase)), extra: r.extra ? noRegion(tidy(toSimplified(r.extra))) : r.extra }));
  const byChip: Record<string, ShownRow[]> = { all: shown(acrossPlatforms(lists, { limit: 400, beats: keys as never }).filter(onBeat).slice(0, 150)) };
  for (const f of BEAT_FEEDS) {
    if (f.tab === "crypto") continue;
    const { charted, feed } = tabRows(f.tab, lists, { beats: keys as never, chartCap: 50 });
    byChip[f.tab] = shown([...charted, ...feed].filter(onBeat).slice(0, 80));
  }
  return (
    <ResearchShell zh={zh} tenantId={viewer.tenantId}>
      <HotBoard zh={zh} canWrite={viewer.modules.includes("script")} canHide={viewer.isAdmin} initial={byChip} hiddenCount={hidden.size} />
    </ResearchShell>
  );
}
