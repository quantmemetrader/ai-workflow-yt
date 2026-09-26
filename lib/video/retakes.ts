import { toSimplified } from "@/lib/text/simplified";
import { silenceNear } from "@/lib/video/ranges";
import type { Retake, Sentence, Silence, Word } from "@/lib/video/v2/types";

/**
 * Retakes, stutters and false starts, found in the transcript.
 *
 * A presenter who fluffs a line says it again. The take then holds both,
 * and the brief for the 蒸馏 video names four phrases that were said twice
 * and asks for the clean one. Report A's prototype found the three known
 * retakes with a character-level repeat search; this is that search made
 * general, with the cases the fixture taught us:
 *
 *   - **restart**: the same opening said twice, the second time all the way
 *     (但是这场看似一边倒的捉贼大戏 | 但这场看似一边倒的捉贼大戏越往后看…).
 *   - **reworded**: the second take says the same thing differently
 *     (但是有一个细节值得关注就是这些所有的指控数据 | 但是有个细节值得关注所有指控数据都是…).
 *   - **stutter**: a few characters repeated back to back (阿里相关账号 | 阿里相关的3500多个账号).
 *   - **repeat**: the whole span said again verbatim.
 *   - a **false start**: a fragment, a long pause, then the real sentence
 *     (那么在追逐在 … 5.6 s … 追逐蒸馏捷径的行业氛围里).
 *
 * The rule is "keep the last take": the drop runs from the first take's
 * start to the second take's start, in word time; the planner then moves
 * both edges into measured silence. Every decision carries a score and who
 * made it, because deliberate repetition looks exactly like a retake to a
 * string search (一轮比一轮官方，一轮比一轮激进 is rhetoric, not a fluff) —
 * those cases are handed back as `ambiguous` and decided by one batched,
 * cheap yes/no model call (`decisionMessages` / `parseDecisions`). When the
 * model cannot be reached they are kept: losing a sentence is the one
 * mistake this module must never make on its own.
 *
 * Pure: words and sentences in, decisions out. `fillHoles` is the one
 * exception, and it takes the transcriber as an argument.
 */

/** One character of Han text, or one Latin word, or one number, with the time whisper gave the word it came from. */
export type Unit = { text: string; startMs: number; endMs: number; sentence: number; word: number };

export type RetakeKind = Retake["kind"];

/** A repeat the rules found, with everything a person or a model needs to judge it. */
export type RetakeCandidate = {
  id: string;
  kind: RetakeKind;
  /** Word-time edges of the drop: first take's first word to second take's first word. */
  dropStartMs: number;
  dropEndMs: number;
  firstText: string;
  secondText: string;
  contextBefore: string;
  contextAfter: string;
  /** How much of the first take the verbatim repeat covers (0–1). */
  coverage: number;
  /** Character-LCS of the first take against the same-length window that follows it (0–1). */
  lcs: number;
  /** A measured silence (or a whisper gap) sits at the second take's start. */
  hasPause: boolean;
  /** A brief-quoted phrase is in both takes. */
  briefHit: boolean;
  spanUnits: number;
  /** The rules' verdict before any model sees it. */
  verdict: "drop" | "ambiguous";
  score: number;
  whyZh: string;
  keptSentenceId: string;
  droppedSentenceIds: string[];
};

export type RetakeDecision = {
  id: string;
  drop: boolean;
  decidedBy: "rule" | "model";
  whyZh: string;
  candidate: RetakeCandidate;
};

export type FindRetakesOptions = {
  /** Phrases the brief quotes as said twice; a repeat of one is accepted on sight. */
  briefPhrases?: readonly string[];
  /** Measured silences, for the pause test at the second take's start. */
  silences?: readonly Silence[];
  /** How far apart (ms) two takes of one line may be. */
  windowMs?: number;
  /** Units a seed must match to start a candidate. */
  seedUnits?: number;
  /** Units a back-to-back stutter must match. */
  stutterUnits?: number;
};

