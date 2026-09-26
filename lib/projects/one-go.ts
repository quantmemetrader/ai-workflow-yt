import "server-only";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, timelineItems, videoClips, videoProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { workProjectDetail } from "@/lib/projects/service";
import { addClip, addTimelineItem, requestDirector, requestExport, updateTimelineItem } from "@/lib/video/service";
import { canEditProject } from "@/lib/video/access";
import { importVideo } from "@/lib/files/service";
import { clipAttribution, searchStockClips, stockConfigured } from "@/lib/video/stock";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { narrationOf } from "@/lib/video/narrate";
import { parseVoiceId } from "@/lib/video/tts/voices";

export type OneGoResult =
  | { ok: true; brought: number; way: "director" | "assembled" | "narrated"; seconds?: number; videoProjectId: string }
  | { ok: false; error: string; status: number };

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
 * Shared by the project page's button (`/api/projects/[id]/one-go`) and by
 * 剪辑师's "先用素材库画面" under its request for the host's clips (a `run`
 * card action), so both are one path with one set of checks: the Video
 * module, a project this person may see, and edit rights on its video.
 */
export async function oneGo(
  viewer: Viewer,
  projectId: string,
  body: { prompt?: unknown; way?: unknown; narrate?: unknown; voiceId?: unknown } = {},
): Promise<OneGoResult> {
  if (!viewer.modules.includes("video")) return { ok: false, error: "Not allowed", status: 403 };
  const p = await workProjectDetail(viewer, projectId, true, 1);
  if (!p?.video) return { ok: false, error: "No such project", status: 404 };
  /* The route used to stop at "may see the project". Starting footage
     imports and a render in its video is editing it, which is the video
     project's own rule (`canEditProject`), whoever pressed. */
  if (!(await canEditProject(viewer, p.video.id))) return { ok: false, error: "This project's video was shared with you to view. Ask its owner for edit access.", status: 403 };
  const asked = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  const brief = asked || (p.brief ?? p.title).replace(/@\S+/g, "").trim() || p.title;

  /*
   * AI 配音. "on": the script's narration is voiced and the video cut to it,
   * whatever the footage sounds like. "off": never. Otherwise "auto": the
   * director voices it when the footage has no sound to cut on — which stock
   * footage never has — and the script has 旁白 to read.
   */
  const narrate = body.narrate === "on" || body.narrate === "off" ? body.narrate : "auto";
  const voiceId = typeof body.voiceId === "string" && parseVoiceId(body.voiceId) ? body.voiceId.slice(0, 64) : null;
  const beats = p.script
    ? await db
        .select({ ord: scriptBeats.ord, voiceover: scriptBeats.voiceover, visual: scriptBeats.visual, naturalSound: scriptBeats.naturalSound })
        .from(scriptBeats)
        .where(eq(scriptBeats.scriptId, p.script.id))
        .orderBy(asc(scriptBeats.ord))
    : [];
  const narration = narrate === "off" ? null : narrationOf(beats);
  if (narrate === "on" && !narration) {
    return { ok: false, error: "脚本里还没有旁白，没法配音。先写好脚本的旁白（VO），或者关掉 AI 配音。The script has no narration (VO) to voice yet: write it first, or turn AI voice-over off.", status: 400 };
  }
  /* The director reads the script through the video project; a project whose
     cut was never tied to its script is tied now, or the narration has
     nothing to read. */
  if (narration && p.script) {
    await db
      .update(videoProjects)
      .set({ scriptId: p.script.id })
      .where(and(eq(videoProjects.id, p.video.id), isNull(videoProjects.scriptId)));
  }

  const [have] = await db.select({ n: count() }).from(videoClips).where(and(eq(videoClips.projectId, p.video.id)));
  let brought = 0;
  if (have.n === 0) {
    if (!stockConfigured().pexels) return { ok: false, error: "No stock library is configured; upload the clips instead.", status: 400 };
    /* A narrated video changes shot on every beat, so it wants a clip per
       beat (up to eight), found from what each beat says is on screen;
       three clips looped under two minutes of narration is a slideshow. */
    const narratedBeats = narration ? beats.filter((b) => !b.naturalSound && b.voiceover.trim()) : [];
    const want = narratedBeats.length ? Math.min(8, Math.max(3, narratedBeats.length)) : 3;
    const queries = narratedBeats.length ? await beatSearchWords(brief, narratedBeats.slice(0, want)) : await searchWords(brief);
    const seen = new Set<string>();
    for (const q of queries) {
      if (brought >= want) break;
      const found = await searchStockClips(q, { limit: 4 }).catch(() => []);
      for (const clip of found) {
        if (brought >= want || seen.has(clip.id)) continue;
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
    if (brought === 0) return { ok: false, error: "No stock footage matched this topic; upload the clips instead.", status: 400 };
  }

  /*
   * Two ways to a finished video.
   *
   * Footage with somebody speaking goes to the director, which cuts on
   * what is said. Stock footage is silent and the director refuses it
   * ("nothing to transcribe"), so a stock video is assembled directly: the
   * clips in order, trimmed to the length asked for, and rendered.
   */
  /* "assemble" is asked for after the director found no speech to cut on. */
  const stockOnly = brought > 0 || p.mode === "direct:video" || body.way === "assemble";

  /*
   * Silent footage and a script to read: the narrated way. The director
   * voices the 旁白, cuts the footage to it, captions it from its own
   * timings, designs and renders (`lib/video/narrate.ts`). This is what the
   * stock path does whenever the project has a script, instead of laying
   * silent clips end to end.
   */
  if (narration && (narrate === "on" || stockOnly)) {
    try {
      await requestDirector(viewer, p.video.id, { brief, aspect: "9:16", render: true, pace: "channel", narrate: "on", voiceId });
      return { ok: true, brought, way: "narrated", videoProjectId: p.video.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not start the director", status: 400 };
    }
  }

  if (!stockOnly) {
    try {
      await requestDirector(viewer, p.video.id, { brief, aspect: "9:16", render: true, pace: "channel", narrate: narration ? narrate : "off", voiceId });
      return { ok: true, brought, way: "director", videoProjectId: p.video.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/sound|transcribe|speech|声音|转写/i.test(msg)) return { ok: false, error: msg || "Could not start the director", status: 400 };
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
    } else {
      /* A timeline already there (an earlier try) is held to the length
         asked for: each clip trimmed to its share, from its own in-point. */
      const items = await db
        .select({ id: timelineItems.id, kind: timelineItems.kind, inMs: timelineItems.inMs, outMs: timelineItems.outMs, holdMs: timelineItems.holdMs, dur: videoClips.durationMs })
        .from(timelineItems)
        .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
        .where(eq(timelineItems.projectId, p.video.id));
      const clipItems = items.filter((i) => i.kind === "clip");
      const total = items.reduce((n, i) => n + (i.kind === "clip" ? (i.outMs ?? i.dur ?? 0) - i.inMs : i.holdMs), 0);
      if (clipItems.length && total > seconds * 1000 * 1.2) {
        const each = Math.max(1000, Math.round((seconds * 1000) / clipItems.length));
        for (const i of clipItems) {
          const end = i.dur ? Math.min(i.dur, i.inMs + each) : i.inMs + each;
          await updateTimelineItem(viewer, i.id, { outMs: end });
        }
      }
    }
    await requestExport(viewer, p.video.id, { aspect: "9:16", burnCaptions: false, captionLanguage: "zh-CN" });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not put the video together", status: 400 };
  }
  return { ok: true, brought, way: "assembled", seconds, videoProjectId: p.video.id };
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

/**
 * One English stock-search phrase per narrated beat, from what the beat says
 * is on screen (its 画面 column) and, failing that, what it says. In beat
 * order, so the narrated cut can start each beat on its own clip.
 */
async function beatSearchWords(topic: string, beats: { visual: string; voiceover: string }[]): Promise<string[]> {
  try {
    const res = await complete({
      model: modelFor.utility(),
      temperature: 0.2,
      maxTokens: 300,
      messages: [
        {
          role: "user",
          content:
            `For each numbered shot below, give ONE short English search phrase (2 to 4 words) for stock video footage that would illustrate it. ` +
            `Generic scenes only: no brand names, no people's names. One per line, numbered the same, nothing else.\n` +
            `Topic: ${topic}\n` +
            beats.map((b, i) => `${i + 1}. ${(b.visual || b.voiceover).replace(/\s+/g, " ").slice(0, 160)}`).join("\n"),
        },
      ],
    });
    const lines = res.text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .split("\n")
      .map((l) => l.replace(/^[\s\d.)\-*"]+|["\s]+$/g, ""))
      .filter((l) => /^[a-zA-Z][a-zA-Z\s'-]{2,40}$/.test(l));
    if (lines.length) return lines.slice(0, beats.length);
  } catch {
    // fall through to the topic's own phrases
  }
  return searchWords(topic);
}
