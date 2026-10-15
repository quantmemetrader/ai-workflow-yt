import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, scriptBeats, scripts, videoClips, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { beatsFromDoc, docForBeats, type RichDoc, type RichNode } from "@/lib/script/rich";
import { createScript, cutVersion, saveBeats } from "@/lib/script/service";
import { toSimplified } from "@/lib/text/simplified";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { keptWords, normChars, piecesFromKept, piecesMs, transferPunctuation, type TimedWord } from "@/lib/video/script-cut";

/**
 * The script page as what the host actually says (15 Oct: "if user has uploaded the video then the script section
 * should be the whole transcribe of the video … if they remove the data from the script then it should cut those out").
 *
 * When filmed footage of the host lands in a project, its words (`video_clips.transcript`, on the clip's own clock)
 * become the script, paragraph by paragraph. A draft written before the filming is kept in 版本记录 first. From then
 * on the script and the cut are one thing: the director keeps exactly what is still in the script
 * (`lib/video/script-cut.ts`), so deleting a sentence here cuts it from the video, and the script's length is the
 * video's length. Text typed in that she never said cannot appear in the video and is ignored by the cut.
 */

export type ClipTranscript = NonNullable<typeof videoClips.$inferSelect.transcript>;
export type HostClip = { id: string; fileId: string; name: string; durationMs: number | null; words: TimedWord[] };

/** Footage pulled in from a link (「B站 · …」), a stock or sourced cutaway, or a take the AI made from the script is not the host's own filming. */
const IMPORTED = /^(B站|bilibili|YouTube|抖音|小红书|微博|TikTok|快手|视频号|Instagram|X|Pexels|Pixabay|Wikimedia|Openverse)\s*·\s/i;
export function isHostFootage(name: string, durationMs: number | null, words: readonly TimedWord[]): boolean {
  if (IMPORTED.test(name)) return false;
  if (/^(主持人口播|AI 生成|配音)\s*·/.test(name)) return false;
  if (durationMs !== null && durationMs < 8000) return false;
  const chars = words.reduce((n, w) => n + w.text.length, 0);
  return chars >= 20;
}

/** The project's host clips that have been transcribed, in the order they were added. */
export async function hostClips(videoProjectId: string): Promise<HostClip[]> {
  const rows = await db
    .select({ c: videoClips, name: files.name })
    .from(videoClips)
    .innerJoin(files, eq(files.id, videoClips.fileId))
    .where(and(eq(videoClips.projectId, videoProjectId), isNull(files.deletedAt)))
    .orderBy(asc(videoClips.addedAt));
  return rows
    .filter((r) => r.c.transcript && r.c.transcript.fileId === r.c.fileId)
    .map((r) => ({ id: r.c.id, fileId: r.c.fileId, name: r.name, durationMs: r.c.durationMs, words: r.c.transcript!.words }))
    .filter((c) => isHostFootage(c.name, c.durationMs, c.words));
}

const ENDS = /[。！？!?…]$|[.!?]$/;
const join = (ws: readonly TimedWord[]) =>
  ws.reduce((s, w, i) => {
    const prev = i ? ws[i - 1].text : "";
    const latin = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(w.text);
    return s + (latin ? " " : "") + w.text;
  }, "");

/**
 * What she said as paragraphs: a sentence ends at its punctuation or at a pause; a paragraph gathers sentences up
 * to about eighty characters, or ends sooner at a long pause, so the page reads like a script and not like a wall.
 */
export function paragraphsOf(words: readonly TimedWord[]): string[] {
  const sentences: TimedWord[][] = [];
  let cur: TimedWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.startMs - w.endMs : Infinity;
    const len = cur.reduce((n, x) => n + x.text.length, 0);
    if (ENDS.test(w.text) || gap >= 700 || (len >= 40 && gap >= 250) || len >= 70) {
      sentences.push(cur);
      cur = [];
    }
  });
  if (cur.length) sentences.push(cur);
  const paras: string[] = [];
  let buf: TimedWord[][] = [];
  const len = (list: TimedWord[][]) => list.reduce((n, s) => n + join(s).length, 0);
  sentences.forEach((s, i) => {
    buf.push(s);
    const next = sentences[i + 1];
    const pause = next ? next[0].startMs - s[s.length - 1].endMs : Infinity;
    if (len(buf) >= 80 || pause >= 1500 || !next) {
      paras.push(
        buf
          .map((x) => {
            const t = join(x);
            return ENDS.test(t) || /[，,、；;：:]$/.test(t) ? t : `${t}${/[一-鿿]$/.test(t) ? "，" : ","}`;
          })
          .join("")
          .replace(/[，,]$/, /[一-鿿]/.test(join(buf[buf.length - 1])) ? "。" : "."),
      );
      buf = [];
    }
  });
  /* Chinese text takes full-width punctuation; English inside it keeps its own. */
  const full = (p: string) => p.replace(/([\u4e00-\u9fff])\s*,\s*/g, "$1，").replace(/([\u4e00-\u9fff])\s*\?/g, "$1？").replace(/([\u4e00-\u9fff])\s*!/g, "$1！").replace(/([\u4e00-\u9fff])\s*:\s*/g, "$1：").replace(/,\s*([\u4e00-\u9fff])/g, "，$1").replace(/\?\s*([\u4e00-\u9fff])/g, "？$1");
  return paras.map((p) => full(toSimplified(p))).filter((p) => p.trim());
}

