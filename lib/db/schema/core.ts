import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** The eleven surfaces of the product (spec §4). Entitlements are granted
 * per module; the left rail renders exactly the modules a person holds. */
export const MODULES = [
  "chat",
  "files",
  "research",
  "script",
  "video",
  "publish",
  "accounting",
  "finance",
  "legal",
  "hr",
  "admin",
] as const;
export type Module = (typeof MODULES)[number];
export const moduleEnum = pgEnum("module", MODULES);

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member", "guest"]);
export const userStatusEnum = pgEnum("user_status", ["active", "invited", "suspended"]);
export const localeEnum = pgEnum("locale", ["zh-CN", "zh-HK", "en"]);

export const tenants = pgTable("tenants", {
  id: text().primaryKey(),
  name: text().notNull(),
  nameLocal: text(),
  defaultLocale: localeEnum().notNull().default("zh-CN"),
  settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: text().primaryKey(),
    tenantId: text().notNull().references(() => tenants.id),
    email: text().notNull(),
    name: text().notNull(),
    /** Chinese display name; the UI shows this when the locale is zh. */
    nameLocal: text(),
    avatarUrl: text(),
    /** Where the picture itself lives in R2, when somebody uploaded one.
     * `avatarUrl` stays the thing screens render — it points at the route
     * that serves this key to colleagues. */
    avatarKey: text(),
    title: text(),
    role: userRoleEnum().notNull().default("member"),
    status: userStatusEnum().notNull().default("invited"),
    /**
     * An AI employee — the research, script or video agent — not a person.
     *
     * A user row, because every tool already runs with a signed-in person's
     * rights: an agent that is a user gets bounded access, an audit trail and
     * its own line in the AI ledger for free. But its own flag, never a
     * `status`: "suspended" means a disabled human, and the day an admin
     * re-enables one is the day a bot becomes a login. Agents never sign in
     * (`app/login/actions.ts`, `lib/auth/dal.ts`), never approve, and are left
     * out of member pickers, invite checks and head counts.
     */
    isAgent: boolean().notNull().default(false),
    locale: localeEnum(),
    passwordHash: text(),
    /* Two-step verification. The seed is sealed (AES-256-GCM) rather than
       stored as the base32 an app would scan: a database leak that hands out
       TOTP seeds hands out second factors. `totpConfirmedAt` is what makes it
       live — a seed exists from the moment enrolment starts, and must not
       lock anybody out until they have proved the app is set up. */
    totpSecret: text(),
    totpConfirmedAt: timestamp({ withTimezone: true }),
    /** The last 30-second step spent, so a code cannot be used twice. */
    totpLastStep: integer(),
    /** Recovery codes, hashed. Never the codes themselves. */
    totpRecovery: jsonb().$type<string[]>(),
    teamId: text(),
    lastActiveAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha-256 of the cookie value. The raw token never touches the database,
     * so a database leak cannot be replayed as a login. */
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Browsers somebody chose to trust, so two-step verification is asked for
 * once a month rather than every sign-in.
 *
 * The id is the sha-256 of the cookie, exactly as sessions do it: the raw
 * token never lands in the database, so a leak of this table cannot be
 * replayed as a skipped second factor. Turning 2FA off, or re-enrolling,
 * deletes every row — a trusted browser is trusted against one enrolment.
 */
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    label: text(),
    ip: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("trusted_devices_user_idx").on(t.userId)],
);

export const teams = pgTable("teams", {
  id: text().primaryKey(),
  tenantId: text().notNull().references(() => tenants.id),
  name: text().notNull(),
  nameLocal: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text().notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    isLead: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("team_members_pk").on(t.teamId, t.userId)],
);

/** Module access. Absence of a row means the module does not exist for that
 * person — not a greyed-out link (spec §4.1). */
export const entitlements = pgTable(
  "entitlements",
  {
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    module: moduleEnum().notNull(),
    grantedBy: text().references(() => users.id),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entitlements_pk").on(t.userId, t.module)],
);

export const invites = pgTable(
  "invites",
  {
    id: text().primaryKey(),
    tenantId: text().notNull().references(() => tenants.id),
    email: text().notNull(),
    name: text(),
    role: userRoleEnum().notNull().default("member"),
    modules: jsonb().$type<Module[]>().notNull().default([]),
    tokenHash: text().notNull(),
    invitedBy: text().references(() => users.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invites_email_idx").on(t.email)],
);

/** Three kinds, three urgencies, three destinations (brief, Shell). */
export const notificationKindEnum = pgEnum("notification_kind", ["job", "approval", "budget"]);

export const notifications = pgTable(
  "notifications",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum().notNull(),
    title: text().notNull(),
    body: text(),
    href: text(),
    module: moduleEnum(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/** Everything that touches content or permissions lands here, including an
 * admin reading a file they were never granted (brief, Admin §4.11). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    actorId: text(),
    action: text().notNull(),
    objectType: text(),
    objectId: text(),
    module: moduleEnum(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_actor_idx").on(t.actorId, t.at),
    index("audit_object_idx").on(t.objectType, t.objectId, t.at),
    index("audit_at_idx").on(t.at),
  ],
);

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updatedBy: text().references(() => users.id),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Counter used to give humans short, stable numbers (SR-104, INV-2026-018)
 * without exposing row counts or leaking ids across tenants. */
export const sequences = pgTable("sequences", {
  key: text().primaryKey(),
  value: integer().notNull().default(0),
});
