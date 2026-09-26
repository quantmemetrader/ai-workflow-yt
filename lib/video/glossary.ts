import type { TranscriptWord } from "@/lib/video/elevenlabs";

/**
 * The names, spelled the way the brief spells them.
 *
 * Whisper hears 「Anthropic」 as Anthrobic, Enterobic and Anthoropics in one
 * take, 「蒸馏」 as 帧流, 「谢亚芳」 as 西雅芳 and 「摆渡人」 as 百度人 — and v1
 * burnt every one of them into the captions and used two as keywords. The
 * brief carries the right spellings (its 专有名词写法 line, its entity list,
 * its quoted phrases), so this module reads them out of the brief and puts
 * them back into the transcript, without inventing anything.
 *
 * Two halves, kept apart on purpose:
 *
 *   `extractTerms(brief)`     pure: the proper nouns and terms the brief
 *                             names, weighted by how deliberately it names
 *                             them. They become whisper's hotwords and the
 *                             only spellings a correction may resolve to.
 *
 *   `applyGlossary(words, terms, proposals)`
 *                             pure: deterministic Latin fixes (a case-only
 *                             difference, or a near miss by edit distance
 *                             on a token long enough to be sure) plus
 *                             model-proposed CJK near misses that the code
 *                             validates — `to` must be a term, `from` must
 *                             occur in the transcript and look like a
 *                             mishearing of it — and then applies at the
 *                             character level, so the word timings survive.
 *
 *   `applyGlossaryWithModel`  the thin wrapper that makes the one model
 *                             call and feeds its proposals to the core.
 *
 * Nothing here decides what a sentence means. A `from` that is not a term's
 * near miss under the rules below is left alone, even when the model is
 * confident: 「BN大厂」 stays 「BN大厂」 unless the brief names 美国大厂.
 */

export type Term = {
  text: string;
  kind: "latin" | "han";
  /** 3 = the brief spells it out as a proper noun; 2 = quoted or Latin; 1 = listed. */
  weight: 1 | 2 | 3;
};

export type GlossaryProposal = { from: string; to: string };

export type GlossaryChange = {
  from: string;
  to: string;
  count: number;
  /** case: Latin casing; distance: Latin edit distance; near: Han, one character off; model: a validated proposal. */
  by: "case" | "distance" | "near" | "model";
  /** Character offsets in the transcript text where it was applied. */
  at: number[];
};

export type GlossaryResult = {
  words: TranscriptWord[];
  /** The transcript text after the fixes, joined the way `joinText` joins it. */
  text: string;
  changes: GlossaryChange[];
  /** Proposals the code refused, and why — for the lab's report. */
  rejected: { from: string; to: string; why: string }[];
};

/* ------------------------------------------------------------------ terms */

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9.'-]*[A-Za-z0-9]|[A-Za-z]{2,}/g;

/** Lines that name spellings on purpose: 专有名词写法：Anthropic、Claude… and the term cards. */
const SPELLING_LINE = /专有名词|写法|名词表|术语|人名|名称|拼写|spelling|proper noun/i;

/** Lines whose list is a list of things with names, not of instructions: 每提到一个机构、公司、产品… */
const LIST_HEAD = /机构|公司|产品|人物|人名|提到|名单|术语|品牌|媒体|嘉宾|企业|部门/;

