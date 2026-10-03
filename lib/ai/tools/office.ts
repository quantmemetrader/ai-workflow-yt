import "server-only";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import type { Viewer } from "@/lib/auth/types";
import type { ToolContext } from "./types";

/**
 * Amounts and people, shared by the office packs (finance, accounting).
 *
 * Every ledger in the studio stores money in millionths (`amountMicros`), and
 * a person says it as "HK$1,200.50", "1200.5", "2,400 港元" or "1.2万". The
 * model passes whatever the person said; this turns it into micros without a
 * float multiplication anywhere, so 0.1 + 0.2 never becomes a ledger line.
 */

/** Ten billion dollars in micros is still well inside a safe integer. */
const MAX_UNITS = 1e10;

/**
 * Micros from what a person or the model wrote, or null when it is not an
 * amount. Whole cents only: "12.345" is refused rather than rounded, because a
 * rounded figure in a ledger is a figure nobody typed.
 */
export function parseAmount(v: unknown): number | null {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    s = String(v);
    if (/e/i.test(s)) return null;
  } else if (typeof v === "string") {
    s = v;
  } else {
    return null;
  }

  s = s
    .trim()
    .replace(/^HK\$|^HKD|^\$/i, "")
    .replace(/(?:HKD|港元|港币|元)$/i, "")
    .replace(/[,，\s]/g, "")
    .replace(/^HK\$|^\$/i, "");

  let scale = 1;
  if (s.endsWith("万")) {
    scale = 10_000;
    s = s.slice(0, -1);
  }

  const m = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[2]);
  if (!Number.isSafeInteger(whole) || whole * scale > MAX_UNITS) return null;
  const micros = (whole * 1_000_000 + Number((m[3] ?? "").padEnd(6, "0"))) * scale;
  if (!Number.isSafeInteger(micros) || micros % 10_000 !== 0) return null;
  return m[1] ? -micros : micros;
}

/** HK$1,200.50 — how every office tool says an amount. */
export function hk(micros: number): string {
  const units = Math.abs(micros) / 1_000_000;
  const text = units.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${micros < 0 ? "-" : ""}HK$${text}`;
}

/**
 * The person an action is taken as: whoever typed into their own assistant,
 * or the person behind an AI employee's turn. Null when nobody is behind it
 * (a chain an employee started on its own), and anything that approves,
 * decides, pays, posts or closes is then refused.
 */
export function personOf(ctx: ToolContext): Viewer | null {
  return ctx.asker ?? (agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer);
}

/** Today's month in Hong Kong, YYYY-MM, which is the studio's month. */
export function hkMonthNow(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
}

/** Today in Hong Kong, YYYY-MM-DD. */
export function hkTodayNow(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** A YYYY-MM-DD that is a real date, or null. */
export function dayOf(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** A YYYY-MM with a real month, or null. */
export function monthArg(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

/**
 * Who an HR or Accounting tool works for, or why it will not.
 *
 * Neither module has an AI employee: these packs serve the person's own
 * assistant, and every call runs as that person, so the services' own checks
 * (`canManage`, closed months) see a person and never an agent. When an
 * employee's turn reaches one anyway (a pack offered by a module it was
 * later granted), the answer must still be the person's alone.
 */
export function officePerson(
  ctx: ToolContext,
  module: "hr" | "accounting",
): { person: Viewer } | { refuse: string } {
  const label = module === "hr" ? "HR (人事)" : "Accounting (会计)";
  const person = personOf(ctx);
  if (!person) return { refuse: `Nobody who holds the ${label} module asked for this, so its records are not read or changed on this turn.` };
  if (!person.modules.includes(module)) {
    return { refuse: `${person.nameLocal || person.name} does not hold the ${label} module, so its records are not theirs to see or change. An administrator grants modules.` };
  }
  if (agentKeyFromEmail(ctx.viewer.email) && !ctx.privateReply) {
    return { refuse: `This answer would be posted where others can read it, so ${label} records stay out of it. ${person.nameLocal || person.name} can ask their own assistant instead.` };
  }
  return { person };
}
