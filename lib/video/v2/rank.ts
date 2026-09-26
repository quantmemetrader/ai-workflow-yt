import type { Beat } from "@/lib/video/v2/types";
import type { Candidate, MediaKind } from "@/lib/video/v2/media-adapter";
import { zhWords, type QueryPlan } from "@/lib/video/v2/queries";

/**
 * Which candidates are worth showing the vision model.
 *
 * A search fan-out returns twenty to forty candidates; the judge reads
 * eight to ten well (Stage 0 measured the flash model skipping rows past
 * that). This is the cheap pass in between, on metadata alone:
 *
 *   drop     anything already used in this video or recently by the
 *            tenant; a channel at its cap (two assets per author per
 *            video); a Pinterest pin whose original is a stock-photo site
 *            (credited, not licensed, and usually watermarked); a clip
 *            shorter than the beat needs; a frame under 540 px on the short
 *            side (it would be upscaled); a title that says it is a
 *            compilation, a captioned re-upload, a reaction, a meme.
 *   score    how much of what the beat must show is in the title and
 *            description — Chinese by the segmenter's words, English by
 *            token — with popularity as a tie-break and a small nudge for
 *            the sources the routing table ranks first for this intent.
 *   keep     eight to ten, taken round-robin across the sources that
 *            answered, so a judge never sees ten of one site when three
 *            answered.
 *
 * Pure, so the lab can replay a search's JSON through it.
 */

export type Ranked = { candidate: Candidate; pre: number; why: string[] };

export type PrefilterOpts = {
  /** Provider ids and permalinks already taken, in this run and in the tenant's recent videos. */
  usedIds: ReadonlySet<string>;
  /** Assets already taken per author key (`authorKey`). */
  usedAuthors: ReadonlyMap<string, number>;
  authorCap?: number;
  /** How long the cutaway will be, in ms; a clip must hold it with room to spare. */
  needMs: number;
  keep?: number;
  minShortSide?: number;
  /** Candidates that are a logo, seal or emblem (the record's P154 claim): they serve on an entity card, so a
   * smaller short side is enough — a 4000-wide wordmark is 450 px tall and would otherwise be thrown out. */
  logoIds?: ReadonlySet<string>;
  /** The short side a logo needs; 300 by default. */
  minLogoSide?: number;
  /** At most this many pictures among the kept, for a beat that wants a clip. */
  maxImages?: number;
};

export const BLACKLIST = /合集|字幕版|带字幕|中字|水印|混剪|鬼畜|搬运|直播回放|完整版|全集|reaction|compilation|watermark|meme|brainrot|lyrics|歌词|reupload|mashup|tiktok trend|asmr/i;

/** The author as a diversity key: platform plus the platform's own id, or the name when it gives none. */
export function authorKey(c: Candidate): string {
  return `${c.platform}:${(c.author.id || c.author.name || "").toLowerCase()}`;
}

