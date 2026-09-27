import "server-only";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Viewer } from "@/lib/auth/types";
import type { Beat, Intent, Layout, Sentence, Sourced } from "@/lib/video/v2/types";
import {
  downloadThumb,
  fetchIntoFiles,
  fetchLocal,
  localAsset,
  mediaSpend,
  search,
  PLATFORM_LABEL,
  type Asset,
  type Candidate,
  type LocalFetch,
  type MediaCtx,
  type MediaKind,
  type Platform,
  type ProviderReport,
} from "@/lib/video/v2/media-adapter";
import { beatQueries, type OutlineHint, type QueryPlan } from "@/lib/video/v2/queries";
import { preferredKind, prefilter, type Ranked } from "@/lib/video/v2/rank";
import { cutClip, pickWindow, sampleFrames, type WindowPick } from "@/lib/video/v2/window";
import { dhashOf, newReservations, precheck, reserve, type Reservations, type SourcedKind } from "@/lib/video/v2/diversity";
import { entityVisual, ogImageCandidate } from "@/lib/video/v2/entities";
import { sheet, type SheetCell } from "@/lib/video/contactsheet";
import { scoreCandidates, visionSpend, type VisionOptions } from "@/lib/video/vision";

/**
 * The most relevant clip from anywhere, once, credited.
 *
 * For every beat that wants a picture (PLAN.md §2 W3): the queries the
 * outline wrote become searches across the sources that suit the beat's
 * kind (`queries.ts`); a named thing also goes through the record
 * (`entities.ts`); the answers are thinned on metadata (`rank.ts`); the
 * survivors go to the vision model, which scores each against the spoken
 * line — a picture or a library clip by its thumbnail, a platform clip by
 * two frames sampled from inside it, because 抖音, B站 and YouTube covers
 * carry the title as an overlay and a cover is not the clip; the best is
 * fetched at once (抖音 addresses expire in an
 * hour), sampled, and the model picks the frame to cut to (`window.ts`);
 * the chosen frame is hashed and the pick is reserved so no other beat can
 * take the same clip, author beyond the cap or look-alike frame
 * (`diversity.ts`); the runner-up steps in on any failure; and a beat for
 * which nothing reaches the gate — 7 of 10, 8 for a named person — gets
 * nothing, which is the right answer: a designed card beats a weak clip.
 *
 * Six beats are sourced at once. A pick is reserved in the same tick it is
 * checked, so parallel beats cannot collide on an asset. Every step is in
 * the trace, and the lab writes contact sheets of what the judge saw.
 *
 * Two modes. `into: "local"` keeps every file on this machine (the lab,
 * and the look-before-you-keep pass in production). `into: "files"` then
 * imports the chosen window through the media library, with attribution
 * and its `file_meta` record, exactly as `fetchAsset` writes them — the
 * very file the judge chose (`localFile`), not a second download, so the
 * product's cutaway is the lab's to the pixel.
 */

export type SourcingCtx = {
  sentences: readonly Sentence[];
  into: "local" | "files";
  /** Required for `into: "files"`. */
  viewer?: Viewer;
  media: MediaCtx;
  /** Thumbnails, frames, clips and sheets are written under here. */
  workDir: string;
  /** Write a contact sheet of the judged candidates per beat. */
  sheets?: boolean;
  /** Provider ids and permalinks already used in this video. */
  used?: Iterable<string>;
  /** dHashes of frames already chosen. */
  hashes?: string[];
  /** Ids and permalinks the tenant used in the last thirty days (`recentSourceIds`). */
  tenantRecent?: Iterable<string>;
  /** Beats sourced at once; 6 by default. */
  limiter?: number;
  /** The video's subject in English, for the judge's context line. */
  contextEn?: string;
  outline?: OutlineHint;
  /** How long the cutaway for a beat will be; the intent's default otherwise. */
  needMs?: (beat: Beat) => number;
  onProgress?: (noteZh: string) => void;
  vision?: VisionOptions;
  /** Clip length cap on the long side; 1920 by default. */
  maxEdge?: number;
};

export type ScoredCandidate = {
  id: string;
  platform: Platform;
  kind: MediaKind;
  title: string;
  credit: string;
  url: string;
  licence?: string;
  pre: number;
  score: number;
  reason: string;
  thumb?: string;
};

