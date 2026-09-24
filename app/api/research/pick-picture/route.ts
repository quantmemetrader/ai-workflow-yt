import { type NextRequest } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { getViewer } from "@/lib/auth/dal";
import { searchVideos } from "@/lib/research/youtube";

/**
 * A picture for one of the morning's picks, from the internet.
 *
 * A pick is a sentence: "RWA（真实世界资产）如何让普通人参与香港新机会？".
 * The studio asked for a picture of what it is about rather than a coloured
 * dot, so this searches YouTube for the topic and hands back the cover of
 * the most-watched result from the last year. It is a picture *of the
 * subject*, found by search, and the row says so; it is not the studio's
 * footage and not a clip the pick cites.
 *
 * A search costs 101 units of a 10,000-a-day quota, so every answer
 * (including "nothing found") is kept on disk for a week and survives the
 * restarts a deploy causes. A GET, not a server action: a server action
 * holds up every navigation while it runs.
 */
type Found = { thumbnail: string; url: string; title: string; channel: string } | null;
const FILE = "/tmp/aura-pick-pictures.json";
const TTL = 7 * 86_400_000;
let memo: Record<string, { at: number; found: Found }> | null = null;

async function load() {
  if (memo) return memo;
  try {
    memo = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    memo = {};
  }
  return memo!;
}

/** The subject of a pick: the title in 《》 if it names one, else its first clause. */
function subjectOf(text: string): string {
  const quoted = text.match(/《([^》]{2,40})》/)?.[1];
  const base = quoted ?? text.replace(/^(完成|优化|写|做|拍)?(脚本|视频)?/, "");
  return base
    .replace(/[（(][^）)]*[）)]/g, " ")
    .split(/[，,。？?！!；;：:—]/)[0]
    .trim()
    .slice(0, 40);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const text = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const q = subjectOf(text);
  if (q.length < 2) return Response.json({ found: null, q });

  const cache = await load();
  const hit = cache[q];
  if (hit && Date.now() - hit.at < TTL) return Response.json({ found: hit.found, q }, { headers: { "Cache-Control": "private, max-age=3600" } });

  let found: Found = null;
  try {
    const videos = await searchVideos(q, { days: 365, limit: 5 });
    const best = videos.find((v) => v.thumbnail) ?? null;
    found = best ? { thumbnail: best.thumbnail!, url: `https://www.youtube.com/watch?v=${best.id}`, title: best.title, channel: best.channelTitle ?? "" } : null;
  } catch {
    // Out of quota or offline: say nothing now, and try again next time.
    return Response.json({ found: null, q });
  }
  cache[q] = { at: Date.now(), found };
  void writeFile(FILE, JSON.stringify(cache)).catch(() => {});
  return Response.json({ found, q }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
