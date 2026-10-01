/**
 * Money on the Finance screens, in the same "US$ 1.00" style as /settings.
 *
 * (QA, 2 Oct: Finance wrote "$0.87" where Settings wrote "US$ 0.87", and a
 * balance flipped between $10.00 and $9.99 across loads.) `formatUsd` in
 * lib/ai/ledger is the house style, but that module is server-only, so the
 * client screens use this copy of it. Rounding happens once, on whole cents
 * taken from integer micros, so the same amount always prints the same way.
 */
export function usd(micros: number): string {
  if (!Number.isFinite(micros) || micros === 0) return "US$ 0.00";
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(Math.round(micros));
  if (abs < 10_000) return `${sign}US$ ${(abs / 1_000_000).toFixed(4)}`;
  const cents = Math.round(abs / 10_000);
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `${sign}US$ ${whole}.${String(cents % 100).padStart(2, "0")}`;
}

/** The same, for an amount a provider reports in dollars. */
export function usdDollars(n: number): string {
  return usd(Math.round(n * 1_000_000));
}
