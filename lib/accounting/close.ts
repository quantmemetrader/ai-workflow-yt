/**
 * Month-end close (月结): the rules, kept apart from the database so they can
 * be checked on their own. `lib/accounting/service.ts` is the caller.
 *
 * An entry belongs to a month two ways: its `period` (the month it is booked
 * into) and the month of its `entry_date`. A closed month locks both, so an
 * entry booked into October but dated 30 September cannot be written once
 * September is closed, and neither can one dated in October once October is.
 *
 * Months close in order: a month cannot close while an earlier month that has
 * entries is still open, and a month cannot reopen while a later one is
 * closed. The books are a running total; closing out of order would freeze a
 * month whose opening position can still change underneath it.
 */

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isPeriod = (v: unknown): v is string => typeof v === "string" && PERIOD_RE.test(v);

/** 'YYYY-MM' of a 'YYYY-MM-DD' date, or null when it is not one. */
export function monthOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4}-\d{2})-\d{2}$/.exec(date);
  return m ? m[1] : null;
}

/** The months an entry with this `period` and `entry_date` touches. */
export function monthsOfEntry(entry: { period: string; entryDate: string | null | undefined }): string[] {
  const out = new Set<string>([entry.period]);
  const m = monthOf(entry.entryDate);
  if (m) out.add(m);
  return [...out];
}

/**
 * Why an entry in these months may not be changed, or null when it may.
 * `verb` is what was being attempted, for the message ("修改", "过账"…).
 */
export function lockedReason(
  closed: ReadonlySet<string>,
  entry: { period: string; entryDate: string | null | undefined },
  verb: string,
): string | null {
  const hit = monthsOfEntry(entry)
    .filter((m) => closed.has(m))
    .sort();
  if (!hit.length) return null;
  return `${hit.join("、")} 已结账，不能${verb}该期间的分录。如需更正，请由管理员先反结账，或在未结账的月份另记一笔更正分录。`;
}

export type CloseChecklist = {
  /** Drafts booked into or dated in the month. A closed month's drafts could
   * never be posted or deleted, so they block. */
  drafts: number;
  /** Of those drafts, the ones whose lines do not sum to zero. */
  unbalanced: number;
  /** Documents dated in the month (or undated and added in it) with no entry
   * written against them. A warning only: a late receipt can still be booked
   * into an open month. */
  unenteredDocuments: number;
  /** Sum of every posted line in the month. Zero, or the books are wrong. */
  trialBalanceMicros: number;
  /** Earlier months that have entries and are not closed. */
  earlierOpen: string[];
};

/** What stops a month closing, in Chinese, in the order to fix them. Empty means it can close. */
export function closeBlockers(period: string, c: CloseChecklist, now = new Date()): string[] {
  const out: string[] = [];
  const thisMonth = now.toISOString().slice(0, 7);
  if (!isPeriod(period)) out.push("月份格式不对");
  else if (period > thisMonth) out.push(`${period} 还没到，不能提前结账`);
  if (c.earlierOpen.length) {
    const first = [...c.earlierOpen].sort()[0];
    out.push(`请按顺序结账：更早的 ${[...c.earlierOpen].sort().join("、")} 还有分录未结账，请先结 ${first}`);
  }
  if (c.drafts > 0) {
    out.push(
      c.unbalanced > 0
        ? `还有 ${c.drafts} 条草稿分录（其中 ${c.unbalanced} 条借贷不平），请先过账或删除`
        : `还有 ${c.drafts} 条草稿分录，请先过账或删除`,
    );
  }
  if (c.trialBalanceMicros !== 0) {
    out.push(`试算不平衡：已过账分录借贷相差 ${(c.trialBalanceMicros / 1_000_000).toFixed(2)}`);
  }
  return out;
}

/** Why a month may not be reopened, or null. */
export function reopenBlocker(period: string, closedPeriods: Iterable<string>, reason: string): string | null {
  if (!isPeriod(period)) return "月份格式不对";
  const set = new Set(closedPeriods);
  if (!set.has(period)) return `${period} 没有结账，无需反结账`;
  const later = [...set].filter((p) => p > period).sort();
  if (later.length) return `请先反结账更晚的月份：${later.reverse().join("、")}`;
  if (reason.trim().length < 2) return "请写明反结账的原因";
  return null;
}
