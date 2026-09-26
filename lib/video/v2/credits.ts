import type { Credits, Sourced } from "@/lib/video/v2/types";
import { creditLine, creditsBlock, PLATFORM_LABEL, type Asset, type Platform } from "@/lib/video/v2/media-adapter";

/**
 * Where the credits go, and in what shape.
 *
 * The text is the media library's (`lib/media/credits.ts`): the one-line
 * form for the end card and the full block for the publish copy, takedown
 * line included. This module only decides placement: which assets count
 * (each once, in the order they appear), how the end-card line is kept to
 * two lines of 26 px type when a video used many sources, and the record
 * that goes on the project (`director.credits` and `director.assets`, W6's
 * `persist.ts` writes them).
 *
 * The fit is measured in CJK units: a Han glyph is one, a Latin one about
 * half. At 26 px inside the 64 px side margins (952 px of width) a line
 * holds about 36 units, so two lines hold 72. Over that, each platform's
 * group keeps its first account and says how many more (「抖音 @甲 等 3
 * 位」); still over, the groups shrink to a count.
 */

export const LINE_UNITS = 72;

/** Display width in CJK units. */
export function units(text: string): number {
  let n = 0;
  for (const ch of Array.from(text)) n += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : ch === " " ? 0.3 : 0.55;
  return n;
}

/** Each used asset once, in beat order, by permalink. */
export function usedAssets(sourced: readonly Sourced[]): Asset[] {
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (const s of sourced) {
    const key = s.asset.candidate.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.asset);
  }
  return out;
}

/* The account part of a credit, without its platform label: "抖音 @甲" → "@甲", "YouTube · CNBC" → "CNBC". */
function accountOf(asset: Asset): string {
  const label = PLATFORM_LABEL[asset.candidate.platform];
  const c = asset.credit.trim();
  const rest = c.startsWith(label) ? c.slice(label.length).replace(/^\s*·\s*/, "").trim() : c;
  return rest || asset.candidate.author.name;
}

/** The end-card line, compacted until it fits `maxUnits`. */
export function fitLine(assets: readonly Asset[], maxUnits = LINE_UNITS): string {
  const full = creditLine([...assets]);
  if (units(full) <= maxUnits) return full;
  const order = Object.keys(PLATFORM_LABEL) as Platform[];
  const groups = new Map<Platform, string[]>();
  for (const a of assets) {
    const names = groups.get(a.candidate.platform) ?? [];
    const name = accountOf(a);
    if (!names.includes(name)) names.push(name);
    groups.set(a.candidate.platform, names);
  }
  const present = order.filter((p) => groups.has(p));
  /* Web pictures are credited to sites, the libraries and Commons to their works; everything else to accounts. */
  const unit = (p: Platform) => (p === "bing" ? "家网站" : p === "wikimedia" || p === "pexels" || p === "unsplash" || p === "openverse" ? "项" : "位");
  const short = (name: string) => (units(name) > 14 ? `${Array.from(name).slice(0, 12).join("")}…` : name);
  const compact = present.map((p) => {
    const names = groups.get(p)!;
    return `${PLATFORM_LABEL[p]} ${short(names[0])}${names.length > 1 ? ` 等${names.length}${unit(p)}` : ""}`;
  });
  let line = `素材来源：${compact.join(" · ")}`;
  if (units(line) <= maxUnits) return line;
  line = `素材来源：${present.map((p) => `${PLATFORM_LABEL[p]} ${groups.get(p)!.length}${unit(p)}`).join(" · ")}`;
  return line;
}

/**
 * The credits for a sourced video: the line, the block, the assets. The
 * block always ends with the takedown line, which the library appends.
 */
export function placeCredits(sourced: readonly Sourced[], opts: { maxLineUnits?: number } = {}): Credits {
  const assets = usedAssets(sourced);
  return {
    line: assets.length ? fitLine(assets, opts.maxLineUnits ?? LINE_UNITS) : "",
    block: assets.length ? creditsBlock([...assets]) : "",
    assets,
  };
}

/** The per-graphic credit the editor already shows (`options.credit`). */
export function creditFor(sourced: Sourced): string {
  return sourced.asset.credit;
}
