/**
 * One Home, a layout per job.
 *
 * The client's ask: *"different people see different modular design — the
 * video dev only sees video projects in hand, the research guy only sees
 * research — and once a project is created everyone can see it."* So Home
 * stays one route (`/home`) and this table decides, per job, which panels it
 * draws, in what order, which employee the task box is addressed to, and
 * which projects count as "in hand". Nothing is hidden: projects are visible
 * to the whole studio as before, every layout keeps a link to all of them,
 * and anybody can look at another job's Home with `?view=`.
 *
 * A job is one of the employee keys (research · planning · script · video ·
 * article), stored per person in `users.work_role`, so `AGENT_LABELS`,
 * `JOB_OWNER` and a decision's `agent` all filter by it without a mapping
 * table. "overview" is everything, today's Home.
 *
 * Client-safe on purpose: the screen needs the layout and the step rule to
 * draw the same thing the page filtered by, and the admin screen needs the
 * labels. Only types come from server files, and types are erased.
 */
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import type { Viewer } from "@/lib/auth/types";
import type { ProjectStep, StepState } from "@/lib/projects/service";

export type HomeRole = "overview" | AgentKey;

/** In the order the tabs are drawn: everything first, then the line of work
 * in the order it goes. */
export const HOME_ROLES: readonly HomeRole[] = ["overview", ...AGENT_KEYS];

export function isHomeRole(value: unknown): value is HomeRole {
  return typeof value === "string" && (HOME_ROLES as readonly string[]).includes(value);
}

/**
 * What each job is called on the screen. The human job, not the employee:
 * the video editor is 剪辑, the employee they work with is 剪辑师. Used by
 * the Home tabs and by the admin's 岗位 select.
 */
export const ROLE_LABELS: Record<HomeRole, { zh: string; en: string }> = {
  overview: { zh: "全部", en: "Everything" },
  research: { zh: "研究", en: "Research" },
  planning: { zh: "策划", en: "Planning" },
  script: { zh: "编剧", en: "Script" },
  video: { zh: "剪辑", en: "Video" },
  article: { zh: "撰稿/发布", en: "Writing & publishing" },
};

/**
 * Which Home a person lands on when the URL does not say.
 *
 * Their own `work_role` when an admin (or they themselves) set one. Without
 * it, owners and admins get the overview — they run the studio. A member is
 * read from their modules, the only other thing that says what they do:
 * research and nothing else of the production line is a researcher; video
 * without script is an editor; script without video is a writer; publish is
 * the writer who ships. Anyone else — every module, or none of these — gets
 * the overview, which is never wrong, only less focused.
 */
export function homeRoleOf(viewer: Pick<Viewer, "workRole" | "role" | "modules">): HomeRole {
  if (viewer.workRole && (AGENT_KEYS as readonly string[]).includes(viewer.workRole)) return viewer.workRole;
  if (viewer.role === "owner" || viewer.role === "admin") return "overview";
  const has = (m: Viewer["modules"][number]) => viewer.modules.includes(m);
  const production = (["research", "script", "video", "publish"] as const).filter(has);
  if (production.length === 1 && production[0] === "research") return "research";
  if (has("video") && !has("script")) return "video";
  if (has("script") && !has("video")) return "script";
  if (has("publish")) return "article";
  return "overview";
}

/** The panels Home knows how to draw. */
export type PanelKey =
  /** The task box. Every job has it; the job's employee is tagged in it. */
  | "composer"
  /** 研究员's video ideas (components/home/IdeasPanel). */
  | "ideas"
  /** 今天建议拍: the morning brief's picks. */
  | "suggestion"
  /** The one thing only this job needs (approvals, renders, drafts, backlog). */
  | "extra"
  /** The projects in hand, with their steppers. */
  | "projects"
  /** Cards waiting on somebody's answer. */
  | "decisions"
  /** Jobs on the queue. */
  | "running"
  /** The last words of each project in hand. */
  | "chats"
  /** The five employees. */
  | "team";

export type HomeLayout = {
  /** Down the wide column, top to bottom. */
  main: PanelKey[];
  /** Down the narrow column, top to bottom. */
  side: PanelKey[];
  /** The employee this job works with: first in 同事, tagged in the task box. */
  agent: AgentKey | null;
  /** The projects panel's title and what it says when nothing is in hand. */
  projectsZh: string;
  projectsEn: string;
  emptyZh: string;
  emptyEn: string;
};

const SIDE: PanelKey[] = ["chats", "team"];

/* Every job's Home reads top-down the same way: the task box, then where the
   work in hand stands, then what to shoot next, then the rest. The owner asked
   for the projects' status right under the box. */

