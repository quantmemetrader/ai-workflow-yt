import { endTurn, registerTurn } from "@/lib/ai/turns";
import { after } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, files, scripts, topics } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import type { Module } from "@/lib/db/schema";
import { runAgent, titleConversation } from "@/lib/ai/agent";
import type { ToolContext } from "@/lib/ai/tools/types";
import { newId } from "@/lib/ids";
import { AGENT_KEYS, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { agentViewer } from "@/lib/agents";
import { CUT_TOOLS, MAX_REPLIES, findStartClaims, later } from "@/lib/agents/mentions";
import { attachmentsFor, channelById } from "@/lib/chat/service";
import { bridgeState } from "@/lib/chat/conversation-project";
import { binImage, binVideo } from "@/lib/chat/bin";
import { projectById } from "@/lib/video/service";
import { canEditProject } from "@/lib/video/access";
import { relationOn, share } from "@/lib/authz/rebac";
import { clipCount, projectFor, reachableThroughProjects } from "@/lib/projects/service";
import { holdsTheCut, looksLikeDone } from "@/lib/projects/done-phrases";
import { describeOutcome, startCutForProject, type StartCutOutcome } from "@/lib/projects/start-cut";
import { workProjects } from "@/lib/db/schema";
import { videoClock } from "@/lib/chat/video-card";

type ScreenIds = Pick<ToolContext, "channelId" | "projectId" | "topicId" | "fileId" | "scriptId">;

/**
 * Files the person put on their message, as lines the employee reads.
 *
 * The personal chat has no attachments column: the message is text, and
 * the employee reads text. So each file the person may actually read
 * (`attachmentsFor`, checked against them) becomes one line under what
 * they typed — `[附件] 原片.mp4 (video, 2:31) file id fil_…` — which the
 * employee's tools can open by id and a reloaded thread draws as a card
 * (`threadMessagesOf`). A video also goes into the bin of the project this
 * conversation belongs to (`bridgeState`: the one it was made into, the one
 * the employees worked in, or the one on screen), as the person, under the
 * video project's own edit rule, and the line says so — 剪辑师 can cut it
 * from this same turn.
 *
 * The employee answering is given the file to read (`share`, a viewer
 * grant from the person, who must hold the file to give it). Its tools run
 * under its own permissions, and an upload is private to the uploader:
 * without this the line names a file `read_file` would then say does not
 * exist. The assistant answers as the person and needs nothing.
 */
async function describeAttachments(viewer: Viewer, conversationId: string, raw: unknown, hints: { videoProjectId?: string; reader?: Viewer | null }): Promise<{ text: string; fileIds: string[] }> {
  const wanted = Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))].slice(0, 10) : [];
  if (!wanted.length) return { text: "", fileIds: [] };
  const readable = await attachmentsFor(viewer, wanted);
  const files = wanted.flatMap((id) => readable.get(id) ?? []);
  if (!files.length) return { text: "", fileIds: [] };

  const reader = hints.reader && hints.reader.id !== viewer.id ? hints.reader : null;
  if (reader) {
    for (const f of files) {
      const r = await share(viewer, { type: "file", id: f.id }, "viewer", { type: "user", id: reader.id }).catch((err: unknown) => {
        console.error("[agent] could not open an attachment to the employee", err);
        return null;
      });
      if (r && !r.ok) console.warn(`[agent] attachment ${f.id} not opened to the employee: ${r.reason}`);
    }
  }

  let bin: { videoProjectId: string; title: string } | null = null;
  if (files.some((f) => f.kind === "video" || f.kind === "image")) {
    try {
      const state = await bridgeState(viewer, conversationId, { videoProjectId: hints.videoProjectId ?? null });
      if (state?.project) {
        const [wp] = await db.select({ videoProjectId: workProjects.videoProjectId }).from(workProjects).where(eq(workProjects.id, state.project.id)).limit(1);
        if (wp?.videoProjectId && (await canEditProject(viewer, wp.videoProjectId))) bin = { videoProjectId: wp.videoProjectId, title: state.project.title };
      }
    } catch (err) {
      console.error("[agent] could not find the conversation's project for an attachment", err);
    }
  }

  const lines: string[] = [];
  for (const f of files) {
    let note = "";
    if ((f.kind === "video" || f.kind === "image") && bin) {
      try {
        /* Once: a take already in the bin is named, not added again. A
           picture goes in as a five-second shot (`binImage`). */
        const { clipId } = f.kind === "image" ? await binImage(viewer, bin.videoProjectId, f.id) : await binVideo(viewer, bin.videoProjectId, f.id);
        note = f.kind === "image" ? ` · 已做成 5 秒画面放进项目素材《${bin.title}》(clip id ${clipId})` : ` · 已加入项目素材《${bin.title}》(clip id ${clipId})`;
      } catch (err) {
        console.error("[agent] could not put an attached video in the project's bin", err);
      }
    }
    lines.push(`[附件] ${f.name} (${f.kind}${f.durationMs ? `, ${videoClock(f.durationMs)}` : ""}) file id ${f.id}${note}`);
  }
  return { text: lines.join("\n"), fileIds: files.map((f) => f.id) };
}

