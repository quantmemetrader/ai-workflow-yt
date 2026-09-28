import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMembers, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { agentViewer } from "@/lib/agents";
import type { CardAction } from "@/lib/agents/cards";
import { endPending, startPending, stepPending } from "@/lib/chat/pending";
import { postMessage } from "@/lib/chat/service";
import { audit } from "@/lib/audit";
import { oneGo } from "@/lib/projects/one-go";
import { clipCount } from "@/lib/projects/service";
import { disarmAutoCut, projectsLive } from "@/lib/projects/live";
import { isRunning, liveWords } from "@/lib/projects/live-types";

/**
 * "素材传好了 · 开始剪": the one way a cut starts from the clips.
 *
 * Four things used to be four different paths, or no path at all: the
 * project page's 一键成片 button (a route, silent in the chat), 剪辑师
 * answering "传好了" (a model turn that might or might not call
 * `make_video`), a video dropped into the project's chat (landed in the
 * bin and stopped there), and nothing whatever for "start it by itself
 * when the uploads finish". They are all this now:
 *
 *   1. count the bin — nothing to cut is said, not started;
 *   2. look at what is running — a second start while the director works
 *      is refused by the one-go anyway, and said plainly here instead;
 *   3. start the one-go (`lib/projects/one-go.ts`: script + clips → cut +
 *      render 9:16) as the person, with 剪辑师's working row up meanwhile;
 *   4. 剪辑师 says in the project's chat what it is doing, with the job on
 *      the message so the chat follows it live (`JobChip`), and the worker's
 *      own 渲染好了 line lands under it when the film is out.
 *
 * Deterministic: no model decides whether to start. Every caller — the
 * page's button, the chat's phrase check, the chat's button, the armed
 * auto-cut — gets the same outcome and the same words.
 */
export type CutProject = { id: string; title: string; channelId: string; videoProjectId: string };

export type StartCutOutcome =
  | { kind: "started"; way: "director" | "assembled" | "narrated"; videoProjectId: string; clips: number; aspect?: string }
  | { kind: "no-clips" }
  | { kind: "running"; label: string }
  | { kind: "error"; error: string };

export type StartCutOptions = {
  /** Where the press came from, for the words and the audit. */
  via: "page" | "chat" | "button" | "auto" | "assistant";
  /** The project page's own prompt and voice choices, when it pressed. */
  prompt?: string;
  narrate?: "on" | "off" | "auto";
  voiceId?: string | null;
  /** 竖屏 9:16 (the default) or 横屏 16:9. */
  aspect?: "9:16" | "16:9";
  /** Say nothing in the chat when the bin is empty (the page shows that
   *  itself); the chat paths want the reply. */
  quietWhenEmpty?: boolean;
};