export const HOME_LAYOUT: Record<HomeRole, HomeLayout> = {
  overview: {
    main: ["composer", "projects", "suggestion", "ideas", "decisions", "running"],
    side: SIDE,
    agent: null,
    projectsZh: "进行中的项目",
    projectsEn: "Projects in progress",
    emptyZh: "还没有进行中的项目。在上面交代一件事就会开一个。",
    emptyEn: "Nothing in progress. Give the team a task above and a project starts.",
  },
  /* The researcher's work comes before a project exists (the brief, the
     ideas, the backlog) and after it is delivered (how it did, what people
     said). So the brief leads, and the projects are the delivered ones. */
  research: {
    main: ["composer", "projects", "suggestion", "ideas", "extra", "decisions", "running"],
    side: SIDE,
    agent: "research",
    projectsZh: "刚交付 · 看反馈",
    projectsEn: "Just delivered · watch the response",
    emptyZh: "最近 7 天没有交付的片子。交付之后在这里看反馈。",
    emptyEn: "Nothing delivered in the last 7 days. Delivered videos come here for their response.",
  },
  planning: {
    main: ["composer", "projects", "suggestion", "ideas", "decisions", "running"],
    side: SIDE,
    agent: "planning",
    projectsZh: "待策划",
    projectsEn: "To plan",
    emptyZh: "没有等着策划的新项目。",
    emptyEn: "No new project waiting for a plan.",
  },
  script: {
    main: ["composer", "projects", "suggestion", "extra", "ideas", "decisions"],
    side: SIDE,
    agent: "script",
    projectsZh: "手上的脚本",
    projectsEn: "Scripts in hand",
    emptyZh: "现在没有要写的脚本。",
    emptyEn: "No script to write right now.",
  },
  video: {
    main: ["composer", "projects", "extra", "decisions", "running"],
    side: SIDE,
    agent: "video",
    projectsZh: "手上的视频",
    projectsEn: "Videos in hand",
    emptyZh: "现在没有要剪的片子。素材一到就会出现在这里。",
    emptyEn: "Nothing to cut right now. A project appears here once its clips arrive.",
  },
  article: {
    main: ["composer", "projects", "extra", "decisions", "running"],
    side: SIDE,
    agent: "article",
    projectsZh: "待交付发布",
    projectsEn: "To deliver & publish",
    emptyZh: "没有等着交付的成片。",
    emptyEn: "No finished cut waiting to go out.",
  },
};

export function layoutHas(layout: HomeLayout, panel: PanelKey): boolean {
  return layout.main.includes(panel) || layout.side.includes(panel);
}

type StepLike = { key: ProjectStep["key"]; state: StepState };

/**
 * Where a project has actually got to: the first unfinished step after the
 * furthest finished one.
 *
 * Not "the first step that is not done". The steps do not finish in order —
 * both of the studio's real projects have a rendered video while their
 * script still says `drafting`, because nobody locks a script before cutting
 * it — and reading the first open step would put two finished videos on the
 * writer's Home. Null means every step is done: delivered.
 */
export function frontierStep<S extends StepLike>(steps: readonly S[]): S | null {
  let last = -1;
  steps.forEach((s, i) => {
    if (s.state === "done") last = i;
  });
  for (let i = last + 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.state !== "done" && s.state !== "skipped") return s;
  }
  return null;
}

/** What `inHandFor` needs to know about a project; `listProjectStages`
 * returns exactly this. */
export type StageFacts = {
  status: string;
  steps: readonly StepLike[];
  scriptStatus: string | null;
  beats: number;
  directorState: string | null;
  updatedAt: string;
};

/** How long a delivered video stays on the researcher's Home. */
const DELIVERED_WINDOW_MS = 7 * 86_400_000;

/**
 * Whether a project is "in hand" for a job — per job, not per person: the
 * studio records who started a project, never who is on it, so two editors
 * see the same list.
 *
 *   research  delivered in the last 7 days (the response is theirs to read)
 *   planning  at the script step with nothing written: brief, no beats
 *   script    at the script step (to write, being written, or awaiting OK)
 *   video     at the clips or edit step, or the director failed on a cut
 *             that has not finished yet
 *   article   rendered and waiting to be delivered
 *   overview  everything active
 *
 * A failed director counts only while the edit is unfinished. 测试 has a
 * failed director and a finished render — a later re-run went wrong — and
 * the cut is waiting on delivery, not on the editor.
 *
 * `now` is passed in so this stays a pure function of its inputs.
 */
export function inHandFor(role: HomeRole, p: StageFacts, now: number): boolean {
  if (role === "research") {
    const at = Date.parse(p.updatedAt);
    return p.status === "done" && Number.isFinite(at) && now - at <= DELIVERED_WINDOW_MS;
  }
  if (p.status !== "active") return false;
  if (role === "overview") return true;
  const frontier = frontierStep(p.steps);
  const key = frontier?.key ?? null;
  switch (role) {
    case "planning":
      return key === "script" && (p.scriptStatus === null || p.scriptStatus === "brief") && p.beats === 0;
    case "script":
      return key === "script";
    case "video": {
      const editDone = p.steps.some((s) => s.key === "edit" && s.state === "done");
      return key === "clips" || key === "edit" || (p.directorState === "failed" && !editDone);
    }
    case "article":
      return key === "deliver";
  }
}

/**
 * The projects in hand for a job, in the order given.
 *
 * The clock is read here, once, rather than in the page: a component that
 * reads it is impure by React's rules even when it only runs on the server.
 */
export function projectsInHand<T extends StageFacts>(role: HomeRole, rows: readonly T[], now: number = Date.now()): T[] {
  return rows.filter((p) => inHandFor(role, p, now));
}
