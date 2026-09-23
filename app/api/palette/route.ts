import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, folders, users } from "@/lib/db/schema";
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
  kind: "channel" | "person" | "folder" | "file";
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
    return Response.json({ hits: [], withheld: 0 }, { headers: { "Cache-Control": "no-store" } });
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

  const hits: PaletteHit[] = [];

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
    { hits, withheld: fileSearch.withheld },
    { headers: { "Cache-Control": "no-store" } },
  );
}