export type BeatTrace = {
  beatId: string;
  index: number;
  sentenceId: string;
  intent: Intent;
  line: string;
  needMs: number;
  plan: QueryPlan;
  searches: ProviderReport[];
  entityVisuals: { id: string; via: string; licence?: string }[];
  candidates: number;
  kept: number;
  dropped: { id: string; why: string }[];
  scored: ScoredCandidate[];
  attempts: { id: string; outcome: string }[];
  sheet?: string;
  /** The frame the window was chosen on (video) or the picture itself, for the chosen-windows sheet. */
  chosenImage?: string;
  missReasonZh?: string;
  skipped?: boolean;
  ms: number;
};

export type SourcingReport = {
  sourced: Sourced[];
  traces: BeatTrace[];
  misses: { beatId: string; reasonZh: string }[];
  ms: number;
  spend: { media: ReturnType<typeof mediaSpend>; vision: ReturnType<typeof visionSpend> };
};

/** The id a beat's `Sourced` carries: its position in the list plus its sentence and intent, so W6 can map back. */
export function beatIdOf(beat: Beat, index: number): string {
  return `b${String(index).padStart(2, "0")}-${beat.sentenceId}-${beat.intent}`;
}

/** PLAN.md §1: cutaways 1.5–3.5 s, up to 4.5 s for an interview clip or a headline. */
export function defaultNeedMs(beat: Beat): number {
  switch (beat.intent) {
    case "person":
      return 4_000;
    case "headline":
      return 3_500;
    case "org":
    case "product":
    case "concept":
      return 3_000;
    default:
      return 2_500;
  }
}

/** The relevance gate: 7 of 10, 8 for a named person. */
export function gateFor(beat: Beat): number {
  /*
   * A scene or a metaphor comes from stock libraries, where the in-pipeline
   * judge is generous: in r02 it passed a pip-install terminal, euro notes
   * and Matrix code at 7–8 that the independent re-score gave 2. They need
   * an 8 like a person does; a miss leaves the host or a designed card.
   */
  return beat.intent === "person" || beat.entity?.kind === "person" || beat.intent === "scene" || beat.intent === "metaphor" ? 8 : 7;
}

/**
 * The layout the compositor should use for an asset of this size (PLAN.md
 * §2 W3, last item): a portrait frame at least 1080 wide fills the frame; a
 * 4K landscape frame fills it cropped on the subject; a 720p–1440p
 * landscape frame goes in the `split` panel; anything narrower goes under
 * the presenter circle in `run`.
 */
export function layoutFor(width: number | undefined, height: number | undefined, kind: SourcedKind): Layout {
  if (kind === "logo") return "full";
  if (!width || !height) return "run";
  if (height >= width) return width >= 1080 ? "full" : "run";
  if (width >= 3840) return "full";
  if (width >= 1280) return "split";
  return "run";
}

/* ---------------------------------------------------------------- helpers */

function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60);

const KIND_ZH: Record<SourcedKind, string> = { video: "片段", image: "图片", logo: "标志" };

const providerZh = (p: string) => (p === "stock" ? "图库" : (PLATFORM_LABEL as Record<string, string>)[p] ?? p);

/** Platform clips whose covers carry a title overlay: the judge sees frames from inside them instead. */
const PROBE_PLATFORMS = new Set<Platform>(["douyin", "bilibili", "youtube", "tiktok"]);
/** Probes per beat: two where the clip is the point, one for a scene (the libraries' covers are real frames). */
const probeMax = (intent: Intent) => (intent === "scene" || intent === "metaphor" ? 1 : 2);
/** A probe that has not finished by then is abandoned and the cover is judged instead; the winner is fetched without this limit. */
const PROBE_TIMEOUT_MS = Number(process.env.DV2_PROBE_TIMEOUT_MS) || 25_000;
const JUDGE_MAX_IMAGES = 12;
const MIN_SHORT_SIDE = 540;
/** A picture this small still serves on an entity card (the logo on a tile), never full-frame. */
const MIN_LOGO_SIDE = 300;
/** Candidates tried per beat: judged rejections (window, look-alike, size) stop it at three; a download that merely failed does not count. */
const MAX_REJECTIONS = 3;
const MAX_ATTEMPTS = 6;

/**
 * What no cutaway may be, whatever the beat says: the judge scored an
 * AI-rendered "Anthropic" office with the name misspelt on the facade 10/10
 * in the first review run, because nothing had told it a rendering is not a
 * picture of the thing. Appended to every beat's `mustNot`, for the
 * candidate scoring and the window pick alike. The integrated r01 added the
 * rest: a 2022 Hong Kong TV frame with a Bank of Japan ticker for MOFCOM's
 * statement, an App Store ad screenshot for Kimi, a 2016 Nature cover
 * about a planet for Nature's warning on model collapse — each matched the
 * name and scored 7–10.
 */
