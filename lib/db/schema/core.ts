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
    title: text(),
    role: userRoleEnum().notNull().default("member"),
    status: userStatusEnum().notNull().default("invited"),
    locale: localeEnum(),
    passwordHash: text(),
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
