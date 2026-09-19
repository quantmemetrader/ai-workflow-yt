/**
 * Adds a person to the studio, or updates the one already there.
 *
 * Until the Admin module is built, this is how people are created. It is the
 * same code path the Admin screen will call, so nothing has to be redone.
 *
 *   EMAIL=amy@aurafarmers.hk NAME="Amy Wong" ROLE=member \
 *   MODULES=chat,files,research,script,publish npm run db:add-user
 *
 * Omit MODULES to grant everything. A new person's password is generated and
 * printed once unless PASSWORD is set.
 *
 * Re-running against someone who already exists updates their name, role and
 * modules and leaves their password alone — changing modules is routine, and
 * it must not quietly sign somebody out of the account they are using. Pass
 * PASSWORD to set a new one deliberately.
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../lib/db/client";
import { entitlements, tenants, users, type Module } from "../lib/db/schema";
import { generatePassword, hashPassword } from "../lib/auth/password";
import { newId } from "../lib/ids";

const ALL: Module[] = [
  "chat", "files", "research", "script", "video", "publish",
  "accounting", "finance", "legal", "hr", "admin",
];

const ROLES = ["owner", "admin", "member", "guest"] as const;
type Role = (typeof ROLES)[number];

async function main() {
  const email = (process.env.EMAIL ?? "").trim().toLowerCase();
  const name = process.env.NAME ?? "";
  const nameLocal = process.env.NAME_LOCAL || null;
  const title = process.env.TITLE || null;
  const role = (process.env.ROLE ?? "member") as Role;

  if (!email || !name) {
    console.error('Set EMAIL and NAME, e.g. EMAIL=amy@studio.hk NAME="Amy Wong"');
    process.exit(1);
  }

  // Caught here rather than by the enum, so the message names the four roles
  // instead of quoting a Postgres type.
  if (!(ROLES as readonly string[]).includes(role)) {
    console.error(`ROLE must be one of: ${ROLES.join(", ")}`);
    process.exit(1);
  }

  const modules = (process.env.MODULES ? process.env.MODULES.split(",") : ALL)
    .map((m) => m.trim())
    .filter((m): m is Module => (ALL as string[]).includes(m));

  if (!modules.length) {
    console.error(`MODULES must name at least one of: ${ALL.join(", ")}`);
    process.exit(1);
  }

  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    console.error("No tenant exists yet. Run npm run db:reset first.");
    process.exit(1);
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenant.id), eq(users.email, email)))
    .limit(1);

  const id = existing?.id ?? newId("usr");

  // A password is set for a new person, or when one is asked for by name.
  // Re-running to change somebody's modules leaves the password they are
  // already using in place.
  const password = existing && !process.env.PASSWORD ? null : process.env.PASSWORD || generatePassword();
  const passwordHash = password ? await hashPassword(password) : null;

  await db.transaction(async (trx) => {
    if (existing) {
      await trx
        .update(users)
        .set({ name, nameLocal, title, role, status: "active", ...(passwordHash ? { passwordHash } : {}) })
        .where(eq(users.id, id));
    } else {
      await trx.insert(users).values({
        id,
        tenantId: tenant.id,
        email,
        name,
        nameLocal,
        title,
        role,
        status: "active",
        passwordHash,
        locale: tenant.defaultLocale,
      });
    }

    // Entitlements are replaced, not merged: what you pass is what they hold.
    // In one transaction, so a failure between the two cannot leave somebody
    // signed in with no modules at all.
    await trx.delete(entitlements).where(eq(entitlements.userId, id));
    await trx.insert(entitlements).values(modules.map((module) => ({ userId: id, module })));
  });

  console.log(`${existing ? "Updated" : "Created"} ${name} <${email}> as ${role}`);
  console.log(`Modules:  ${modules.join(", ")}`);
  if (password) {
    console.log(`Password: ${password}`);
    console.log("Printed once. They should change it after signing in.");
  } else {
    console.log("Password: unchanged. Pass PASSWORD=… to set a new one.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
