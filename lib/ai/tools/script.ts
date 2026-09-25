import "server-only";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts, topics } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
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
          seconds: { type: "number", description: "Target length in seconds. Optional; default 180." },
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

    const points = Array.isArray(args.points) ? args.points.filter((p): p is string => typeof p === "string") : [];
    const res = await writeScript(ctx.viewer, {
      /* Inside a project, always its own script. */
      intoScriptId: ctx.scriptId ?? null,
      topicId: topic?.id ?? null,
      subject: topic ? topic.name : subject,
      angle: str(args.angle, 300) || null,
      channel: str(args.channel, 60) || null,
      seconds: num(args.seconds, 180),
      language: str(args.language, 40) || null,
      subtitleLanguage: str(args.subtitle_language, 40) || null,
      mandatoryPoints: points,
    });
    if (!res.ok) return { text: res.error };
    return {
      /* The receipt. Inside a project the script already existed and was
         written into; elsewhere it is new. */
      artifacts: [{ kind: "script", id: res.id, title: res.title, action: ctx.scriptId ? "updated" : "created" }],
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
