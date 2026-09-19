import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { getViewer } from "@/lib/auth/dal";

/**
 * "Has anything been said since?" — the whole answer in one query.
 *
 * An open channel asks this every few seconds, so it does the channel lookup,
 * the membership check and the newest-message read in a single statement: one
 * round trip per poll rather than three. The client only refetches the thread
 * when the id changes.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  // Polled every few seconds from an open channel, but still a public endpoint:
  // the module is re-checked here like everywhere else.
  if (!viewer.modules.includes("chat")) return new Response("Not found", { status: 404 });

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || slug.length > 60) return new Response("Bad request", { status: 400 });

  const { rows } = await db.execute<{ id: string | null }>(sql`
    select m.id
      from chat_channels c
      left join lateral (
        select msg.id from chat_messages msg
         where msg.channel_id = c.id and msg.deleted_at is null
         order by msg.created_at desc
         limit 1
      ) m on true
     where c.tenant_id = ${viewer.tenantId} and c.slug = ${slug}
       and (c.is_private = false or exists (
            select 1 from chat_members cm
             where cm.channel_id = c.id and cm.user_id = ${viewer.id}))
     limit 1
  `);

  if (!rows.length) return new Response("Not found", { status: 404 });

  return Response.json(
    { latest: rows[0].id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
