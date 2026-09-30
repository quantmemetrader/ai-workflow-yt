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

export const metadata = { title: "热点榜 · Hot now" };

/** The four beats the studio makes videos on (the owner: "crypto, tech, business, AI only"). */
const FOUR = ["ai", "crypto", "tech", "biz"] as const;

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
    return Boolean(r.beat && keys.includes(r.beat));
  };
  /* Everything shown in Simplified (the owner, 29 Sep: "simplified chinese for all"). */
  const shown = (rows: BeatRow[]): ShownRow[] => rows.map((r) => ({ ...r, label: toSimplified(r.phrase), extra: r.extra ? toSimplified(r.extra) : r.extra }));
  const byChip: Record<string, ShownRow[]> = { all: shown(acrossPlatforms(lists, { limit: 400, beats: keys as never }).filter(onBeat).slice(0, 150)) };
  for (const f of BEAT_FEEDS) {
    if (f.tab === "crypto") continue;
    const { charted, feed } = tabRows(f.tab, lists, { beats: keys as never, chartCap: 50 });
    byChip[f.tab] = shown([...charted, ...feed].filter(onBeat).slice(0, 80));
  }
  return (
    <ResearchShell zh={zh}>
      <HotBoard zh={zh} canWrite={viewer.modules.includes("script")} initial={byChip} hiddenCount={hidden.size} />
    </ResearchShell>
  );
}
