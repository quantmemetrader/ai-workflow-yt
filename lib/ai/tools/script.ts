import "server-only";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts, topics, workProjects } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import { isWriting, type ProjectSource } from "@/lib/projects/topic";
import { setProjectWriting } from "@/lib/projects/service";
import { writeScript } from "@/lib/script/from-research";
import { listScripts } from "@/lib/script/service";
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
        "Write a full shooting script and return its link. Inside a project it is written into the project's own script (never a new one); elsewhere a new script goes into the Script library. Give the subject (a watched topic's name, or anything), and optionally the angle, the channel (YouTube, Shorts, LinkedIn…), the length in seconds, the spoken language and the subtitle language. When the subject is a watched topic, the headlines it collected are used as facts. Takes about half a minute. Costs one drafting-model call.",
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
];

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
     * become 180 whatever the script was: "@编剧 开头再抓人一点" in a project
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
    if (ctx.scriptId) {
      const [into] = await db
        .select({ targetSeconds: scripts.targetSeconds })
        .from(scripts)
        .where(and(eq(scripts.id, ctx.scriptId), eq(scripts.tenantId, ctx.viewer.tenantId), isNull(scripts.deletedAt)))
        .limit(1);
      if (seconds === null && !into?.targetSeconds) seconds = 180;
      const live = await db
        .select({ id: workProjects.id, source: workProjects.source })
        .from(workProjects)
        .where(and(eq(workProjects.tenantId, ctx.viewer.tenantId), eq(workProjects.scriptId, ctx.scriptId), isNull(workProjects.deletedAt)));
      /* A draft already on its way. "开项目并写脚本" writes it after the
         response, for half a minute to a minute; a tag in the project's chat
         inside that window used to start a second draft into the same
         script, both were billed, and whichever saved last replaced the
         other — under a "初稿写好了" that then described beats that were gone. */
      const now = Date.now();
      if (live.some((p) => isWriting(p.source as ProjectSource | null, now))) {
        return {
          text: "A draft of this script is already being written (started from the project's topic); it lands in a minute or so and is announced in the project's chat. Nothing was written now: say that the draft is on its way, and offer to change it once it has landed.",
        };
      }
      projects = live.map((p) => p.id);
    } else if (seconds === null) {
      seconds = 180;
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
        /* Inside a project, always its own script. */
        intoScriptId: ctx.scriptId ?? null,
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
    if (!res.ok) return { text: res.error };
    /* Written into the script it was asked to write into, or (that one gone)
       a new one. */
    const into = Boolean(ctx.scriptId) && res.id === ctx.scriptId;
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
          "Say that it did not work and why; it can be tried again.",
        ].join("\n"),
      };
    }
    return {
      /* The receipt. Inside a project the script already existed and was
         written into; elsewhere it is new. */
      artifacts: [{ kind: "script", id: res.id, title: res.title, action: into ? "updated" : "created" }],
      text: [
        `Written: "${res.title}" — ${res.beats} beat${res.beats === 1 ? "" : "s"}${res.model ? ` by ${res.model}` : ""}.`,
        `Open it at /script/${res.id} (id: ${res.id}).`,
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

  return { text: `Unknown tool ${name}.` };
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
