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
  /* 200, not 60. A direct message's slug is `dm-` plus both user ids — 64
     characters — so every poll from a DM was a 400 and no DM ever updated
     itself; the same off-by-a-format that used to swallow DM sends. The limit
     is a guard against an absurd string, not a format. */
  if (!slug || slug.length > 200) return new Response("Bad request", { status: 400 });

  /* And who is at work in the room, on which step: an employee's working
     row (`lib/chat/pending.ts`) moves from "正在看…" to "正在写脚本" without
     a new message, and the channel has to see that too. Same statement, so
     it is still one round trip. */
  const { rows } = await db.execute<{ id: string | null; pending: string | null }>(sql`
    select m.id,
           (select string_agg(p.id || ':' || coalesce(p.meta -> 'pending' ->> 'step', 'working'), ',' order by p.created_at)
              from chat_messages p
             where p.channel_id = c.id
               /* Bounded by when it began, so the (channel, created_at)
                  index answers it: no turn runs for an hour. */
               and p.created_at > now() - interval '1 hour'
               and p.deleted_at is not null
               and p.meta ? 'pending'
               and coalesce(p.edited_at, p.created_at) > now() - interval '10 minutes') as pending
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
    { latest: rows[0].id ?? null, pending: rows[0].pending ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
