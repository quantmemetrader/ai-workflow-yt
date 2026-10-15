import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, timelineItems, videoClips } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { joinTimed, type Piece, type TimedWord } from "@/lib/video/script-cut";

/**
 * Pieces of the host's clips onto the timeline, in order, with captions on the new timeline's clock made from the
 * words she actually said in them (`video_clips.transcript`). Used when the script decides the cut
 * (`lib/script/from-footage.ts`) and to put the whole footage back before a fresh cut.
 */
export async function writeTimelineFromPieces(
  projectId: string,
  clips: readonly { id: string; words: readonly TimedWord[]; pieces: readonly Piece[] }[],
  language: string,
  aspect: string,
): Promise<{ items: number; ms: number; lines: number }> {
  const items: (typeof timelineItems.$inferInsert)[] = [];
  const lines: (typeof captions.$inferInsert)[] = [];
  const maxChars = aspect === "9:16" ? 16 : 24;
  let at = 0;
  let ord = 0;
  for (const c of clips) {
    for (const p of c.pieces) {
      items.push({ id: newId("beat"), projectId, kind: "clip", clipId: c.id, ord: ord++ * 10, inMs: Math.round(p.inMs), outMs: Math.round(p.outMs) });
      const inside = c.words.filter((w) => w.startMs >= p.inMs - 1 && w.endMs <= p.outMs + 1);
      let line: { start: number; end: number; text: string; space?: boolean }[] = [];
      const flush = () => {
        if (!line.length) return;
        const text = joinTimed(line).replace(/[，。,.]$/, "");
        if (text.trim()) lines.push({ id: newId("beat"), projectId, language, ord: lines.length, startMs: Math.round(line[0].start * 1000), endMs: Math.round(line[line.length - 1].end * 1000), text, words: line });
        line = [];
      };
      inside.forEach((w, i) => {
        const prev = inside[i - 1];
        if (prev && w.startMs - prev.endMs > 400) flush();
        line.push({ start: (at + w.startMs - p.inMs) / 1000, end: (at + w.endMs - p.inMs) / 1000, text: w.text, space: w.space });
        const chars = line.reduce((n, x) => n + x.text.length, 0);
        if (/[。！？!?，,；;]$/.test(w.text) || chars >= maxChars) flush();
      });
      flush();
      at += p.outMs - p.inMs;
    }
  }
  await db.delete(timelineItems).where(eq(timelineItems.projectId, projectId));
  await db.delete(captions).where(eq(captions.projectId, projectId));
  for (let i = 0; i < items.length; i += 200) await db.insert(timelineItems).values(items.slice(i, i + 200));
  for (let i = 0; i < lines.length; i += 200) await db.insert(captions).values(lines.slice(i, i + 200));
  return { items: items.length, ms: at, lines: lines.length };
}

/**
 * Before a fresh cut: every clip that was on the timeline goes back on whole, so the cut starts from everything
 * that was filmed, not from the last cut (11 Oct: a 6-second cut was re-cut into the same 6 seconds three times,
 * because the captions it worked from had been cut to those 6 seconds). Returns whether the captions could be
 * rebuilt from the clips' own transcripts; when not, they are cleared so the footage is transcribed again.
 */
export async function resetToFullFootage(projectId: string, language: string, aspect: string): Promise<"rebuilt" | "cleared" | "kept"> {
  const items = await db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord));
  if (!items.length || items.some((i) => i.kind !== "clip" || !i.clipId)) return "kept";
  const order = [...new Set(items.map((i) => i.clipId!))];
  const clips = await db.select().from(videoClips).where(eq(videoClips.projectId, projectId));
  const byId = new Map(clips.map((c) => [c.id, c]));
  const full = order.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c?.durationMs));
  if (full.length !== order.length) return "kept";
  const fullMs = full.reduce((n, c) => n + (c.durationMs ?? 0), 0);
  const nowMs = items.reduce((n, i) => n + Math.max(0, (i.outMs ?? byId.get(i.clipId!)?.durationMs ?? 0) - i.inMs), 0);
  if (nowMs >= fullMs * 0.95) return "kept";
  if (full.every((c) => c.transcript && c.transcript.fileId === c.fileId)) {
    await writeTimelineFromPieces(projectId, full.map((c) => ({ id: c.id, words: c.transcript!.words, pieces: [{ inMs: 0, outMs: c.durationMs! }] })), language, aspect);
    return "rebuilt";
  }
  await db.delete(timelineItems).where(eq(timelineItems.projectId, projectId));
  await db.delete(captions).where(eq(captions.projectId, projectId));
  await db.insert(timelineItems).values(full.map((c, i) => ({ id: newId("beat"), projectId, kind: "clip", clipId: c.id, ord: i * 10, inMs: 0, outMs: c.durationMs })));
  return "cleared";
}
