import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/auth/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";

/**
 * What the studio's AI employees do without being asked, and the switch for it.
 *
 * The client asked for the work to happen on its own *and* for a page to turn
 * it off — which is the right pair: an employee that acts by itself and cannot
 * be told to stop is not an employee.
 *
 * Kept in the `settings` key-value table rather than a table of its own. There
 * are four rows, they are edited by hand a few times a year, and a migration
 * for four booleans is a migration to maintain for ever.
 *
 * **Times are Hong Kong.** pm2 wakes the two scheduled scripts every hour and
 * they decide whether it is time (`dueNow`), so changing the hour on this page
 * actually changes when the post lands — a cron line in `ecosystem.config.cjs`
 * could not be edited from a browser.
 */
export const AUTOMATION_KEYS = ["digest", "plan", "footage"] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export type Automation = {
  enabled: boolean;
  /** Hong Kong, 24-hour. Absent on the ones that answer an event. */
  hour?: number;
  minute?: number;
  /** Which AI employee posts it. */
  agent: AgentKey;
};

export type AutomationDef = {
  key: AutomationKey;
  name: string;
  nameEn: string;
  what: string;
  whatEn: string;
  /** False for the ones that fire on something happening rather than a clock. */
  scheduled: boolean;
  default: Automation;
};

export const AUTOMATIONS: AutomationDef[] = [
  {
    key: "digest",
    name: "每日晨报",
    nameEn: "Morning digest",
    what: "每天早上在 #研究日报 发昨天的趋势，和今天值得讨论的一个选题。",
    whatEn: "Yesterday's trends and one topic worth discussing, in #研究日报 each morning.",
    scheduled: true,
    default: { enabled: true, hour: 8, minute: 0, agent: "research" },
  },
  {
    key: "plan",
    name: "每日待办",
    nameEn: "Daily to-dos",
    what: "晨报之后，在同一个频道发当天的待办，每位同事一个按钮。",
    whatEn: "Right after the digest, the day's to-dos in the same channel, one button per colleague.",
    scheduled: true,
    default: { enabled: true, hour: 8, minute: 5, agent: "planning" },
  },
  {
    key: "footage",
    name: "新素材自动分析",
    nameEn: "Read new footage",
    what: "上传的素材自动转写后，在 #制作 说说这段可以拿来做什么。",
    whatEn: "When an upload has been transcribed, say in #制作 what could be made from it.",
    scheduled: false,
    default: { enabled: true, agent: "planning" },
  },
];

const KEY = "automations";

type Stored = Partial<Record<AutomationKey, Partial<Automation>>>;

function clean(def: AutomationDef, stored: Partial<Automation> | undefined): Automation {
  const base = def.default;
  const hour = Number(stored?.hour);
  const minute = Number(stored?.minute);
  return {
    enabled: typeof stored?.enabled === "boolean" ? stored.enabled : base.enabled,
    agent: AGENT_KEYS.includes(stored?.agent as AgentKey) ? (stored!.agent as AgentKey) : base.agent,
    ...(def.scheduled
      ? {
          hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : base.hour,
          minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : base.minute,
        }
      : {}),
  };
}

/** Every automation, with whatever the studio has changed applied over the
 *  defaults. Safe to call from anywhere: an empty row reads as the defaults. */
export async function readAutomations(): Promise<Record<AutomationKey, Automation>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).limit(1);
  const stored = (row?.value ?? {}) as Stored;
  return Object.fromEntries(AUTOMATIONS.map((def) => [def.key, clean(def, stored[def.key])])) as Record<
    AutomationKey,
    Automation
  >;
}

export async function readAutomation(key: AutomationKey): Promise<Automation> {
  return (await readAutomations())[key];
}

/** Change one automation. Only an owner or an admin gets here (the page and
 *  the action both check), and the change is audited like any other. */
export async function setAutomation(viewer: Viewer, key: AutomationKey, patch: Partial<Automation>) {
  const def = AUTOMATIONS.find((a) => a.key === key);
  if (!def) throw new Error(`No automation called ${key}`);

  const current = await readAutomations();
  const next = { ...current, [key]: clean(def, { ...current[key], ...patch }) };

  await db
    .insert(settings)
    .values({ key: KEY, value: next, updatedBy: viewer.id })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: next, updatedBy: viewer.id, updatedAt: new Date() },
    });

  await audit(viewer, "automation.set", {
    module: "admin",
    objectType: "automation",
    objectId: key,
    meta: next[key],
  });
  return next[key];
}

/** Hong Kong's wall clock, as minutes since midnight. */
function hkMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether a scheduled automation should run on this wake-up.
 *
 * pm2 wakes the script hourly, so "is it eight o'clock" is the wrong question;
 * "has eight o'clock been and gone today, and not by so long that this is
 * yesterday's post arriving at dinner time" is the right one. The three-hour
 * window is what turns a missed run — a deploy, a reboot — into a late post
 * rather than a lost one, and stops switching the automation on at four in the
 * afternoon from firing the morning brief immediately.
 */
const CATCH_UP_MINUTES = 3 * 60;

export function dueNow(automation: Automation, now = new Date()): boolean {
  if (!automation.enabled) return false;
  if (automation.hour === undefined) return true;
  const at = automation.hour * 60 + (automation.minute ?? 0);
  const since = hkMinutes(now) - at;
  return since >= 0 && since <= CATCH_UP_MINUTES;
}
