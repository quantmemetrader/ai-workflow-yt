/**
 * Times and day labels for the chat screens, the same on the server and in the
 * browser.
 *
 * The message list used to format with the machine's own clock and zone: the
 * server renders in UTC, a browser in Hong Kong hydrates in UTC+8, and the two
 * disagree about every timestamp on the page — a hydration mismatch on each
 * message, and "Today" that could be yesterday on one side of midnight. The
 * studio works in Hong Kong time (the morning brief says "8:00（香港时间）"),
 * so both sides now format in that zone, and "now" is handed down from the
 * server render instead of being read again during hydration.
 */
const ZONE = "Asia/Hong_Kong";

function loc(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-09-25": the calendar day this instant falls on, in Hong Kong. */
export function dayKey(iso: string | Date): string {
  return DAY_KEY.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** Whole days between two Hong Kong calendar days (b − a). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function sameDay(a: string, b: string): boolean {
  return dayKey(a) === dayKey(b);
}

/** "09:38". */
export function clock(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(loc(locale), { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** The day pill over a run of messages: "今天" / "昨天", the date for anything older. */
export function dayLabel(iso: string | undefined, now: string, locale: string): string {
  const at = iso ?? now;
  const days = dayDiff(dayKey(now), dayKey(at));
  if (days === 0 || days === -1) {
    const rel = new Intl.RelativeTimeFormat(loc(locale), { numeric: "auto" }).format(days, "day");
    return rel.charAt(0).toUpperCase() + rel.slice(1);
  }
  return new Intl.DateTimeFormat(loc(locale), { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" }).format(new Date(at));
}

/** The sidebar's right-hand date: the time today, the weekday this week, else the date. */
export function shortDay(iso: string, now: string, locale: string): string {
  const days = dayDiff(dayKey(iso), dayKey(now));
  if (days <= 0) return clock(iso, locale);
  const at = new Date(iso);
  if (days < 7) return new Intl.DateTimeFormat(loc(locale), { timeZone: ZONE, weekday: "short" }).format(at);
  return new Intl.DateTimeFormat(loc(locale), { timeZone: ZONE, day: "numeric", month: "short" }).format(at);
}

/** Minutes between two instants, for grouping a run of messages. */
export function minutesBetween(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 60_000;
}