export async function startCutForProject(viewer: Viewer, project: CutProject, opts: StartCutOptions): Promise<StartCutOutcome> {
  const editor = await agentViewer(viewer.tenantId, "video");
  /* In the room before it speaks in it: a private project's chat lists its
     members, and 剪辑师 posting where it is not a member is refused. */
  await db.insert(chatMembers).values({ channelId: project.channelId, userId: editor.id }).onConflictDoNothing();
  const name = `《${project.title}》`;

  const clips = await clipCount(project.videoProjectId);
  if (clips === 0) {
    if (!opts.quietWhenEmpty) {
      const actions: CardAction[] = [
        { id: "upload-clips", label: "上传素材", labelEn: "Upload the clips", kind: "open", href: `/projects/${project.id}#clips`, tone: "primary" },
        { id: "stock-cut", label: "先用素材库画面", labelEn: "Use stock footage for now", kind: "run", op: "stock-cut", projectId: project.id, tone: "quiet" },
      ];
      await postMessage(
        editor,
        project.channelId,
        `${name}的素材箱里还没有素材，现在还不能开剪。请把拍好的素材传到项目里（点下面的「上传素材」，或直接把视频发到这个对话里）；素材一到我就按脚本分段粗剪、配好字幕、渲染成片。想先看看节奏，也可以点「先用素材库画面」拼一版。`,
        { agent: "video", project: { id: project.id, title: project.title }, actions },
      );
    }
    return { kind: "no-clips" };
  }

  /* Already at it: say where it is, with the chip, rather than starting a
     second film over the first (which the one-go would refuse anyway). */
  const [live] = await projectsLive(viewer, { ids: [project.id] }).catch(() => []);
  if (live && isRunning(live)) {
    const label = liveWords(live, Date.now()).zh;
    if (opts.via !== "auto") {
      /* No job chip on this one: the chat's live row already follows the
         film, and the message that started it carries the chip. */
      await postMessage(editor, project.channelId, `${name}已经在做了（${label}），不用再点。好了我会把成片发在这里。`, {
        agent: "video",
        project: { id: project.id, title: project.title },
      });
    }
    return { kind: "running", label };
  }

  /* Two starts in the same moment — the auto-cut's minute running out as
     the person presses 现在开始, a double click, two tabs — both see nothing
     running above, because the director's row is written a beat later. The
     queue would still hold one job (its dedupe key), but both would post
     "开始剪". So one claim on the project, for twenty seconds: the start
     that takes it goes on, the other stands down without a word. */
  const claimAt = new Date().toISOString();
  const claimed = await db
    .update(workProjects)
    .set({ source: sql`coalesce(${workProjects.source}, '{}'::jsonb) || jsonb_build_object('cutClaim', ${claimAt}::text)` })
    .where(
      sql`${workProjects.id} = ${project.id} and ${workProjects.tenantId} = ${viewer.tenantId}
          and coalesce(${workProjects.source} ->> 'cutClaim', '') < ${new Date(Date.now() - 20_000).toISOString()}`,
    )
    .returning({ id: workProjects.id });
  if (!claimed.length) return { kind: "running", label: "正在开始" };
  const release = () =>
    db
      .update(workProjects)
      .set({ source: sql`${workProjects.source} - 'cutClaim'` })
      .where(sql`${workProjects.id} = ${project.id} and ${workProjects.source} ->> 'cutClaim' = ${claimAt}`)
      .catch(() => null);

  const pendingId = await startPending(editor, project.channelId, "video", "looking");
  try {
    const aspect = opts.aspect ?? "9:16";
    const res = await oneGo(viewer, project.id, { prompt: opts.prompt, narrate: opts.narrate, voiceId: opts.voiceId ?? undefined, aspect });
    if (!res.ok) {
      /* Nothing started: the next press may try at once. */
      await release();
      await postMessage(editor, project.channelId, `${name}没能开始剪：${res.error}`, {
        agent: "video",
        project: { id: project.id, title: project.title },
        failed: true,
        actions: [{ id: "open-project", label: "打开项目", labelEn: "Open the project", kind: "open", href: `/projects/${project.id}`, tone: "quiet" }] satisfies CardAction[],
      });
      return { kind: "error", error: res.error };
    }
    if (pendingId) await stepPending(pendingId, res.way === "assembled" ? "rendering" : "making", { videoProjectId: res.videoProjectId }).catch(() => {});
    /* This start took the clips an armed "传完自动开始剪" was waiting on:
       the arm is used up, so it cannot fire a second film later. */
    await disarmAutoCut(viewer, project.id).catch(() => {});

    const how =
      opts.via === "auto"
        ? `素材传完一分钟没再传，按「传完自动开始剪」的设置，`
        : opts.via === "button" || opts.via === "chat"
          ? `收到，`
          : "";
    const count = `${name}的素材 ${clips} 段都在。`;
    const plan =
      res.way === "narrated"
        ? `素材里没有人声，用脚本的旁白配音、按配音剪，最后渲染 ${aspect}。`
        : res.way === "assembled"
          ? `直接把这些画面拼成片，正在渲染 ${aspect}。`
          : `开始剪：先转写，再按脚本粗剪、配图形，最后渲染 ${aspect}。`;
    const text = `${how}${count}${plan}进度看下面这条；好了我会把成片发在这里。`;
    await postMessage(editor, project.channelId, text, {
      agent: "video",
      project: { id: project.id, title: project.title },
      job: { videoProjectId: res.videoProjectId },
      cut: { via: opts.via, by: viewer.id, way: res.way },
    });
    await audit(viewer, "project.cut.start", {
      module: "video",
      objectType: "project",
      objectId: project.id,
      meta: { via: opts.via, way: res.way, clips, videoProjectId: res.videoProjectId, aspect },
    });
    return { kind: "started", way: res.way, videoProjectId: res.videoProjectId, clips, aspect };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[start-cut] could not start", err);
    await release();
    await postMessage(editor, project.channelId, `${name}没能开始剪：${error.slice(0, 200)}`, { agent: "video", project: { id: project.id, title: project.title }, failed: true }).catch(() => null);
    return { kind: "error", error };
  } finally {
    await endPending(pendingId);
  }
}

/** What an outcome reads as, for a toast or an assistant's system note. */
export function describeOutcome(o: StartCutOutcome, title: string, zh: boolean): string {
  const name = `《${title}》`;
  switch (o.kind) {
    case "started":
      return zh
        ? `${name}开始剪了：${o.clips} 段素材，${o.way === "assembled" ? "直接拼成片并渲染" : o.way === "narrated" ? "旁白配音、按配音剪、渲染" : "转写、粗剪、图形、渲染"} ${o.aspect ?? "9:16"}。`
        : `Started on “${title}”: ${o.clips} clips, ${o.way === "assembled" ? "assembled and rendering" : o.way === "narrated" ? "narrated, cut to the voice, rendering" : "transcribe, cut, design, render"} ${o.aspect ?? "9:16"}.`;
    case "no-clips":
      return zh ? `${name}的素材箱是空的，还不能开剪：先把素材传到项目里。` : `“${title}” has no clips yet; upload them to the project first.`;
    case "running":
      return zh ? `${name}已经在做了（${o.label}）。` : `“${title}” is already being made (${o.label}).`;
    default:
      return zh ? `${name}没能开始剪：${o.error}` : `Could not start “${title}”: ${o.error}`;
  }
}
