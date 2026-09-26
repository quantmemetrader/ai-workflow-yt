/**
 * The director v2 switch.
 *
 * Off by default, and off means the v1 path runs byte for byte as it does
 * today: `direct()` reads this once at the top and never again, so a tenant
 * that has not opted in cannot be touched by anything under `lib/video/v2/`.
 *
 * Two places can turn it on, and they are read in this order:
 *
 *   1. `tenants.settings.directorV2` — the studio's own choice, per tenant.
 *      `true`, `1`, `"1"` and `"on"` switch it on; `false`, `0`, `"0"` and
 *      `"off"` switch it off *even when the environment says on*, because
 *      the release plan (PLAN.md §3 step 7) turns the flag on for the
 *      owner's tenant first and watches three real runs, and a second
 *      tenant on the same box must be able to stay on v1 meanwhile.
 *   2. `DIRECTOR_V2=1` in the environment — the deployment-wide default for
 *      when no tenant has said anything. Lab runs set this.
 *
 * The core is pure: it takes the settings object it is given. The wrapper
 * below reads the tenant row, and imports the database lazily so a lab
 * script can load this module without `DATABASE_URL`.
 */

/** What a tenant row carries that matters here. */
export type FlagTenant = { settings?: Record<string, unknown> | null } | null | undefined;

const ON = new Set(["1", "true", "on", "yes"]);
const OFF = new Set(["0", "false", "off", "no"]);

/** `true` / `false` for a value that means one of them, `null` for anything else. */
function asSwitch(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (ON.has(v)) return true;
    if (OFF.has(v)) return false;
  }
  return null;
}

/**
 * Whether the v2 director runs for this tenant.
 *
 * `envValue` is a parameter rather than a read of `process.env` inside so a
 * test can pass both states without touching the environment; callers leave
 * it out and get the real one.
 */
export function directorV2(tenant: FlagTenant, envValue: string | undefined = process.env.DIRECTOR_V2): boolean {
  const chosen = asSwitch(tenant?.settings?.directorV2);
  if (chosen !== null) return chosen;
  return asSwitch(envValue) === true;
}

/**
 * The same answer, from a tenant id.
 *
 * A tenant that cannot be read is treated as unset: the environment decides,
 * and a database blip therefore leaves a deployment on whichever path it was
 * already on rather than flipping a run to v2 by accident.
 */
export async function directorV2ForTenant(tenantId: string): Promise<boolean> {
  try {
    const [{ db }, { tenants }, { eq }] = await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/db/schema"),
      import("drizzle-orm"),
    ]);
    const [row] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return directorV2(row ?? null);
  } catch (err) {
    console.warn("[director-v2] could not read the tenant flag; using the environment:", err instanceof Error ? err.message : err);
    return directorV2(null);
  }
}
