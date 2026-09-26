import "server-only";

/**
 * How long the cut is supposed to be.
 *
 * The first pass had no idea. A producer wrote "45 到 58 秒" in the brief, the
 * model was handed the transcript with no mention of a duration, and it came
 * back with a plan that kept nearly everything — two minutes fifty-three
 * against a target of under a minute. Nothing downstream knew either, so the
 * number in the brief was decoration.
 *
 * Two halves, deliberately separate:
 *
 *   — `targetFromBrief` reads the number a person actually wrote, in the forms
 *     people actually write it, in both languages. No number means no budget;
 *     a long-form interview should not be trimmed because nobody said not to.
 *   — `fitToBudget` is the backstop for a model that was told the budget and
 *     kept everything anyway. It is arithmetic over the ranges, so it cannot
 *     fail the way a second model call could.
 */
export type Range = { startMs: number; endMs: number; why?: string };

/** Nothing shorter than this is a video; nothing longer is a target anybody
 *  writes in a brief. Outside the pair, the match is a coincidence. */
const MIN_MS = 5_000;
const MAX_MS = 60 * 60_000;

const inRange = (ms: number) => (ms >= MIN_MS && ms <= MAX_MS ? Math.round(ms) : null);

/**
 * The length a brief asks for, in milliseconds, or null.
 *
 * A range — "45–58 秒", "2 to 3 minutes" — resolves to its **upper** bound:
 * the producer's ceiling is the number that matters, and cutting to the floor
 * throws away material they said they would accept.
 */
export function targetFromBrief(brief: string | null | undefined): number | null {
  if (!brief) return null;
  const text = brief.replace(/[–—~～]/g, "-");

  /* Minutes first, so "2-3 分钟" is not read as "3 秒". */
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?(?:分钟|分|minutes?|mins?|m\b)/i);
  if (minutes) {
    const upper = Number(minutes[2] ?? minutes[1]);
    const hit = inRange(upper * 60_000);
    if (hit) return hit;
  }

  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?(?:秒钟|秒|seconds?|secs?|s\b)/i);
  if (seconds) {
    const upper = Number(seconds[2] ?? seconds[1]);
    const hit = inRange(upper * 1000);
    if (hit) return hit;
  }

  return null;
}

/** Total length of a set of ranges. */
export const totalMs = (ranges: Range[]): number =>
  ranges.reduce((sum, r) => sum + Math.max(0, r.endMs - r.startMs), 0);

export type Fitted = {
  kept: Range[];
  /** What was taken out to make it fit, so a person can put it back. */
  dropped: Range[];
  overBy: number;
};

/**
 * Cut a plan down to its budget.
 *
 * The rule is how a person cuts to time, not how a computer does: the opening
 * stays, the ending stays, and the middle gives way. Truncating the tail —
 * the obvious implementation — throws away the conclusion and the call to
 * action, which are the two things a short video is for.
 *
 * Whole ranges only. Half a range is half a sentence, and the ranges were
 * already snapped to measured speech by the caller.
 *
 * `slack` is there because a plan that lands three seconds over is a plan that
 * fits; re-cutting it would cost a whole section to save a breath.
 */
export function fitToBudget(
  hook: Range | null,
  keep: Range[],
  budgetMs: number,
  slack = 0.1,
): Fitted {
  const all = hook ? [hook, ...keep] : [...keep];
  const total = totalMs(all);
  const ceiling = Math.round(budgetMs * (1 + slack));
  if (total <= ceiling) return { kept: all, dropped: [], overBy: 0 };

  /* The opening and the ending are not negotiable. If those two alone are over
     budget there is nothing this function can sensibly do — the plan is simply
     longer than the brief — so it returns them and says by how much. */
  const first = all[0];
  const last = all.length > 1 ? all[all.length - 1] : null;
  const middle = all.slice(1, last ? -1 : undefined);

  const fixed = last ? [first, last] : [first];
  let used = totalMs(fixed);
  if (used >= budgetMs) {
    return { kept: fixed, dropped: middle, overBy: Math.max(0, used - budgetMs) };
  }

  /* Then as much of the middle as fits, in order, so the argument still runs
     forwards. A range that does not fit is skipped rather than ending the
     loop: a short one later on may still fit where a long one did not. */
  const taken: Range[] = [];
  const dropped: Range[] = [];
  for (const r of middle) {
    const length = Math.max(0, r.endMs - r.startMs);
    if (used + length <= budgetMs) {
      taken.push(r);
      used += length;
    } else {
      dropped.push(r);
    }
  }

  const kept = [first, ...taken, ...(last ? [last] : [])];
  return { kept, dropped, overBy: Math.max(0, totalMs(kept) - budgetMs) };
}

/** "0:58" — for the line that tells somebody what they got. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------ director v2 */

/** A sentence the model said could go, and how willingly. */
export type OptionalDrop = {
  id: string;
  /** What dropping it saves, in ms of the cut. */
  ms: number;
  /** 2: should go if the video must be shorter; 3: could go if it still must. */
  priority: 2 | 3;
  reason: "filler" | "off-topic" | "aside";
  text: string;
};

export type SentenceBudget = {
  /** The cut's length once retakes, pauses and the must-go drops are out. */
  lengthMs: number;
  /** The brief's ceiling, or null for no budget. */
  budgetMs: number | null;
  /** What the model offered up, any order. */
  optional: readonly OptionalDrop[];
  /** Sentences holding a brief anchor (a quoted phrase, a number, a named entity): never dropped for length. */
  anchors: ReadonlySet<string>;
  /** A cut this close over the budget fits; re-cutting it would cost a sentence to save a breath. */
  slack?: number;
};

export type SentenceFit = {
  dropped: OptionalDrop[];
  /** Offered drops that were refused because the sentence holds a brief anchor. */
  refused: OptionalDrop[];
  lengthMs: number;
  /**
   * How far past the brief's ceiling the cut still is, slack or no slack.
   * The slack decides whether anything is *cut* for length; it never hides
   * an overrun from the report, because a 5:05 cut against a 5:00 brief is
   * a fact the producer reads, not a rounding the code makes for them.
   */
  overBudgetMs: number;
};

/**
 * Cut a sentence plan down to its budget, v2.
 *
 * The order is the plan's (§2 W1): retakes and pauses have already gone
 * (they are wins whatever the budget), so what is left to give is the
 * model's optional drops, priority 2 before 3, in transcript order within a
 * priority so the argument still runs forwards. A sentence that holds a
 * brief anchor is never given up: the brief said it, so it stays. If the
 * cut is still over after all of that, nothing else goes — `overBudgetMs`
 * says by how much and the director reports the overrun rather than losing
 * a sentence to hit a number (§1: never drop a sentence to hit a length).
 */
export function fitSentencesToBudget(input: SentenceBudget): SentenceFit {
  const slack = input.slack ?? 0.03;
  let lengthMs = input.lengthMs;
  const dropped: OptionalDrop[] = [];
  const refused: OptionalDrop[] = [];
  if (input.budgetMs === null || lengthMs <= Math.round(input.budgetMs * (1 + slack))) {
    return { dropped, refused, lengthMs, overBudgetMs: input.budgetMs === null ? 0 : Math.max(0, lengthMs - input.budgetMs) };
  }
  const order = [...input.optional].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const d of order) {
    if (lengthMs <= input.budgetMs) break;
    if (input.anchors.has(d.id)) {
      refused.push(d);
      continue;
    }
    dropped.push(d);
    lengthMs -= Math.max(0, d.ms);
  }
  return { dropped, refused, lengthMs, overBudgetMs: Math.max(0, lengthMs - input.budgetMs) };
}
