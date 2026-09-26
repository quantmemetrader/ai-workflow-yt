/**
 * Every platform's hot list, read once and stored (`hot_snapshots`), and
 * every third hour the beat feeds.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/collect-hot.ts [flags]
 *
 * Run by pm2 on the hour (`aura-hot`). Pages and the morning brief read what
 * this stores and never call a platform themselves. Each list is marked by
 * beat (AI, crypto, tech, business) or none as it is stored
 * (`lib/research/relevance.ts`).
 *
 * Two jobs, one after the other:
 *
 *   The platforms' own charts (`collectAll`): up to ten metered TikHub
 *   requests a run, fewer most hours. A list stored under half an hour ago is
 *   skipped, so a restart loop or a second run by hand does not buy the same
 *   lists again, and the three 抖音 creator billboards are read every third
 *   hour. About 176 requests a day. These are the 上榜 signal.
 *
 *   The beat feeds (`collectBeats`, `lib/research/beat-feeds.ts`): each
 *   platform searched for the beats, thirty on-beat posts per platform with
 *   their numbers. Every third hour by default (a feed newer than that is
 *   left alone), 17 TikHub requests a run (up to 22) under a hard cap of
 *   30, two YouTube searches (202 units), free Google News and CoinGecko
 *   reads. About 145 TikHub requests and 1,616 YouTube units a day.
 *
 * Flags:
 *   --force         re-read every chart now, ignoring the age guard (billed;
 *                   does not force the beat feeds)
 *   --beats         the beat feeds only, not the charts
 *   --no-beats      the charts only
 *   --force-beats   read the beat feeds now, ignoring their age guard
 *   --dry           print the beat feeds' planned requests and stop; nothing
 *                   is called, nothing is written, the charts are not read
 *   --only=a,b      only these beat feeds (beat_douyin, beat_weibo, …)
 *   --slot=N        plan the beat words of rotation slot N instead of now's
 *                   (with --dry, to preview what a later run will ask)
 *
 * Environment (optional):
 *   RESEARCH_BEAT_EVERY_HOURS       hours between beat runs (default 3)
 *   RESEARCH_BEAT_TIKHUB_CAP        most TikHub requests per beat run (default 30)
 *   RESEARCH_BEAT_YOUTUBE_SEARCHES  most YouTube searches per beat run (default 2)
 */
import { collectAll } from "@/lib/research/platforms";
import { collectBeats } from "@/lib/research/beat-feeds";
import { BEATS, isBeatFeedKey, type BeatFeedKey, type RelevanceMap } from "@/lib/research/platform-catalog";

const arg = (name: string) => process.argv.includes(name);
const FORCE = arg("--force");
const DRY = arg("--dry");
const BEATS_ONLY = arg("--beats");
const NO_BEATS = arg("--no-beats");
const FORCE_BEATS = arg("--force-beats");
const SLOT = Number(process.argv.find((a) => a.startsWith("--slot="))?.slice(7)) || undefined;
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(isBeatFeedKey) as BeatFeedKey[];

async function main() {
  const t0 = Date.now();
  /* Marks made on the charts this run, reused by the feeds. */
  const seen: RelevanceMap = {};

  if (!DRY && !BEATS_ONLY) {
    const out = await collectAll({ force: FORCE, seen });
    for (const r of out) {
      console.log(
        r.skipped
          ? `[hot] ${r.platform.padEnd(12)}   - skipped, ${r.skipped}`
          : `[hot] ${r.platform.padEnd(12)} ${String(r.rows).padStart(3)} rows${r.note ? ` · ${r.note}` : ""}`,
      );
    }
    console.log(`[hot] charts done in ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  if (!NO_BEATS) {
    const t1 = Date.now();
    const res = await collectBeats({ force: FORCE_BEATS, dry: DRY, only: ONLY.length ? ONLY : undefined, seen, slot: SLOT });
    if (DRY) {
      const paid = res.planned.filter((p) => p.paid === "tikhub").length;
      console.log(`[beats] dry run, slot ${res.slot}: ${res.planned.length} requests planned (${paid} TikHub, cap ${res.tikhubCap}); nothing called`);
      console.log(`[beats]   channel subjects: ${res.pillars.join(" / ")}`);
      for (const p of res.planned) console.log(`[beats]   ${p.feed.padEnd(16)} ${p.paid.padEnd(7)} ${p.beat ?? "-"}  ${p.what}`);
      for (const r of res.reports) if (r.skipped) console.log(`[beats]   ${r.feed.padEnd(16)} would be skipped, ${r.skipped}`);
    } else {
      for (const r of res.reports) {
        if (r.skipped) {
          console.log(`[beats] ${r.feed.padEnd(16)}   - skipped, ${r.skipped}`);
          continue;
        }
        const beats = BEATS.map((b) => `${b.en} ${r.byBeat[b.key]}`).join(" · ");
        console.log(
          `[beats] ${r.feed.padEnd(16)} ${String(r.rows).padStart(3)} rows (${beats}) · kept ${r.kept}/${r.classified} on a beat · ${r.carried} carried · ${r.model} marked by model · TikHub ${r.tikhub}${r.youtubeUnits ? ` · YouTube ${r.youtubeUnits}u` : ""}${r.free ? ` · free ${r.free}` : ""}${r.note ? ` · ${r.note}` : ""}${r.errors.length ? ` · ${r.errors.length} errors` : ""}`,
        );
      }
      const ran = res.reports.some((r) => !r.skipped);
      if (ran) {
        console.log(
          `[beats] done in ${Math.round((Date.now() - t1) / 1000)}s: ${res.tikhub} TikHub requests (cap ${res.tikhubCap}), ${res.youtubeUnits} YouTube units, ${res.free} free${res.refused.length ? `; over the cap, not asked: ${res.refused.join(", ")}` : ""}`,
        );
      }
    }
  }

  console.log(`[hot] done in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[hot] failed", err);
  process.exit(1);
});
