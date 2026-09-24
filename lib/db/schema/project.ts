import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A project: one video, and everything about it in one place.
 *
 * The studio's work used to be spread across #制作, the Script page, the
 * Video page and Research, and every screen had to stitch it back
 * together. A project holds it instead: its own chat with the five
 * employees (`channelId`), its script, its video project (clips, cuts,
 * renders), and where it came from. The sidebar lists projects as a tree
 * and a project's page is the only place its work happens.
 */
export const workProjects = pgTable(
  "work_projects",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    title: text().notNull(),
    /** What it is about, in the words it was started with. */
    brief: text(),
    /** active · done · archived */
    status: text().notNull().default("active"),
    /**
     * How it was started. "full" goes through the whole line (topic, script,
     * host's clips, edit); "direct:video" and the like went straight to one
     * employee, and the steps before them are skipped.
     */
    mode: text().notNull().default("full"),
    /** Where the topic came from: a pick's evidence, or who typed it. */
    source: jsonb().$type<{ kind: string; label?: string; url?: string | null; evidence?: unknown[] } | null>(),
    /**
     * Who can see and work on it, as the Files picker says it: private (the
     * person who started it), everyone in the studio, some groups (roles), or
     * named people (guests only when named). The five employees always can.
     */
    access: jsonb().$type<{ mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] }>().notNull().default({ mode: "everyone" }),
    channelId: text().notNull(),
    scriptId: text(),
    videoProjectId: text(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("work_projects_tenant_idx").on(t.tenantId, t.updatedAt)],
);
