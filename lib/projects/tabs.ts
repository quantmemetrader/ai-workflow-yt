import type { ProjectDetail, ProjectStep } from "@/lib/projects/service";
import { frontierStep } from "@/lib/home/roles";

/**
 * A project's pages, as the tab bar across its top draws them.
 *
 * The client (28 Sep): the one long project page was "a bit messy" and people
 * kept asking how to get to the next step — "more subpages", one block per
 * row, like the reference board. So each step is its own page under
 * `/projects/[id]/…`, numbered in the order the work goes, with a tick once
 * it is done; 概览 and 文件 sit either side of them, unnumbered.
 *
 * Five steps, not the six presses it used to take: uploading the clips is
 * part of 剪辑 (the editor needs them, and it is the editor who asks), and
 * approving the script is part of 脚本 (share it, they press 批准).
 */
export type ProjectTab = "overview" | "topic" | "script" | "edit" | "publish" | "review" | "files";

export type TabState = "done" | "now" | "todo";

export const PROJECT_TABS: { key: ProjectTab; zh: string; en: string; n: number | null; path: string }[] = [
  { key: "overview", zh: "概览", en: "Overview", n: null, path: "" },
  { key: "topic", zh: "选题", en: "Topic", n: 1, path: "/topic" },
  { key: "script", zh: "脚本", en: "Script", n: 2, path: "/script" },
  { key: "edit", zh: "剪辑", en: "Edit", n: 3, path: "/edit" },
  { key: "publish", zh: "发布", en: "Publish", n: 4, path: "/publish" },
  { key: "review", zh: "复盘", en: "Review", n: 5, path: "/review" },
  { key: "files", zh: "文件", en: "Files", n: null, path: "/files" },
];

export function tabHref(projectId: string, tab: ProjectTab): string {
  return `/projects/${projectId}${PROJECT_TABS.find((t) => t.key === tab)!.path}`;
}

/** Which tab a pathname under `/projects/[id]` is. */
export function tabOfPath(pathname: string): ProjectTab {
  const seg = pathname.split("/")[3] ?? "";
  return (PROJECT_TABS.find((t) => t.path === `/${seg}`)?.key ?? "overview") as ProjectTab;
}

/** The project's internal steps behind each numbered tab. */
const STEPS_OF: Partial<Record<ProjectTab, ProjectStep["key"][]>> = {
  topic: ["topic"],
  script: ["script"],
  edit: ["clips", "edit"],
  publish: ["deliver"],
};

/**
 * Done, the one to do now, or later — for each numbered tab. 复盘 is "now"
 * once the video is out (there is something to review) and never "done":
 * a review is looked at again as the numbers come in.
 */
export function tabStates(p: Pick<ProjectDetail, "steps" | "status" | "published"> & { reviewDone?: boolean }): Partial<Record<ProjectTab, TabState>> {
  const now = p.status === "active" ? frontierStep(p.steps) : null;
  const out: Partial<Record<ProjectTab, TabState>> = {};
  for (const [tab, keys] of Object.entries(STEPS_OF) as [ProjectTab, ProjectStep["key"][]][]) {
    const steps = p.steps.filter((s) => keys.includes(s.key));
    const allDone = steps.length > 0 && steps.every((s) => s.state === "done" || s.state === "skipped");
    out[tab] = allDone ? "done" : now && keys.includes(now.key) ? "now" : "todo";
  }
  out.review = p.reviewDone ? "done" : p.published || p.status === "done" ? "now" : "todo";
  return out;
}

/** The tab with the work to do now, for the overview's one big button. */
export function nowTab(p: Pick<ProjectDetail, "steps" | "status" | "published"> & { reviewDone?: boolean }): ProjectTab | null {
  const s = tabStates(p);
  return (["topic", "script", "edit", "publish", "review"] as ProjectTab[]).find((k) => s[k] === "now") ?? null;
}
