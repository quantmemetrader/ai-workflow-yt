/**
 * The arithmetic a leave request has to pass, kept apart from the database so
 * it can be checked on its own (`requestLeave` is the one caller).
 *
 * QA, 3 Oct: a request for more days than the person had left went through,
 * and so did 30 days over a two-day range. Both are refused now, in Chinese,
 * with the number that matters.
 */

const KIND_ZH: Record<string, string> = { annual: "年假", sick: "病假", unpaid: "无薪假", other: "其他假" };

export const leaveKindZh = (kind: string) => KIND_ZH[kind] ?? kind;

/** Days written one way, as the HR screen writes them: "4", "2.5". */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Calendar days from `startOn` to `endOn`, both counted. Null if either is not a date. */
export function calendarDays(startOn: string, endOn: string): number | null {
  const a = Date.parse(`${startOn}T00:00:00Z`);
  const b = Date.parse(`${endOn}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Whether `days` fits the range: at least half a day, in half-day steps, and
 * no more than the calendar days from the first to the last, inclusive. The
 * error to show, or null.
 */
export function checkLeaveDays(startOn: string, endOn: string, days: number): string | null {
  const span = calendarDays(startOn, endOn);
  if (span === null) return "开始和结束日期都要填";
  if (span < 1) return "结束日期早于开始日期";
  if (!Number.isFinite(days) || days <= 0) return "请填写天数";
  if (days < 0.5 || !Number.isInteger(days * 2)) return "天数请按半天或整天填写，例如 1 或 1.5";
  if (days > span) return `所选日期只有 ${span} 天，请假天数不能超过 ${span} 天`;
  return null;
}

/**
 * Whether a request fits what is left of the balance. `committed` is what is
 * already approved or still waiting for approval, so two requests sent one
 * after another cannot each spend the same days. The error, or null.
 */
export function checkLeaveBalance(input: {
  kind: string;
  days: number;
  entitlementDays: number;
  carriedDays: number;
  approvedDays: number;
  pendingDays: number;
}): string | null {
  const remaining = input.entitlementDays + input.carriedDays - input.approvedDays - input.pendingDays;
  if (input.days <= remaining + 1e-9) return null;
  const left = Math.max(0, remaining);
  const pending = input.pendingDays > 0 ? `（已扣除待审批的 ${fmt(input.pendingDays)} 天）` : "";
  return `${leaveKindZh(input.kind)}余额不足：还剩 ${fmt(left)} 天${pending}，这次申请了 ${fmt(input.days)} 天`;
}
