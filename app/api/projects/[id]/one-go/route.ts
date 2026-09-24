import { type NextRequest } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { timelineItems, videoClips } from "@/lib/db/schema";
import { workProjectDetail } from "@/lib/projects/service";
import { addClip, addTimelineItem, requestDirector, requestExport, updateTimelineItem } from "@/lib/video/service";
import { importVideo } from "@/lib/files/service";
import { clipAttribution, searchStockClips, stockConfigured } from "@/lib/video/stock";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";

/**
 * "Make it in one go" for a project.
 *
 * The director cuts from clips in the bin. A project that asked for a stock
 * video ("a five-second crypto clip") has none, and the press used to end in
 * "put some footage in the bin first". So when the bin is empty this finds
 * stock footage for the topic first (the topic in plain English search
 * words, which is what the library understands), brings two or three clips
 * in, and then starts the director with a render.
 *
 * A route, not a server action: importing clips takes a while, and the app
 * router holds every navigation behind an action in flight.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("video")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await workProjectDetail(viewer, id, true, 1);
  if (!p?.video) return Response.json({ error: "No such project" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  const asked = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  const brief = asked || (p.brief ?? p.title).replace(/@\S+/g, "").trim() || p.title;

  const [have] = await db.select({ n: count() }).from(videoClips).where(and(eq(videoClips.projectId, p.video.id)));
  let brought = 0;
  if (have.n === 0) {
    if (!stockConfigured().pexels) return Response.json({ error: "No stock library is configured; upload the clips instead." }, { status: 400 });
    const queries = await searchWords(brief);
    const seen = new Set<string>();
    for (const q of queries) {
      if (brought >= 3) break;
      const found = await searchStockClips(q, { limit: 4 }).catch(() => []);
      for (const clip of found) {
        if (brought >= 3 || seen.has(clip.id)) continue;
        seen.add(clip.id);
        try {
          const file = await importVideo(viewer, { url: clip.url, name: `stock · ${clip.title}`, attribution: clipAttribution(clip), source: clip.source });
          await addClip(viewer, p.video.id, file.id);
          brought++;
          break; // one clip per search phrase, for variety
        } catch (err) {
          console.error("[one-go] could not bring a clip in", err);
        }
      }
    }
    if (brought === 0) return Response.json({ error: "No stock footage matched this topic; upload the clips instead." }, { status: 400 });
  }

  /*
   * Two ways to a finished video.
   *
   * Footage with somebody speaking goes to the director, which cuts on
   * what is said. Stock footage is silent and the director refuses it
   * ("nothing to transcribe"), so a stock video is assembled directly: the
   * clips in order, trimmed to the length asked for, and rendered.
   */
  const stockOnly = brought > 0 || p.mode === "direct:video";
  if (!stockOnly) {
    try {
      await requestDirector(viewer, p.video.id, { brief, aspect: "9:16", render: true, pace: "channel" });
      return Response.json({ ok: true, brought, way: "director" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/sound|transcribe|speech|声音|转写/i.test(msg)) return Response.json({ error: msg || "Could not start the director" }, { status: 400 });
    }
  }

  const seconds = Math.max(3, Math.min(180, Number(brief.match(/(\d{1,3})\s*(秒|s\b|sec|second)/i)?.[1] ?? 15)));
  const [onTimeline] = await db.select({ n: count() }).from(timelineItems).where(eq(timelineItems.projectId, p.video.id));
  try {
    if (onTimeline.n === 0) {
      const clips = await db.select({ id: videoClips.id, durationMs: videoClips.durationMs }).from(videoClips).where(eq(videoClips.projectId, p.video.id)).limit(6);
      const each = Math.max(1500, Math.round((seconds * 1000) / Math.max(1, clips.length)));
      for (const c of clips) {
        const itemId = await addTimelineItem(viewer, p.video.id, { kind: "clip", clipId: c.id, text: "" });
        const out = c.durationMs ? Math.min(c.durationMs, each) : each;
        await updateTimelineItem(viewer, itemId, { inMs: 0, outMs: out });
      }
    }
    await requestExport(viewer, p.video.id, { aspect: "9:16", burnCaptions: false, captionLanguage: "zh-CN" });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not put the video together" }, { status: 400 });
  }
  return Response.json({ ok: true, brought, way: "assembled", seconds });
}

/** Two or three English stock-search phrases for a topic. */
async function searchWords(topic: string): Promise<string[]> {
  try {
    const res = await complete({
      model: modelFor.utility(),
      temperature: 0.2,
      maxTokens: 120,
      messages: [{ role: "user", content: `Give 3 short English search phrases for stock video footage that would illustrate this topic. One per line, 2 to 4 words each, generic scenes only (no brand names, no people's names). Topic: ${topic}` }],
    });
    const lines = res.text.replace(/<think>[\s\S]*?<\/think>/g, "").split("\n").map((l) => l.replace(/^[\s\d.\-*"]+|["\s]+$/g, "")).filter((l) => /^[a-zA-Z][a-zA-Z\s'-]{2,40}$/.test(l));
    if (lines.length) return lines.slice(0, 3);
  } catch {
    // fall through
  }
  return ["technology abstract", "city night", "business office"];
}
