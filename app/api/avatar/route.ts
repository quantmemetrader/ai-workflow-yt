import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { deleteObject, putObject } from "@/lib/storage/r2";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Somebody's own profile picture.
 *
 * Not a file in the Files module: a profile picture is meant to be seen by
 * every colleague, and a file is meant to be seen by whoever it is shared
 * with. Putting one in the other's store would mean either an avatar nobody
 * else can load or a file everybody can.
 *
 * You can only ever change your own. There is no `userId` in the request —
 * the session decides whose picture this is, which is the only way this cannot
 * be used to change somebody else's face.
 */
const MAX_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });

  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  const extension = TYPES[type];
  if (!extension) return new NextResponse("That is not a picture I can take", { status: 415 });

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return new NextResponse("empty", { status: 400 });
  if (body.byteLength > MAX_BYTES) {
    return new NextResponse("A profile picture has to be under 5MB", { status: 413 });
  }

  const key = `avatars/${viewer.tenantId}/${viewer.id}-${newId("fil")}.${extension}`;
  await putObject(key, new Uint8Array(body), type);

  const [before] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);

  /* The version in the URL is what makes a new picture appear immediately:
     the route caches hard, and without it a browser would show the old face
     for as long as it felt like. */
  const url = `/api/avatar/${viewer.id}?v=${key.slice(-10)}`;
  await db.update(users).set({ avatarKey: key, avatarUrl: url }).where(eq(users.id, viewer.id));

  // The old one is no use to anybody now, and it is the person's own face.
  if (before?.key && before.key !== key) await deleteObject(before.key).catch(() => {});

  await audit(viewer, "user.avatar.change");
  return NextResponse.json({ avatarUrl: url });
}
