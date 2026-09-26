import { after, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { runBeatNow, startBeatNow } from "@/lib/research/beat-feeds";

/**
 * "现在收集": collect one beat now instead of waiting for its turn.
 *
 * Answers at once; the searches (paid TikHub and YouTube calls, within the
 * caps in `lib/research/beats.ts`: at most 12 TikHub requests, one YouTube
 * search) run after the response, and the page polls `/api/research/beats`
 * until the run's row says it is done, then reads the lists again. At most
 * once per beat per half hour and eight times a day per studio, checked in
 * the same statement that claims the run (`startBeatNow`).
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !(viewer.isAdmin || viewer.modules.includes("research"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return Response.json({ error: "哪个赛道？", errorEn: "Which beat?" }, { status: 400 });
  const res = await startBeatNow(viewer.tenantId, key);
  if ("error" in res) return Response.json({ error: res.error, errorEn: res.errorEn, retryAt: res.retryAt ?? null }, { status: res.status });
  after(async () => {
    const done = await runBeatNow(viewer.tenantId, key, res.runId);
    console.log(`[beats] now ${key}: ${done ? `${done.rows} rows · TikHub ${done.tikhub}/${done.tikhubCap} · YouTube ${done.youtubeUnits}u` : "failed"}`);
  });
  return Response.json({ ok: true, at: res.at }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}
