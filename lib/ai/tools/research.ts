import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { seriesCache, topics } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { env } from "@/lib/env";
import type { ToolDef } from "@/lib/ai/openrouter";
import { createTopic, decide, rankedTopics } from "@/lib/research/service";
import { suggestAngles } from "@/lib/research/angles";
import { trendingSearches } from "@/lib/research/trending";
import { channelsForPhrase, trendingVideos } from "@/lib/research/youtube";
import { addCompetitor, listCompetitors } from "@/lib/social/service";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * What the studio watches, and what the world is doing.
 *
 * The Research screens can do all of this by hand. What they could not do is
 * answer "is anyone making videos about this yet, and should we?" in one
 * breath — that is three screens and a judgement, which is exactly the shape a
 * conversation is good at.
 *
 * Reads are cheap and writes are not: watching a phrase starts a collection
 * job, and looking up who is making videos about something spends 100 of the
 * YouTube key's 10,000 daily units. Both say so in their descriptions, because
 * a model that knows a call is expensive makes fewer of them.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_topics",
      description:
        "The phrases the studio watches, hottest first, with their heat, how much they moved, and what has been collected about them.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Default 20, most 60." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "watch_topic",
      description:
        "Start watching a phrase. Collection runs in the background and takes a few seconds; the numbers appear on the Trends dashboard when it lands.",
      parameters: {
        type: "object",
        properties: {
          phrase: { type: "string", description: "What to search for." },
          beat: {
            type: "string",
            description: "Which beat it belongs to: ai, chain, semi, devices, fintech, ev, startups. Optional — it is guessed from the phrase.",
          },
        },
        required: ["phrase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_topic",
      description:
        "Everything collected about one watched phrase: its numbers, the headlines and videos behind them, and any angles already written.",
      parameters: {
        type: "object",
        properties: { phrase: { type: "string", description: "The topic's name or its exact phrase." } },
        required: ["phrase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_angles",
      description:
        "Ask for angles on a watched topic, from the headlines already collected. Writes them onto the topic so the Trends screen shows them too. Costs a model call.",
      parameters: {
        type: "object",
        properties: { phrase: { type: "string" } },
        required: ["phrase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "decide_topic",
      description:
        "Adopt a topic into the backlog, reject it, or save it for later. Adopting and rejecting both feed back into how future topics are ranked.",
      parameters: {
        type: "object",
        properties: {
          phrase: { type: "string" },
          decision: { type: "string", enum: ["adopt", "reject", "save"] },
        },
        required: ["phrase", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trending_now",
      description:
        "What a region is searching for and watching right now: Google's daily trending searches and YouTube's most-watched chart. Free and current to the last few hours.",
      parameters: {
        type: "object",
        properties: {
          region: { type: "string", description: "HK, TW, SG, US, GB or JP. Default HK." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "who_makes_this",
      description:
        "Which YouTube channels are making videos about a subject, ranked by what those videos actually earned in the last 30 days. Use it to find competitors worth watching. Costs 100 of the day's 10,000 YouTube units, so ask once per subject.",
      parameters: {
        type: "object",
        properties: { subject: { type: "string" } },
        required: ["subject"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "watch_channel",
      description:
        "Add a YouTube channel to the studio's competitor board, so its numbers are read alongside the studio's own.",
      parameters: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "A YouTube channel id, as who_makes_this reports it." },
          name: { type: "string" },
        },
        required: ["channel_id"],
      },
    },
  },
];

/** A topic by its name or its exact phrase. Models use whichever they saw. */
async function findTopic(ctx: ToolContext, phrase: string) {
  const wanted = phrase.trim().toLowerCase();
  const rows = await db
    .select()
    .from(topics)
    .where(eq(topics.tenantId, ctx.viewer.tenantId))
    .orderBy(desc(topics.heat));
  return (
    rows.find((t) => t.name.toLowerCase() === wanted || t.query.toLowerCase() === wanted) ??
    rows.find((t) => t.name.toLowerCase().includes(wanted) || t.query.toLowerCase().includes(wanted)) ??
    null
  );
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "list_topics") {
    const limit = Math.min(Math.max(num(args.limit, 20), 1), 60);
    const rows = await rankedTopics(ctx.viewer, { limit });
    if (rows.length === 0) return { text: "The studio is not watching anything yet." };
    return {
      text: rows
        .map(
          (t) =>
            `- ${t.name}${t.category ? ` (${t.category})` : ""} — heat ${Math.round(t.heat)}, ${pct(
              t.change14d,
            )}${t.collecting ? ", still collecting" : ""}${t.status !== "new" ? `, ${t.status}` : ""}`,
        )
        .join("\n"),
    };
  }

  if (name === "watch_topic") {
    const phrase = str(args.phrase, 120);
    if (!phrase) return { text: "Give me a phrase to watch." };
    const existing = await findTopic(ctx, phrase);
    if (existing) return { text: `The studio already watches "${existing.name}".` };

    const beats = ["ai", "chain", "semi", "devices", "fintech", "ev", "startups"];
    const beat = beats.includes(str(args.beat, 20)) ? str(args.beat, 20) : null;
    const topic = await createTopic(ctx.viewer, { query: phrase, category: beat });
    return {
      text: `Watching "${phrase}" now. Collection takes a few seconds; the numbers appear on the Trends dashboard when it lands.${
        topic.category ? ` Filed under ${topic.category}.` : ""
      }`,
      changed: true,
    };
  }

  if (name === "read_topic") {
    const topic = await findTopic(ctx, str(args.phrase, 120));
    if (!topic) return { text: "The studio does not watch that. Call list_topics to see what it does." };

    const [cached] = await db
      .select()
      .from(seriesCache)
      .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
      .limit(1);

    const lines = [
      `# ${topic.name}`,
      `Heat ${Math.round(topic.heat)}, ${pct(topic.change14d)} over 14 days.${
        topic.category ? ` Beat: ${topic.category}.` : ""
      }`,
      topic.summary ? `\n${topic.summary}` : "",
      topic.angles.length ? `\nAngles already written:\n${topic.angles.map((a) => `- ${a}`).join("\n")}` : "",
      cached?.articles.length
        ? `\nWhat is being published (${cached.sourceKey}):\n${cached.articles
            .slice(0, 20)
            .map((a) => `- ${a.title} (${a.domain}, ${a.at.slice(0, 10)})`)
            .join("\n")}`
        : "\nNothing has been collected for it yet.",
      cached?.error ? `\nThe last collection reported: ${cached.error}` : "",
    ];
    return { text: lines.filter(Boolean).join("\n") };
  }

  if (name === "suggest_angles") {
    const topic = await findTopic(ctx, str(args.phrase, 120));
    if (!topic) return { text: "The studio does not watch that." };
    const res = await suggestAngles(ctx.viewer, topic.id);
    if ("error" in res) return { text: res.error };
    return {
      text: `Angles for "${topic.name}":\n${res.angles.map((a) => `- ${a}`).join("\n")}`,
      changed: true,
    };
  }

  if (name === "decide_topic") {
    const topic = await findTopic(ctx, str(args.phrase, 120));
    if (!topic) return { text: "The studio does not watch that." };
    const decision = str(args.decision, 10);
    if (!["adopt", "reject", "save"].includes(decision)) {
      return { text: "The decision has to be adopt, reject or save." };
    }
    await decide(ctx.viewer, topic.id, decision as "adopt" | "reject" | "save");
    return {
      text:
        decision === "adopt"
          ? `"${topic.name}" is in the backlog, ready to plan.`
          : decision === "reject"
            ? `Rejected "${topic.name}". Future ranking takes that into account.`
            : `Saved "${topic.name}" for later.`,
      changed: true,
    };
  }

  if (name === "trending_now") {
    const region = str(args.region, 2).toUpperCase() || "HK";
    const [searches, videos] = await Promise.all([
      trendingSearches(region).catch(() => []),
      env.youtube.configured ? trendingVideos(region, 10).catch(() => []) : Promise.resolve([]),
    ]);

    if (searches.length === 0 && videos.length === 0) {
      return { text: `Nothing came back for ${region}. The feeds may be unavailable right now.` };
    }

    return {
      text: [
        searches.length ? `Trending searches in ${region}:` : "",
        ...searches
          .slice(0, 10)
          .map((s) => `- ${s.phrase}${s.traffic ? ` (${s.traffic})` : ""}${s.headline ? ` — ${s.headline}` : ""}`),
        videos.length ? `\nMost watched on YouTube in ${region}:` : "",
        ...videos.map((v) => `- ${v.views.toLocaleString()} · ${v.channelTitle} — ${v.title}`),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (name === "who_makes_this") {
    const subject = str(args.subject, 120);
    if (!subject) return { text: "Give me a subject." };
    if (!env.youtube.configured) return { text: "No YouTube key is configured on this deployment." };

    try {
      const channels = await channelsForPhrase(subject, { days: 30 });
      await audit(ctx.viewer, "agent.research.discover", {
        module: "research",
        meta: { subject, found: channels.length },
      });
      if (channels.length === 0) return { text: `Nobody has posted about "${subject}" in the last month.` };

      const watching = new Set((await listCompetitors(ctx.viewer)).map((c) => c.externalId));
      return {
        text: [
          `Who is making videos about "${subject}" (last 30 days, by what those videos earned):`,
          ...channels
            .slice(0, 10)
            .map(
              (c) =>
                `- ${c.title} (id: ${c.id}${c.handle ? `, ${c.handle}` : ""}) — ${c.viewsHere.toLocaleString()} views from ${
                  c.videosHere
                } video${c.videosHere === 1 ? "" : "s"}, ${c.subscribers.toLocaleString()} subscribers${
                  watching.has(c.id) ? " · already watched" : ""
                }`,
            ),
        ].join("\n"),
      };
    } catch (err) {
      return { text: err instanceof Error ? err.message : "YouTube could not be reached." };
    }
  }

  if (name === "watch_channel") {
    const channelId = str(args.channel_id, 64);
    if (!channelId) return { text: "Give me a channel id." };
    if (!env.tikhub.configured) {
      return { text: "No outside-world key is configured, so nobody else's channel can be read." };
    }

    await addCompetitor(ctx.viewer, {
      platform: "youtube",
      externalId: channelId,
      handle: null,
      displayName: str(args.name, 200) || null,
      note: null,
    });
    await enqueue({
      tenantId: ctx.viewer.tenantId,
      type: "social.syncCompetitors",
      module: "research",
      createdBy: ctx.viewer.id,
      dedupeKey: "social.syncCompetitors",
      priority: 5,
    });
    return {
      text: `Watching ${str(args.name, 200) || channelId}. Its numbers appear on the Trends dashboard once they are read.`,
      changed: true,
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const researchPack: ToolPack = { module: "research", defs, run };
