import { formatDate, type Locale } from "@/lib/i18n";

/**
 * How long ago something happened, in words.
 *
 * "23 Sept, 19:54" is a fact nobody asked for: on a list of cuts the question
 * is always *how stale is this*, and a date makes you do the subtraction. So
 * the recent past is relative — 刚刚, 10 分钟前, 2 小时前, 昨天, 3 天前 — and
 * anything a week or more old falls back to `formatDate`, because past that
 * point "37 天前" is worse than the date it happened.
 *
 * One helper rather than one per screen: the thresholds and the wording are a
 * decision about the product, and three screens that each rounded differently
 * would read as three different products.
 *
 * The answer depends on the reader's clock and zone, which the server does not
 * know, so a component that renders on the server must wait for mount before
 * showing this — see `Library` in components/video/VideoScreen.tsx.
 */
export function timeAgo(when: Date, locale: Locale, now: Date = new Date()): string {
  const t = (en: string, cn: string) => (locale === "en" ? en : cn);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

  const minutes = Math.floor((now.getTime() - when.getTime()) / 60_000);
  // A clock a little ahead of the server's should read as "now", not as a
  // negative count of minutes.
  if (minutes < 1) return t("just now", "刚刚");
  if (minutes < 60) return t(plural(minutes, "minute"), `${minutes} 分钟前`);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(plural(hours, "hour"), `${hours} 小时前`);

  /* Past a day it is calendar days, not 24-hour blocks: something from 23:00
     last night is "yesterday" to a person, whatever the arithmetic says. */
  const days = calendarDaysApart(when, now);
  if (days <= 1) return t("yesterday", "昨天");
  if (days < 7) return t(plural(days, "day"), `${days} 天前`);
  return formatDate(when, locale);
}

/** Whole days between two local dates, ignoring the time of day. */
function calendarDaysApart(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  // Rounded, so the hour a daylight-saving change adds or removes does not
  // turn a day into "0 days" or "2 days".
  return Math.round((b - a) / 86_400_000);
}
