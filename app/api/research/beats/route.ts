import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { readBeatsWithOrigin, saveBeats } from "@/lib/research/beat-store";
import { DEFAULT_BEATS, nextBeatRun } from "@/lib/research/beats";
import { beatNowRuns, lastBeatRunAt } from "@/lib/research/beat-feeds";
import { HOT_TENANT } from "@/lib/research/platforms";

/**
 * The studio's research beats: read them, and save a new list.
 *
 * The owner, on the chips "全部 · AI · 加密 · 科技 · 商业": "let me be able to
 * change this list too". The Research page's 管理赛道 panel reads the list
 * here and writes it back whole (`BeatsEditor.tsx`); the collector, the
 * classifier and the Research agent read the same row (`beat-store.ts`).
 *
 * Who: anyone who holds the research module, and admins. Each studio reads
 * and writes its own list only (the key is the viewer's tenant). A route
 * handler rather than a server action, so a save never holds up navigation.
 *
 * GET also says when the next beat collection is due (for a beat with no
 * rows yet: "下一轮收集后出现（约 N 分钟）"), the latest "现在收集" of each
 * beat, and whether this studio may collect one now (only the studio the
 * collector searches for; the feeds are shared).
 */
function allowed(viewer: Awaited<ReturnType<typeof getViewer>>) {
  return !!viewer && (viewer.isAdmin || viewer.modules.includes("research"));
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const [{ beats, stored }, lastRun, runs] = await Promise.all([
    readBeatsWithOrigin(viewer.tenantId, { fresh: true }),
    lastBeatRunAt().catch(() => null),
    beatNowRuns(viewer.tenantId).catch(() => []),
  ]);
  const everyHours = Number(process.env.RESEARCH_BEAT_EVERY_HOURS) || undefined;
  return Response.json(
    {
      beats,
      stored,
      defaults: DEFAULT_BEATS,
      lastRunAt: lastRun,
      nextRunAt: nextBeatRun(lastRun, Date.now(), everyHours),
      runs,
      canCollect: viewer.tenantId === HOT_TENANT,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function PUT(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !allowed(viewer)) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { beats?: unknown } | null;
  const res = await saveBeats(viewer, body?.beats);
  if ("error" in res) return Response.json(res, { status: 400 });
  return Response.json({ beats: res.beats, stored: true }, { headers: { "Cache-Control": "private, no-store" } });
}