const STANDING_MUST_NOT = "an AI-generated, rendered or mocked-up picture (garbled or misspelt signage, impossible architecture, plastic-looking people are the tells); a stock actor posing; a TV news frame with a burned-in ticker, lower third or subtitles; an app-store, marketing or ad screenshot with its sales headline; a picture of a different event, year or subject that only shares a name, logo or masthead with the line (a magazine cover about another story, a press conference on another topic, a repost about another announcement): score what the picture shows against what the line says, not the name it carries; a generic stock screen of code or a terminal, Matrix-style code rain, a keyboard, banknotes, a glowing abstract shape, particles or a pattern standing in for an idea (score these 3 or less unless the line literally names that object)";

function withStandingMustNot(mustNot: string | undefined): string {
  return [mustNot?.trim(), STANDING_MUST_NOT].filter(Boolean).join("; ");
}

/** Whether a small picture is a logo or mark rather than a photograph, by its title and the judge's own words. */
const MARK_WORDS = /\blogo\b|wordmark|\bicon\b|\bseal\b|emblem|badge|标志|图标|徽|商标|logo图/i;
const looksLikeMark = (title: string, reason: string) => MARK_WORDS.test(`${title} ${reason}`);

const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp", "image/svg+xml": "svg" };

/** Two looks inside a clip: past the intro, and past the middle. */
function probeTimes(durationMs: number): number[] {
  if (durationMs <= 4_000) return [Math.round(durationMs / 2)];
  return [Math.round(Math.max(1_000, durationMs * 0.3)), Math.round(durationMs * 0.65)];
}

/** The judge's context: the video's subject and the lines around this one. */
function lineContext(sentences: readonly Sentence[], sentence: Sentence | undefined, topic: string | undefined): string {
  const parts: string[] = [];
  if (topic) parts.push(topic);
  if (sentence) {
    const i = sentences.findIndex((s) => s.id === sentence.id);
    const prev = sentences[i - 1]?.text ?? "";
    const next = sentences[i + 1]?.text ?? "";
    parts.push(`前后文：${prev} ／ ${next}`.slice(0, 200));
  }
  return parts.join(" ");
}

/** For a long video: a 24 s section starting a fifth of the way in (past the intro), never past the end. */
function sectionFor(c: Candidate): { start: number; end: number } | undefined {
  if (c.kind !== "video" || c.handle.via !== "yt-dlp" || !c.durationMs || c.durationMs <= 90_000) return undefined;
  const dur = c.durationMs / 1000;
  const start = Math.round(Math.min(Math.max(5, dur * 0.2), Math.max(5, dur - 30)));
  return { start, end: start + 24 };
}

type JudgeImage = { file: string; atMs?: number; score: number; reason: string };
type Judged = Ranked & { score: number; reason: string; thumb: string; images: JudgeImage[]; kind: SourcedKind; logo: boolean; fromRecord: boolean };

/**
 * Best first: score, then the routing table's preferences at a tie — the
 * record's logo for a company or product, never an agency's seal over a
 * real picture, the kind the beat would rather have, the prefilter's own
 * score. When the top two tie — the same score, or both in the "shows the
 * specific thing" band (9–10) a point apart — and the previous beat's
 * cutaway is of the top one's kind, the other kind goes first, so
 * consecutive cutaways alternate when the choice is free. A whole point
 * across the band edge (9 against 8) is not a free choice: the first
 * review run swapped a 9/10 code clip for an 8/10 photograph that way.
 */
function order(judged: Judged[], beat: Beat, gate: number, prevKind: SourcedKind | undefined): Judged[] {
  const logoWanted = beat.entity && (beat.entity.kind === "company" || beat.entity.kind === "product" || beat.entity.kind === "publication");
  const seal = beat.entity && (beat.entity.kind === "agency" || beat.entity.kind === "legislature");
  const want = preferredKind(beat);
  const bonus = (j: Judged) =>
    j.score < gate ? 0 : (logoWanted && j.logo ? 0.5 : 0) + (seal && j.logo ? -1.5 : 0) + (j.fromRecord && !j.logo ? 0.3 : 0) + (j.candidate.kind === want ? 0.1 : 0) + j.pre * 0.05;
  const sorted = judged.slice().sort((a, b) => b.score + bonus(b) - (a.score + bonus(a)));
  const tie = sorted.length > 1 && (sorted[1].score >= sorted[0].score || (sorted[1].score >= 9 && sorted[0].score - sorted[1].score <= 1));
  if (prevKind && tie && sorted[0].kind === prevKind && sorted[1].kind !== prevKind && sorted[1].score >= gate && !sorted[0].logo) {
    [sorted[0], sorted[1]] = [sorted[1], sorted[0]];
  }
  return sorted;
}

