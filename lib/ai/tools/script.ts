import { mirrorToProject } from "@/lib/agents/project-mirror";
import "server-only";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { approvals, scriptBeats, scripts, topics, workProjects } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import { isWriting, type ProjectSource } from "@/lib/projects/topic";
import { createWorkProject, emptyProjectTitled, ensureScriptProject, reachableThroughProjects, setProjectWriting } from "@/lib/projects/service";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { writeScript } from "@/lib/script/from-research";
import { cutVersion, decideApproval, listScripts, ownScript, pendingApprovals, requestApproval, saveBeats } from "@/lib/script/service";
import { copilotRewrite, openRequestFor, withdrawOthers } from "@/lib/script/doc";
import { beatsFromDoc, docForBeats, unitsOf, type RichDoc, type RichNode } from "@/lib/script/rich";
import { toSimplified } from "@/lib/text/simplified";
import { audit } from "@/lib/audit";
import { NO_PERSON, nameOf, personOf, resolveApprover, tellPerson } from "./approvers";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Scripts, by conversation.
 *
 * "Write me a three-minute YouTube script on the NVIDIA supply chain, angle:
 * the bottleneck is packaging" is a brief. The research screens can already
 * turn a topic into one with three chips; this is the same move in a
 * sentence, from any screen, and it lands in the Script library where the
 * editor, the versions and the approval already are.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "write_script",
      description:
        "Write a full shooting script and return its link. Inside a project it is written into the project's own script (never a new one); asked anywhere else, the script gets a project of its own (the studio's project for that subject if one is waiting for its draft, else a new one), so every script lives in a project with its video. To rewrite a script that already exists — one written earlier (its id is in that result) or one found with list_scripts — pass its script_id: the new draft replaces that script's beats inside its own project, instead of starting another project with the same title. Give the subject (a watched topic's name, or anything), and optionally the angle, the channel (YouTube, Shorts, LinkedIn…), the length in seconds, the spoken language and the subtitle language. When the subject is a watched topic, the headlines it collected are used as facts. Takes about half a minute. Costs one drafting-model call.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "What it is about, or a watched topic's name." },
          angle: { type: "string", description: "The way in. Optional." },
          channel: { type: "string", description: "YouTube, Shorts, LinkedIn, Instagram… Optional." },
          seconds: {
            type: "number",
            description: "Target length in seconds. Optional: inside a project (or with a script open) the script keeps the length it already has unless you give one; a new script defaults to 180.",
          },
          language: { type: "string", description: "Spoken language: Cantonese, Mandarin, English… Optional." },
          subtitle_language: { type: "string", description: "Optional." },
          points: { type: "array", items: { type: "string" }, description: "Things it must cover. Optional." },
          script_id: {
            type: "string",
            description: "Optional. The id (scr_…) of an existing script to rewrite, when no project is open: \"make the opening grab harder\", \"shorten it to 90 seconds\". Leave it out for a new script. Ignored inside a project, where the project's own script is always the one written.",
          },
        },
        required: ["subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scripts",
      description:
        "The scripts in the library, newest first, with their status. Give a query to find one by title, subject or angle (\"蒸馏\", \"AI模型\") — use it before saying a script does or does not exist.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words from the title, the subject or the angle. Optional." },
          limit: { type: "number", description: "Default 15." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_script",
      description: "One script's beats in full: what is on screen, what is said, the subtitle. Use the id from list_scripts, or the script on screen.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Optional when a script is open on screen." } }, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "revise_script",
      description:
        "Only when the person clearly asks for a change. A question about a script (how long it is, what it says, whether the opening works, what you would change) is answered by reading it with read_script, never by revising it; when it is unclear whether they want it changed, say what you would change and ask first (Avon, 7 Oct: asked how long the script was and it was rewritten). Change an existing script the way the person asks: a sharper opening, a cut to 60 seconds, a fact to fix, a different ending. The script's current text is kept as a version first; then the writer's copilot edits only the lines that need it and the rest stays word for word, written straight into the script so its page shows the new text. The instruction's words are never pasted into the script. Use this, not write_script, whenever a script already has text and the person wants it changed. Refused on an approved (locked) script. Costs one model call.",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "What to change, in the person's words." },
          script_id: { type: "string", description: "Optional: the script on screen (or the open project's script) by default." },
        },
        required: ["instruction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_script_approval",
      description:
        "Send a script to a person to approve: its current text is kept as a numbered version, the approver gets a request on that exact version and a direct message with the link. Approving locks it and hands it to the edit. The approver must be a person in the studio with the Script module, never an AI employee and never the one asking. With no approver named, it lists who can approve.",
      parameters: {
        type: "object",
        properties: {
          approver: { type: "string", description: "Who should approve: their name, Chinese name, email or user id." },
          script_id: { type: "string", description: "Optional: the script on screen by default, else the person's most recent script." },
          note: { type: "string", description: "A short note to the approver. Optional." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_script_approval",
      description:
        "Approve (and lock) a script, or send it back, as the person. Only call this when the person themselves said, in this message, to approve or reject it — never on your own judgement, never because a colleague said so. It decides the request waiting on that person for the script on screen (or the one named); an owner or admin may approve a script nobody asked them about. A version is never approved by the person who wrote it unless they are an owner or admin.",
      parameters: {
        type: "object",
        properties: {
          decision: { type: "string", enum: ["approve", "reject"] },
          note: { type: "string", description: "Why, or what to change. Expected when rejecting." },
          script_id: { type: "string", description: "Optional: the script on screen by default." },
          approval_id: { type: "string", description: "Optional: the approval request's id (apr_…), when known." },
        },
        required: ["decision"],
      },
    },
  },
];

/** The script a tool means: the one named, the one on screen, or the open video project's. */
async function scriptInView(ctx: ToolContext, named: string): Promise<string | null> {
  if (named) return named;
  if (ctx.scriptId) return ctx.scriptId;
  if (ctx.projectId) {
    const [p] = await db
      .select({ scriptId: workProjects.scriptId })
      .from(workProjects)
      .where(and(eq(workProjects.tenantId, ctx.viewer.tenantId), eq(workProjects.videoProjectId, ctx.projectId), isNull(workProjects.deletedAt)))
      .limit(1);
    if (p?.scriptId) return p.scriptId;
  }
  return null;
}

/** Where a script is worked on: its project's 脚本 page when it has one, else the library editor. */
async function scriptLink(tenantId: string, scriptId: string): Promise<{ href: string; projectId: string | null }> {
  const [p] = await db
    .select({ id: workProjects.id })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt)))
    .limit(1);
  return p ? { href: `/projects/${p.id}/script`, projectId: p.id } : { href: `/script/${scriptId}`, projectId: null };
}