const LATIN = /[a-z][a-z0-9'-]{2,}/gi;
const HAN = /[㐀-鿿]/;

/** Terms to look for: Chinese words of two or more characters, Latin tokens of three or more letters, numbers with their unit. */
export function terms(text: string): string[] {
  const out = new Set<string>();
  const zh = text.replace(/[^㐀-鿿\d%.]+/g, " ");
  for (const chunk of zh.split(/\s+/)) {
    if (!chunk) continue;
    if (HAN.test(chunk)) {
      for (const w of zhWords(chunk)) if (w.length >= 2 && HAN.test(w)) out.add(w);
    } else if (/\d/.test(chunk)) out.add(chunk);
  }
  for (const m of text.matchAll(LATIN)) out.add(m[0].toLowerCase());
  return Array.from(out);
}

/** Share of `wanted` found in `text`, 0–1. */
export function overlap(text: string, wanted: readonly string[]): number {
  if (!wanted.length) return 0;
  const hay = text.toLowerCase();
  let n = 0;
  for (const t of wanted) if (hay.includes(t.toLowerCase())) n++;
  return n / wanted.length;
}

/* The routing table's order, as a small nudge per intent; the judge decides the rest. */
const NUDGE: Record<string, Partial<Record<Candidate["platform"], number>>> = {
  person: { douyin: 0.15, bilibili: 0.15, youtube: 0.12, wikimedia: 0.2, bing: 0.08, pinterest: 0.05 },
  product: { youtube: 0.15, bilibili: 0.15, douyin: 0.12, wikimedia: 0.15, bing: 0.05 },
  org: { wikimedia: 0.3, bing: 0.15, youtube: 0.1, bilibili: 0.1, douyin: 0.1 },
  headline: { bing: 0.12, douyin: 0.1, bilibili: 0.1 },
  concept: { bilibili: 0.1, youtube: 0.1 },
  scene: { pexels: 0.1, pinterest: 0.08, douyin: 0.08, unsplash: 0.05, openverse: 0.03 },
  metaphor: { pexels: 0.1, pinterest: 0.08, douyin: 0.05 },
};

function popularity(c: Candidate): number {
  const n = c.stats?.views ?? c.stats?.likes ?? 0;
  return Math.min(1, Math.log10(n + 1) / 8);
}

export function prefilter(cands: Candidate[], beat: Beat, plan: QueryPlan, opts: PrefilterOpts): { kept: Ranked[]; dropped: { id: string; why: string }[] } {
  const cap = opts.authorCap ?? 2;
  const keep = opts.keep ?? 10;
  const minSide = opts.minShortSide ?? 540;
  const wanted = terms([beat.must ?? "", beat.entity?.name ?? "", beat.entity?.romanised ?? "", ...plan.zh.slice(0, 2), ...plan.en.slice(0, 2)].join(" "));
  const nudge = NUDGE[beat.intent] ?? {};
  const want = preferredKind(beat);
  const authors = new Map<string, number>(opts.usedAuthors);
  const seen = new Set<string>();
  const kept: Ranked[] = [];
  const dropped: { id: string; why: string }[] = [];

  for (const c of cands) {
    const key = c.id;
    if (seen.has(key) || seen.has(c.url)) continue;
    seen.add(key);
    seen.add(c.url);
    const why: string[] = [];
    if (opts.usedIds.has(c.id) || opts.usedIds.has(c.url)) {
      dropped.push({ id: c.id, why: "已用过" });
      continue;
    }
    if ((authors.get(authorKey(c)) ?? 0) >= cap) {
      dropped.push({ id: c.id, why: "同一作者已达上限" });
      continue;
    }
    if (c.licence?.startsWith("stock:")) {
      dropped.push({ id: c.id, why: "图库转载（可能带水印）" });
      continue;
    }
    if (c.kind === "video" && c.durationMs !== undefined && c.durationMs < opts.needMs + 800) {
      dropped.push({ id: c.id, why: "太短" });
      continue;
    }
    const isLogo = opts.logoIds?.has(c.id) ?? false;
    const need = isLogo ? (opts.minLogoSide ?? 300) : minSide;
    if (c.width && c.height && Math.min(c.width, c.height) < need) {
      dropped.push({ id: c.id, why: `短边 ${Math.min(c.width, c.height)} px 不够${isLogo ? "（标志也至少要 300）" : ""}` });
      continue;
    }
    if (BLACKLIST.test(`${c.title} ${c.description ?? ""}`)) {
      dropped.push({ id: c.id, why: "标题像合集/字幕版/反应视频" });
      continue;
    }
    const text = `${c.title} ${c.description ?? ""} ${c.author.name}`;
    const o = overlap(text, wanted);
    const pop = popularity(c);
    const n = nudge[c.platform] ?? 0;
    /* The kind the beat would rather have (a clip for a scene or a person, a picture for a logo or a headline) goes a little first. */
    const k = c.kind === want ? 0.1 : 0;
    const pre = o + 0.15 * pop + n + k;
    if (o > 0) why.push(`标题命中 ${Math.round(o * 100)}%`);
    if (n) why.push(`来源优先 +${n}`);
    if (k) why.push(`类型优先 +${k}`);
    kept.push({ candidate: c, pre: Number(pre.toFixed(3)), why });
  }

  /* Round-robin over the sources — a source's clips and its pictures as two
     sources, or Pexels' fully-titled photographs would take every slot from
     its slug-titled clips — each list best first. */
  const groups = new Map<string, Ranked[]>();
  for (const r of kept.sort((a, b) => b.pre - a.pre)) {
    const key = `${r.candidate.platform}:${r.candidate.kind}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const order = Array.from(groups.entries()).sort((a, b) => b[1][0].pre - a[1][0].pre);
  const chosen: Ranked[] = [];
  const maxImages = opts.maxImages ?? keep;
  let round = 0;
  while (chosen.length < keep) {
    let took = false;
    for (const [, g] of order) {
      const r = g[round];
      if (!r) continue;
      if (r.candidate.kind === "image" && chosen.filter((c) => c.candidate.kind === "image").length >= maxImages) continue;
      chosen.push(r);
      took = true;
      if (chosen.length >= keep) break;
    }
    if (!took) break;
    round++;
  }
  for (const r of kept) if (!chosen.includes(r)) dropped.push({ id: r.candidate.id, why: "初筛未入前十" });
  return { kept: chosen, dropped };
}

/** For a tie between two judged candidates: the kind the beat would rather have. */
export function preferredKind(beat: Beat): MediaKind {
  return beat.intent === "org" || beat.intent === "headline" ? "image" : "video";
}
