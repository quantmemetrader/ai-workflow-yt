import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
    source: jsonb().$type<{ kind: string; label?: string; url?: string | null; evidence?: unknown[]; [k: string]: unknown } | null>(),
    /** The backlog topic or idea this project was started from, if any. */
    topicId: text(),
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
  (t) => [index("work_projects_tenant_idx").on(t.tenantId, t.updatedAt), index("work_projects_topic_idx").on(t.tenantId, t.topicId)],
);

/**
 * Video ideas 研究员 worked out from the stored research, for Home.
 *
 * One press of "generate" is a batch; each row is one idea with its title
 * options, the angle, why now, and the evidence rows it stands on. Kept so
 * the panel is instant on the next visit and an idea can become a project
 * (status "started", projectId set) or be saved for later.
 */
export const ideas = pgTable(
  "ideas",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    batchId: text().notNull(),
    createdBy: text().notNull(),
    /** What the person asked for, if they typed anything. */
    seed: text(),
    title: text().notNull(),
    /** Other ways to title it. */
    titles: jsonb().$type<string[]>().notNull().default([]),
    angle: text(),
    why: text(),
    hook: text(),
    format: text(),
    /** 1-5, how strong 研究员 thinks it is. */
    strength: integer(),
    evidence: jsonb().$type<unknown[]>().notNull().default([]),
    /** new · saved · started · dismissed */
    status: text().notNull().default("new"),
    projectId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ideas_tenant_idx").on(t.tenantId, t.createdAt)],
);