const DEFAULTS = { windowMs: 20_000, seedUnits: 5, stutterUnits: 3 } as const;

const PUNCT = /[\p{P}\p{S}\s]/gu;
const HAN = /\p{Script=Han}/u;
const TOKEN = /\p{Script=Han}|[A-Za-z]+|\d+(?:[.,]\d+)*%?/gu;
/* Particles a false start trails off on; 那么在追逐在 minus its last 在 is 那么在追逐. */
const TRAILING_PARTICLE = new Set(["在", "的", "就", "是", "了", "那", "这", "个", "呢", "啊", "嗯", "呃"]);

/* --------------------------------------------------------------- units */

/**
 * The transcript as a stream of units with interpolated times.
 *
 * Whisper gives a Mandarin take mostly as one or two characters per word,
 * but not always (你知道 is one word); every unit gets an equal share of its
 * word's span, which is as good as the timing gets and better than it needs
 * to be, since edges are snapped to silence later. Traditional characters
 * are folded to simplified and Latin is lower-cased so the two takes of a
 * name compare equal however whisper spelled them.
 */
export function toUnits(sentences: readonly Sentence[]): Unit[] {
  const out: Unit[] = [];
  sentences.forEach((s, si) => {
    s.words.forEach((w, wi) => {
      const clean = toSimplified(w.text).replace(PUNCT, "");
      const tokens = clean.match(TOKEN) ?? [];
      if (!tokens.length) return;
      const span = Math.max(0, w.endMs - w.startMs);
      tokens.forEach((t, k) => {
        out.push({
          text: HAN.test(t) ? t : t.toLowerCase(),
          startMs: Math.round(w.startMs + (span * k) / tokens.length),
          endMs: Math.round(w.startMs + (span * (k + 1)) / tokens.length),
          sentence: si,
          word: wi,
        });
      });
    });
  });
  return out;
}

const text = (units: readonly Unit[], from: number, to: number): string =>
  units
    .slice(Math.max(0, from), Math.max(0, to))
    .map((u) => u.text)
    .join("");

