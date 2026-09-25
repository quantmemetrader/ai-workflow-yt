import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { generateIdeas, latestIdeas } from "@/lib/ideas/service";

/**
 * Home's ideas: GET the latest batch, POST to have 研究员 work out a new one.
 *
 * The POST is awaited here, in a route handler, and not in a server action:
 * it takes twenty seconds to a minute, and a server action that long holds
 * up every navigation behind it. The panel shows its own progress meanwhile.
 */
export const maxDuration = 120;

function allowed(modules: readonly string[]) {
  return modules.includes("chat") || modules.includes("research");
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer.modules)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const items = await latestIdeas(viewer, 8);
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer.modules)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { seed?: unknown; n?: unknown };
  const seed = typeof body.seed === "string" ? body.seed.slice(0, 200) : null;
  const n = Number(body.n);
  try {
    const res = await generateIdeas(viewer, { seed, n: Number.isFinite(n) ? n : 5 });
    if (!res.ok) return Response.json({ error: res.error }, { status: 422 });
    return Response.json({ items: res.ideas, model: res.model, batchId: res.batchId }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ideas] generate", err);
    return Response.json({ error: err instanceof Error ? err.message : "研究员这次没有写出来" }, { status: 500 });
  }
}
