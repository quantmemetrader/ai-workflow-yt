import { type NextRequest } from "next/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { ideas, topics } from "@/lib/db/schema";
import { availableFootage } from "@/lib/video/service";
import { listScripts } from "@/lib/script/service";
import { latestDigest } from "@/lib/home/pulse";
import { ownPicksToday } from "@/lib/research/own-picks";
import { scriptsInProjects, workProjectDetail } from "@/lib/projects/service";
import { cleanCodes } from "@/lib/projects/topic";

/**
 * What a project can take from what the studio already has: clips already
 * uploaded, scripts already written, topics already picked. The project
 * page's "choose existing" popups read this.
 *
 * Scripts another live project already uses are left out: one script in two
 * projects made the project of a script ambiguous (`chooseScriptAction`
 * refuses it too). Topics are every kind a project can start from, each
 * with an id `chooseTopicAction` resolves on the server: this morning's
 * signals by their brief's date ("signal:<date>:<n>"), today's own picks,
 * Home's ideas that were not put away, and the backlog.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const p = await workProjectDetail(viewer, id, true, 1);
  if (!p) return Response.json({ error: "Not found" }, { status: 404 });
  const kind = req.nextUrl.searchParams.get("kind");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  if (kind === "clips") {
    const have = new Set(p.clipList.map((c) => c.fileId));
    const rows = (await availableFootage(viewer)).filter((f) => !have.has(f.id) && !/^proxy|\.proxy\./i.test(f.name));
    return Response.json({ items: rows.slice(0, 120).map((f) => ({ id: f.id, title: f.name, sub: f.durationMs ? `${Math.round(f.durationMs / 1000)}s` : f.kind, thumb: `/api/files/${f.id}/thumb` })) });
  }
  if (kind === "scripts") {
    const [rows, taken] = await Promise.all([listScripts(viewer), scriptsInProjects(viewer.tenantId)]);
    const free = rows.filter((s) => s.id !== p.script?.id && (!taken.has(s.id) || taken.get(s.id) === p.id));
    return Response.json({ items: free.slice(0, 120).map((s) => ({ id: s.id, title: s.title, sub: `${s.status} · v${s.version}${s.ownerName ? ` · ${s.ownerName}` : ""}`, thumb: null })) });
  }
  if (kind === "topics") {
    const [digest, own, kept, backlog] = await Promise.all([
      latestDigest(viewer.tenantId),
      ownPicksToday(viewer.tenantId),
      db
        .select({ id: ideas.id, title: ideas.title, why: ideas.why, status: ideas.status })
        .from(ideas)
        .where(and(eq(ideas.tenantId, viewer.tenantId), inArray(ideas.status, ["new", "saved"])))
        .orderBy(desc(ideas.createdAt))
        .limit(12),
      db
        .select({ id: topics.id, name: topics.name, nameLocal: topics.nameLocal, summary: topics.summary })
        .from(topics)
        .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"]), ne(topics.stage, "handed")))
        .orderBy(desc(topics.heat))
        .limit(30),
    ]);
    const date = digest?.date ?? null;
    const items = [
      ...(date ? (digest?.signals ?? []) : []).map((s, i) => ({ id: `signal:${date}:${i}`, title: s.title, sub: zh ? `晨报信号 · ${date}` : `Morning signal · ${date}`, brief: cleanCodes(s.whyNow), thumb: s.evidence.find((e) => e.thumbnail)?.thumbnail ?? null })),
      ...own.map((o) => ({ id: `own:${o.text}`, title: o.text, sub: zh ? `${o.by} 加的` : `Added by ${o.by}`, brief: "", thumb: null })),
      ...kept.map((x) => ({ id: `idea:${x.id}`, title: x.title, sub: x.status === "saved" ? (zh ? "研究员的选题 · 已存" : "Researcher's idea · saved") : zh ? "研究员的选题灵感" : "Researcher's idea", brief: x.why ?? "", thumb: null })),
      ...backlog.map((t) => ({ id: `topic:${t.id}`, title: (zh && t.nameLocal) || t.name, sub: zh ? "选题储备" : "Topic backlog", brief: t.summary ?? "", thumb: null })),
    ];
    return Response.json({ items });
  }
  return Response.json({ error: "Say which" }, { status: 400 });
}
