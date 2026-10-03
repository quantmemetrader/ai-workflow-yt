import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, chatChannels, chatMembers, chatMessages, conversations, folders, users, workProjects } from "@/lib/db/schema";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { getViewer } from "@/lib/auth/dal";
import { canReadFolders } from "@/lib/authz/rebac";
import { searchFiles } from "@/lib/ai/retrieval";

/**
 * What the command palette shows for a query.
 *
 * Places (channels, people, folders) and things (files and their contents) in
 * one answer, because to the person typing it is one question: take me to X.
 *
 * Every list is scoped to the caller's own studio, and both halves of the file
 * search carry the ReBAC predicate in SQL rather than filtering rows after the
 * fact: `searchFiles` is the same query the agent's `search_files` tool runs,
 * and folders go through `canReadFolders`. A folder's *name* is worth hiding
 * on its own, so a folder nobody may open never reaches the list.
 *
 * Modules are not here. They come from the viewer's entitlements, which the
 * shell already holds, so the places half of the palette renders with no round
 * trip at all.
 */
export type PaletteHit = {
  kind: "channel" | "person" | "folder" | "file" | "project" | "chat";
  id: string;
  href: string;
  title: string;
  subtitle: string | null;
};

const MAX_PER_GROUP = 6;

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!q) {
    return Response.json({ hits: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const like = `%${q}%`;
  const chat = viewer.modules.includes("chat");
  const filesModule = viewer.modules.includes("files");

  /*
   * Four small queries, in parallel. They are independent and each is bounded
   * at six rows; running them in sequence would be four round trips to the
   * database for one keystroke's worth of answer.
   */
  const [channels, people, folderRows, fileSearch] = await Promise.all([
    chat
      ? db
          .select({
            id: chatChannels.id,
            slug: chatChannels.slug,
            name: chatChannels.name,
            isPrivate: chatChannels.isPrivate,
          })
          .from(chatChannels)
          .leftJoin(
            chatMembers,
            and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, viewer.id)),
          )
          .where(
            and(
              eq(chatChannels.tenantId, viewer.tenantId),
              isNull(chatChannels.archivedAt),
              ilike(chatChannels.name, like),
              // A private channel is only a place you can go if you are in it.
              or(eq(chatChannels.isPrivate, false), sql`${chatMembers.userId} is not null`),
            ),
          )
          .limit(MAX_PER_GROUP)
      : Promise.resolve([]),

    chat
      ? db
          .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, title: users.title })
          .from(users)
          .where(
            and(
              eq(users.tenantId, viewer.tenantId),
              isNull(users.deletedAt),
              eq(users.isAgent, false),
              or(ilike(users.name, like), ilike(users.nameLocal, like)),
            ),
          )
          .limit(MAX_PER_GROUP)
      : Promise.resolve([]),

    filesModule
      ? db
          .select({ id: folders.id, name: folders.name })
          .from(folders)
          .where(
            and(
              eq(folders.tenantId, viewer.tenantId),
              isNull(folders.deletedAt),
              ilike(folders.name, like),
              canReadFolders(viewer),
            ),
          )
          .limit(MAX_PER_GROUP)
      : Promise.resolve([]),

    filesModule ? searchFiles(viewer, q, MAX_PER_GROUP) : Promise.resolve({ hits: [], withheld: 0 }),
  ]);
  /* Projects you may open, and your own chats: "search should be like the
     jump box" — the things people actually look for by name. */
  const [projectRows, chatRows] = await Promise.all([
    chat
      ? db
          .select({ id: workProjects.id, title: workProjects.title })
          .from(workProjects)
          .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), ilike(workProjects.title, like), projectsVisibleTo(viewer)))
          .limit(MAX_PER_GROUP)
      : Promise.resolve([]),
    chat
      ? db
          .select({ id: conversations.id, title: conversations.title })
          .from(conversations)
          .where(and(eq(conversations.userId, viewer.id), isNull(conversations.archivedAt), ilike(conversations.title, like)))
          .limit(MAX_PER_GROUP)
      : Promise.resolve([]),
  ]);

  const hits: PaletteHit[] = [];

  for (const p of projectRows) hits.push({ kind: "project", id: p.id, href: `/projects/${p.id}`, title: p.title, subtitle: null });
  for (const c of chatRows) hits.push({ kind: "chat", id: c.id, href: `/chat/t/${c.id}`, title: c.title, subtitle: null });

  /* Any word said in any chat you can read ("I should be able to search any
     word in any chat"): your own chats with the assistant and the employees,
     and the channels and DMs you are in (public channels too). The line is
     shown around the word. */
  if (chat) {
    const [ownLines, channelLines] = await Promise.all([
      db
        .select({ conversationId: agentMessages.conversationId, title: conversations.title, content: agentMessages.content, at: agentMessages.createdAt })
        .from(agentMessages)
        .innerJoin(conversations, eq(conversations.id, agentMessages.conversationId))
        .where(and(eq(conversations.userId, viewer.id), isNull(conversations.archivedAt), ilike(agentMessages.content, like)))
        .orderBy(desc(agentMessages.createdAt))
        .limit(24),
      db
        .select({ id: chatMessages.id, body: chatMessages.body, slug: chatChannels.slug, name: chatChannels.name, kind: chatChannels.kind, at: chatMessages.createdAt })
        .from(chatMessages)
        .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
        .leftJoin(chatMembers, and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, viewer.id)))
        .where(
          and(
            eq(chatChannels.tenantId, viewer.tenantId),
            isNull(chatMessages.deletedAt),
            ilike(chatMessages.body, like),
            or(sql`${chatMembers.userId} is not null`, and(eq(chatChannels.isPrivate, false), sql`${chatChannels.kind} <> 'dm'`)),
          ),
        )
        .orderBy(desc(chatMessages.createdAt))
        .limit(12),
    ]);
    const seen = new Set<string>();
    for (const l of ownLines) {
      if (seen.has(l.conversationId) || seen.size >= MAX_PER_GROUP) continue;
      seen.add(l.conversationId);
      hits.push({ kind: "chat", id: `${l.conversationId}:line`, href: `/chat/t/${l.conversationId}`, title: l.title === "New chat" ? "对话" : l.title, subtitle: around(l.content, q) });
    }
    for (const l of channelLines.slice(0, MAX_PER_GROUP)) {
      if (!l.slug) continue;
      hits.push({ kind: "channel", id: `${l.id}:line`, href: l.kind === "dm" ? `/chat/c/${l.slug}` : `/chat/c/${l.slug}`, title: l.kind === "dm" ? l.name : `#${l.name}`, subtitle: around(l.body, q) });
    }
  }

  for (const c of channels) {
    if (!c.slug) continue;
    hits.push({
      kind: "channel",
      id: c.id,
      href: `/chat/c/${c.slug}`,
      title: c.name,
      subtitle: c.isPrivate ? "private" : null,
    });
  }

  for (const p of people) {
    if (p.id === viewer.id) continue;
    hits.push({
      kind: "person",
      id: p.id,
      href: `/chat/dm/${p.id}`,
      title: p.nameLocal ?? p.name,
      subtitle: p.title,
    });
  }

  for (const f of folderRows) {
    hits.push({ kind: "folder", id: f.id, href: `/files/f/${f.id}`, title: f.name, subtitle: null });
  }

  for (const h of fileSearch.hits) {
    hits.push({
      kind: "file",
      id: h.fileId,
      href: `/files/${h.fileId}`,
      title: h.name,
      subtitle: h.snippet || null,
    });
  }

  return Response.json(
    /* Not `withheld`: the number of matches somebody may not read is not
       theirs to know either (QA, 3 Oct). */
    { hits },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** The words around the first match, on one line, with the markdown and ids taken out. */
function around(text: string, q: string): string {
  const flat = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:scr|wp|prj|fil|rnd|shot|cnv|msg|am)_[0-9a-z]{6,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, 80);
  const start = Math.max(0, i - 30);
  return `${start > 0 ? "…" : ""}${flat.slice(start, i + q.length + 50)}${i + q.length + 50 < flat.length ? "…" : ""}`;
}