/** Longest common subsequence length of two unit-text arrays. Quadratic, on spans of a few dozen units. */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The phrases a brief quotes in 「」 or “”, as unit strings, longest first. */
export function briefPhrases(brief: string | null | undefined): string[] {
  if (!brief) return [];
  const out = new Set<string>();
  for (const m of brief.matchAll(/[「“"『]([^」”"』]{3,40})[」”"』]/g)) {
    const units = (toSimplified(m[1]).replace(PUNCT, "").match(TOKEN) ?? []).map((t) => (HAN.test(t) ? t : t.toLowerCase()));
    if (units.length >= 3) out.add(units.join(""));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/* ------------------------------------------------------------ the search */

type Seed = { i: number; j: number };

export type FindRetakesResult = {
  retakes: Retake[];
  ambiguous: RetakeCandidate[];
  decisions: RetakeDecision[];
  candidates: RetakeCandidate[];
};

export function findRetakes(
  words: readonly Word[],
  sentences: readonly Sentence[],
  opts: FindRetakesOptions = {},
): FindRetakesResult {
  const o = { ...DEFAULTS, ...opts };
  /* Sentences are the source of truth for the stream (they carry the words
     and the ids the report speaks in); bare words are one sentence. */
  const sents: readonly Sentence[] = sentences.length
    ? sentences
    : words.length
      ? [{ id: "s000", clipId: "src", startMs: words[0].startMs, endMs: words[words.length - 1].endMs, text: "", words: [...words] }]
      : [];
  const units = toUnits(sents);
  const N = units.length;
  const phrases = (o.briefPhrases ?? []).map((p) => (p.match(TOKEN) ?? []).map((t) => (HAN.test(t) ? t : t.toLowerCase())));
  const silences = o.silences ?? [];

  /* Where each sentence begins in the unit stream. */
  const sentStart: number[] = [];
  units.forEach((u, k) => {
    if (sentStart[u.sentence] === undefined) sentStart[u.sentence] = k;
  });
  const sentEnd = (si: number): number => (sentStart[si + 1] ?? N) - 1;

  const seeds: Seed[] = [];
  const seen = new Set<string>();
  /* An n-gram with a pause of a second or more inside it is two phrases, not
     one: 在 … 5.6 s … 追逐 must not seed a repeat of 在追逐. */
  const contiguous = (from: number, n: number): boolean => {
    for (let k = from + 1; k < from + n && k < N; k++) {
      if (units[k].startMs - units[k - 1].endMs >= 1000) return false;
      const gap = silenceNear(units[k].startMs, silences, 100);
      if (gap && gap.endMs - gap.startMs >= 1000 && gap.startMs >= units[k - 1].startMs) return false;
    }
    return true;
  };
  const addSeed = (i: number, j: number, n: number) => {
    if (i < 0 || j <= i || j >= N) return;
    /* Maximal to the left: a seed whose predecessors also match is the same repeat seen one unit later. */
    if (i > 0 && units[i - 1].text === units[j - 1].text) return;
    if (!contiguous(i, n) || !contiguous(j, n)) return;
    const key = `${i}:${j}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ i, j });
  };

  /* 1. Five units repeated within the window. */
  const gram = new Map<string, number[]>();
  for (let k = 0; k + o.seedUnits <= N; k++) {
    const key = units
      .slice(k, k + o.seedUnits)
      .map((u) => u.text)
      .join("\u0001");
    const list = gram.get(key);
    if (list) list.push(k);
    else gram.set(key, [k]);
  }
  for (const positions of gram.values()) {
    if (positions.length < 2) continue;
    for (let a = 0; a < positions.length; a++) {
      for (let b = a + 1; b < positions.length; b++) {
        const i = positions[a];
        const j = positions[b];
        if (units[j].startMs - units[i].startMs > o.windowMs) break;
        addSeed(i, j, o.seedUnits);
      }
    }
  }

  /* 2. Three units repeated back to back (a stutter), or three Latin words within the window. */
  for (let i = 0; i + o.stutterUnits <= N; i++) {
    const a = units.slice(i, i + o.stutterUnits).map((u) => u.text);
    const latin = a.every((t) => /^[a-z]/.test(t));
    const reach = latin ? N : Math.min(N, i + 12);
    for (let j = i + 1; j + o.stutterUnits <= reach; j++) {
      if (units[j].startMs - units[i].startMs > (latin ? o.windowMs : 3000)) break;
      let same = true;
      for (let k = 0; k < o.stutterUnits; k++) {
        if (units[j + k].text !== a[k]) {
          same = false;
          break;
        }
      }
      if (same) addSeed(i, j, o.stutterUnits);
    }
  }

  /*
   * 3. A fragment, a long pause, then a sentence that picks up its last words.
   *
   * The fragment is a short sentence (≤ 8 units) plus any particle-only
   * sentence right after it: whisper times the 在 of 那么在追逐在 across the
   * pause that follows, so the sentence split leaves it on its own.
   */
  const falseStarts: Seed[] = [];
  const particlesOnly = (si: number): boolean => {
    const a0 = sentStart[si];
    if (a0 === undefined) return false;
    const a1 = sentEnd(si);
    return a1 - a0 + 1 <= 2 && units.slice(a0, a1 + 1).every((u) => TRAILING_PARTICLE.has(u.text));
  };
  for (let si = 0; si + 1 < sents.length; si++) {
    const a0 = sentStart[si];
    if (a0 === undefined || particlesOnly(si)) continue;
    let last = si;
    while (last + 1 < sents.length && particlesOnly(last + 1)) last++;
    const a1 = sentEnd(last);
    const b0 = sentStart[last + 1];
    if (b0 === undefined || a1 < a0) continue;
    const len = a1 - a0 + 1;
    if (len > 8) continue;
    const pauseMs = units[b0].startMs - units[a1].endMs;
    const sil = silenceNear(units[b0].startMs, silences, 600);
    const measured = sil ? sil.endMs - sil.startMs : 0;
    if (pauseMs < 1500 && measured < 1500) continue;
    let tailEnd = a1;
    while (tailEnd > a0 && TRAILING_PARTICLE.has(units[tailEnd].text)) tailEnd--;
    if (tailEnd - a0 + 1 < 2) continue;
    const tail = [units[tailEnd - 1].text, units[tailEnd].text];
    const head = units.slice(b0, Math.min(N, b0 + 6)).map((u) => u.text);
    for (let k = 0; k + 1 < head.length; k++) {
      if (head[k] === tail[0] && head[k + 1] === tail[1]) {
        falseStarts.push({ i: a0, j: b0 });
        break;
      }
    }
  }

  /* ---- candidates -------------------------------------------------- */

  const takeStart = (k: number): number => {
    const s0 = sentStart[units[k].sentence];
    if (s0 !== undefined && k - s0 <= 8 && units[k].startMs - units[s0].startMs <= 2500) return s0;
    return k;
  };

  const candidates: RetakeCandidate[] = [];
  const build = (seed: Seed, forced?: { kind: RetakeKind; score: number; whyZh: string }): RetakeCandidate | null => {
    const { i, j } = seed;
    let m = 0;
    while (i + m < j && j + m < N && units[i + m].text === units[j + m].text) m++;
    const A = forced ? i : takeStart(i);
    let B = forced ? j : takeStart(j);
    if (B <= A || B <= i) B = j;
    const span = B - A;
    if (span < 2) return null;
    const first = units.slice(A, B).map((u) => u.text);
    const second = units.slice(B, Math.min(N, B + span)).map((u) => u.text);
    const lcs = lcsLength(first, second) / span;
    const coverage = m / span;
    const tail = span - (i - A) - m;
    const startOfSecond = units[B].startMs;
    const gap = startOfSecond - units[B - 1].endMs;
    const hasPause = gap >= 300 || silenceNear(startOfSecond, silences, 400) !== null;
    const durationMs = units[B - 1].endMs - units[A].startMs;

    const window = units.slice(B, Math.min(N, B + span + 12)).map((u) => u.text).join("");
    const firstText = first.join("");
    const briefHit = phrases.some((p) => {
      if (p.length < 3) return false;
      if (!window.includes(p.join(""))) return false;
      return lcsLength(p, first) >= Math.ceil(p.length * 0.75);
    });

    let verdict: RetakeCandidate["verdict"] | null = null;
    let kind: RetakeKind = "restart";
    let score = 0;
    let whyZh = "";
    const short = span <= 8 && durationMs <= 2500;
    if (forced) {
      verdict = "drop";
      kind = forced.kind;
      score = forced.score;
      whyZh = forced.whyZh;
    } else if (briefHit && (coverage >= 0.4 || lcs >= 0.5)) {
      verdict = "drop";
      kind = coverage >= 0.95 && tail === 0 ? "repeat" : coverage >= 0.6 ? "restart" : "reworded";
      score = 0.95;
      whyZh = "简报点名说了两遍的句子，保留最后一遍";
    } else if (coverage >= 0.6 && (hasPause || tail <= 1)) {
      verdict = "drop";
      kind = short ? "stutter" : coverage >= 0.95 && tail === 0 ? "repeat" : "restart";
      score = Math.min(0.95, coverage);
      whyZh = hasPause ? "开头原样重说一遍，中间有停顿" : "连着重复了一遍";
    } else if (coverage >= 0.6) {
      verdict = "ambiguous";
      kind = "reworded";
      score = coverage;
      whyZh = "开头相同、结尾不同且没有停顿：可能是排比";
    } else if (lcs >= 0.6 && hasPause) {
      verdict = "drop";
      kind = "reworded";
      score = Math.min(0.9, lcs);
      whyZh = "换了说法重说一遍，中间有停顿";
    } else if (lcs >= 0.6 || coverage >= 0.4 || lcs >= 0.45) {
      verdict = "ambiguous";
      kind = "reworded";
      score = Math.max(lcs, coverage);
      whyZh = "两段相似但不确定是不是重说";
    }
    if (!verdict) return null;

    const keptSentence = sents[units[B].sentence];
    const dropped = sents.filter((_, si) => sentStart[si] !== undefined && sentStart[si] >= A && sentEnd(si) < B).map((s) => s.id);
    return {
      id: "",
      kind,
      dropStartMs: units[A].startMs,
      dropEndMs: startOfSecond,
      firstText,
      secondText: second.join(""),
      contextBefore: text(units, A - 24, A),
      contextAfter: text(units, B + span, B + span + 24),
      coverage: Math.round(coverage * 100) / 100,
      lcs: Math.round(lcs * 100) / 100,
      hasPause,
      briefHit,
      spanUnits: span,
      verdict,
      score: Math.round(score * 100) / 100,
      whyZh,
      keptSentenceId: keptSentence?.id ?? "",
      droppedSentenceIds: dropped,
    };
  };

  for (const seed of seeds) {
    const c = build(seed);
    if (c) candidates.push(c);
  }
  for (const seed of falseStarts) {
    const c = build(seed, { kind: "restart", score: 0.8, whyZh: "半句话停了很久，再从头说：起头作废" });
    if (c) candidates.push(c);
  }

  /*
   * One repeat, one candidate.
   *
   * A long restart seeds several times (而且这些账号 / 不是正常注册的 /
   * 阿里相关的3500多个账号 all recur across the two takes of one sentence).
   * The earliest first-take start wins; a later candidate whose first
   * occurrence lies inside an accepted drop is that same retake seen again
   * — dropping it would take the kept take too. A candidate that starts
   * inside the *kept* take is independent (the stutter inside the 3500
   * re-say) and stands.
   */
  candidates.sort((a, b) => a.dropStartMs - b.dropStartMs || b.score - a.score);
  const chosen: RetakeCandidate[] = [];
  for (const c of candidates) {
    const inside = chosen.find((k) => c.dropStartMs >= k.dropStartMs && c.dropStartMs < k.dropEndMs);
    if (inside) continue;
    const overlaps = chosen.find((k) => c.dropEndMs > k.dropStartMs && c.dropStartMs < k.dropEndMs);
    if (overlaps) continue;
    chosen.push(c);
  }
  chosen.forEach((c, n) => (c.id = `r${String(n + 1).padStart(2, "0")}`));

  const decisions: RetakeDecision[] = chosen
    .filter((c) => c.verdict === "drop")
    .map((c) => ({ id: c.id, drop: true, decidedBy: "rule", whyZh: c.whyZh, candidate: c }));
  return {
    retakes: decisions.map((d) => toRetake(d)),
    ambiguous: chosen.filter((c) => c.verdict === "ambiguous"),
    decisions,
    candidates: chosen,
  };
}

/** A decision that drops, as the frozen `Retake` record. */
export function toRetake(d: RetakeDecision): Retake {
  const c = d.candidate;
  return {
    dropStartMs: c.dropStartMs,
    dropEndMs: c.dropEndMs,
    keptSentenceId: c.keptSentenceId,
    droppedSentenceIds: c.droppedSentenceIds,
    kind: c.kind,
    score: c.score,
    decidedBy: d.decidedBy,
  };
}

/* ------------------------------------------------------- the model's say */

/**
 * The one batched question for the ambiguous cases. Chinese, because the
 * takes are Chinese and the answer is logged for a Chinese-reading editor.
 */
export function decisionMessages(ambiguous: readonly RetakeCandidate[]): { role: "system" | "user"; content: string }[] {
  const list = ambiguous
    .map((c) =>
      [
        `【${c.id}】`,
        `前文：…${c.contextBefore}`,
        `第一遍：${c.firstText}`,
        `第二遍：${c.secondText}…`,
        `后文：…${c.contextAfter}`,
        c.hasPause ? "（两遍之间有停顿）" : "（两遍之间没有停顿）",
      ].join("\n"),
    )
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "你是口播视频的剪辑师。下面每一组是同一段口播里前后相邻的两段话，第二段和第一段开头相同。" +
        "判断第二段是「重说」（讲者说错或没说顺，重新说了一遍，剪辑时应删掉第一遍）还是「刻意的排比或重复」（两遍都是有意说的，都要保留）。" +
        "只回答一个 JSON 对象，不要解释，第一个字符必须是左花括号：\n" +
        '{"decisions":[{"id":"r01","drop":true,"why":"十个字以内"}]}\n' +
        "drop 为 true 表示删掉第一遍。拿不准就保留（drop 为 false）：漏删一句重复，比删掉一句正文要好。",
    },
    { role: "user", content: list },
  ];
}

/** The model's answer, bounded to the ids it was asked about; anything unparseable means "keep". */
export function parseDecisions(textOut: string, ambiguous: readonly RetakeCandidate[]): RetakeDecision[] {
  const ids = new Map(ambiguous.map((c) => [c.id, c]));
  const answers = new Map<string, { drop: boolean; why: string }>();
  const body = textOut.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const raw = fenced ? fenced[1] : body;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as { decisions?: unknown };
      if (Array.isArray(parsed.decisions)) {
        for (const d of parsed.decisions) {
          if (!d || typeof d !== "object") continue;
          const { id, drop, why } = d as { id?: unknown; drop?: unknown; why?: unknown };
          if (typeof id === "string" && ids.has(id)) {
            answers.set(id, { drop: drop === true, why: typeof why === "string" ? why.slice(0, 60) : "" });
          }
        }
      }
    } catch {
      // Unparseable: every case below is kept.
    }
  }
  return ambiguous.map((c) => {
    const a = answers.get(c.id);
    return {
      id: c.id,
      drop: a?.drop ?? false,
      decidedBy: "model",
      whyZh: a ? a.why || (a.drop ? "模型判定为重说" : "模型判定为刻意重复") : "模型没有回答，保留",
      candidate: c,
    };
  });
}

/**
 * Ask once for all ambiguous cases. `ask` is the model call (the caller
 * supplies `complete` with its own model and ledger); a call that throws or
 * times out keeps every case, and says so in each decision.
 */
export async function decideRetakes(
  ambiguous: readonly RetakeCandidate[],
  ask: (messages: { role: "system" | "user"; content: string }[]) => Promise<string>,
): Promise<RetakeDecision[]> {
  if (!ambiguous.length) return [];
  try {
    const answer = await ask(decisionMessages(ambiguous));
    return parseDecisions(answer, ambiguous);
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 80) : "unknown";
    return ambiguous.map((c) => ({ id: c.id, drop: false, decidedBy: "model", whyZh: `模型暂时连不上（${why}），保留`, candidate: c }));
  }
}

/* ------------------------------------------------------------- holes */

/**
 * Audio the transcript does not account for.
 *
 * Whisper's decoder suppresses repetition, so the second take of a phrase
 * said twice in a row can vanish from the words: on the 蒸馏 take the first
 * 要么你就得接受一定程度 is there and the second (264.5–266.2 s) is folded
 * into the last character of the first, which whisper times at 2.6 s long.
 * The tell is a word that runs on past a measured silence inside it, or a
 * long gap between two words that the silences do not cover. Both are
 * "holes": spans of speech with no words. Transcribed on their own (no
 * context, so nothing to suppress) they come back as words, and the repeat
 * search then sees the second take.
 */
export type Hole = {
  startMs: number;
  endMs: number;
  kind: "stretched" | "gap";
  wordIndex: number;
  /** Where the word before the hole really ends: the start of the silence inside a stretched word, the word end for a gap. */
  cutAtMs: number;
};

export function findHoles(
  words: readonly Word[],
  silences: readonly Silence[],
  opts: { minVoicedMs?: number; minGapMs?: number } = {},
): Hole[] {
  const minVoiced = opts.minVoicedMs ?? 700;
  const minGap = opts.minGapMs ?? 1200;
  const out: Hole[] = [];
  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs);
  words.forEach((w, k) => {
    /* A silence inside the word, with the word still running well past it. */
    for (const s of sorted) {
      if (s.startMs <= w.startMs || s.endMs >= w.endMs) continue;
      if (w.endMs - s.endMs >= minVoiced) {
        out.push({ startMs: s.endMs, endMs: w.endMs, kind: "stretched", wordIndex: k, cutAtMs: s.startMs });
        break;
      }
    }
    /* A gap to the next word that silence does not explain. */
    const next = words[k + 1];
    if (next && next.startMs - w.endMs >= minGap) {
      let quiet = 0;
      for (const s of sorted) {
        const a = Math.max(s.startMs, w.endMs);
        const b = Math.min(s.endMs, next.startMs);
        if (b > a) quiet += b - a;
      }
      if (next.startMs - w.endMs - quiet >= minVoiced) {
        out.push({ startMs: w.endMs, endMs: next.startMs, kind: "gap", wordIndex: k, cutAtMs: w.endMs });
      }
    }
  });
  return out;
}

/**
 * New words for a hole, folded into the transcript.
 *
 * For a stretched word the word is closed at the silence that begins the
 * hole and the new words follow it; for a gap they go between the two
 * words. New words that reach past the hole's end duplicate what whisper
 * already had there (the 的 after 程度) and are left out.
 */
export function spliceWords(words: readonly Word[], hole: Hole, found: readonly Word[]): Word[] {
  const next = words[hole.wordIndex + 1];
  const limit = next ? next.startMs - 80 : Infinity;
  const fresh = found
    .filter((w) => w.startMs >= hole.startMs - 150 && w.startMs < Math.min(limit, hole.endMs + 200))
    .map((w) => ({ text: w.text, startMs: Math.max(hole.startMs, w.startMs), endMs: Math.min(hole.endMs + 200, Math.max(w.startMs, w.endMs)) }));
  if (!fresh.length) return [...words];
  const out = words.map((w) => ({ ...w }));
  if (hole.kind === "stretched") out[hole.wordIndex].endMs = Math.max(out[hole.wordIndex].startMs, Math.min(out[hole.wordIndex].endMs, hole.cutAtMs));
  out.splice(hole.wordIndex + 1, 0, ...fresh);
  return out;
}

/**
 * Transcribe every hole and splice the words in. `transcribe` returns words
 * in *source* milliseconds for the window it was given; the lab passes an
 * ffmpeg-extract-plus-whisper function, the director passes the same thing
 * through `lib/video/whisper.ts`. At most `maxHoles` are filled (each costs
 * a model load, ~5 s on the box); the rest stay as they are, which loses
 * nothing — the audio is still in the cut.
 */
export async function fillHoles(
  words: readonly Word[],
  silences: readonly Silence[],
  transcribe: (startMs: number, endMs: number) => Promise<Word[]>,
  opts: { maxHoles?: number; padMs?: number } = {},
): Promise<{ words: Word[]; holes: (Hole & { text: string })[] }> {
  const maxHoles = opts.maxHoles ?? 4;
  const pad = opts.padMs ?? 80;
  const holes = findHoles(words, silences).slice(0, maxHoles);
  let out = [...words];
  const filled: (Hole & { text: string })[] = [];
  /* Later holes first, so earlier splices do not shift the indices of the rest. */
  for (const h of [...holes].sort((a, b) => b.wordIndex - a.wordIndex)) {
    let found: Word[] = [];
    try {
      found = await transcribe(Math.max(0, h.startMs - pad), h.endMs + pad * 2);
    } catch (err) {
      console.warn("[retakes] hole transcription failed:", err instanceof Error ? err.message : err);
      continue;
    }
    const before = out.length;
    out = spliceWords(out, h, found);
    filled.unshift({ ...h, text: out.slice(h.wordIndex + 1, h.wordIndex + 1 + (out.length - before)).map((w) => w.text).join("") });
  }
  return { words: out, holes: filled };
}
