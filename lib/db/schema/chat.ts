import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";

/** Team chat: channels, DMs, and the agent thread — the Slack-shaped surface
 * the design canvas shows. The agent's own conversations live in `agent.ts`;
 * this is people talking to people. */
/**
 * `announce` is the design's company-wide channel: everyone is a member and
 * only an administrator may post. It is a kind rather than a flag because the
 * membership rule differs too — joining is automatic, and leaving is not a
 * thing you can do.
 */
export const channelKindEnum = pgEnum("channel_kind", ["channel", "dm", "group", "announce"]);

export const chatChannels = pgTable(
  "chat_channels",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    kind: channelKindEnum().notNull().default("channel"),
    slug: text(),
    name: text().notNull(),
    topic: text(),
    isPrivate: boolean().notNull().default(false),
    createdBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("chat_channels_slug_idx").on(t.tenantId, t.slug)],
);

export const chatMembers = pgTable(
  "chat_members",
  {
    channelId: text().notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp({ withTimezone: true }),
    muted: boolean().notNull().default(false),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_members_pk").on(t.channelId, t.userId),
    index("chat_members_user_idx").on(t.userId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text().primaryKey(),
    channelId: text().notNull().references(() => chatChannels.id, { onDelete: "cascade" }),
    authorId: text().references(() => users.id),
    body: text().notNull().default(""),
    /** Thread root; null for a top-level message. */
    parentId: text(),
    /** File ids — rendered as previews, and each one is permission-checked
     * again at render time for the viewer, not the poster. */
    attachments: jsonb().$type<string[]>().notNull().default([]),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("chat_messages_channel_idx").on(t.channelId, t.createdAt),
    index("chat_messages_thread_idx").on(t.parentId),
  ],
);

export const chatReactions = pgTable(
  "chat_reactions",
  {
    messageId: text().notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    emoji: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_reactions_pk").on(t.messageId, t.userId, t.emoji)],
);