const para = (text: string): RichNode => ({ type: "paragraph", content: [{ type: "text", text }] });

const PUNCTUATE = `你是中文字幕编辑。下面是一段口播的逐字转写，标点很少或是半角的，英文单词有时被拆开（如 "Open AI"、"F ig ure"）。
只做三件事：
1. 加上正确的中文全角标点（，。？！：、“”），英文和数字保持半角；
2. 把被拆开的英文单词、品牌名、网址拼回去（Open AI → OpenAI，new s.com → news.com）；
3. 按意思分段，每段两到四句，段与段之间空一行。
严禁增加、删除、替换或调换任何一个汉字、字母或数字，错别字也原样保留。只输出整理后的正文，不要解释。`;

/**
 * Punctuation, re-joined English and paragraphs for what she said, by a model — and only if it kept every
 * character: the letters, digits and Han characters of its answer must equal those of the transcript exactly,
 * because the cut matches the script to the footage character by character. Anything else and the plain
 * paragraphs are used.
 */
async function tidy(words: readonly TimedWord[], viewer: Viewer | null): Promise<string[]> {
  const plain = paragraphsOf(words);
  const key = (x: string) => normChars(x).join("");
  /* In chunks of whole paragraphs, so a long take is never one huge call and a failed chunk falls back alone. */
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const p of plain) {
    cur.push(p);
    if (cur.join("").length > 1400) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  const out: string[] = [];
  for (const chunk of chunks) {
    /* One run of text, so the model paragraphs it by meaning rather than keeping the plain breaks. */
    const text = chunk.join("");
    try {
      const r = await complete({ model: modelFor.utility(), temperature: 0, maxTokens: Math.min(6000, text.length * 3 + 400), messages: [{ role: "system", content: PUNCTUATE }, { role: "user", content: text }] });
      if (viewer) await recordUsage({ viewer, module: "script", provider: r.provider ?? "openrouter", model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, costMicros: r.costMicros, requestId: r.requestId ?? undefined }).catch(() => {});
      const tidied = toSimplified(r.text.trim()).replace(/^```\w*\n?|```$/g, "");
      /* Only the model's punctuation, spacing and breaks are taken; every spoken character is hers, as said. */
      const laid = transferPunctuation(text, tidied);
      if (laid && key(laid) === key(text)) {
        out.push(...laid.split(/\n+/).map((x) => x.trim()).filter(Boolean));
        continue;
      }
      console.log(`[from-footage] tidy had too little in common with the transcript; plain paragraphs kept`);
    } catch (err) {
      console.log(`[from-footage] tidy failed: ${err instanceof Error ? err.message : err}`);
    }
    out.push(...chunk);
  }
  return out;
}

/**
 * Write (or extend) the project's script from its host footage.
 *
 *   no script text yet          the transcript becomes the script
 *   a draft written before      kept in 版本记录 as 上传视频前的稿子, then replaced by what she said
 *   already from the footage    a newly added clip's words are added at the end; edits already made are kept
 *   approved and locked         left alone (unlock to bring the footage in)
 */
