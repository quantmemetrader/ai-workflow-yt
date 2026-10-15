/**
 * The script decides the cut (15 Oct: "if they remove the data from the script then it should cut those out").
 *
 * When a project's footage is the host talking, its script page holds what she actually said, word for word
 * (`lib/script/from-footage.ts`). Whatever is still in the script is kept; whatever was deleted from it is cut
 * out of the video. Words typed into the script that she never said cannot appear, and are ignored.
 *
 * Pure functions, no database: the director's v2 cut and the plain cut both call these.
 */

export type TimedWord = { text: string; startMs: number; endMs: number };
export type Piece = { inMs: number; outMs: number };

/** Letters, digits and Han characters only, lower-cased: punctuation, spaces and case never decide a cut. */
export function normChars(s: string): string[] {
  return [...s.toLowerCase().normalize("NFKC")].filter((c) => /[\p{L}\p{N}]/u.test(c));
}

/**
 * Which characters of `a` also appear, in order, in `b`: a shortest-edit-script (Myers) diff over characters.
 * Returns a mask over `a`. Linear memory per step, fast when the two are close (the usual case: a transcript
 * with some lines deleted), and bounded so a script that has nothing to do with the footage cannot stall a job.
 */
export function matchedMask(a: readonly string[], b: readonly string[], maxD = 6000): boolean[] {
  const n = a.length;
  const m = b.length;
  const mask = new Array<boolean>(n).fill(false);
  if (!n || !m) return mask;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3).fill(-1);
  v[off + 1] = 0;
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    const nv = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      nv[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    trace.push(nv);
    v = nv;
    if (found >= 0) break;
  }
  if (found < 0) return fallbackMask(a, b);
  /* Walk back through the trace, marking the diagonal (matched) runs. */
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d - 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = pv[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      mask[x] = true;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    mask[x] = true;
  }
  return mask;
}

/** Too different for an exact diff in the time allowed: a greedy in-order match, still never out of order. */
function fallbackMask(a: readonly string[], b: readonly string[]): boolean[] {
  const mask = new Array<boolean>(a.length).fill(false);
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    const at = b.indexOf(a[i], j);
    if (at >= 0 && at - j < 40) {
      mask[i] = true;
      j = at + 1;
    }
  }
  return mask;
}

/**
 * For each word the host said: is it still in the script? A word counts as kept when at least half of its
 * characters are matched in order. Punctuation-only words follow their neighbours.
 */
export function keptWords(scriptText: string, words: readonly { text: string }[]): boolean[] {
  const chars: string[] = [];
  const owner: number[] = [];
  words.forEach((w, i) => {
    for (const c of normChars(w.text)) {
      chars.push(c);
      owner.push(i);
    }
  });
  const hit = matchedMask(chars, normChars(scriptText));
  const total = new Array<number>(words.length).fill(0);
  const got = new Array<number>(words.length).fill(0);
  owner.forEach((w, i) => {
    total[w]++;
    if (hit[i]) got[w]++;
  });
  const kept = words.map((_, i) => (total[i] ? got[i] * 2 >= total[i] : false));
  for (let i = 0; i < words.length; i++) if (!total[i]) kept[i] = i > 0 ? kept[i - 1] : i + 1 < words.length && kept[i + 1];
  /* A deleted sentence can still share a common character with the script elsewhere (的, 是, 了); a lone match
     like that would leave a quarter-second blip in the middle of a cut. A kept run of under three characters
     with deleted runs of three or more on both sides is a stray, not a choice. */
  const runs: { from: number; to: number; on: boolean; chars: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.on === kept[i]) {
      last.to = i;
      last.chars += total[i];
    } else runs.push({ from: i, to: i, on: kept[i], chars: total[i] });
  }
  for (let r = 1; r + 1 < runs.length; r++) {
    const x = runs[r];
    if (x.on && x.chars < 3 && runs[r - 1].chars >= 3 && runs[r + 1].chars >= 3) for (let i = x.from; i <= x.to; i++) kept[i] = false;
  }
  if (runs.length > 1 && runs[0].on && runs[0].chars < 3 && runs[1].chars >= 3) for (let i = runs[0].from; i <= runs[0].to; i++) kept[i] = false;
  const z = runs[runs.length - 1];
  if (runs.length > 1 && z.on && z.chars < 3 && runs[runs.length - 2].chars >= 3) for (let i = z.from; i <= z.to; i++) kept[i] = false;
  return kept;
}

/**
 * The kept words as pieces of the clip, in order. A pause longer than `gapMs` between two kept words is cut out
 * (the host's breath stays, a long silence does not), and so is anything removed between them. Each piece keeps a
 * little air before the first word and after the last so no syllable is clipped.
 */
export function piecesFromKept(
  words: readonly TimedWord[],
  kept: readonly boolean[],
  opts: { durationMs?: number | null; gapMs?: number; padInMs?: number; padOutMs?: number; minMs?: number } = {},
): Piece[] {
  const gapMs = opts.gapMs ?? 450;
  const padIn = opts.padInMs ?? 80;
  const padOut = opts.padOutMs ?? 160;
  const minMs = opts.minMs ?? 250;
  const end = opts.durationMs ?? Number.POSITIVE_INFINITY;
  const runs: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!kept[i]) {
      cur = null;
      continue;
    }
    const w = words[i];
    if (cur && w.startMs - words[cur.to].endMs <= gapMs) cur.to = i;
    else {
      cur = { from: i, to: i };
      runs.push(cur);
    }
  }
  const pieces: Piece[] = [];
  for (let r = 0; r < runs.length; r++) {
    const first = words[runs[r].from];
    const last = words[runs[r].to];
    const prevEnd = r > 0 ? words[runs[r - 1].to].endMs : 0;
    const nextStart = r + 1 < runs.length ? words[runs[r + 1].from].startMs : end;
    /* Air either side, but never into the neighbouring piece's words. */
    const inMs = Math.max(0, first.startMs - padIn, prevEnd);
    const outMs = Math.min(end, last.endMs + padOut, Number.isFinite(nextStart) ? Math.max(last.endMs, nextStart) : last.endMs + padOut);
    if (outMs - inMs < minMs) continue;
    const prev = pieces[pieces.length - 1];
    if (prev && inMs - prev.outMs < 100) prev.outMs = Math.max(prev.outMs, outMs);
    else pieces.push({ inMs: Math.round(inMs), outMs: Math.round(outMs) });
  }
  return pieces;
}

export const piecesMs = (pieces: readonly Piece[]) => pieces.reduce((n, p) => n + (p.outMs - p.inMs), 0);
