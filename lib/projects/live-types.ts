import { directorStepLabel } from "@/lib/agents/steps";

/**
 * Where a project's film is right now, as every live surface reads it.
 *
 * The owner: "once the user uploads clips and says done, show the user it's
 * being rendered and stuff — and let the user see when it's done." Before
 * this, the project page was the only place that knew: Home said 进行中,
 * the sidebar said nothing, the channel had a line from twenty minutes ago,
 * and the corner chip followed only a render started from the editor.
 *
 * So one shape, worked out once on the server (`lib/projects/live.ts`, from
 * the director's row, the latest render and — the honest part — whether a
 * worker job for it still exists) and polled by one client store
 * (`lib/client/live.ts`) that Home, the sidebar, the channel, the project
 * page and the corner chip all read. Pure here: no `server-only`, so the
 * browser can import the type and the words.
 */
export type LiveState =
  /** The director's job is queued, or a render is waiting for the worker. */
  | "queued"
  /** The director is at it: transcribing, cutting, designing, rendering. */
  | "directing"
  /** A plain render (no director) is encoding. */
  | "rendering"
  /** "传完自动开始剪" is set and the last upload landed: it starts at `dueAt`. */
  | "armed"
  /** The latest render finished with a file, within the window. */
  | "done"
  /** The director or the render stopped, within the window. */
  | "failed"
  /** Asked for by id and nothing is happening. */
  | "idle";

export type LiveProject = {
  /** The work project (`wp_…`), whose page everything links to. */
  id: string;
  title: string;
  videoProjectId: string;
  channelSlug: string | null;
  state: LiveState;
  /** The director's step while it directs (`DirectorState.step`). */
  step: string | null;
  /** 0–100 while a render encodes (the director's render step included). */
  percent: number | null;
  error: string | null;
  exportId: string | null;
  /** The finished film, once there is one. */
  fileId: string | null;
  proxyFileId: string | null;
  aspect: string | null;
  durationMs: number | null;
  startedAt: string | null;
  /** When it finished or failed (ISO), for the two-minute windows. */
  finishedAt: string | null;
  /** When the armed auto-cut fires (ISO). */
  dueAt: string | null;
};

/** How long a finished (or failed) film keeps its chip, its toast and its
 *  "成片已出" pill after it lands. */
export const DONE_WINDOW_MS = 2 * 60_000;

/** The auto-cut's debounce: this long after the last upload lands. */
export const AUTO_CUT_DELAY_MS = 60_000;

export function isRunning(p: Pick<LiveProject, "state"> | null | undefined): boolean {
  return p?.state === "queued" || p?.state === "directing" || p?.state === "rendering";
}

/** Whether a done or failed state is still inside its window, at `now`. */
export function isRecent(p: Pick<LiveProject, "state" | "finishedAt"> | null | undefined, now: number): boolean {
  if (!p || (p.state !== "done" && p.state !== "failed") || !p.finishedAt) return false;
  const at = new Date(p.finishedAt).getTime();
  return Number.isFinite(at) && now - at < DONE_WINDOW_MS;
}

/** Whether anything about a project is worth polling quickly for. */
export function isActive(p: Pick<LiveProject, "state"> | null | undefined): boolean {
  return isRunning(p) || p?.state === "armed";
}

/**
 * What a live pill says: "正在剪辑 · 设计图形", "正在渲染 42%", "排队中",
 * "60 秒后自动开始剪", "成片已出", "渲染没成功". The pair is what
 * `AgentTyping` and `Tr` take, so the words survive Chrome's translate.
 */
export function liveWords(p: LiveProject, now: number): { zh: string; en: string } {
  switch (p.state) {
    case "queued":
      return { zh: "排队中，马上开始", en: "Queued, starting soon" };
    case "directing": {
      if (p.step === "render") {
        const pct = p.percent !== null ? ` ${p.percent}%` : "";
        return { zh: `正在渲染${pct}`, en: `Rendering${pct}` };
      }
      return { zh: `正在剪辑 · ${directorStepLabel(p.step, true)}`, en: `Editing · ${directorStepLabel(p.step, false)}` };
    }
    case "rendering": {
      const pct = p.percent !== null ? ` ${p.percent}%` : "";
      return { zh: `正在渲染${pct}`, en: `Rendering${pct}` };
    }
    case "armed": {
      const secs = p.dueAt ? Math.max(0, Math.ceil((new Date(p.dueAt).getTime() - now) / 1000)) : 0;
      return { zh: `${secs} 秒后自动开始剪`, en: `Auto-cut starts in ${secs}s` };
    }
    case "done":
      return { zh: "成片已出", en: "The film is out" };
    case "failed":
      return { zh: "渲染没成功", en: "The render failed" };
    default:
      return { zh: "", en: "" };
  }
}

/**
 * Why a film stopped, in words a person can act on, for the toast and the
 * chat's row. The worker's reason is often ffmpeg's own ("moov atom not
 * found … Invalid data found when processing input"), which says nothing
 * to the person who uploaded the clip; the known ones are said plainly,
 * the rest cut to their first line.
 */
export function friendlyError(error: string | null | undefined, zh: boolean): string {
  if (!error) return "";
  if (/moov atom|Invalid data found|Error opening input/i.test(error)) {
    return zh ? "有一段素材文件不完整、读不出来：把那段素材重新上传一次，再重试。" : "A clip file is incomplete and cannot be read: upload that clip again, then try again.";
  }
  if (/no words|no sound|没有声音|听不到/i.test(error)) {
    return zh ? "素材里听不到人声，没法按口播剪：可以勾选 AI 配音，或换一段有声音的素材。" : "No speech was found in the clips: turn on AI voice-over, or use clips with sound.";
  }
  const first = error.split("\n")[0].replace(/^FFmpeg exited \d+:\s*/i, "").trim();
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
}

/**
 * "传完自动开始剪", as the project keeps it (`work_projects.source.autoCut`):
 * `{ on, by, at }` is the setting, `{ dueAt, armedBy }` an armed one — the
 * last upload landed and the cut starts at `dueAt` unless another lands
 * first (`lib/projects/live.ts` arms, disarms and fires it).
 */
export type AutoCut = { on: boolean; dueAt: string | null };

export function readAutoCut(source: unknown): AutoCut {
  const a = (source as { autoCut?: { on?: unknown; dueAt?: unknown } } | null)?.autoCut;
  return { on: a?.on === true, dueAt: typeof a?.dueAt === "string" ? a.dueAt : null };
}

/**
 * The same, with an arm that a start has already used up read as unarmed.
 *
 * An armed cut is spent once any cut or render started at or after the
 * moment it was armed — the clips card's button, the video card's 一键成片
 * or 渲染, 剪辑师 from the chat: whatever it was, it took those clips. Left
 * standing, the old deadline would read as "due" the moment that film
 * finished and start a second one nobody asked for. `lastStartMs` is the
 * newest of the director's `startedAt` and the latest render's `createdAt`.
 * (`lib/projects/live.ts` also clears a spent arm from the row.)
 */
export function liveAutoCut(source: unknown, lastStartMs: number): AutoCut & { spent: boolean } {
  const a = readAutoCut(source);
  if (!a.dueAt) return { ...a, spent: false };
  const raw = (source as { autoCut?: { armedAt?: unknown } } | null)?.autoCut?.armedAt;
  const armedAt = typeof raw === "string" && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) : Date.parse(a.dueAt) - AUTO_CUT_DELAY_MS;
  const spent = Number.isFinite(armedAt) && lastStartMs > 0 && lastStartMs >= armedAt;
  return spent ? { on: a.on, dueAt: null, spent: true } : { ...a, spent: false };
}
