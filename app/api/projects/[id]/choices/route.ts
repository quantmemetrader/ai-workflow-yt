import { type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth/dal";
import { availableFootage } from "@/lib/video/service";
import { listScripts } from "@/lib/script/service";
import { latestDigest } from "@/lib/home/pulse";
import { ownPicksToday } from "@/lib/research/own-picks";
import { workProjectDetail } from "@/lib/projects/service";

/**
 * What a project can take from what the studio already has: clips already
 * uploaded, scripts already written, topics already picked. The project
 * page's "choose existing" popups read this.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await workProjectDetail(viewer, id, true, 1);
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind");

  if (kind === "clips") {
    const have = new Set(p.clipList.map((c) => c.fileId));
    const rows = (await availableFootage(viewer)).filter((f) => !have.has(f.id) && !/^proxy|\.proxy\./i.test(f.name));
    return Response.json({ items: rows.slice(0, 120).map((f) => ({ id: f.id, title: f.name, sub: f.durationMs ? `${Math.round(f.durationMs / 1000)}s` : f.kind, thumb: `/api/files/${f.id}/thumb` })) });
  }
  if (kind === "scripts") {
    const rows = await listScripts(viewer);
    return Response.json({ items: rows.filter((s) => s.id !== p.script?.id).slice(0, 120).map((s) => ({ id: s.id, title: s.title, sub: `${s.status} · v${s.version}${s.ownerName ? ` · ${s.ownerName}` : ""}`, thumb: null })) });
  }
  if (kind === "topics") {
    const [digest, own] = await Promise.all([latestDigest(viewer.tenantId), ownPicksToday(viewer.tenantId)]);
    const items = [
      ...(digest?.signals ?? []).map((s, i) => ({ id: `signal-${i}`, title: s.title, sub: "晨报信号", brief: s.whyNow, thumb: s.evidence.find((e) => e.thumbnail)?.thumbnail ?? null })),
      ...(digest?.topic && !digest.signals.length ? [{ id: "digest", title: digest.topic, sub: "晨报", brief: digest.why ?? "", thumb: null }] : []),
      ...own.map((o, i) => ({ id: `own-${i}`, title: o.text, sub: `${o.by} 加的`, brief: "", thumb: null })),
    ];
    return Response.json({ items });
  }
  return Response.json({ error: "Say which" }, { status: 400 });
}
