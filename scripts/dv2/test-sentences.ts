/**
 * Smoke test for `toSentences` on the fixture's source-time words.
 *
 *   cd /home/ubuntu/wt/dv2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-sentences.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] \
 *     [--silences /home/ubuntu/raw/zl_silences.txt] [--gold /tmp/dv2_lab/fixture/zhengliu.gold.json]
 *
 * No database, no model. Prints the split, its length distribution, and —
 * when the gold file is there — whether every retake's kept take starts on
 * a sentence boundary, which is what the cut planner needs to be able to
 * drop the first take by sentence id.
 */
import { readFile } from "node:fs/promises";
import { hanCount, toSentences } from "../../lib/video/sentences";
import type { Silence } from "../../lib/video/v2/types";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const SILENCES = arg("--silences", "/home/ubuntu/raw/zl_silences.txt");
const GOLD = arg("--gold", "/tmp/dv2_lab/fixture/zhengliu.gold.json");

type Fixture = { sourceWords?: { words: { text: string; start: number; end: number }[] } | null };
type Gold = { retakes: { name: string; dropStartMs: number; dropEndMs: number; keptTake: { startMs: number } }[] };

async function main() {
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const words = fixture.sourceWords?.words ?? [];
  if (!words.length) throw new Error(`${FIXTURE} carries no sourceWords`);

  /* silencedetect output as the raw-take probe wrote it: "start end duration" per line, seconds. */
  const silences: Silence[] = (await readFile(SILENCES, "utf8").catch(() => ""))
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([a, b]) => ({ startMs: Math.round(a * 1000), endMs: Math.round(b * 1000) }));

  const sentences = toSentences(words, [], { clipId: "src", silences });
  const lengths = sentences.map((s) => hanCount(s.text));
  const durations = sentences.map((s) => (s.endMs - s.startMs) / 1000);
  const bucket = (n: number) => (n < 6 ? "<6" : n < 12 ? "6–11" : n < 20 ? "12–19" : n < 30 ? "20–29" : n < 45 ? "30–44" : "45+");
  const hist: Record<string, number> = {};
  for (const n of lengths) hist[bucket(n)] = (hist[bucket(n)] ?? 0) + 1;

  console.log(`${words.length} words, ${silences.length} silences → ${sentences.length} sentences`);
  console.log(`Han chars per sentence: ${JSON.stringify(hist)}; longest ${Math.max(...lengths)}, mean ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)}`);
  console.log(`seconds per sentence: min ${Math.min(...durations).toFixed(2)}, mean ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)}, max ${Math.max(...durations).toFixed(2)}`);
  for (const s of sentences.slice(0, 18)) console.log(`  ${s.id} ${(s.startMs / 1000).toFixed(2).padStart(7)}–${(s.endMs / 1000).toFixed(2).padStart(7)} ${s.text}`);
  console.log("  …");

  const gold = JSON.parse(await readFile(GOLD, "utf8").catch(() => "null")) as Gold | null;
  if (!gold) return;
  let aligned = 0;
  for (const r of gold.retakes) {
    const near = (ms: number) => sentences.find((s) => Math.abs(s.startMs - ms) <= 450);
    const a = near(r.dropStartMs);
    const b = near(r.keptTake.startMs);
    if (a && b) aligned++;
    console.log(`${a && b ? "ok  " : "MISS"} ${r.name}: drop start ${a?.id ?? "—"} (${(r.dropStartMs / 1000).toFixed(2)}), kept start ${b?.id ?? "—"} (${(r.keptTake.startMs / 1000).toFixed(2)})`);
  }
  console.log(`${aligned}/${gold.retakes.length} gold retakes start on sentence boundaries (±450 ms)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
