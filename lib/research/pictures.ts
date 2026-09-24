import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { competitorPosts, creatorVideos } from "@/lib/db/schema";

/**
 * A picture for a line of text, from what the studio already holds.
 *
 * The morning's picks are sentences — "RWA 如何让普通人参与香港新机会" — and
 * a sentence has no thumbnail. What it cites does: the channel's own video
 * whose title it quotes, or the rival post it points at. This finds the
 * title that shares the longest run of characters with the text and hands
 * back that picture. Nothing is fetched; a pick that cites nothing with a
 * picture gets none.
 */
const MIN_RUN = 4;
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; titles: { title: string; thumbnail: string }[] }>();

async function titles(tenantId: string) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.titles;
  const [own, rival] = await Promise.all([
    db
      .select({ title: creatorVideos.title, thumbnail: creatorVideos.thumbnailUrl })
      .from(creatorVideos)
      .where(and(eq(creatorVideos.tenantId, tenantId), isNotNull(creatorVideos.thumbnailUrl)))
      .orderBy(desc(creatorVideos.publishedAt))
      .limit(300),
    db
      .select({ title: competitorPosts.title, thumbnail: competitorPosts.thumbnailUrl })
      .from(competitorPosts)
      .where(and(eq(competitorPosts.tenantId, tenantId), isNotNull(competitorPosts.thumbnailUrl)))
      .orderBy(desc(competitorPosts.views))
      .limit(300),
  ]);
  const list = [...own, ...rival]
    .filter((r): r is { title: string; thumbnail: string } => Boolean(r.title && r.thumbnail))
    .map((r) => ({ title: clean(r.title), thumbnail: r.thumbnail }));
  cache.set(tenantId, { at: Date.now(), titles: list });
  return list;
}

const clean = (s: string) => s.replace(/[\s《》「」“”"'’‘()（）【】\[\]|｜·•,，。！？!?:：;；-]/g, "").toLowerCase();

/** Longest common substring length, over short strings; the pick is one line. */
function overlap(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

export async function pictureFor(tenantId: string, text: string): Promise<string | null> {
  const needle = clean(text);
  if (needle.length < MIN_RUN) return null;
  let bestRun = 0;
  let best: string | null = null;
  for (const row of await titles(tenantId)) {
    const run = overlap(needle, row.title);
    if (run > bestRun) {
      bestRun = run;
      best = row.thumbnail;
    }
  }
  return bestRun >= MIN_RUN ? best : null;
}
