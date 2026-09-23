import { getViewer } from "@/lib/auth/dal";
import { abandonUpload } from "@/lib/files/abandon";

/**
 * The single-PUT upload's way of saying it failed.
 *
 * `presign` makes the row before the bytes move; if the PUT then dies, nothing
 * used to remove it, and Files showed a file with nothing in it. The browser
 * calls this on failure (with `keepalive`, so a closing tab still gets to),
 * and the row goes — unless the object did arrive and was confirmed, in which
 * case it is a file and stays.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("files")) return new Response("Not found", { status: 404 });
  if (!id || id.length > 64) return new Response("Bad request", { status: 400 });

  const outcome = await abandonUpload(viewer, id);
  if (outcome === "missing") return new Response("Not found", { status: 404 });
  return Response.json({ ok: true, removed: outcome === "gone" });
}
