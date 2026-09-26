import { execFile } from "node:child_process";
import type { Candidate } from "@/lib/video/v2/media-adapter";
import { authorKey } from "@/lib/video/v2/rank";

/**
 * Never the same picture twice.
 *
 * v1 put one Pexels clip on screen four times and another twice. The rules
 * here (PLAN.md §1 relevance gate, §2 W3 `diversity.ts`) say what "the
 * same" means and hold the line while beats are sourced in parallel:
 *
 *   id        the provider's id and the permalink, in this video and in the
 *             tenant's videos of the last thirty days
 *   author    at most two assets from one channel or account per video
 *   look      a perceptual hash of the chosen frame (dHash on a 9×8 grey
 *             thumbnail, 64 bits) within a Hamming distance of 10 of one
 *             already chosen is the same shot from another upload
 *   platform  no more than 40 % of the cutaways from one site, so the
 *             sources feel varied; logos are graphics and do not count
 *
 * `reserve` is synchronous and mutates the reservations in the same tick as
 * it checks them, which is what makes it safe under the limiter: two beats
 * cannot both pass for the same clip. `dhashOf` is the one piece of IO, a
 * thin ffmpeg call that returns the 72 grey bytes the pure hash reads.
 */

export type SourcedKind = "video" | "image" | "logo";

export type Reservations = {
  ids: Set<string>;
  authors: Map<string, number>;
  hashes: { hash: string; beatId: string }[];
  platforms: Map<string, number>;
  /** Kinds in beat order, for the alternation preference. */
  kinds: Map<string, SourcedKind>;
  total: number;
  authorCap: number;
  hashMax: number;
  platformShare: number;
};

export function newReservations(opts: { total: number; tenantRecent?: Iterable<string>; used?: Iterable<string>; authorCap?: number; hashMax?: number; platformShare?: number }): Reservations {
  return {
    ids: new Set([...(opts.tenantRecent ?? []), ...(opts.used ?? [])]),
    authors: new Map(),
    hashes: [],
    platforms: new Map(),
    kinds: new Map(),
    total: Math.max(1, opts.total),
    authorCap: opts.authorCap ?? 2,
    hashMax: opts.hashMax ?? 10,
    platformShare: opts.platformShare ?? 0.4,
  };
}

/** The 64-bit difference hash of a 9×8 grey image, as sixteen hex digits. */
export function dhashFromGray(gray: Uint8Array, w = 9, h = 8): string {
  if (gray.length < w * h) throw new Error(`dhash: ${gray.length} bytes for ${w}×${h}`);
  let bits = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      bits += gray[y * w + x] < gray[y * w + x + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** The nearest already-chosen frame, by Hamming distance. */
export function nearest(hash: string, r: Reservations): { distance: number; beatId: string } | null {
  let best: { distance: number; beatId: string } | null = null;
  for (const h of r.hashes) {
    const d = hamming(hash, h.hash);
    if (!best || d < best.distance) best = { distance: d, beatId: h.beatId };
  }
  return best;
}

type Verdict = { ok: true } | { ok: false; reasonZh: string };

/** The checks that need no frame: run before a candidate is fetched, so nothing is downloaded for a clip that cannot be used. */
export function precheck(candidate: Candidate, kind: SourcedKind, r: Reservations): Verdict {
  if (r.ids.has(candidate.id) || r.ids.has(candidate.url)) return { ok: false, reasonZh: "这条素材已经用过（本片或近 30 天）" };
  if ((r.authors.get(authorKey(candidate)) ?? 0) >= r.authorCap) return { ok: false, reasonZh: `同一作者 ${candidate.author.name} 已用 ${r.authorCap} 条` };
  if (kind !== "logo") {
    const cap = Math.max(2, Math.ceil(r.platformShare * r.total));
    if ((r.platforms.get(candidate.platform) ?? 0) >= cap) return { ok: false, reasonZh: `来自 ${candidate.platform} 的镜头已占四成` };
  }
  return { ok: true };
}

/** Take the clip: the prechecks again (another beat may have moved), the look, then the record. */
export function reserve(pick: { beatId: string; candidate: Candidate; kind: SourcedKind; dhash: string }, r: Reservations): Verdict {
  const pre = precheck(pick.candidate, pick.kind, r);
  if (!pre.ok) return pre;
  if (pick.dhash) {
    const near = nearest(pick.dhash, r);
    if (near && near.distance <= r.hashMax) return { ok: false, reasonZh: `画面与已选镜头几乎相同（dHash 距离 ${near.distance}，${near.beatId}）` };
  }
  r.ids.add(pick.candidate.id);
  r.ids.add(pick.candidate.url);
  r.authors.set(authorKey(pick.candidate), (r.authors.get(authorKey(pick.candidate)) ?? 0) + 1);
  if (pick.kind !== "logo") r.platforms.set(pick.candidate.platform, (r.platforms.get(pick.candidate.platform) ?? 0) + 1);
  if (pick.dhash) r.hashes.push({ hash: pick.dhash, beatId: pick.beatId });
  r.kinds.set(pick.beatId, pick.kind);
  return { ok: true };
}

/* ------------------------------------------------------------------- IO */

/** The dHash of a picture or a video frame on disk: ffmpeg scales it to 9×8 grey and the pure hash reads the bytes. */
export function dhashOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"],
      { encoding: "buffer", timeout: 20_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`dhash: ffmpeg failed on ${file}: ${err.message}`));
        try {
          resolve(dhashFromGray(new Uint8Array(stdout as Buffer)));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
