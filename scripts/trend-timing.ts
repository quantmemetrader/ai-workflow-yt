import { trendingNearby } from "@/lib/research/trending";
import { trendingVideos } from "@/lib/research/youtube";
async function t(label: string, fn: () => Promise<unknown>) {
  const s = Date.now();
  try { const r = await fn(); console.log(`  ${label}: ${Date.now() - s}ms  (${Array.isArray(r) ? r.length : "?"} rows)`); }
  catch (e) { console.log(`  ${label}: FAILED after ${Date.now() - s}ms: ${e instanceof Error ? e.message.slice(0, 90) : e}`); }
}
async function main() {
  await t("trendingNearby HK (cold)", () => trendingNearby("HK", 14));
  await t("trendingNearby HK (2nd)", () => trendingNearby("HK", 14));
  await t("trendingVideos HK (cold)", () => trendingVideos("HK", 20));
  await t("trendingVideos HK (2nd)", () => trendingVideos("HK", 20));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
