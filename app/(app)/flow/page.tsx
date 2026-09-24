import { requireModule } from "@/lib/auth/dal";
import { AUTOMATIONS, readAutomations } from "@/lib/automations/service";
import { FlowScreen } from "@/components/flow/FlowScreen";
import { listWorkProjects, workProjectDetail, type ProjectDetail } from "@/lib/projects/service";
import type { Pipeline, Stage } from "@/lib/home/pipeline";
import { FlowProjectPicker } from "@/components/projects/FlowProjectPicker";

export const metadata = { title: "自动化流程 · Flow" };

/**
 * 自动化流程 — one project's whole line on the board.
 *
 * Which project: `?project=`, or the most recently active one. The board is
 * the same twelve nodes; what they read is that project's script, clips,
 * cut and delivery.
 */
export default async function FlowPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const { project: wanted } = await searchParams;
  const [projects, automations] = await Promise.all([listWorkProjects(viewer, 60), readAutomations()]);
  const pickId = wanted ?? projects.find((p) => p.status === "active")?.id ?? projects[0]?.id ?? null;
  const detail = pickId ? await workProjectDetail(viewer, pickId, zh, 1) : null;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <FlowProjectPicker zh={zh} projects={projects.map((p) => ({ id: p.id, title: p.title }))} current={detail?.id ?? null} />
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex" }}>
        <FlowScreen
          zh={zh}
          pipeline={detail ? pipelineOf(detail, zh) : EMPTY(zh)}
          canEdit={viewer.role === "owner" || viewer.role === "admin"}
          automations={AUTOMATIONS.map((def) => ({ key: def.key, name: def.name, nameEn: def.nameEn, what: def.what, whatEn: def.whatEn, scheduled: def.scheduled, value: automations[def.key] }))}
        />
      </div>
    </div>
  );
}

function EMPTY(zh: boolean): Pipeline {
  const t = (a: string, b: string) => (zh ? a : b);
  const keys: Stage["key"][] = ["topic", "plan", "script", "approve", "cut", "export", "publish", "feedback"];
  return { title: null, scriptId: null, projectId: null, collectedAt: null, stages: keys.map((key, i) => ({ key, n: i + 1, owner: key === "approve" ? "you" : "research", state: "todo", line: t("还没有项目", "No project yet"), href: null, progress: null })) as Stage[] };
}

/** A project's state, in the board's eight stages. */
function pipelineOf(p: ProjectDetail, zh: boolean): Pipeline {
  const t = (a: string, b: string) => (zh ? a : b);
  const step = (k: string) => p.steps.find((s) => s.key === k)!;
  const script = step("script"), clips = step("clips"), edit = step("edit"), deliver = step("deliver");
  const sv = (st: string): Stage["state"] => (st === "skipped" ? "done" : (st as Stage["state"]));
  const scriptHref = p.script ? `/script/${p.script.id}` : null;
  const videoHref = p.video ? `/video?project=${p.video.id}` : null;
  const rendered = p.render?.state === "done";
  const stages: Stage[] = [
    { key: "topic", n: 1, owner: "research", state: "done", line: p.source?.label ?? t("项目已开", "Project started"), href: `/projects/${p.id}`, progress: null },
    { key: "plan", n: 2, owner: "planning", state: "done", line: t("项目已开", "Project started"), href: `/projects/${p.id}`, progress: null },
    { key: "script", n: 3, owner: "script", state: sv(script.state), line: script.line, href: scriptHref, progress: null },
    { key: "approve", n: 4, owner: "you", state: p.script?.status === "locked" || script.state === "skipped" ? "done" : p.script?.status === "awaiting_approval" ? "you" : "todo", line: p.script?.status === "locked" ? t("已批准", "Approved") : script.state === "skipped" ? t("跳过", "Skipped") : t("写完后", "After the script"), href: scriptHref ? `${scriptHref}?tab=approval` : null, progress: null },
    { key: "cut", n: 5, owner: "video", state: clips.state === "skipped" ? sv(edit.state) : p.video && p.video.items > 0 ? "done" : p.video && p.video.clips > 0 ? "running" : "todo", line: clips.line, href: videoHref, progress: null },
    { key: "export", n: 6, owner: "video", state: sv(edit.state), line: edit.line, href: videoHref, progress: p.render && !rendered ? p.render.progress : null },
    { key: "publish", n: 7, owner: "article", state: p.status === "done" ? "done" : rendered ? "you" : "todo", line: deliver.line, href: `/projects/${p.id}`, progress: null },
    { key: "feedback", n: 8, owner: "research", state: "todo", line: t("发布后 24 小时", "24h after posting"), href: null, progress: null },
  ];
  return { title: p.title, scriptId: p.script?.id ?? null, projectId: p.video?.id ?? null, collectedAt: null, stages };
}
