import "server-only";
import { hiddenTodos } from "@/lib/home/hidden";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, scripts, users, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { listProjectStages, type ProjectStageRow, type ProjectStep } from "@/lib/projects/service";
import { readSentBack } from "@/lib/projects/sendback";
import { PROJECT_TABS, nowTab, tabHref, type ProjectTab } from "@/lib/projects/tabs";
import { homeRoleOf } from "@/lib/home/roles";

/**
 * What Home shows (28 Sep, rebuilt for people who are not technical): the
 * things waiting on this person, the videos under way, and who of the AI
 * team is busy — nothing else.
 *
 * "Waiting on you" is worked out from the real state, in this order, one row
 * per video:
 *   1. a script somebody asked this person to review (an `approvals` row);
 *   2. a step sent back with a note, still open, that is theirs to redo;
 *   3. the step a video has got to, when it is a person's step (upload the
 *      footage, share the script, publish) and it is theirs — an owner or
 *      admin sees them all, anybody else the ones for their job or on videos
 *      they started.
 */

export type TodoRow = { id: string; verb: string; title: string; press: string; href: string; note?: string };
export type ActiveRow = { id: string; title: string; step: string; state: "you" | "running" | "todo"; who: string; href: string; thumbFileId: string | null };

export type Today = {
  todo: TodoRow[];
  moreTodo: number;
  active: ActiveRow[];
  activeCount: number;
  busy: string[];
};

const WORK_OF: Record<string, ProjectStep["key"][]> = {
  research: ["topic"],
  planning: ["topic"],
  script: ["script"],
  video: ["clips", "edit"],
  article: ["deliver"],
};

const TAB_OF: Record<ProjectStep["key"], ProjectTab> = { topic: "topic", script: "script", clips: "edit", edit: "edit", deliver: "publish" };

export async function readToday(viewer: Viewer, zh: boolean): Promise<Today> {
  const t = (a: string, b: string) => (zh ? a : b);
  const stages = (await listProjectStages(viewer, { limit: 80, zh })).filter((r) => r.status === "active");
  const ids = stages.map((r) => r.id);
  const byId = new Map(stages.map((r) => [r.id, r]));
  const admin = viewer.role === "owner" || viewer.role === "admin";
  const mine = WORK_OF[homeRoleOf(viewer)] ?? [];
  const isMine = (r: ProjectStageRow, key: ProjectStep["key"]) => admin || mine.includes(key) || r.createdBy === viewer.id;

  const [asks, sources] = ids.length
    ? await Promise.all([
        db
          .select({ projectId: workProjects.id, by: users.name, byLocal: users.nameLocal })
          .from(approvals)
          .innerJoin(scripts, eq(scripts.id, approvals.objectId))
          .innerJoin(workProjects, eq(workProjects.scriptId, scripts.id))
          .innerJoin(users, eq(users.id, approvals.requestedBy))
          .where(and(eq(approvals.tenantId, viewer.tenantId), eq(approvals.objectType, "script"), eq(approvals.state, "requested"), eq(approvals.approverId, viewer.id), inArray(workProjects.id, ids), isNull(workProjects.deletedAt))),
        db.select({ id: workProjects.id, source: workProjects.source }).from(workProjects).where(inArray(workProjects.id, ids)),
      ])
    : [[], []];

  const todo: TodoRow[] = [];
  const seen = new Set<string>();
  const push = (row: TodoRow) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    todo.push(row);
  };

  for (const a of asks) {
    const r = byId.get(a.projectId);
    if (!r) continue;
    push({ id: r.id, verb: t("审阅稿子", "Review the script"), title: r.title, press: t("去审阅", "Review"), href: tabHref(r.id, "script"), note: t(`${(zh && a.byLocal) || a.by} 请你看看`, `${a.by} asked you`) });
  }

  const REDO: Record<ProjectStep["key"], [string, string]> = {
    topic: ["换个选题", "Rethink the topic"],
    script: ["按意见改稿子", "Revise the script"],
    clips: ["补拍素材", "Reshoot footage"],
    edit: ["按意见改视频", "Revise the video"],
    deliver: ["按意见改发布", "Revise the post"],
  };
  for (const s of sources) {
    const r = byId.get(s.id);
    if (!r) continue;
    const back = readSentBack(s.source);
    for (const key of Object.keys(back) as ProjectStep["key"][]) {
      const b = back[key];
      if (!b || b.state !== "open" || !isMine(r, key)) continue;
      push({ id: r.id, verb: t(REDO[key][0], REDO[key][1]), title: r.title, press: t("去看看", "Open"), href: tabHref(r.id, TAB_OF[key]), note: b.note.slice(0, 60) });
    }
  }

  const DO: Record<ProjectStep["key"], [string, string, string, string]> = {
    topic: ["定下选题", "Settle the topic", "去看看", "Open"],
    script: ["看稿子，发给同事审阅", "Read the script, send it for review", "去审阅", "Review"],
    clips: ["上传拍好的视频", "Upload the footage", "去上传", "Upload"],
    edit: ["看成片", "Watch the cut", "去看看", "Watch"],
    deliver: ["发布", "Publish it", "去发布", "Publish"],
  };
  for (const r of stages) {
    const f = r.frontier;
    if (!f || f.state !== "you" || !isMine(r, f.key)) continue;
    const [vz, ve, pz, pe] = DO[f.key];
    push({ id: r.id, verb: t(vz, ve), title: r.title, press: t(pz, pe), href: tabHref(r.id, TAB_OF[f.key]) });
  }

  const name = (a: ProjectStep["owner"]) => (a === "you" ? "" : zh ? AGENT_LABELS[a as AgentKey].nameLocal : AGENT_LABELS[a as AgentKey].name);
  const DOING: Record<ProjectStep["key"], [string, string]> = { topic: ["正在查资料", "is researching"], script: ["正在写", "is writing"], clips: ["正在整理素材", "is sorting footage"], edit: ["正在剪", "is cutting"], deliver: ["正在写文案", "is writing captions"] };
  const busy = stages
    .filter((r) => r.frontier?.state === "running" && r.frontier.owner !== "you")
    .slice(0, 3)
    .map((r) => (zh ? `${name(r.frontier!.owner)}${DOING[r.frontier!.key][0]}《${r.title}》` : `${name(r.frontier!.owner)} ${DOING[r.frontier!.key][1]} “${r.title}”`));

  const active: ActiveRow[] = stages.slice(0, 5).map((r) => {
    const tab = nowTab(r) ?? "overview";
    const def = PROJECT_TABS.find((x) => x.key === tab);
    const f = r.frontier;
    const state: ActiveRow["state"] = f?.state === "running" ? "running" : f?.state === "you" ? "you" : "todo";
    return {
      id: r.id,
      title: r.title,
      step: def?.n ? t(`第 ${def.n} 步 · ${def.zh}`, `Step ${def.n} · ${def.en}`) : t("进行中", "In progress"),
      state,
      who: state === "running" && f ? t(`${name(f.owner)}在做`, `${name(f.owner)} on it`) : state === "you" ? t("等人处理", "Waiting on the team") : t("下一步", "Up next"),
      href: tabHref(r.id, tab === "overview" ? "overview" : tab),
      thumbFileId: r.thumbFileId,
    };
  });

  const hidden = await hiddenTodos(viewer.id);
  const left = todo.filter((r) => !hidden.has(`${r.id}:${r.verb}`));
  return { todo: left.slice(0, 8), moreTodo: Math.max(0, left.length - 8), active, activeCount: stages.length, busy };
}