/** Items on a brief's 、-separated lists that are not names: sizes, colours, instructions. */
const NOT_A_TERM = /^[\d.:%#\s]+$|^#?[0-9a-f]{6}$|^\d+[:x×]\d+$/i;

/** Characters a name does not contain, but an instruction does: 去掉停顿, 中文粗体在上. */
const INSTRUCTION = /[去用做放加写留说看有不只把被让给上下要请做]/;

/** A brief line's items, split on the Chinese enumeration comma and its friends. */
function listItems(line: string): string[] {
  return line
    .split(/[、,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** What a line lists: everything after its colon, up to its first full stop. */
function listOf(line: string): string {
  return line.replace(/^.*?[:：]/, "").split(/[。！？!?]/)[0];
}

/**
 * Strip what a brief wraps a name in — 《自然》杂志 → 《自然》 自然 杂志,
 * 月之暗面（Kimi） → 月之暗面 and Kimi, 谢亚芳 · 创变派 → both,
 * 蒸馏＝小模型学… → 蒸馏 — and hand back the pieces that could be names.
 */
function nameParts(item: string): string[] {
  const out: string[] = [];
  const clean = item.replace(/[「」『』【】“”"']/g, "").trim();
  /* A parenthesised alias is its own term: 月之暗面（Kimi）. */
  const paren = /^(.*?)[（(]([^（()）]+)[)）](.*)$/.exec(clean);
  if (paren) {
    out.push(...nameParts(paren[1] + paren[3]), ...nameParts(paren[2]));
    return out;
  }
  if (/\s*[·•]\s*/.test(clean)) {
    for (const p of clean.split(/\s*[·•]\s*/)) out.push(...nameParts(p));
    return out;
  }
  if (/[＝=]/.test(clean)) {
    out.push(...nameParts(clean.split(/[＝=]/)[0]));
    return out;
  }
  const titled = /《([^》]+)》(.*)/.exec(clean);
  if (titled) {
    out.push(`《${titled[1]}》`, titled[1]);
    if (titled[2].trim()) out.push(titled[2].trim());
    return out;
  }
  out.push(clean);
  return out;
}

function isTermLike(s: string): boolean {
  if (!s || s.length < 2 || s.length > 12) return false;
  if (NOT_A_TERM.test(s)) return false;
  /* A whole clause is not a name: nothing with a full stop, a comma or a bracket left in it. */
  if (/[。！？!?，,（）()：:]/.test(s)) return false;
  if (/^(和|与|及|或|的|了|是|在|把|被|从|到|比|而|就|也|都)/.test(s)) return false;
  return HAN.test(s) || /^[A-Za-z]/.test(s);
}

/**
 * The terms a brief names, most deliberate first.
 *
 * Read, in order of trust: the spelling line (weight 3), anything quoted in
 * 「」【】《》 and every Latin token (weight 2), then the items of any other
 * 、-list on a line that reads like a list of things — the entity list, the
 * term cards (weight 1). Deduped by exact text; a Latin term also dedupes
 * case-insensitively so 「Minimax」 in one line and 「MiniMax」 on the
 * spelling line keep the spelling line's form.
 */
export function extractTerms(brief: string, options: { max?: number } = {}): Term[] {
  const max = options.max ?? 48;
  const seen = new Map<string, Term>();
  const order: string[] = [];
  const add = (text: string, kind: Term["kind"], weight: Term["weight"]) => {
    const t = text.trim();
    if (!isTermLike(t)) return;
    const key = kind === "latin" ? t.toLowerCase() : t;
    const had = seen.get(key);
    if (had) {
      if (weight > had.weight) {
        had.weight = weight;
        had.text = t;
      }
      return;
    }
    seen.set(key, { text: t, kind, weight });
    order.push(key);
  };
  const kindOf = (s: string): Term["kind"] => (HAN.test(s) ? "han" : "latin");

  const lines = brief.split(/\r?\n/);
  for (const line of lines) {
    const spelling = SPELLING_LINE.test(line);
    const head = line.split(/[:：]/)[0];
    /* 1. The spelling line and the term cards, item by item, after the colon and before the next sentence. */
    if (spelling) {
      for (const item of listItems(listOf(line))) for (const p of nameParts(item)) add(p, kindOf(p), 3);
    }
    /* 2. Quoted names and titles anywhere. A quoted phrase longer than a
       name (「这场看似一边倒的捉贼大戏」) is still a spelling the captions must
       keep, but it ranks below the names for the hotword budget. */
    for (const m of line.matchAll(/[「【]([^」】]{2,12})[」】]/g)) {
      for (const p of nameParts(m[1])) add(p, kindOf(p), Array.from(p).length <= 6 ? 2 : 1);
    }
    for (const m of line.matchAll(/《([^》]{1,12})》/g)) {
      add(`《${m[1]}》`, "han", 2);
      add(m[1], kindOf(m[1]), 2);
    }
    /* 3. Latin tokens: a brief written in Chinese only reaches for Latin to
       spell a name. Not a colour, not a figure, not an English function word. */
    for (const m of line.matchAll(LATIN_TOKEN)) {
      const tok = m[0];
      if (/^(the|and|of|to|in|on|for|a|an|vs|or|by|at|is|it|as|be|are)$/i.test(tok)) continue;
      if (/^[0-9a-f]{6}$/i.test(tok) || (/\d/.test(tok) && !/^[A-Za-z]+\d{1,3}$/.test(tok))) continue;
      add(tok, "latin", 2);
    }
    /* 4. Lists of named things (机构、公司、产品), not instructions with commas in them. */
    if (!spelling && LIST_HEAD.test(head) && (line.match(/、/g) ?? []).length >= 2) {
      for (const item of listItems(listOf(line))) {
        for (const p of nameParts(item)) {
          /* Not a figure (154页, 63.5%比35.5%: the counter graphics own those), not an instruction. */
          if (/\d/.test(p)) continue;
          if (HAN.test(p) && INSTRUCTION.test(p)) continue;
          add(p, kindOf(p), 1);
        }
      }
    }
  }

  const terms = order.map((k) => seen.get(k)!);
  terms.sort((a, b) => b.weight - a.weight || order.indexOf(termKey(a)) - order.indexOf(termKey(b)));
  return terms.slice(0, max);
}

function termKey(t: Term): string {
  return t.kind === "latin" ? t.text.toLowerCase() : t.text;
}

/**
 * The hotword list for whisper: names first, in the order the brief trusts
 * them, within a character budget. A quoted phrase longer than eight
 * characters is a sentence, not a name, and stays out; the decoder gets
 * more from ten names than from one slogan.
 */
export function hotwordsFrom(terms: readonly Term[], maxChars = 120): string[] {
  const out: string[] = [];
  let used = 0;
  for (const t of terms) {
    /* The bare title without its 《》 is enough for the decoder; the bracketed
       form only exists so a caption keeps the brackets. */
    if (/^《.*》$/.test(t.text)) continue;
    if (Array.from(t.text).length > 8) continue;
    const cost = Array.from(t.text).length + 1;
    if (used + cost > maxChars) continue;
    out.push(t.text);
    used += cost;
  }
  return out;
}

/* ------------------------------------------------------------ transcript */

const LATIN_END = /[A-Za-z]$/;
const LATIN_START = /^[A-Za-z]/;

/** One character of the transcript with its share of its word's time and the word it came from. */
type Ch = { ch: string; t0: number; t1: number; w: number };

function toChars(words: readonly TranscriptWord[]): Ch[] {
  const chars: Ch[] = [];
  words.forEach((w, wi) => {
    const cs = Array.from(w.text);
    const n = cs.length;
    const span = Math.max(0, w.end - w.start);
    cs.forEach((c, i) => chars.push({ ch: c, t0: w.start + (span * i) / n, t1: w.start + (span * (i + 1)) / n, w: wi }));
  });
  return chars;
}

/**
 * Words back from characters: consecutive characters of one word id become
 * one word again. An untouched word comes back with its exact text and
 * times; a replaced span becomes a single word spanning what it replaced,
 * which is also what the caption breaker wants (a name is never split).
 */
function toWords(chars: readonly Ch[], original: readonly TranscriptWord[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && chars[j].w === chars[i].w) j++;
    const w = chars[i].w;
    const text = chars.slice(i, j).map((c) => c.ch).join("");
    const base = w >= 0 ? original[w] : undefined;
    out.push({
      text,
      start: w >= 0 ? base!.start : round3(chars[i].t0),
      end: w >= 0 ? base!.end : round3(chars[j - 1].t1),
      type: base?.type ?? "word",
      ...(base?.speaker ? { speaker: base.speaker } : {}),
    });
    i = j;
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The transcript as one string, the way a reader sees it: Chinese
 * unspaced, Latin fragments joined unless a real gap separates two words.
 * `offsets[i]` is where word `i` starts in the string, so a match maps back
 * to characters.
 */
export function joinText(words: readonly TranscriptWord[]): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i > 0) {
      const p = words[i - 1];
      if (LATIN_END.test(p.text) && LATIN_START.test(w.text) && w.start - p.end > 0.04) text += " ";
    }
    offsets.push(Array.from(text).length);
    text += w.text;
  }
  return { text, offsets };
}

/* ------------------------------------------------------------- distance */

export function levenshtein(a: string, b: string): number {
  const s = Array.from(a);
  const t = Array.from(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * English words a Latin near miss must never be rewritten from on distance
 * alone. 「Cloud」 is two edits from 「Claude」 and it is the model, in this
 * take; in a take about cloud computing it is not. Short common words go to
 * the model with the context; only a long token nobody would type by
 * accident is corrected without asking.
 */
const COMMON = new Set(
  (
    "about after again being cloud close clause claim class could every first found great house large later might never other place point right small sound still their there these thing think those three under water where which while world would write people should system market model models company content account accounts message minimal minimum maximum internet entropy enterprise entropic anthem chrome cluster claudia trump tokens tiktok google apple amazon meta open openai".split(
      " ",
    )
  ),
);

/** How far a Latin token may be from a term and still be it: 2, or a third of the term for a long one. */
function latinTolerance(term: string): number {
  return Math.max(2, Math.floor(Array.from(term).length / 3));
}

/**
 * The Latin tokens of the transcript, as spans of characters, with the
 * deterministic verdict for each: a case fix, a distance fix, a candidate
 * for the model (short token, close to a term), or nothing.
 */
function latinTokens(chars: readonly Ch[]): { a: number; b: number; text: string }[] {
  const out: { a: number; b: number; text: string }[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!/[A-Za-z]/.test(chars[i].ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && /[A-Za-z0-9'.-]/.test(chars[j].ch)) j++;
    /* A token does not end on punctuation: "Anthropic." is Anthropic. */
    while (j > i && /[.'-]/.test(chars[j - 1].ch)) j--;
    out.push({ a: i, b: j, text: chars.slice(i, j).map((c) => c.ch).join("") });
    i = Math.max(j, i + 1);
  }
  return out;
}

/* ----------------------------------------------------------------- apply */

export type GlossaryOptions = {
  /** A `from` seen more often than this is a common word the model mistook for a name; refused. */
  maxOccurrences?: number;
};

/**
 * Apply the glossary to a transcript's words. Pure.
 *
 * Order: Latin case fixes, Latin distance fixes, then the validated
 * proposals (Latin or CJK). Every replacement is a character span
 * rewritten in place; the times of the new word are the span's own.
 */
export function applyGlossary(
  words: readonly TranscriptWord[],
  terms: readonly Term[],
  proposals: readonly GlossaryProposal[] = [],
  options: GlossaryOptions = {},
): GlossaryResult {
  const maxOccurrences = options.maxOccurrences ?? 20;
  let chars = toChars(words);
  const changes: GlossaryChange[] = [];
  const rejected: GlossaryResult["rejected"] = [];
  let fresh = -1;

  const termByLower = new Map<string, Term>();
  for (const t of terms) termByLower.set(t.kind === "latin" ? t.text.toLowerCase() : t.text, t);
  const isTerm = (s: string) => termByLower.has(s) || termByLower.has(s.toLowerCase());

  const replaceSpan = (a: number, b: number, to: string): void => {
    const t0 = chars[a].t0;
    const t1 = chars[b - 1].t1;
    const cs = Array.from(to);
    const span = Math.max(0, t1 - t0);
    const id = fresh--;
    const next: Ch[] = cs.map((c, i) => ({ ch: c, t0: t0 + (span * i) / cs.length, t1: t0 + (span * (i + 1)) / cs.length, w: id }));
    chars = [...chars.slice(0, a), ...next, ...chars.slice(b)];
  };

  const record = (from: string, to: string, by: GlossaryChange["by"], at: number) => {
    const had = changes.find((c) => c.from === from && c.to === to && c.by === by);
    if (had) {
      had.count++;
      had.at.push(at);
    } else changes.push({ from, to, count: 1, by, at: [at] });
  };

  /* 1 + 2. Latin tokens: exact-but-for-case, then near misses on long tokens. */
  const latinTerms = terms.filter((t) => t.kind === "latin");
  const shortCandidates: { from: string; to: string }[] = [];
  let guard = 0;
  for (;;) {
    if (guard++ > 500) break;
    let did = false;
    for (const tok of latinTokens(chars)) {
      const lower = tok.text.toLowerCase();
      const exact = latinTerms.find((t) => t.text.toLowerCase() === lower);
      if (exact) {
        if (exact.text !== tok.text) {
          replaceSpan(tok.a, tok.b, exact.text);
          record(tok.text, exact.text, "case", tok.a);
          did = true;
          break;
        }
        continue;
      }
      if (COMMON.has(lower)) continue;
      let best: { term: Term; d: number } | null = null;
      let tie = false;
      for (const t of latinTerms) {
        const d = levenshtein(lower, t.text.toLowerCase());
        if (d > latinTolerance(t.text) || d * 2 >= Array.from(t.text).length) continue;
        if (!best || d < best.d) {
          best = { term: t, d };
          tie = false;
        } else if (d === best.d) tie = true;
      }
      if (!best || tie) continue;
      if (Array.from(tok.text).length >= 6) {
        replaceSpan(tok.a, tok.b, best.term.text);
        record(tok.text, best.term.text, "distance", tok.a);
        did = true;
        break;
      }
      if (!shortCandidates.some((c) => c.from === tok.text)) shortCandidates.push({ from: tok.text, to: best.term.text });
    }
    if (!did) break;
  }

  /*
   * 2b. Chinese near misses the code can see without a model: a span of
   * the same length as a term of three or more characters that differs in
   * exactly one of them (月之案面 → 月之暗面). Two of four right is a guess;
   * three of four, in a take about the thing, is a mishearing. Found
   * first, applied right to left so offsets hold; a span that is itself
   * a term is left alone.
   */
  for (const t of terms) {
    if (t.kind !== "han") continue;
    const tc = Array.from(t.text.replace(/^《(.*)》$/, "$1"));
    if (tc.length < 3) continue;
    const cps = chars.map((c) => c.ch);
    const found: number[] = [];
    for (let i = 0; i + tc.length <= cps.length; i++) {
      let diff = 0;
      for (let k = 0; k < tc.length && diff < 2; k++) if (cps[i + k] !== tc[k]) diff++;
      if (diff !== 1) continue;
      const span = chars.slice(i, i + tc.length);
      if (span.some((c) => c.w < 0 || !HAN.test(c.ch))) continue;
      const from = span.map((c) => c.ch).join("");
      if (isTerm(from)) continue;
      found.push(i);
      i += tc.length - 1;
    }
    for (const at of found.reverse()) {
      const from = chars.slice(at, at + tc.length).map((c) => c.ch).join("");
      replaceSpan(at, at + tc.length, tc.join(""));
      record(from, tc.join(""), "near", at);
    }
  }

  /* 3. The model's proposals, validated one by one against the current text. */
  for (const p of proposals) {
    const from = (p.from ?? "").trim();
    const to = (p.to ?? "").trim();
    const verdict = validate(from, to, terms, isTerm);
    if (typeof verdict === "string") {
      rejected.push({ from, to, why: verdict });
      continue;
    }
    const text = chars.map((c) => c.ch).join("");
    let hits = occurrences(text, from);
    /* A fix that completes a longer term (百度人 → 摆渡人 inside 你的新经济摆渡人)
       applies only where the rest of that term is around it. */
    if (verdict.within) {
      const cps = Array.from(text);
      const [pre, post] = verdict.within.split(to).map((s) => Array.from(s));
      hits = hits.filter((at) => {
        const b = at + Array.from(from).length;
        return pre.every((c, i) => cps[at - pre.length + i] === c) && post.every((c, i) => cps[b + i] === c);
      });
      if (!hits.length) {
        rejected.push({ from, to, why: `只是「${verdict.within}」的一部分，而识别文字里前后文对不上` });
        continue;
      }
    }
    if (!hits.length) {
      rejected.push({ from, to, why: "识别文字里没有这个词" });
      continue;
    }
    if (hits.length > maxOccurrences) {
      rejected.push({ from, to, why: `出现 ${hits.length} 次，像常用词而不是听错的名词` });
      continue;
    }
    /* Right to left, so earlier offsets stay valid while later spans change length. */
    for (const at of hits.reverse()) {
      const a = at;
      const b = at + Array.from(from).length;
      /* Never rewrite inside a Latin token from a CJK proposal, nor a span already fixed. */
      if (chars.slice(a, b).some((c) => c.w < 0)) continue;
      if (HAN.test(to) && (/[A-Za-z]/.test(chars[a - 1]?.ch ?? "") || /[A-Za-z]/.test(chars[b]?.ch ?? ""))) continue;
      replaceSpan(a, b, to);
      record(from, to, "model", a);
    }
  }

  const out = toWords(chars, words);
  return { words: out, text: joinText(out).text, changes, rejected };
}

/** Every start offset of `needle` in `hay`, by code point. */
function occurrences(hay: string, needle: string): number[] {
  const h = Array.from(hay);
  const n = Array.from(needle);
  const out: number[] = [];
  if (!n.length) return out;
  for (let i = 0; i + n.length <= h.length; i++) {
    let ok = true;
    for (let k = 0; k < n.length; k++) {
      if (h[i + k] !== n[k]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * Whether a proposal is a plausible mishearing of a term, or something the
 * model made up. The rules are the contract the plan states — `to` ∈
 * terms, `from` ∈ transcript — plus a shape test: a mishearing has about
 * the term's length and, for Chinese, either the same length (帧流→蒸馏,
 * 私围裂→思维链) or a character in common (西雅芳→谢亚芳, 百度人→摆渡人).
 *
 * `to` may also be the tail or head of a longer term (摆渡人 in
 * 你的新经济摆渡人): the caller then applies it only where the rest of that
 * term stands around the mishearing. Returns the reason for refusing as a
 * string, or the verdict with the enclosing term.
 */
function validate(
  from: string,
  to: string,
  terms: readonly Term[],
  isTerm: (s: string) => boolean,
): string | { within: string | null } {
  if (!from || !to) return "空的 from/to";
  if (from === to) return "from 与 to 相同";
  let term = terms.find((t) => t.text === to);
  let within: string | null = null;
  if (!term) {
    const enclosing = terms.filter((t) => t.kind === "han" && Array.from(to).length >= 2 && t.text !== to && t.text.includes(to) && t.text.split(to).length === 2);
    if (enclosing.length !== 1) return "to 不在名词表里";
    term = { text: to, kind: "han", weight: enclosing[0].weight };
    within = enclosing[0].text;
  }
  if (isTerm(from)) return "from 本身就是名词表里的词";
  if (from.includes(to) || to.includes(from)) return "from 与 to 互相包含（不是听错）";
  const lf = Array.from(from).length;
  const lt = Array.from(to).length;
  if (lf < 2) return "from 太短";
  if (Math.abs(lf - lt) > 2) return "长度相差太多";
  if (term.kind === "han") {
    const shared = Array.from(from).some((c) => to.includes(c));
    if (lf !== lt && !shared) return "长度不同且没有共同字";
    if (!HAN.test(from)) return "中文名词的 from 不是中文";
  } else {
    const d = levenshtein(from.toLowerCase(), to.toLowerCase());
    if (d > Math.max(2, Math.floor(lt / 2))) return `拼写相差 ${d} 处，太远`;
  }
  return { within };
}

/* ------------------------------------------------------------------ model */

/**
 * The one model call's messages. Pure, so the lab can print them.
 *
 * `hints` are short Latin tokens the code found close to a term but was
 * not sure of; `absent` are terms the transcript never contains at all,
 * which is where a mishearing hides (the brief says 摆渡人, the transcript
 * says 百度人 and nothing else). Both are spelled out because a model asked
 * only for "wrong proper nouns" fixed the obvious names and walked past
 * 帧流 twice.
 */
export function proposalMessages(
  text: string,
  terms: readonly Term[],
  hints: readonly GlossaryProposal[] = [],
  absent: readonly string[] = [],
): { role: "system" | "user"; content: string }[] {
  const list = terms.map((t) => t.text).join("、");
  const hintLine = hints.length
    ? `\n\n这些英文词可能是名词表里某个词的误拼，请结合上下文确认是否要改（是则列入 fixes，否则忽略）：${hints
        .map((h) => `${h.from}（→ ${h.to}？）`)
        .join("；")}`
    : "";
  const absentLine = absent.length
    ? `\n\n名词表里这些词在识别文字中一次都没有出现，很可能被写成了同音或近音的别字，请逐个在识别文字里找出它们对应的原文：${absent.join("、")}`
    : "";
  return [
    {
      role: "system",
      content:
        "你是中文视频字幕的校对。给你一段语音识别出来的口播文字和一份名词表（人名、公司名、产品名、术语）。" +
        "任务：找出识别文字里被听错、写错的名词表词条，给出应改成名词表里的哪个词。" +
        "语音识别最常见的错误是同音字、近音字替换：请把名词表里每个词的读音与识别文字逐一比对，凡是读音相同或相近但写法不同的片段都要报告，术语（不只是人名和公司名）同样要查；同一个错法出现几次只报一次。" +
        "规则：to 必须一字不差地取自名词表；from 必须是识别文字里连续出现的原文；只报告名词表里有的词，别的错字一律不管；" +
        "确实说的是另一个词的不要改（例如短语和名词表词条只是部分相同）。只输出 JSON，格式：{\"fixes\":[{\"from\":\"原文\",\"to\":\"名词表里的写法\"}]}，没有则输出 {\"fixes\":[]}。",
    },
    {
      role: "user",
      content: `名词表：${list}\n\n识别文字：\n${text}${absentLine}${hintLine}`,
    },
  ];
}

/** The proposals out of whatever the model wrote: the first JSON object, its `fixes` array. */
export function parseProposals(answer: string): GlossaryProposal[] {
  const trimmed = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = trimmed.indexOf("{");
  const b = trimmed.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(a, b + 1));
  } catch {
    return [];
  }
  const fixes = (parsed as { fixes?: unknown })?.fixes;
  if (!Array.isArray(fixes)) return [];
  return fixes
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({ from: String(f.from ?? ""), to: String(f.to ?? "") }))
    .filter((f) => f.from && f.to);
}

export type GlossaryModelUsage = {
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  ms: number;
};

/**
 * The models the glossary asks, in order, both with reasoning off and in
 * JSON mode. Measured on the 蒸馏 take (W2 lab, five models, same prompt):
 * the DeepSeek flash found every near miss the others found and the two
 * they missed (帧流→蒸馏, 蒸瘤→蒸馏) for $0.00008 in 1.9 s; the flash Qwen
 * is the fallback (misses the two, $0.00008); qwen3-max found one of the
 * two at 20× the price; kimi-k2.6 found both and invented rewrites of
 * whole clauses, which validation refuses but is not a habit to pay for.
 * Reasoning must be off: through `lib/ai/openrouter.ts:complete`, which
 * cannot say so, the same DeepSeek spent its whole 600-token budget
 * thinking and returned no JSON at all.
 */
export const GLOSSARY_MODELS = (process.env.GLOSSARY_MODELS || "deepseek/deepseek-v4-flash,qwen/qwen3.8-flash").split(",").map((s) => s.trim()).filter(Boolean);

const GLOSSARY_TIMEOUT_MS = Number(process.env.GLOSSARY_TIMEOUT_MS || 60_000);

/**
 * One JSON-mode completion on OpenRouter, with its own `fetch`: the shared
 * client has no `response_format` and no way to turn reasoning off, and
 * this call needs both. Same rules otherwise — the studio's key, the backup
 * key on a refusal, a deadline, OpenRouter's own cost figure. Exported for
 * the lab, which needs the same shape of call for its English lines.
 */
export async function jsonCompletion(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  signal?: AbortSignal,
  maxTokens = 800,
): Promise<{ text: string; usage: GlossaryModelUsage }> {
  const { env } = await import("@/lib/env");
  const { usdToMicros, AiError } = await import("@/lib/ai/openrouter");
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    reasoning: { enabled: false },
    usage: { include: true },
  };
  const keys = [env.openrouter.apiKey, env.openrouter.backupKey].filter(Boolean);
  const deadline = AbortSignal.timeout(GLOSSARY_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const send = (key: string) =>
    fetch(`${env.openrouter.baseUrl}/chat/completions`, {
      method: "POST",
      signal: abort,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Tengya director v2 glossary" },
      body: JSON.stringify(body),
    });
  const started = Date.now();
  let res = await send(keys[0]);
  if ((res.status === 429 || res.status === 402) && keys.length > 1) res = await send(keys[1]);
  const raw = await res.text();
  if (!res.ok) throw new AiError(res.status === 402 ? "credit" : res.status === 429 ? "rate_limit" : "provider", raw.slice(0, 300), res.status);
  const json = JSON.parse(raw) as {
    error?: { message?: string };
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    model?: string;
    provider?: string;
  };
  if (json.error) throw new AiError("provider", String(json.error.message ?? "the provider refused"));
  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw new AiError("provider", `${model} answered with no content`);
  return {
    text,
    usage: {
      model: json.model ?? model,
      provider: json.provider,
      promptTokens: Number(json.usage?.prompt_tokens ?? 0),
      completionTokens: Number(json.usage?.completion_tokens ?? 0),
      costMicros: usdToMicros(json.usage?.cost),
      ms: Date.now() - started,
    },
  };
}

/**
 * The glossary with its one model call.
 *
 * The deterministic pass runs first so the model sees a transcript with
 * the long Latin names already right and only has to judge the short
 * tokens and the Chinese near misses. The call is JSON-mode with reasoning
 * off, with a deadline; a failed call is logged and the deterministic
 * result stands, because a caption with 「帧流」 in it is a lesser fault
 * than a transcription that fails.
 */
export async function applyGlossaryWithModel(
  words: readonly TranscriptWord[],
  terms: readonly Term[],
  options: { model?: string; signal?: AbortSignal; log?: (line: string) => void } = {},
): Promise<GlossaryResult & { usage: GlossaryModelUsage | null; proposals: GlossaryProposal[]; raw: string }> {
  const log = options.log ?? (() => {});
  const first = applyGlossary(words, terms);
  if (!terms.length) return { ...first, usage: null, proposals: [], raw: "" };

  /* The short Latin candidates the pure pass set aside, recomputed here from
     its output: what is left that is close to a term but too short to fix
     without context. */
  const hints: GlossaryProposal[] = [];
  const latinTerms = terms.filter((t) => t.kind === "latin");
  for (const m of first.text.matchAll(/[A-Za-z][A-Za-z0-9'-]*/g)) {
    const tok = m[0];
    const lower = tok.toLowerCase();
    if (latinTerms.some((t) => t.text.toLowerCase() === lower)) continue;
    for (const t of latinTerms) {
      const d = levenshtein(lower, t.text.toLowerCase());
      if (d <= 2 && d * 2 < Array.from(t.text).length && !hints.some((h) => h.from === tok)) hints.push({ from: tok, to: t.text });
    }
  }

  /* Terms the transcript never contains, brackets off, sentences excluded. */
  const absent = terms
    .map((t) => t.text.replace(/^《(.*)》$/, "$1"))
    .filter((t, i, all) => all.indexOf(t) === i && Array.from(t).length <= 8 && !first.text.includes(t) && !first.text.toLowerCase().includes(t.toLowerCase()));

  let proposals: GlossaryProposal[] = [];
  let usage: GlossaryModelUsage | null = null;
  let raw = "";
  const models = options.model ? [options.model] : GLOSSARY_MODELS;
  const messages = proposalMessages(first.text, terms, hints, absent);
  for (const model of models) {
    try {
      const res = await jsonCompletion(model, messages, options.signal);
      usage = res.usage;
      raw = res.text;
      proposals = parseProposals(res.text);
      log(`glossary: ${model} proposed ${proposals.length} fix(es) in ${usage.ms} ms (${usage.promptTokens}+${usage.completionTokens} tokens)`);
      break;
    } catch (err) {
      log(`glossary: ${model} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!usage) log("glossary: no model answered; keeping the deterministic fixes only");

  const second = applyGlossary(first.words, terms, proposals);
  return {
    words: second.words,
    text: second.text,
    changes: [...first.changes, ...second.changes],
    rejected: second.rejected,
    usage,
    proposals,
    raw,
  };
}
