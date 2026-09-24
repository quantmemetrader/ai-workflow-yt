import { projectFor } from "@/lib/projects/service";
import { ProjectBar } from "@/components/projects/ProjectBar";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { modelFor } from "@/lib/ai/models";
import { shareCeiling } from "@/lib/authz/rebac";
import { sharesWithNames } from "@/lib/files/service";
import { DetailView } from "@/components/script/DetailView";
import { ShareSheet } from "@/components/files/ShareSheet";
import { jumpList, possibleApprovers, scriptDetail } from "@/lib/script/service";
import { scriptRun } from "@/lib/script/run";

/**
 * One script: Brief, Draft, Versions, Approval (spec §4.4).
 *
 * A script that does not exist, or belongs to another studio, is a 404 rather
 * than an error — the two are indistinguishable from outside, and they should
 * be.
 */
export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireModule("script");
  const { id } = await params;

  const detail = await scriptDetail(viewer, id);
  if (!detail) notFound();

  const zh0 = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [siblings, approvers, ceiling, shares, run] = await Promise.all([
    jumpList(viewer, detail.script.folderId),
    possibleApprovers(viewer),
    /* Scripts carry the same `relation_tuples` files do, so sharing one is the
       same sheet, the same ceiling and the same audit line — not a second
       system that would drift from the first. */
    shareCeiling(viewer, "script", id),
    sharesWithNames("script", id),
    scriptRun(viewer, id, zh0),
  ]);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  const inProject = await projectFor(viewer.tenantId, { scriptId: id });
  const view = (
    <DetailView
      locale={viewer.locale ?? "zh-CN"}
      detail={detail}
      siblings={siblings}
      approvers={approvers.map((a) => ({ id: a.id, name: (zh && a.nameLocal) || a.name }))}
      viewerId={viewer.id}
      model={modelFor.drafting()}
      canMakeVideo={viewer.modules.includes("video")}
      flow={run}
      shareSheet={
        ceiling ? (
          <ShareSheet
            objectType="script"
            objectId={id}
            ceiling={ceiling}
            locale={viewer.locale ?? "zh-CN"}
            shares={shares.map((s) => ({
              subjectId: s.tuple.subjectId,
              subjectType: s.tuple.subjectType,
              relation: s.tuple.relation,
              name: s.userName,
              expiresAt: s.tuple.expiresAt?.toISOString() ?? null,
            }))}
          />
        ) : null
      }
    />
  );
  if (!inProject) return view;
  /* A project's script opens inside the project: its bar on top. */
  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <ProjectBar project={inProject} active="script" zh={zh} />
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>{view}</div>
    </div>
  );
}
