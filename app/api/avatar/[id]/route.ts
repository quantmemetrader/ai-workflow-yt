import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { getObject } from "@/lib/storage/r2";

/**
 * A colleague's profile picture.
 *
 * Signed in, and the same studio: a face is not public, and it is not
 * cross-tenant. The URL carries a version, so it is cached hard and a new
 * picture still appears at once.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });

  const [person] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, viewer.tenantId)))
    .limit(1);
  if (!person?.key) return new NextResponse("Not found", { status: 404 });

  const upstream = await getObject(person.key);
  if (!upstream.ok || !upstream.body) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
}