/**
 * What the screen says is open, kept only where the person asking may open
 * it themselves. An id that fails is dropped, as if the screen had sent
 * nothing.
 *
 * This used to be left to the tools, "checked against the viewer inside the
 * tool that uses it" — but when an employee answers ("@策划 …", or the
 * panel on Research), the viewer inside the tool is the employee, and every
 * employee is a member of every private project's chat and an editor of its
 * script. A person outside a private project could send its channel id and
 * have 策划 hand 编剧 that project's script to rewrite. So each id is
 * checked here, against the person, before any turn starts, by the rule
 * each screen itself uses:
 *
 *   - a channel: one they can read (`channelById`: public, or they are in it);
 *   - a script: in the studio, and — when it belongs to projects — through
 *     a project they may see (the Script library is the studio's; a
 *     private project's script is its members');
 *   - a video project: one they may open (`projectById`), by the same
 *     project rule;
 *   - a file: one they hold a relation on;
 *   - a research topic: one of the studio's.
 */
async function screenIds(viewer: Viewer, raw: Record<string, unknown>): Promise<ScreenIds> {
  const pick = (k: string) => (typeof raw[k] === "string" && raw[k] ? (raw[k] as string).slice(0, 64) : undefined);
  const want = { channelId: pick("channelId"), projectId: pick("projectId"), topicId: pick("topicId"), fileId: pick("fileId"), scriptId: pick("scriptId") };
  const [channelId, projectId, topicId, fileId, scriptId] = await Promise.all([
    want.channelId ? channelById(viewer, want.channelId).then((c) => c?.id) : undefined,
    want.projectId
      ? Promise.all([projectById(viewer, want.projectId, "viewer"), reachableThroughProjects(viewer, { videoProjectId: want.projectId })]).then(([p, ok]) => (p && ok ? p.id : undefined))
      : undefined,
    want.topicId
      ? db
          .select({ id: topics.id })
          .from(topics)
          .where(and(eq(topics.id, want.topicId), eq(topics.tenantId, viewer.tenantId)))
          .limit(1)
          .then(([t]) => t?.id)
      : undefined,
    want.fileId
      ? Promise.all([
          db
            .select({ id: files.id })
            .from(files)
            .where(and(eq(files.id, want.fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
            .limit(1),
          relationOn(viewer, "file", want.fileId),
        ]).then(([[f], rel]) => (f && rel ? f.id : undefined))
      : undefined,
    want.scriptId
      ? Promise.all([
          db
            .select({ id: scripts.id })
            .from(scripts)
            .where(and(eq(scripts.id, want.scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
            .limit(1),
          reachableThroughProjects(viewer, { scriptId: want.scriptId }),
        ]).then(([[sc], ok]) => (sc && ok ? sc.id : undefined))
      : undefined,
  ]);
  return { channelId, projectId, topicId, fileId, scriptId };
}

/**
 * The agent turn, streamed.
 *
 * Server-sent events over the Node runtime: each `runAgent` event is one
 * frame, so the screen shows the tool trace and the citations at the moment
 * they happen rather than after the answer lands. If the reader disconnects,
 * the abort signal reaches the provider call and the model stops generating —
 * an abandoned tab does not keep spending the client's money.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  let body: {
    conversationId?: string;
    content?: string;
    /** What is open on screen. Every id is checked against the person
     *  asking (`screenIds`) before any turn sees it. */
    context?: Record<string, unknown>;
    /** The employee who answers by default on this screen; an @ in the
     *  message picks another. Absent means the personal assistant. */
    agent?: string;
    /** Files already uploaded and confirmed, in the order they were
     *  attached; each is checked against the person (`describeAttachments`). */
    attachments?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  /* A file with nothing typed is an ordinary thing to send ("here is the
     take"); nothing at all is not. */
  const hasAttachments = Array.isArray(body.attachments) && body.attachments.length > 0;
  if (!content && !hasAttachments) return new Response("Empty message", { status: 400 });
  // A turn is billed to the studio's OpenRouter account, so the prompt cannot
  // be whatever size the caller feels like posting. 32k characters is longer
  // than anything anyone types and far short of a deliberate bill.
  if (content.length > 32_000) return new Response("That message is too long", { status: 413 });

  /*
   * `null` means the same thing as absent: start a new conversation. It used
   * to be neither, and a client that sent it — which every inline agent panel
   * did — got a 400 for a perfectly well-formed request.
   */
  /*
   * What the person is looking at.
   *
   * Taken as hints, never as authority: each id is checked against the
   * person asking (`screenIds`) before any turn starts, so a client that
   * names a channel it cannot read gets exactly what a client that names
   * nothing gets — whoever answers. Whitelisted by key so an unknown field
   * cannot reach a tool at all.
   */
  const raw = body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {};
  const context = { module: typeof raw.module === "string" ? (raw.module as Module) : undefined };

  /*
   * Who may ask. The Chat module, or the module whose screen the question
   * came from: the assistant panel sits on every Research, Script and Video
   * screen, and a person who holds those but not Chat used to get "Forbidden"
   * from a panel that was drawn for them.
   */
  const allowed =
    viewer.modules.includes("chat") ||
    (context.module !== undefined && context.module !== "chat" && viewer.modules.includes(context.module));
  if (!allowed) return new Response("Forbidden", { status: 403 });

  /* Started now and awaited just before the turn, so the checks overlap the
     conversation's own reads rather than delaying the first words. */
  const checkedIds = screenIds(viewer, raw).catch((err): ScreenIds => {
    /* A check that could not run keeps nothing: an unchecked id is exactly
       what this is here to stop. */
    console.error("[agent] could not check what is on screen", err);
    return {};
  });

  const conversationIdInput = body.conversationId ?? undefined;
  if (conversationIdInput !== undefined && typeof conversationIdInput !== "string") {
    return new Response("Bad request", { status: 400 });
  }

  // A conversation belongs to exactly one person; a supplied id is checked
  // against the caller rather than trusted.
  let conversationId = conversationIdInput;
  let isFirst = false;
  if (conversationId) {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, viewer.id)))
      .limit(1);
    if (!row) return new Response("Not found", { status: 404 });
  } else {
    conversationId = newId("cnv");
    await db.insert(conversations).values({ id: conversationId, userId: viewer.id, module: "chat" });
    isFirst = true;
  }

  /*
   * Who answers. "@编剧 …" in the message hands the turn to that employee;
   * otherwise the screen's own employee answers (the panel on Research is
   * 研究员's); otherwise the person's own assistant. An employee answers as
   * itself: its own prompt, its own tools and budget, in the same thread.
   */
  const tagged = parseAgentMentions(content)[0] ?? null;
  const asked = typeof body.agent === "string" && AGENT_KEYS.includes(body.agent as AgentKey) ? (body.agent as AgentKey) : null;
  const speaker: AgentKey | null = tagged ?? asked;
  const speakerViewer = speaker ? await agentViewer(viewer.tenantId, speaker) : viewer;
  const speakerModule: Module = speaker ? ({ research: "research", planning: "research", script: "script", video: "video", article: "script" } as const)[speaker] : (context.module ?? "chat");

  /* What the conversation is titled from: the words typed, or the file
     named when nothing was. */
  let titleFrom = content;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      /* The page may be gone (the person moved to another screen): the turn
         carries on and is saved; there is just nobody to stream it to. */
      let gone = false;
      const stopper = new AbortController();
      if (conversationId) registerTurn(conversationId, stopper);
      const send = (event: unknown) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          gone = true;
        }
      };

      send({ type: "conversation", id: conversationId });
      send({ type: "speaker", agent: speaker });

      /*
       * Who answered, kept on the answer's own row.
       *
       * The speaker used to exist only in this stream, so a reloaded thread —
       * or the same thread picked up in a side panel — drew every employee's
       * answer as the host's. `runAgent` creates the assistant row and names
       * it in its "message" event; the speaker is written onto that row as
       * soon as it exists rather than after the turn, so an answer that is cut
       * off half way still says who was speaking. Started without waiting, so
       * the first words are not held up by a database round trip, and settled
       * before the stream closes. Null (the person's own assistant) is the
       * column's default and needs no write.
       */
      let speakerSaved: Promise<unknown> | null = null;

      try {
        const screen = await checkedIds;
        /*
         * A private chat that already belongs to a project (编剧 wrote its
         * script here, or it was linked) works in that project when the
         * screen names none. Without this 剪辑师 answered "No video project is
         * open. Open one in the Video module" to "@剪辑师 make this video" —
         * the owner: "fix this so we can make videos directly from DM".
         */
        let ids = screen;
        if (!screen.projectId && conversationId) {
          const state = await bridgeState(viewer, conversationId).catch(() => null);
          if (state?.project) {
            const [wp] = await db
              .select({ id: workProjects.id, videoProjectId: workProjects.videoProjectId, scriptId: workProjects.scriptId })
              .from(workProjects)
              .where(and(eq(workProjects.id, state.project.id), eq(workProjects.tenantId, viewer.tenantId)))
              .limit(1);
            if (wp?.videoProjectId) ids = { ...screen, projectId: wp.videoProjectId, ...(wp.scriptId && !screen.scriptId ? { scriptId: wp.scriptId } : {}) };
          }
        }
        /*
         * The same bound a turn in a channel has. Without it every
         * `assign_task` here started a chain of its own with a fresh budget,
         * and nothing stopped one message from handing 编剧 the same script
         * twice: two drafts, two bills. An employee's hand-off still runs at
         * hop 1 and the person's own assistant's at hop 0, as before; now
         * they share one budget, and a colleague is asked once per turn.
         */
        const team: NonNullable<ToolContext["team"]> = {
          hop: speaker ? 0 : -1,
          spoken: [],
          budget: { left: MAX_REPLIES },
          assigned: [],
          origin: viewer.nameLocal || viewer.name,
          later,
        };
        /* `asker` is the person, whoever answers: an employee's tools
           check what they pick for somebody against the one who asked,
           not only against the employee (`ToolContext.asker`). The
           answer comes back to them alone (`privateReply`), so a list
           may hold everything they may see, private projects included.
           Kept in a variable: a script write that starts a project pins
           the rest of the turn to it (below). */
        /* "还没传好" / "再补一段" to 剪辑师 with a project open: no cut starts
           this turn, whatever the model makes of the bin (`holdsTheCut`). */
        const turnContext: Omit<ToolContext, "viewer"> = { ...context, ...ids, ...(conversationId ? { conversationId } : {}), asker: viewer, team, privateReply: true, ...(ids.projectId && holdsTheCut(content) ? { holdCut: true } : {}) };
        /* The files on the message, as lines under it (and, for a video, in
           the project's bin): what the employee reads, what the thread keeps
           and what a reload draws as cards. The first one is also "the file
           on screen" for tools that read one, unless the screen said which. */
        const attached = hasAttachments ? await describeAttachments(viewer, conversationId!, body.attachments, { videoProjectId: ids.projectId, reader: speaker ? speakerViewer : null }) : { text: "", fileIds: [] };
        const turnContent = attached.text ? (content ? `${content}\n\n${attached.text}` : attached.text) : content;
        /* Nothing typed, and none of the files named is one this person may
           read (a stale id, an upload that never finished): there is no
           turn to run, and the model is not asked an empty question. */
        if (!turnContent) {
          send({ type: "error", kind: "client", message: "那个文件没法附上（没上传完，或不是你能打开的）。" });
          controller.close();
          return;
        }
        titleFrom = turnContent;
        if (!turnContext.fileId && attached.fileIds[0]) turnContext.fileId = attached.fileIds[0];
        /* What 剪辑师 said and did this turn, for the check at the end. */
        let said = "";
        let cut = false;
        /*
         * "传好了" to 剪辑师, in its own chat, with a project open: the cut
         * is started here, in code, before the model says a word — the
         * same starter the project's chat and page use (`startCutForProject`),
         * which counts the bin, refuses a second start, and has 剪辑师 say
         * in the project's chat what it is doing. The model is then told
         * what happened and only phrases it; a start it did not make is
         * not a start claim (`cut`).
         */
        let turnText = turnContent;
        if (speaker === "video" && ids.projectId && !hasAttachments && looksLikeDone(content) && viewer.modules.includes("video")) {
          const wp = await projectFor(viewer, { videoProjectId: ids.projectId }).catch(() => null);
          const [row] = wp ? await db.select({ channelId: workProjects.channelId }).from(workProjects).where(eq(workProjects.id, wp.id)).limit(1) : [];
          if (wp && row) {
            const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
            const outcome = await startCutForProject(viewer, { id: wp.id, title: wp.title, channelId: row.channelId, videoProjectId: ids.projectId }, { via: "assistant", quietWhenEmpty: true }).catch(
              (err): StartCutOutcome => ({ kind: "error", error: err instanceof Error ? err.message : String(err) }),
            );
            if (outcome.kind === "started") cut = true;
            const fact = describeOutcome(outcome, wp.title, zh);
            turnText = `${turnContent}\n\n（系统已处理，不是对方说的）${fact}${
              zh
                ? outcome.kind === "started"
                  ? " 进度在项目页、首页和项目对话里都能看到。请用一两句话告诉对方已经开始了、去哪里看进度；不要再调用任何剪辑工具，不要说“我来开始”。"
                  : outcome.kind === "no-clips"
                    ? " 请告诉对方先把素材传到项目页的「素材」卡（或直接发到项目对话里），传好再说一声；不要调用剪辑工具。"
                    : " 请用一句话告诉对方；不要再调用剪辑工具。"
                : " Tell them in a sentence or two; do not call any editing tool."
            }`;
          }
        }
        for await (const event of runAgent({
          viewer: speakerViewer,
          conversationId: conversationId!,
          content: turnText,
          // The employee's own trade when one answers; otherwise the screen
          // the question came from decides which tuning the prompt carries.
          module: speakerModule,
          context: turnContext,
          /* Not the request's signal: leaving the page used to kill the turn
             mid-answer ("I changed screens and it just disappeared"). Only
             the Stop button ends it (`/api/agent/stop`). */
          signal: stopper.signal,
        })) {
          if (event.type === "delta") said += event.text;
          if (event.type === "tool" && event.status === "ok" && event.artifacts?.length) {
            if (CUT_TOOLS.has(event.name)) cut = true;
            /* write_script outside any project started one: a second write
               in this turn goes into that project's script, not a third. */
            const started = event.name === "write_script" && !turnContext.scriptId ? event.artifacts.find((a) => a.kind === "script") : undefined;
            if (started && event.artifacts.some((a) => a.kind === "work_project")) turnContext.scriptId = started.id;
          }
          /*
           * "开始粗剪" with nothing begun. In a channel the reply is checked
           * before it is posted (`judgeReply` in lib/agents/mentions.ts);
           * here it has already been read as it streamed, so it is put
           * straight underneath instead, in the answer itself and on its
           * stored row: 剪辑师 said it was cutting, and no cut started this
           * turn (`CUT_TOOLS`: no first cut, no make-the-video, nothing taken
           * out of the edit) — with the bin's real count
           * when a video project is open.
           */
          if (event.type === "done" && speaker === "video" && !cut && findStartClaims(said, "video").length) {
            const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
            const clips = ids.projectId ? await clipCount(ids.projectId).catch(() => null) : null;
            const note = zh
              ? `\n\n（系统核对：这一回合没有开始剪辑，没有调用粗剪或一键成片。${clips === 0 ? "项目的素材箱里还是 0 段素材，请先把拍好的素材传到项目里（项目页的「素材」卡），传上来会自动转写，再让剪辑师按脚本粗剪。" : clips ? `素材箱里有 ${clips} 段素材，要开剪请让剪辑师现在出粗剪。` : "要开剪，请在项目里让剪辑师来做，项目的素材箱里要先有素材。"}）`
              : `\n\n(Checked by the system: no editing started this turn; neither the first cut nor make-the-video was run. ${clips === 0 ? "The project's bin still has 0 clips: upload the shot clips to the project (its Clips card); they are transcribed as they land, then ask the editor for the first cut." : clips ? `The bin has ${clips} clips; ask the editor for the first cut now.` : "To cut, ask the editor inside the project, once its bin has clips."})`;
            send({ type: "delta", text: note });
            await db
              .update(agentMessages)
              .set({ content: sql`${agentMessages.content} || ${note}` })
              .where(and(eq(agentMessages.id, event.messageId), eq(agentMessages.conversationId, conversationId!)))
              .catch((err) => console.error("[agent] could not store the check under the answer", err));
          }
          if (event.type === "message" && speaker && !speakerSaved) {
            speakerSaved = db
              .update(agentMessages)
              .set({ speaker })
              .where(and(eq(agentMessages.id, event.id), eq(agentMessages.conversationId, conversationId!)))
              .catch((err) => console.error("[agent] could not record who answered", err));
          }
          send(event);
        }
      } catch (err) {
        // `runAgent` shapes every expected failure into its own error event,
        // including the provider's own message, which the brief wants intact.
        // Anything that escapes to here is unexpected — a database or runtime
        // error whose text can carry internals — so it is logged and not echoed.
        console.error("[agent] stream failed", err);
        send({ type: "error", kind: "server", message: "Something went wrong." });
      } finally {
        if (conversationId) endTurn(conversationId, stopper);
        if (speakerSaved) await speakerSaved;
        try {
          controller.close();
        } catch {
          /* already gone */
        }
      }

      // `void` here meant nothing awaited the call: the stream closes, the
      // request ends, and a standalone worker is free to reclaim the process
      // mid-flight — leaving the conversation titled "New chat" and the model
      // call unrecorded. `after` keeps the runtime alive for it, the same way
      // "last active" and "mark read" are handled.
      if (isFirst) after(() => titleConversation(viewer, conversationId!, titleFrom));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
