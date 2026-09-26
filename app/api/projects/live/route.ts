import { after, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { clearSpentArms, fireDueAutoCuts, projectsLiveWithSpent } from "@/lib/projects/live";

/**
 * Where the films are right now, for every live surface at once.
 *
 * One small query (`lib/projects/live.ts`), polled by the one client store
 * (`lib/client/live.ts`) that Home's project cards, the sidebar's folders,
 * the channel's status row, the project page and the corner chip all read:
 * every five seconds while anything is being made, every twelve otherwise.
 * Without `ids` it returns only what is happening; with `ids` (up to forty,
 * comma-separated) those projects whatever their state.
 *
 * The one thing it does besides reading: an armed "传完自动开始剪" whose
 * minute is up is started, after the response (`fireDueAutoCuts`). The
 * page of the person who armed it is the page that polls, so their own
 * wait is what fires it; nothing waits on the model or the worker here.
 * An arm some other start already used up is cleared instead
 * (`clearSpentArms`), so it never fires once that film is out.
 */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("chat")) return Response.json({ at: new Date().toISOString(), projects: [] }, { headers: NO_STORE });
  const raw = req.nextUrl.searchParams.get("ids");
  const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40) : [];
  const { projects, spent } = await projectsLiveWithSpent(viewer, ids.length ? { ids } : {});
  if (projects.some((p) => p.state === "armed")) {
    after(() => fireDueAutoCuts(viewer, projects).catch((err) => console.error("[live] auto-cut sweep failed", err)));
  }
  if (spent.length) {
    after(() => clearSpentArms(viewer, spent).catch((err) => console.error("[live] could not clear a spent auto-cut", err)));
  }
  return Response.json({ at: new Date().toISOString(), projects }, { headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "private, no-store" };