/* ------------------------------------------------------------------ core */

async function sourceOne(beat: Beat, index: number, prevBeatId: string | undefined, ctx: SourcingCtx, r: Reservations): Promise<{ sourced: Sourced | null; trace: BeatTrace }> {
  const t0 = Date.now();
  const beatId = beatIdOf(beat, index);
  const say = ctx.onProgress ?? (() => {});
  const sentence = ctx.sentences.find((s) => s.id === beat.sentenceId);
  const line = sentence?.text ?? beat.must ?? "";
  const context = lineContext(ctx.sentences, sentence, ctx.contextEn);
  const needMs = ctx.needMs?.(beat) ?? defaultNeedMs(beat);
  const plan = beatQueries(beat, ctx.outline);
  const trace: BeatTrace = { beatId, index, sentenceId: beat.sentenceId, intent: beat.intent, line, needMs, plan, searches: [], entityVisuals: [], candidates: 0, kept: 0, dropped: [], scored: [], attempts: [], ms: 0 };
  const done = (sourced: Sourced | null, miss?: string, skipped?: boolean) => {
    trace.ms = Date.now() - t0;
    if (miss) trace.missReasonZh = miss;
    if (skipped) trace.skipped = true;
    return { sourced, trace };
  };

  if (!plan.searches.length && !beat.entity && !beat.headline?.url) return done(null, plan.noteZh, true);
  if (!line) return done(null, "这个节拍没有对应的句子");

  /* 1. Everything at once: the searches, the record, the headline's own page. */
  const where = Array.from(new Set(plan.searches.flatMap((s) => s.providers))).map(providerZh).join("、");
  say(`在${where || "网上"}找『${plan.zh[0] ?? plan.en[0] ?? beat.must ?? ""}』`);
  const [results, visuals, og] = await Promise.all([
    Promise.all(
      plan.searches.map((s) =>
        search(s.query, { kind: s.kind, providers: s.providers, maxDurationS: s.maxDurationS, orientation: s.orientation, limit: s.limit, budgetMs: 8_000 }, ctx.media).catch(() => ({ candidates: [], providers: [], ms: 0, cached: false })),
      ),
    ),
    beat.entity ? entityVisual(beat.entity, { cacheDir: ctx.media.cacheDir }).catch(() => []) : Promise.resolve([]),
    beat.headline?.url ? ogImageCandidate(beat.headline.url).catch(() => null) : Promise.resolve(null),
  ]);
  trace.searches = results.flatMap((x) => x.providers);
  trace.entityVisuals = visuals.map((v) => ({ id: v.candidate.id, via: v.via, licence: v.candidate.licence }));
  const markIds = new Set(visuals.filter((v) => v.isMark).map((v) => v.candidate.id));
  const recordIds = new Set(visuals.map((v) => v.candidate.id));
  const candidates: Candidate[] = [...visuals.map((v) => v.candidate), ...(og ? [og] : []), ...results.flatMap((x) => x.candidates)];
  trace.candidates = candidates.length;
  if (!candidates.length) return done(null, "各个来源都没有返回候选");

  /* 2. Thin on metadata. */
  const wantsClip = beat.intent === "scene" || beat.intent === "metaphor" || beat.intent === "person" || beat.intent === "product" || beat.intent === "concept";
  const { kept, dropped } = prefilter(candidates, beat, plan, { usedIds: r.ids, usedAuthors: r.authors, authorCap: r.authorCap, needMs, keep: wantsClip ? 12 : 10, maxImages: wantsClip ? 4 : undefined, logoIds: markIds, minLogoSide: MIN_LOGO_SIDE });
  trace.kept = kept.length;
  trace.dropped = dropped;
  if (!kept.length) return done(null, `候选 ${candidates.length} 条全部被初筛淘汰`);

  /* 3. Pictures for the judge: the thumbnail for a picture or a library clip,
        two frames from inside for the best platform clips (their covers carry
        the title as an overlay). A probed clip is on disk already, so the
        winner needs no second download. */
  const thumbDir = path.join(ctx.workDir, "thumbs", safe(beatId));
  const probeTargets = new Set(
    kept
      .filter((k) => k.candidate.kind === "video" && PROBE_PLATFORMS.has(k.candidate.platform))
      .sort((a, b) => b.pre - a.pre)
      .slice(0, probeMax(beat.intent))
      .map((k) => k.candidate.id),
  );
  const probed = new Map<string, LocalFetch>();
  const perCandidate = await Promise.all(
    kept.map(async (k, j): Promise<{ k: Ranked; images: { file: string; atMs?: number }[] }> => {
      const c = k.candidate;
      if (probeTargets.has(c.id)) {
        try {
          const local = await fetchLocal(c, { windowS: sectionFor(c), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }, ctx.media);
          const frames = await sampleFrames(local.file, probeTimes(local.durationMs ?? 0), thumbDir, `p${j}`, 400);
          if (frames.length) {
            probed.set(c.id, local);
            return { k, images: frames.map((f) => ({ file: f.file, atMs: f.atMs })) };
          }
        } catch (err) {
          trace.attempts.push({ id: c.id, outcome: `探看失败，改用封面：${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` });
        }
      }
      const t = await downloadThumb(c, path.join(thumbDir, `${j}.jpg`));
      return { k, images: t ? [{ file: t }] : [] };
    }),
  );
  let shown = perCandidate.filter((x) => x.images.length);
  /* The judge reads a dozen pictures well, no more: the least promising covers go first. */
  while (shown.reduce((n, x) => n + x.images.length, 0) > JUDGE_MAX_IMAGES && shown.length > 1) {
    const cheapest = shown.filter((x) => x.images.length === 1).sort((a, b) => a.k.pre - b.k.pre)[0] ?? shown[shown.length - 1];
    shown = shown.filter((x) => x !== cheapest);
  }
  if (!shown.length) return done(null, "候选的缩略图一张都拿不到");
  const flat = shown.flatMap((x) => x.images.map((img) => ({ x, img })));

  /* 4. The judge. */
  say(`核对 ${shown.length} 个候选（${flat.length} 张图）与「${line.slice(0, 18)}」的相关度`);
  const gate = gateFor(beat);
  const entity = beat.entity ? { name: beat.entity.name, descriptorZh: beat.entity.descriptorZh, romanised: beat.entity.romanised } : undefined;
  const mustNot = withStandingMustNot(beat.mustNot);
  /* The same guard goes to the window pick, which reads the beat's own fields. */
  const judgeBeat: Beat = { ...beat, mustNot };
  let judged: Judged[];
  try {
    const res = await scoreCandidates(line, context, flat.map((f) => f.img.file), { must: beat.must, mustNot, entity }, ctx.vision);
    judged = shown.map((x) => {
      const images: JudgeImage[] = flat.map((f, i) => ({ f, i })).filter(({ f }) => f.x === x).map(({ f, i }) => ({ file: f.img.file, atMs: f.img.atMs, score: res.scores[i].score, reason: res.scores[i].reason }));
      const best = images.reduce((b, im) => (im.score > b.score ? im : b), images[0]);
      const id = x.k.candidate.id;
      return { ...x.k, score: best.score, reason: best.reason, thumb: best.file, images, kind: markIds.has(id) ? "logo" : x.k.candidate.kind, logo: markIds.has(id), fromRecord: recordIds.has(id) };
    });
  } catch (err) {
    return done(null, `视觉模型没有回答：${err instanceof Error ? err.message : String(err)}`);
  }
  trace.scored = judged.map((j) => ({ id: j.candidate.id, platform: j.candidate.platform, kind: j.candidate.kind, title: j.candidate.title, credit: j.candidate.credit, url: j.candidate.url, licence: j.candidate.licence, pre: j.pre, score: j.score, reason: j.reason, thumb: j.thumb }));

  const sheetJob = ctx.sheets
    ? mkdir(path.join(ctx.workDir, "sheets"), { recursive: true })
        .then(() =>
          sheet(
            judged.flatMap((j) =>
              j.images.map((im): SheetCell => ({
                image: im.file,
                label: `${im.score}/10 ${PLATFORM_LABEL[j.candidate.platform]} ${j.candidate.kind}${j.logo ? " mark" : ""}${im.atMs !== undefined ? ` t=${(im.atMs / 1000).toFixed(0)}s` : ""}\n${j.candidate.title.slice(0, 40)}\n${j.candidate.credit.slice(0, 40)}\n${im.reason}`,
              })),
            ),
            path.join(ctx.workDir, "sheets", `cands-${safe(beatId)}.jpg`),
            { cols: 5, cellW: 300, cellH: 240, labelLines: 4, title: `${beatId} · ${line.slice(0, 40)} · gate ${gate}` },
          ),
        )
        .then((p) => {
          trace.sheet = p;
        })
        .catch((err) => console.warn(`[sourcing] sheet for ${beatId} failed: ${err instanceof Error ? err.message : String(err)}`))
    : Promise.resolve();

  /* 5. Best first, then try them in turn. */
  const prevKind = prevBeatId ? r.kinds.get(prevBeatId) : undefined;
  const ordered = order(judged, beat, gate, prevKind).filter((j) => j.score >= gate);
  const alternatives = (chosen: string) =>
    judged
      .filter((j) => j.candidate.id !== chosen && j.score >= 6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((j) => ({ candidate: j.candidate, score: j.score }));
  const best = judged.reduce((m, j) => Math.max(m, j.score), 0);
  if (!ordered.length) {
    await sheetJob;
    return done(null, `没有候选达到 ${gate}/10（最高 ${best}）`);
  }

  let lastReason = "";
  let rejections = 0;
  const shortSide = (local: { width?: number; height?: number }) => (local.width && local.height ? Math.min(local.width, local.height) : undefined);
  const tooSmall = (local: { width?: number; height?: number }, kind: SourcedKind) => (shortSide(local) ?? Infinity) < (kind === "logo" ? MIN_LOGO_SIDE : MIN_SHORT_SIDE);
  for (const j of ordered.slice(0, MAX_ATTEMPTS)) {
    if (rejections >= MAX_REJECTIONS) break;
    const c = j.candidate;
    const pre = precheck(c, j.kind, r);
    if (!pre.ok) {
      trace.attempts.push({ id: c.id, outcome: pre.reasonZh });
      lastReason = pre.reasonZh;
      continue;
    }
    try {
      if (c.kind === "video") {
        say(`取『${c.title.slice(0, 20)}』（${PLATFORM_LABEL[c.platform]}）并选取起点`);
        const local = probed.get(c.id) ?? (await fetchLocal(c, { windowS: sectionFor(c) }, ctx.media));
        if (tooSmall(local, "video")) {
          const why = `短边只有 ${shortSide(local)} px，放大会糊`;
          trace.attempts.push({ id: c.id, outcome: why });
          lastReason = why;
          rejections++;
          continue;
        }
        const verdict = await pickWindow({ file: local.file, durationMs: local.durationMs ?? 0, sectionStartMs: local.sectionStartMs }, judgeBeat, line, needMs, {
          dir: path.join(ctx.workDir, "frames", safe(beatId)),
          prefix: safe(c.id),
          context,
          entity,
          minScore: gate,
          /*
           * A headline's text is the point. Not a product's: r02 tried letting
           * an app's own screen through (the judge calls a chat UI "burned-in
           * text") and a Bilibili tutorial with 「然后我们点击这个」 burned across
           * the bottom went on screen for Claude.
           */
          allowBurnedText: beat.intent === "headline",
          visionOpts: ctx.vision,
        });
        if (!verdict.ok) {
          trace.attempts.push({ id: c.id, outcome: verdict.reasonZh });
          lastReason = verdict.reasonZh;
          rejections++;
          continue;
        }
        const pick: WindowPick = verdict.pick;
        const dhash = await dhashOf(pick.best.file);
        const res = reserve({ beatId, candidate: c, kind: "video", dhash }, r);
        if (!res.ok) {
          trace.attempts.push({ id: c.id, outcome: res.reasonZh });
          lastReason = res.reasonZh;
          rejections++;
          continue;
        }
        const clip = path.join(ctx.workDir, "clips", `${safe(beatId)}.mp4`);
        const cut = await cutClip(local.file, clip, { startMs: pick.localStartMs, durationMs: needMs + 1_000, maxEdge: ctx.maxEdge ?? 1920 });
        const asset: Asset =
          ctx.into === "files" && ctx.viewer
            ? await fetchIntoFiles(ctx.viewer, c, { windowS: { start: pick.windowMs[0] / 1000, end: (pick.windowMs[1] + 1_000) / 1000 }, forLine: line, localFile: clip })
            : localAsset(c, { file: clip, ...cut }, pick.windowMs);
        trace.attempts.push({ id: c.id, outcome: "选用" });
        trace.chosenImage = pick.best.file;
        await sheetJob;
        const width = asset.width ?? cut.width;
        const height = asset.height ?? cut.height;
        return done({
          beatId,
          asset,
          candidate: c,
          kind: "video",
          score: Math.min(j.score, pick.score),
          reasonZh: `${KIND_ZH.video}来自${PLATFORM_LABEL[c.platform]}，相关度 ${j.score}/10（${j.reason}），起点 ${(pick.windowMs[0] / 1000).toFixed(1)} s（${pick.reason}）`,
          windowMs: pick.windowMs,
          subjectX: pick.subjectX,
          dhash,
          layout: layoutFor(width, height, "video"),
          alternatives: alternatives(c.id),
        });
      }

      say(`取『${c.title.slice(0, 20)}』（${PLATFORM_LABEL[c.platform]}）`);
      const local = await fetchLocal(c, {}, ctx.media);
      /* A small picture of a company's or product's *logo* still serves on the entity card; a small picture of
         anything else — the first review run put a 640 px aerial photo of a campus on the logo tile — is out. */
      let kind: SourcedKind = j.kind;
      if (tooSmall(local, kind)) {
        const side = shortSide(local)!;
        if (beat.intent === "org" && beat.entity && beat.entity.kind !== "agency" && beat.entity.kind !== "legislature" && side >= MIN_LOGO_SIDE && looksLikeMark(c.title, j.reason)) {
          kind = "logo";
        } else {
          const why = `短边只有 ${side} px，放大会糊`;
          trace.attempts.push({ id: c.id, outcome: why });
          lastReason = why;
          rejections++;
          continue;
        }
      }
      const dhash = await dhashOf(local.file);
      const res = reserve({ beatId, candidate: c, kind, dhash }, r);
      if (!res.ok) {
        trace.attempts.push({ id: c.id, outcome: res.reasonZh });
        lastReason = res.reasonZh;
        rejections++;
        continue;
      }
      /* The picture goes into the run's own directory, so the run stands on its own once the cache is swept. */
      const still = path.join(ctx.workDir, "clips", `${safe(beatId)}.${EXT_BY_MIME[local.mime ?? ""] ?? "img"}`);
      await mkdir(path.dirname(still), { recursive: true });
      await copyFile(local.file, still);
      const asset: Asset = ctx.into === "files" && ctx.viewer ? await fetchIntoFiles(ctx.viewer, c, { forLine: line, localFile: still }) : localAsset(c, { file: still, width: local.width, height: local.height });
      const smallForCard = kind === "logo" && j.kind !== "logo";
      trace.attempts.push({ id: c.id, outcome: smallForCard ? "选用（小图，只作机构卡用）" : "选用" });
      trace.chosenImage = still;
      await sheetJob;
      return done({
        beatId,
        asset,
        candidate: c,
        kind,
        score: j.score,
        reasonZh: `${smallForCard ? "小图" : KIND_ZH[kind]}来自${PLATFORM_LABEL[c.platform]}，相关度 ${j.score}/10（${j.reason}）${c.licence ? `，授权 ${c.licence}` : ""}${smallForCard ? `，短边 ${shortSide(local)} px，只作机构卡用` : ""}`,
        windowMs: [0, needMs],
        subjectX: 0.5,
        dhash,
        layout: layoutFor(asset.width ?? local.width, asset.height ?? local.height, kind),
        alternatives: alternatives(c.id),
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      trace.attempts.push({ id: c.id, outcome: `失败：${why.slice(0, 160)}` });
      lastReason = `取用失败：${why.slice(0, 120)}`;
    }
  }
  await sheetJob;
  return done(null, lastReason || `达标的候选都没能取用（最高 ${best}/10）`);
}

/* ------------------------------------------------------------------ entry */

/**
 * undici — Node's own fetch — can throw an AssertionError out of a socket
 * 'end' handler when a remote host closes a keep-alive connection in the
 * middle of a response (nodejs/undici, "false == true at Parser.finish";
 * undici 6.28 on Node 22.23 did it on the 41st search of the cold review
 * run, from one of the two hundred picture hosts a run touches). That is
 * an uncaught exception, not a rejected promise: no try/catch in the
 * fetcher sees it, and a worker process dies in the middle of a director
 * run. While beats are being sourced, that one error is logged and the
 * request that hit it fails by its own timeout, which every request here
 * has. Any other uncaught exception is printed and ends the process, as
 * Node would have done with no listener at all.
 */
function guardUndiciAssertions(): () => void {
  const handler = (err: unknown) => {
    const e = err as { code?: string; stack?: string; message?: string } | null;
    if (e && e.code === "ERR_ASSERTION" && /undici/.test(e.stack ?? "")) {
      console.warn(`[sourcing] undici socket assertion ignored: ${e.message ?? ""}`);
      return;
    }
    console.error(err);
    process.exit(1);
  };
  process.on("uncaughtException", handler);
  return () => {
    process.removeListener("uncaughtException", handler);
  };
}

export async function sourceBeatsReport(beats: Beat[], ctx: SourcingCtx): Promise<SourcingReport> {
  const t0 = Date.now();
  if (ctx.into === "files" && !ctx.viewer) throw new Error("sourceBeats: into \"files\" needs a viewer");
  await mkdir(ctx.workDir, { recursive: true });
  const r = newReservations({ total: beats.length, tenantRecent: ctx.tenantRecent, used: ctx.used });
  for (const h of ctx.hashes ?? []) r.hashes.push({ hash: h, beatId: "earlier" });
  const run = limiter(ctx.limiter ?? 6);
  const unguard = guardUndiciAssertions();
  let rows: { sourced: Sourced | null; trace: BeatTrace }[];
  try {
    rows = await sourceAll(beats, ctx, r, run);
  } finally {
    unguard();
  }
  const sourced = rows.map((x) => x.sourced).filter((s): s is Sourced => Boolean(s));
  const traces = rows.map((x) => x.trace);
  const misses = traces.filter((t) => !t.skipped && t.missReasonZh).map((t) => ({ beatId: t.beatId, reasonZh: t.missReasonZh! }));
  return { sourced, traces, misses, ms: Date.now() - t0, spend: { media: mediaSpend(), vision: visionSpend() } };
}

function sourceAll(beats: Beat[], ctx: SourcingCtx, r: Reservations, run: <T>(fn: () => Promise<T>) => Promise<T>): Promise<{ sourced: Sourced | null; trace: BeatTrace }[]> {
  return Promise.all(
    beats.map((beat, i) =>
      run(() =>
        sourceOne(beat, i, i > 0 ? beatIdOf(beats[i - 1], i - 1) : undefined, ctx, r).catch((err): { sourced: Sourced | null; trace: BeatTrace } => ({
          sourced: null,
          trace: {
            beatId: beatIdOf(beat, i),
            index: i,
            sentenceId: beat.sentenceId,
            intent: beat.intent,
            line: "",
            needMs: ctx.needMs?.(beat) ?? defaultNeedMs(beat),
            plan: beatQueries(beat, ctx.outline),
            searches: [],
            entityVisuals: [],
            candidates: 0,
            kept: 0,
            dropped: [],
            scored: [],
            attempts: [],
            missReasonZh: `出错：${err instanceof Error ? err.message : String(err)}`,
            ms: 0,
          },
        })),
      ),
    ),
  );
}

/** PLAN.md §2 W3's entry point: the picks, in beat order; the report is for the lab and the director's log. */
export async function sourceBeats(beats: Beat[], ctx: SourcingCtx): Promise<Sourced[]> {
  return (await sourceBeatsReport(beats, ctx)).sourced;
}

/* ------------------------------------------------------------- IO: recent */

/**
 * What the tenant's videos used in the last `days` days: the provider ids
 * and permalinks in every graphic's `options.asset` snapshot and in each
 * project's `director.media.assets` record. Read-only, through a lazy
 * import so the pure path never loads the database client.
 */
export async function recentSourceIds(tenantId: string, days = 30): Promise<Set<string>> {
  const { db } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) out.add(v);
  };
  const rows = <T,>(res: unknown): T[] => (Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []));
  try {
    const a = await db.execute(sql`
      select distinct g.options->'asset'->'candidate'->>'id' as id, g.options->'asset'->'candidate'->>'url' as url
      from video_graphics g join video_projects p on p.id = g.project_id
      where p.tenant_id = ${tenantId} and p.updated_at > now() - make_interval(days => ${days}) and g.options ? 'asset'`);
    for (const row of rows<{ id?: string; url?: string }>(a)) {
      add(row.id);
      add(row.url);
    }
    const b = await db.execute(sql`
      select distinct m->>'permalink' as url
      from video_projects p, jsonb_array_elements(coalesce(p.director->'media'->'assets', '[]'::jsonb)) m
      where p.tenant_id = ${tenantId} and p.updated_at > now() - make_interval(days => ${days})`);
    for (const row of rows<{ url?: string }>(b)) add(row.url);
  } catch (err) {
    console.warn(`[sourcing] recent assets could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}