export async function syncScriptFromFootage(viewer: Viewer, workProjectId: string, opts: { rebuild?: boolean } = {}): Promise<{ changed: boolean; why: string }> {
  const [p] = await db.select({ scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId, title: workProjects.title }).from(workProjects).where(eq(workProjects.id, workProjectId)).limit(1);
  if (!p?.videoProjectId) return { changed: false, why: "the project has no video" };
  const clips = await hostClips(p.videoProjectId);
  if (!clips.length) return { changed: false, why: "no transcribed footage of the host yet" };
  /* No script, or the one it pointed at was deleted (26.10.06 试剪, 7 Oct): the footage gets a fresh one. */
  const [live] = p.scriptId ? await db.select({ id: scripts.id }).from(scripts).where(and(eq(scripts.id, p.scriptId), isNull(scripts.deletedAt))).limit(1) : [];
  if (!live) {
    const made = await createScript(viewer, { title: p.title, aspect: "9:16" });
    await db.update(workProjects).set({ scriptId: made }).where(eq(workProjects.id, workProjectId));
    p.scriptId = made;
  }
  if (!p.scriptId) return { changed: false, why: "the project has no script" };
  const [s] = await db.select({ doc: scripts.doc, footage: scripts.footage, lockedVersion: scripts.lockedVersion }).from(scripts).where(eq(scripts.id, p.scriptId)).limit(1);
  if (!s) return { changed: false, why: "the script is gone" };
  if (s.lockedVersion !== null) return { changed: false, why: "the script is approved and locked" };
  /* Rebuild: write it again from the footage (the earlier text is kept as a version). */
  const linked = new Set(opts.rebuild ? [] : (s.footage?.clipIds ?? []));
  const fresh = clips.filter((c) => !linked.has(c.id));
  if (!fresh.length) return { changed: false, why: "the script already holds this footage" };

  const beats = await db.select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual }).from(scriptBeats).where(eq(scriptBeats.scriptId, p.scriptId)).orderBy(asc(scriptBeats.ord));
  const hasText = beats.some((b) => b.voiceover.trim());
  const incoming: RichNode[] = [];
  for (const c of fresh) for (const t of await tidy(c.words, viewer)) incoming.push(para(t));
  let next: RichDoc;
  if (linked.size) {
    const base = docForBeats((s.doc ?? null) as RichNode | null, beats);
    next = { type: "doc", content: [...(base.content ?? []).filter((n) => n.content?.length || n.attrs?.shot), ...incoming] };
  } else {
    if (hasText) await cutVersion(viewer, p.scriptId, { note: "上传视频前的稿子" });
    next = { type: "doc", content: incoming };
  }
  const nextBeats = beatsFromDoc(next).slice(0, 200);
  const saved = await saveBeats(viewer, p.scriptId, nextBeats.length ? nextBeats : [{ visual: "", voiceover: "", subtitle: "", naturalSound: false }]);
  if (!saved) return { changed: false, why: "the script could not be saved" };
  await db
    .update(scripts)
    .set({ doc: next as unknown as Record<string, unknown>, docHtml: null, footage: { clipIds: [...linked, ...fresh.map((c) => c.id)], at: new Date().toISOString() } })
    .where(eq(scripts.id, p.scriptId));
  return { changed: true, why: linked.size ? `added ${fresh.length} clip(s) to the script` : hasText ? "replaced the written draft (kept in versions) with what was said" : "wrote the script from what was said" };
}

/** The script's spoken text, in order: what the cut keeps. */
export async function scriptText(scriptId: string): Promise<string> {
  const beats = await db.select({ voiceover: scriptBeats.voiceover }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId)).orderBy(asc(scriptBeats.ord));
  return beats.map((b) => b.voiceover).join("\n");
}

/**
 * For a project whose script came from its footage: the clips, and per clip the pieces the script keeps.
 * Null when the script is not linked to footage (a script written to be filmed is cut by the director as before).
 */
export async function footageCut(workProjectId: string): Promise<{
  scriptId: string;
  clips: (HostClip & { kept: boolean[]; pieces: { inMs: number; outMs: number }[] })[];
  keptMs: number;
  totalMs: number;
  sentences: number;
} | null> {
  const [p] = await db.select({ scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId }).from(workProjects).where(eq(workProjects.id, workProjectId)).limit(1);
  if (!p?.scriptId || !p.videoProjectId) return null;
  const [s] = await db.select({ footage: scripts.footage }).from(scripts).where(eq(scripts.id, p.scriptId)).limit(1);
  const ids = s?.footage?.clipIds ?? [];
  if (!ids.length) return null;
  const clips = (await hostClips(p.videoProjectId)).filter((c) => ids.includes(c.id));
  if (!clips.length) return null;
  const text = await scriptText(p.scriptId);
  /* One alignment across all the clips in order, so a sentence that also appears in another clip is matched once, in place. */
  const all = clips.flatMap((c) => c.words.map((w) => ({ ...w, clip: c.id })));
  const kept = keptWords(text, all);
  /* A written draft put back over it (版本记录, an import): most of the script is no longer anything she said, so
     it is not the footage's script any more and the director cuts as it would for any written script. */
  const scriptChars = normChars(text).length;
  const keptChars = all.reduce((n, w, i) => n + (kept[i] ? normChars(w.text).length : 0), 0);
  if (scriptChars > 30 && keptChars < scriptChars * 0.3) return null;
  let at = 0;
  const out = clips.map((c) => {
    const k = kept.slice(at, at + c.words.length);
    at += c.words.length;
    return { ...c, kept: k, pieces: piecesFromKept(c.words, k, { durationMs: c.durationMs }) };
  });
  const totalMs = clips.reduce((n, c) => n + (c.durationMs ?? (c.words.at(-1)?.endMs ?? 0)), 0);
  return { scriptId: p.scriptId, clips: out, keptMs: out.reduce((n, c) => n + piecesMs(c.pieces), 0), totalMs, sentences: text.split(/[。！？!?\n]/).filter((x) => x.trim()).length };
}
