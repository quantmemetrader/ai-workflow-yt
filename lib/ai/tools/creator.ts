import "server-only";
import type { ToolDef } from "@/lib/ai/openrouter";
import { creatorVideoById, listCreatorVideos } from "@/lib/creator/service";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * The creator's own channel, as something the agent can look up.
 *
 * The voice note is already in every prompt; these are for the cases where a
 * note is not enough — "what did we say about NVIDIA last time", "which of
 * our videos did best this year", "how did we open the one about stablecoins".
 * Offered to anyone who holds Research, Script or Video, because all three
 * write things that should sound like the channel.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "creator_videos",
      description:
        "The studio's own published YouTube videos, with views, length and date. Search by a word in the title, description or tags, or leave the query empty for the best-performing ones. Use it to match the channel's own voice, to avoid repeating a video that exists, and to cite what worked.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A word or phrase to look for. Optional." },
          sort: { type: "string", enum: ["views", "recent"], description: "Default views." },
          limit: { type: "number", description: "Default 12, most 40." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "creator_video",
      description:
        "One of the studio's own videos in full: description, tags, and the transcript when the product has it. Use the id from creator_videos.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  },
];

const mins = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "?");

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "creator_videos") {
    const rows = await listCreatorVideos(ctx.viewer.tenantId, {
      query: str(args.query, 120),
      sort: str(args.sort, 10) === "recent" ? "recent" : "views",
      limit: Math.min(40, Math.max(1, num(args.limit, 12))),
    });
    if (!rows.length) {
      return {
        text: "No videos from the studio's own channel are synced yet. Somebody can press Sync on the Research screen, under Your channel.",
      };
    }
    return {
      text: rows
        .map(
          (v) =>
            `- ${v.title} (id: ${v.id}) — ${v.views.toLocaleString()} views · ${mins(v.durationSec)} · ${v.publishedAt?.toISOString().slice(0, 10) ?? "?"}${v.transcript ? " · transcript available" : ""}`,
        )
        .join("\n"),
    };
  }

  if (name === "creator_video") {
    const id = str(args.id, 64);
    const v = id ? await creatorVideoById(ctx.viewer.tenantId, id) : null;
    if (!v) return { text: "No such video. Use an id from creator_videos." };
    return {
      text: [
        `# ${v.title}`,
        `${v.views.toLocaleString()} views · ${v.likes.toLocaleString()} likes · ${v.comments.toLocaleString()} comments · ${mins(v.durationSec)} · published ${v.publishedAt?.toISOString().slice(0, 10) ?? "?"}`,
        `https://www.youtube.com/watch?v=${v.externalId}`,
        v.tags.length ? `Tags: ${v.tags.join(", ")}` : "",
        "",
        v.description ? `Description:\n${v.description.slice(0, 2000)}` : "",
        v.transcript ? `\nTranscript (${v.transcriptSource}):\n${v.transcript.slice(0, 12_000)}` : "\n(No transcript is held for this video.)",
      ]
        .filter((l) => l !== "")
        .join("\n"),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const creatorPack: ToolPack = { module: ["research", "script", "video"], defs, run };