/** A script row of this studio, with what the approval and revision tools check. */
async function scriptRow(tenantId: string, scriptId: string) {
  const [row] = await db
    .select({ id: scripts.id, title: scripts.title, lockedVersion: scripts.lockedVersion, status: scripts.status, doc: scripts.doc })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  return row ?? null;
}

function plainText(n: RichNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(plainText).join("");
}

/**
 * The copilot's tracked changes, accepted all at once on the server: what the
 * script page does when somebody presses "accept all", over the same spoken
 * lines (`unitsOf` order). A changed line keeps its shot note; a line emptied
 * with no shot note goes; new lines go in after the line they name (-1:
 * before the first). Headings and untouched lines stay as they were, and a
 * list item or quote left with nothing in it goes too.
 */
function applyCopilot(doc: RichDoc, changes: Map<number, string>, inserts: Map<number, string[]>): RichDoc {
  let i = 0;
  const para = (text: string): RichNode => ({ type: "paragraph", content: [{ type: "text", text }] });
  const walk = (nodes: RichNode[]): RichNode[] => {
    const out: RichNode[] = [];
    for (const n of nodes) {
      if (n.type === "paragraph") {
        const text = plainText(n).replace(/\s+$/g, "");
        const shot = typeof n.attrs?.shot === "string" ? (n.attrs.shot as string).trim() : "";
        if (!text.trim() && !shot) {
          out.push(n);
          continue;
        }
        const k = i++;
        if (k === 0) out.push(...(inserts.get(-1) ?? []).map(para));
        const next = changes.get(k);
        if (next === undefined) out.push(n);
        else if (next.trim() || shot) out.push({ ...n, content: next.trim() ? [{ type: "text", text: next }] : undefined });
        out.push(...(inserts.get(k) ?? []).map(para));
        continue;
      }
      if (n.type === "heading" || !n.content) {
        out.push(n);
        continue;
      }
      const inner = walk(n.content);
      if (inner.length || !n.content.length) out.push({ ...n, content: inner });
    }
    return out;
  };
  const content = walk(doc.content ?? []);
  return { ...doc, type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "write_script") {
    const subject = str(args.subject, 200);
    if (!subject) return { text: "Say what the script is about." };

    // A watched topic by that name brings its headlines with it.
    const rows = await db
      .select({ id: topics.id, name: topics.name, query: topics.query })
      .from(topics)
      .where(eq(topics.tenantId, ctx.viewer.tenantId));
    const wanted = subject.toLowerCase();
    const topic =
      rows.find((t) => t.name.toLowerCase() === wanted || t.query.toLowerCase() === wanted) ??
      rows.find((t) => wanted.includes(t.name.toLowerCase()) || t.name.toLowerCase().includes(wanted)) ??
      null;

    /*
     * The length, only when it was asked for.
     *
     * The model leaves `seconds` out more often than not, and it used to
     * become 180 whatever the script was: "@文案 开头再抓人一点" in a project
     * whose topic had made it an eight-minute video (480 s) wrote 180 onto
     * the script and drafted three minutes. Writing into a script, no length
     * means "keep its own" (`writeScript` leaves `targetSeconds` alone on
     * null); only a new script, or one that never had a length, gets 180.
     */
    const asked = num(args.seconds, 0);
    let seconds: number | null = asked > 0 ? asked : null;
    /* The live projects this script is the draft of: their "being written"
       mark is what the topic's background draft sets (`lib/script/background.ts`). */
    let projects: string[] = [];
    /*
     * Asked outside any project — a plan's hand-off in #研究日报, "@文案 写个
     * 脚本" in #制作, a person's own assistant — the script still lives in a
     * project. It used to land loose in the library, owned by 文案, with no
     * video project: 剪辑师, handed it next, had nowhere to cut. Now the
     * studio's project for this subject is filled if one is waiting for its
     * first draft (`emptyProjectTitled`: same title, empty script), else a
     * project is started around it — the studio's to see, started for the
     * person who asked (or, with nobody behind the turn, by the employee),
     * the way a project from a pick is — and the draft is written into its
     * script. The receipt names the project, so the reply and any hand-off
     * carry it.
     */
    let project: { id: string; title: string; created: boolean } | null = null;
    let intoScriptId = ctx.scriptId ?? null;
    /*
     * The conversation's own script is approved (locked) or gone, and the ask
     * is a different video: that is a new project, not a refusal. 29 Sep:
     * "帮我做一条新视频：比特币…" in 文案's chat, last about an approved
     * script, was refused twice as "locked" — and the reply then said a
     * project had been made. The same subject still gets the refusal, so an
     * approved script is never quietly replaced.
     */
    if (intoScriptId) {
      const [own] = await db
        .select({ title: scripts.title, lockedVersion: scripts.lockedVersion })
        .from(scripts)
        .where(and(eq(scripts.id, intoScriptId), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
        .limit(1);
      if (!own || (own.lockedVersion !== null && subject && !sameSubject(own.title, subject))) intoScriptId = null;
    }
    const person = ctx.asker ?? (agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer);
    const starter = person ?? ctx.viewer;
    /*
     * A rewrite, asked outside the project: "把最新的脚本开头改得更抓人" on
     * 文案's own page, "@文案 再短一点" in #研究日报. Without the id every
     * such request started one more project titled like the first, with a
     * new script beside the old. With it, the draft goes into that script,
     * inside its project (one is started around a loose older script), for
     * a script the person asking may reach — a private project's script is
     * its members' — and never a locked one.
     */
    const named = intoScriptId ? "" : str(args.script_id, 64);
    if (named) {
      const [target] = await db
        .select({ id: scripts.id, lockedVersion: scripts.lockedVersion })
        .from(scripts)
        .where(and(eq(scripts.id, named), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
        .limit(1);
      if (!target) return { text: `There is no script ${named} in the library. Find its id with list_scripts; nothing was written.` };
      /* Refused before a project is started around it, not after. */
      if (target.lockedVersion !== null) return { text: "That script is locked: it was approved. Unlock it on its page before writing a new draft. Nothing was written." };
      if (person && !(await reachableThroughProjects(person, { scriptId: target.id }))) {
        return { text: "That script is in a project the person asking may not see. Nothing was written." };
      }
      const around = await ensureScriptProject(starter, target.id);
      if (around) project = { id: around.id, title: around.title, created: around.created };
      intoScriptId = target.id;
    }
    if (!intoScriptId) {
      const title = (topic ? topic.name : subject).slice(0, 80);
      const waiting = await emptyProjectTitled(starter, title);
      if (waiting?.scriptId) {
        project = { id: waiting.id, title: waiting.title, created: false };
        intoScriptId = waiting.scriptId;
        /* Its script keeps the length it was started with, if any. */
        const [own] = await db.select({ targetSeconds: scripts.targetSeconds }).from(scripts).where(eq(scripts.id, waiting.scriptId)).limit(1);
        if (seconds === null && !own?.targetSeconds) seconds = 180;
      } else {
        if (seconds === null) seconds = 180;
        const made = await createWorkProject(starter, {
          title,
          brief: str(args.angle, 300) || subject,
          mode: "full",
          source: { kind: "agent", label: "文案写的脚本" },
          topicId: topic?.id ?? null,
          script: {
            topicId: topic?.id ?? null,
            angle: str(args.angle, 300) || null,
            mandatoryPoints: Array.isArray(args.points) ? args.points.filter((p): p is string => typeof p === "string") : [],
            targetChannel: str(args.channel, 60) || null,
            targetSeconds: seconds,
            language: str(args.language, 40) || null,
            subtitleLanguage: str(args.subtitle_language, 40) || null,
          },
        });
        project = { id: made.id, title, created: true };
        intoScriptId = made.scriptId;
      }
      projects = [project.id];
    } else {
      /* Into a script that exists: the project's own, or the one named. */
      const [into] = await db
        .select({ targetSeconds: scripts.targetSeconds })
        .from(scripts)
        .where(and(eq(scripts.id, intoScriptId), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
        .limit(1);
      if (seconds === null && !into?.targetSeconds) seconds = 180;
      const live = await db
        .select({ id: workProjects.id, source: workProjects.source })
        .from(workProjects)
        .where(and(eq(workProjects.tenantId, ctx.viewer.tenantId), eq(workProjects.scriptId, intoScriptId), isNull(workProjects.deletedAt)));
      /* A draft already on its way. "开项目并写脚本" writes it after the
         response, for half a minute to a minute; a tag in the project's chat
         inside that window used to start a second draft into the same
         script, both were billed, and whichever saved last replaced the
         other — under a "初稿写好了" that then described beats that were gone. */
      const now = Date.now();
      if (live.some((p) => isWriting(p.source as ProjectSource | null, now))) {
        return {
          text: "A draft of this script is already being written (from the project's topic, or another request to the writer); it lands within a few minutes. Nothing was written now: say that a draft is on its way, and offer to change it once it has landed.",
        };
      }
      projects = live.map((p) => p.id);
    }

    const points = Array.isArray(args.points) ? args.points.filter((p): p is string => typeof p === "string") : [];
    /* And this draft carries the same mark while it is written, so the
       topic's "写初稿" / "按选题重写" wait for it rather than racing it, and
       the project and script pages show it being written. Cleared however
       the draft ends. */
    const started = new Date().toISOString();
    await Promise.all(projects.map((id) => setProjectWriting(id, started)));
    let res: Awaited<ReturnType<typeof writeScript>>;
    try {
      res = await writeScript(ctx.viewer, {
        /* Inside a project, always its own script; outside one, the script
           of the project just found or started for it. */
        intoScriptId,
        topicId: topic?.id ?? null,
        subject: topic ? topic.name : subject,
        angle: str(args.angle, 300) || null,
        channel: str(args.channel, 60) || null,
        seconds,
        language: str(args.language, 40) || null,
        subtitleLanguage: str(args.subtitle_language, 40) || null,
        mandatoryPoints: points,
      });
    } finally {
      await Promise.all(projects.map((id) => setProjectWriting(id, null).catch(() => {})));
    }
    /* The project is real whether or not the draft lands: it is receipted
       and named, so nobody is told a script exists that does not, and nobody
       has to find the project by hand. */
    const projectReceipt = project?.created ? [{ kind: "work_project" as const, id: project.id, title: project.title, action: "created" as const }] : [];
    const projectLine = project
      ? `${project.created ? "Started the project" : "Wrote into the project"} "${project.title}" for it (open it at /projects/${project.id}, id: ${project.id}); its video project is there for the edit.`
      : "";
    if (!res.ok) {
      return { text: [res.error, projectLine].filter(Boolean).join("\n"), ...(projectReceipt.length ? { artifacts: projectReceipt, changed: true } : {}) };
    }
    /* Written into the script it was asked to write into, or (that one gone)
       a new one. */
    const into = Boolean(intoScriptId) && res.id === intoScriptId;
    /*
     * No beats, no receipt.
     *
     * The drafting model sometimes answers with nothing readable, twice, and
     * `writeScript` then returns ok with 0 beats and the reason in `note`.
     * This used to come back as "Written: … — 0 beats" with a script
     * receipt, and "已经重写好了" was posted as backed by it. Now it says
     * what the background draft says when it happens there: nothing was
     * written, and why.
     */
    if (res.beats === 0) {
      return {
        text: [
          `No draft was written: ${(res.note ?? "the drafting model returned nothing readable").replace(/[.。]\s*$/, "")}.`,
          into
            ? `The script's beats are as they were (/script/${res.id}, id: ${res.id}).`
            : `An empty script "${res.title}" was left in the library (/script/${res.id}, id: ${res.id}).`,
          projectLine,
          "Say that it did not work and why; it can be tried again.",
        ]
          .filter(Boolean)
          .join("\n"),
        ...(projectReceipt.length ? { artifacts: projectReceipt, changed: true } : {}),
      };
    }
    /* Written from a private chat: the project's own chat says so too. */
    if (project && ctx.privateReply) {
      await mirrorToProject(ctx.viewer.tenantId, project.id, "script", `《${res.title}》的${project.created ? "初稿" : "新一版"}写好了：${res.beats} 个分镜。在脚本页看、改：/script/${res.id}`).catch((err) => console.error("[script] could not tell the project", err));
    }
    return {
      /* The receipt. Inside a project the script already existed and was
         written into; elsewhere it is new. */
      artifacts: [...projectReceipt, { kind: "script", id: res.id, title: res.title, action: into && (named || !project?.created) ? "updated" : "created" }],
      text: [
        `Written: "${res.title}" — ${res.beats} beat${res.beats === 1 ? "" : "s"}${res.model ? ` by ${res.model}` : ""}.`,
        `Open it at /script/${res.id} (id: ${res.id}).`,
        projectLine,
        topic ? `It drew on the headlines collected for "${topic.name}".` : "",
        res.note ? `Note: ${res.note}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      changed: true,
    };
  }

  if (name === "list_scripts") {
    const query = str(args.query, 80);
    if (query) return findScripts(ctx, query, Math.min(40, Math.max(1, num(args.limit, 15))));
    const rows = await db
      .select({ id: scripts.id, title: scripts.title, status: scripts.status, channel: scripts.targetChannel, updatedAt: scripts.updatedAt })
      .from(scripts)
      .where(and(eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
      .orderBy(desc(scripts.updatedAt))
      .limit(Math.min(40, Math.max(1, num(args.limit, 15))));
    if (!rows.length) return { text: "The library is empty." };
    return {
      text: rows
        .map((r) => `- ${r.title} (id: ${r.id}) — ${r.status}${r.channel ? ` · ${r.channel}` : ""} · ${r.updatedAt.toISOString().slice(0, 10)}`)
        .join("\n"),
    };
  }

  if (name === "read_script") {
    const id = str(args.id, 64) || ctx.scriptId || "";
    const [script] = id
      ? await db
          .select()
          .from(scripts)
          .where(and(eq(scripts.id, id), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
          .limit(1)
      : [];
    if (!script) return { text: "No such script. Use an id from list_scripts, or open one." };
    const beats = await db.select().from(scriptBeats).where(eq(scriptBeats.scriptId, script.id)).orderBy(asc(scriptBeats.ord));
    return {
      text: [
        `# ${script.title} (${script.status}${script.targetChannel ? ` · ${script.targetChannel}` : ""}${script.targetSeconds ? ` · ${script.targetSeconds}s target` : ""})`,
        script.angle ? `Angle: ${script.angle}` : "",
        "",
        ...beats.map(
          (b) =>
            `Beat ${b.ord + 1}${b.naturalSound ? " (natural sound)" : ""}${b.startSeconds !== null ? ` @${b.startSeconds}s` : ""}\n  Visual: ${b.visual}\n  VO: ${b.voiceover}\n  Sub: ${b.subtitle}`,
        ),
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  if (name === "revise_script") return reviseScript(ctx, args);
  if (name === "request_script_approval") return requestScriptApproval(ctx, args);
  if (name === "decide_script_approval") return decideScriptApproval(ctx, args);

  return { text: `Unknown tool ${name}.` };
}

/**
 * "开头再抓人一点" on a script that has words: the copilot the script page
 * uses (`copilotRewrite`), its changes accepted on the server and saved the
 * way the page saves (`saveBeats` plus the rich document), so the page opens
 * on the new text and the untouched lines are exactly as they were. The
 * draft before it is a version first, as "Generate from brief" does.
 */
async function reviseScript(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const instruction = str(args.instruction, 1000);
  if (!instruction) return { text: "Say what should change." };
  const id = await scriptInView(ctx, str(args.script_id, 64));
  if (!id) return { text: "Which script? Open it, or give its id (find it with list_scripts). Nothing was changed." };
  const own = await ownScript(ctx.viewer, id);
  const row = own ? await scriptRow(ctx.viewer.tenantId, own) : null;
  if (!row) return { text: `There is no script ${id} in the library. Find its id with list_scripts; nothing was changed.` };
  const person = personOf(ctx);
  if (person && !(await reachableThroughProjects(person, { scriptId: row.id }))) {
    return { text: "That script is in a project the person asking may not see. Nothing was changed." };
  }
  if (row.lockedVersion !== null) {
    return { text: `"${row.title}" is approved and locked (version ${row.lockedVersion}). It has to be unlocked on its page ("继续编辑") before it can be changed; it will then need approving again. Nothing was changed.` };
  }
  const live = await db
    .select({ source: workProjects.source })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, ctx.viewer.tenantId), eq(workProjects.scriptId, row.id), isNull(workProjects.deletedAt)));
  if (live.some((p) => isWriting(p.source as ProjectSource | null, Date.now()))) {
    return { text: "A draft of this script is being written right now; it lands within a few minutes. Nothing was changed: offer to make the change once it has landed." };
  }

  const readBeats = () =>
    db
      .select({ voiceover: scriptBeats.voiceover, visual: scriptBeats.visual, subtitle: scriptBeats.subtitle })
      .from(scriptBeats)
      .where(eq(scriptBeats.scriptId, row.id))
      .orderBy(asc(scriptBeats.ord));
  const beats = await readBeats();
  const base = docForBeats((row.doc ?? null) as RichNode | null, beats);
  const units = unitsOf(base);
  if (!units.length) return { text: `"${row.title}" has no text yet, so there is nothing to revise. Use write_script to write its first draft. Nothing was changed.` };

  let res: Awaited<ReturnType<typeof copilotRewrite>>;
  try {
    res = await copilotRewrite(ctx.viewer, row.id, units.map((u) => u.text), instruction);
  } catch (err) {
    return { text: `The change could not be made: ${err instanceof Error ? err.message : "the model call failed"}. The script is as it was.` };
  }
  if ("error" in res) return { text: `${res.error} The script is as it was.` };
  /* The writer read it as a question or put a proposal back: nothing is written. */
  if (!res.changes.length && !res.inserts.length) {
    return { text: `Nothing was changed in "${row.title}"; it is as it was. The writer's answer${res.reply ? `: ${res.reply}` : " was that no change is needed."}\nPass this on; if it proposes a change, ask the person whether to make it.` };
  }

  /* Somebody typing in the page while the copilot worked: its line numbers
     no longer point at the same words, so nothing is applied over them. */
  const [after] = await db.select({ doc: scripts.doc, lockedVersion: scripts.lockedVersion }).from(scripts).where(eq(scripts.id, row.id)).limit(1);
  const nowUnits = unitsOf(docForBeats((after?.doc ?? null) as RichNode | null, await readBeats()));
  if (after?.lockedVersion !== null || nowUnits.map((u) => u.text).join("\u0001") !== units.map((u) => u.text).join("\u0001")) {
    return { text: "The script changed (or was approved) while the revision was being written, so it was not applied over the new text. Nothing was changed; it can be asked again." };
  }

  const changes = new Map(res.changes.map((c) => [c.i, c.text]));
  const inserts = new Map<number, string[]>();
  for (const x of res.inserts) inserts.set(x.after, [...(inserts.get(x.after) ?? []), x.text]);
  const next = JSON.parse(toSimplified(JSON.stringify(applyCopilot(base, changes, inserts)))) as RichDoc;
  /* A subtitle typed separately for a line that did not change is kept, as the page's save keeps it. */
  const subtitleOf = new Map(beats.filter((b) => b.subtitle && b.subtitle !== b.voiceover).map((b) => [b.voiceover, b.subtitle]));
  const nextBeats = beatsFromDoc(next)
    .slice(0, 400)
    .map((b) => ({ ...b, subtitle: subtitleOf.get(b.voiceover) ?? b.subtitle }));
  /* The text before is kept as a version only when something is about to change. */
  await cutVersion(ctx.viewer, row.id, { note: "改稿前" });
  const saved = await saveBeats(ctx.viewer, row.id, nextBeats.length ? nextBeats : [{ visual: "", voiceover: "", subtitle: "", naturalSound: false }]);
  if (!saved) return { text: "The script was locked before the revision could be saved. Nothing was changed." };
  await db.update(scripts).set({ doc: next as unknown as Record<string, unknown>, docHtml: null }).where(eq(scripts.id, row.id));
  await audit(ctx.viewer, "script.revise", {
    objectType: "script",
    objectId: row.id,
    module: "script",
    meta: { model: res.model, changed: res.changes.length, inserted: res.inserts.length, for: person?.id ?? null },
  });
  const link = await scriptLink(ctx.viewer.tenantId, row.id);
  const removed = res.changes.filter((c) => !c.text.trim()).length;
  return {
    artifacts: [{ kind: "script", id: row.id, title: row.title, action: "updated" }],
    text: [
      `Revised "${row.title}": ${res.changes.length - removed} line(s) rewritten${removed ? `, ${removed} removed` : ""}${res.inserts.length ? `, ${res.inserts.length} added` : ""}; ${saved.beats} line(s) now. The text before is kept as a version.`,
      res.summary ? `What changed: ${res.summary}` : "",
      `Open it at ${link.href} (id: ${row.id}).`,
      "Say in one sentence what changed; do not repeat the instruction.",
    ]
      .filter(Boolean)
      .join("\n"),
    changed: true,
  };
}

/** The person's most recent script, for "send it to 谢总 to approve" with nothing open. */
async function latestScriptOf(ctx: ToolContext): Promise<string | null> {
  const owner = personOf(ctx)?.id ?? ctx.viewer.id;
  const [row] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.tenantId, ctx.viewer.tenantId), eq(scripts.ownerId, owner), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.updatedAt))
    .limit(1);
  return row?.id ?? null;
}

async function requestScriptApproval(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const id = (await scriptInView(ctx, str(args.script_id, 64))) ?? (await latestScriptOf(ctx));
  if (!id) return { text: "Which script? Open it, or give its id (find it with list_scripts). Nothing was sent." };
  const row = await scriptRow(ctx.viewer.tenantId, id);
  if (!row || !(await ownScript(ctx.viewer, row.id))) return { text: `There is no script ${id} in the library. Nothing was sent.` };
  const person = personOf(ctx);
  if (person && !(await reachableThroughProjects(person, { scriptId: row.id }))) {
    return { text: "That script is in a project the person asking may not see. Nothing was sent." };
  }
  if (row.lockedVersion !== null) return { text: `"${row.title}" is already approved (version ${row.lockedVersion}). Nothing was sent.` };

  const who = await resolveApprover(ctx.viewer, str(args.approver, 120), [ctx.viewer.id]);
  if ("error" in who) return { text: who.error };
  const note = str(args.note, 500) || undefined;
  const res = await requestApproval(ctx.viewer, row.id, who.ok.id, note);
  if (!res) return { text: `"${row.title}" has no text to approve yet, or it is locked. Nothing was sent.` };
  await audit(ctx.viewer, "script.approval.request", {
    objectType: "script",
    objectId: row.id,
    module: "script",
    meta: { approverId: who.ok.id, versionNo: res.versionNo, for: person?.id ?? null },
  });
  const link = await scriptLink(ctx.viewer.tenantId, row.id);
  const forWhom = person && person.id !== ctx.viewer.id ? `（应 ${nameOf(person)} 的要求）` : "";
  const told = await tellPerson(
    ctx.viewer,
    who.ok.id,
    [note ? `${note}\n` : "", `${nameOf(ctx.viewer)}${forWhom}请你审阅并批准脚本《${row.title}》第 ${res.versionNo} 版。看完按「批准」或「提修改意见」。`, "", `[打开脚本 →](${link.href})`].join("\n").trim(),
    { share: { kind: "script", projectId: link.projectId, scriptId: row.id, ask: "review", versionNo: res.versionNo } },
  );
  return {
    artifacts: [{ kind: "script", id: row.id, title: row.title, action: "updated" }],
    text: `Sent "${row.title}" (version ${res.versionNo}) to ${who.ok.name} to approve${told ? "; they have a direct message with the link" : ""}. Request id: ${res.approvalId}. It is not approved until ${who.ok.name} approves it.`,
    changed: true,
  };
}

async function decideScriptApproval(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const person = personOf(ctx);
  if (!person) return { text: NO_PERSON };
  if (!person.modules.includes("script")) return { text: `${nameOf(person)} does not hold the Script module, so cannot decide script approvals. Nothing was done.` };
  const decision = args.decision === "approve" || args.decision === "approved" ? "approved" : args.decision === "reject" || args.decision === "rejected" ? "rejected" : null;
  if (!decision) return { text: "Say whether to approve or reject it." };
  const note = str(args.note, 500) || undefined;

  /* The request: the one named (in this studio, on a script), else the one waiting on this person for the script in view. */
  let approvalId: string | null = null;
  let scriptId: string | null = null;
  let requestedBy: string | null = null;
  const named = str(args.approval_id, 64);
  if (named) {
    const [a] = await db
      .select({ id: approvals.id, objectId: approvals.objectId, requestedBy: approvals.requestedBy })
      .from(approvals)
      .where(and(eq(approvals.id, named), eq(approvals.tenantId, person.tenantId), eq(approvals.objectType, "script"), eq(approvals.state, "requested")))
      .limit(1);
    if (!a) return { text: `There is no script approval ${named} waiting. Nothing was done.` };
    approvalId = a.id;
    scriptId = a.objectId;
    requestedBy = a.requestedBy;
  } else {
    scriptId = await scriptInView(ctx, str(args.script_id, 64));
    if (!scriptId) {
      const waiting = await pendingApprovals(person);
      return {
        text: waiting.length
          ? `Which script? Waiting on ${nameOf(person)}:\n${waiting.map((w) => `- ${w.title} (script id: ${w.objectId}, version ${w.versionNo ?? "?"}, request id: ${w.id})`).join("\n")}`
          : `No script approval is waiting on ${nameOf(person)}. Open the script, or give its id.`,
      };
    }
  }
  const row = await scriptRow(person.tenantId, scriptId);
  if (!row) return { text: `There is no script ${scriptId} in the library. Nothing was done.` };
  if (!(await reachableThroughProjects(person, { scriptId: row.id }))) return { text: `${nameOf(person)} may not see the project this script is in. Nothing was done.` };

  if (!approvalId) {
    const req = await openRequestFor(person, row.id);
    if (req) {
      approvalId = req.id;
      requestedBy = req.requestedBy;
    } else {
      if (row.lockedVersion !== null) return { text: `"${row.title}" is already approved (version ${row.lockedVersion}). Nothing was done.` };
      const admin = person.role === "owner" || person.role === "admin";
      /* An owner or admin may approve a script as it stands without being asked (the page's 批准); anyone else needs a request addressed to them. */
      if (decision === "rejected" || !admin) {
        return { text: `Nobody has asked ${nameOf(person)} to approve "${row.title}", so there is nothing to ${decision === "approved" ? "approve" : "reject"}. Send it for approval first (request_script_approval). Nothing was done.` };
      }
      const r = await requestApproval(person, row.id, person.id);
      if (!r) return { text: `"${row.title}" has no text to approve yet. Nothing was done.` };
      approvalId = r.approvalId;
      requestedBy = person.id;
    }
  }

  const res = await decideApproval(person, approvalId, decision, note);
  if ("error" in res) return { text: `${res.error} Nothing was decided.` };
  await withdrawOthers(person, row.id, approvalId);
  await audit(person, `script.approval.${decision}`, {
    objectType: "approval",
    objectId: approvalId,
    module: "script",
    meta: { versionNo: res.versionNo, by: "assistant", speaker: ctx.viewer.id },
  });
  const link = await scriptLink(person.tenantId, row.id);
  if (requestedBy) {
    await tellPerson(
      person,
      requestedBy,
      decision === "approved"
        ? `${nameOf(person)} 批准了脚本《${row.title}》第 ${res.versionNo} 版，可以开拍、剪辑了。\n\n[打开脚本 →](${link.href})`
        : `${nameOf(person)} 退回了脚本《${row.title}》第 ${res.versionNo} 版${note ? `：${note}` : ""}\n\n[打开脚本 →](${link.href})`,
      { share: { kind: "script", projectId: link.projectId } },
    );
  }
  return {
    artifacts: [{ kind: "script", id: row.id, title: row.title, action: "updated" }],
    text:
      decision === "approved"
        ? `${nameOf(person)} approved "${row.title}" (version ${res.versionNo}); it is locked and handed to the edit. Open it at ${link.href}.`
        : `${nameOf(person)} sent "${row.title}" (version ${res.versionNo}) back${note ? ` with the note: ${note}` : ""}. It is a draft again. Open it at ${link.href}.`,
    changed: true,
  };
}

/**
 * Scripts matching some words, for "is there a script about 蒸馏 yet".
 *
 * The library's own search first (title, in either language), then the
 * angle and the words of the beats: a script written into a project keeps
 * the project's name — one about distillation is filed as "测试" — so a
 * title search alone says "no" about a script that is sitting right there.
 * When nothing matches, it says what the library does hold, because "there
 * is no such script" is only useful next to "here is what there is".
 */
async function findScripts(ctx: ToolContext, query: string, limit: number): Promise<ToolResult> {
  const byTitle = await listScripts(ctx.viewer, { query });
  const seen = new Set(byTitle.map((r) => r.id));
  const like = `%${query}%`;
  const byContent = await db
    .selectDistinct({ id: scripts.id, title: scripts.title, status: scripts.status, channel: scripts.targetChannel, updatedAt: scripts.updatedAt })
    .from(scripts)
    .leftJoin(scriptBeats, eq(scriptBeats.scriptId, scripts.id))
    .where(
      and(
        eq(scripts.tenantId, ctx.viewer.tenantId),
        isNull(scripts.deletedAt),
        or(ilike(scripts.angle, like), ilike(scriptBeats.voiceover, like), ilike(scriptBeats.visual, like)),
      ),
    )
    .orderBy(desc(scripts.updatedAt))
    .limit(limit);

  const hits = [
    ...byTitle.map((r) => ({ id: r.id, title: r.title, status: r.status, channel: r.targetChannel, updatedAt: r.updatedAt, where: "title" })),
    ...byContent.filter((r) => !seen.has(r.id)).map((r) => ({ ...r, where: "angle or beats" })),
  ].slice(0, limit);

  if (hits.length) {
    return {
      text: [
        `Scripts matching "${query}":`,
        ...hits.map(
          (r) =>
            `- ${r.title} (id: ${r.id}) — ${r.status}${r.channel ? ` · ${r.channel}` : ""} · ${r.updatedAt.toISOString().slice(0, 10)} · matched in the ${r.where}`,
        ),
      ].join("\n"),
    };
  }

  const newest = await db
    .select({ id: scripts.id, title: scripts.title, status: scripts.status, updatedAt: scripts.updatedAt })
    .from(scripts)
    .where(and(eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.updatedAt))
    .limit(8);
  return {
    text: newest.length
      ? [
          `No script matches "${query}" — not in a title, an angle or any beat. What the library does hold, newest first:`,
          ...newest.map((r) => `- ${r.title} (id: ${r.id}) — ${r.status} · ${r.updatedAt.toISOString().slice(0, 10)}`),
        ].join("\n")
      : `No script matches "${query}", and the library is empty.`,
  };
}

export const scriptPack: ToolPack = { module: "script", defs, run };

/** Two titles about the same video: one holds the other's first eight letters, punctuation and spaces aside. */
function sameSubject(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  const head = (z: string) => Array.from(z).slice(0, 8).join("");
  return x.includes(head(y)) || y.includes(head(x));
}
