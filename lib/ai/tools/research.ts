import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { seriesCache, topics } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { env } from "@/lib/env";
import type { ToolDef } from "@/lib/ai/openrouter";
import { createTopic, decide, moveTopicStage, planTopic, rankedTopics } from "@/lib/research/service";
import { suggestAngles } from "@/lib/research/angles";
import { trendingSearches } from "@/lib/research/trending";
import { channelsForPhrase, trendingVideos } from "@/lib/research/youtube";
import { storedAll } from "@/lib/research/platforms";
import { PLATFORMS, isPlatformKey, onFocus, relevanceLabel, type Beat, type BeatTab } from "@/lib/research/platform-catalog";
import { readBeats } from "@/lib/research/beat-store";
import { googleNewsSearch } from "@/lib/research/beat-sources";
import { searchPlatform } from "@/lib/research/platform-search";
import { BEAT_TABS, acrossPlatforms, feedOfTab, tabRows, type BeatRow, type Lists } from "@/lib/research/beat-view";
import { addCompetitor, listCompetitors } from "@/lib/social/service";
import { colleagueRefusal, findColleague, personOf } from "./people";
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
/** The Research tab a list belongs to: a feed's own, or the feed whose
 *  platform a chart is on. */
function tabOf(from: string): BeatTab {
  for (const t of BEAT_TABS) {
    const f = feedOfTab(t);
    if (f.key === from || (f.hot as readonly string[]).includes(from)) return t;
  }
  return "news";
}

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
        "Add a phrase to the studio's tracking list (numbers land on the Trends dashboard later). Only when someone asks to track something, or as an extra AFTER you have answered — never instead of answering; to learn about a subject now, use search_now.",
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
      name: "search_now",
      description:
        "Research any subject right now, live: the latest news headlines about it (Chinese and English, with outlet and date) and the top videos about it on YouTube and 抖音 (with views and creators). " +
        "Call this FIRST whenever someone asks what you think about, what is happening with, or what the future is of anything — a coin, a company, a technology, a person, an event. " +
        "Takes a few seconds. Search in the language the subject is best known in; you may call it twice (e.g. English name, then Chinese name).",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The subject, as people would search it: \"Arc chain\", \"Circle Arc blockchain\", \"后量子钱包\"." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "trending_now",
      description:
        "What is doing well right now on the studio's beats (by default AI, crypto, tech, business; the studio can add its own on the Research page), platform by platform: 抖音, 小红书, 微博, B站, YouTube, TikTok, Hong Kong/Taiwan news and the crypto market. " +
        "Each platform is searched for the beats every three hours and its best recent posts kept with their numbers (plays, likes, comments, followers); rows also on the platform's own chart are marked 上榜. " +
        "Reads stored lists: free and instant. beat= narrows to one beat. all=true reads the platforms' raw hourly charts instead, every row. " +
        "A region other than HK reads Google and YouTube for that market live instead, unfiltered.",
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            description:
              "One platform only: douyin, xiaohongshu, weibo, bilibili, youtube, tiktok, news or crypto (the coin market). With all=true, a raw chart: google, youtube, dy_breakout, dy_finance, dy_tech, dy_rising, douyin, weibo, bilibili, xiaohongshu or tiktok. Default every platform.",
          },
          beat: {
            type: "string",
            description: "One beat only, by its key: ai, crypto, tech, biz, or a key the studio added (the answer lists the studio's beats with their keys). Default every beat the studio follows.",
          },
          all: { type: "boolean", description: "The platforms' raw hourly charts, every row including entertainment and sport. Default false." },
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
        "Which YouTube channels are making videos about a subject, ranked by what those videos actually earned in the last 30 days. Use it to find competitors worth watching. Give it TWO OR THREE WORDS, not a sentence: \"\u9999\u6e2f Web3\" or \"Hong Kong startups\", never \"\u9999\u6e2f Web3 AI \u521b\u4e1a\u6295\u8d44\". Ask once per subject; each call costs 100 of the day's 10,000 YouTube units.",
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
  if (name === "move_topic_stage" || name === "plan_topic") return runPlanning(ctx, name, args);
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
      artifacts: [{ kind: "topic", id: topic.id, title: topic.name, action: "created" }],
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
      artifacts: [{ kind: "topic", id: topic.id, title: topic.name, action: "updated" }],
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
      artifacts: [{ kind: "topic", id: topic.id, title: topic.name, action: "updated" }],
    };
  }

  if (name === "search_now") {
    const q = str(args.query, 120).trim();
    if (!q) return { text: "Say what to search for." };
    /* Each source alone, under its own deadline: one slow or failing source
       never costs the answer the others found. */
    const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    const [zhNews, enNews, yt, dy] = await Promise.all([
      within(googleNewsSearch(q, "HK", 12), 15_000),
      within(googleNewsSearch(q, "US", 12), 15_000),
      within(searchPlatform("youtube", q), 20_000),
      within(searchPlatform("douyin", q), 20_000),
    ]);
    const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
    const lines: string[] = [];
    const news = [...(enNews ?? []), ...(zhNews ?? [])].slice(0, 14);
    if (news.length) {
      lines.push(`News about "${q}" (newest first as Google returns them):`);
      for (const n of news) lines.push(`- ${day(n.stats?.publishedAt)} · ${n.extra ?? "news"} — ${n.phrase}${n.url ? ` (${n.url})` : ""}`);
    }
    for (const [label, res] of [["YouTube", yt], ["抖音", dy]] as const) {
      const rows = res?.rows?.slice(0, 6) ?? [];
      if (!rows.length) continue;
      lines.push(`${label} 上关于「${q}」的视频：`);
      for (const r of rows) lines.push(`- ${r.phrase}${r.extra ? ` · ${r.extra}` : ""}${r.heatLabel ? ` · ${r.heatLabel}` : r.stats?.views != null ? ` · ${r.stats.views.toLocaleString("en-US")} views` : ""}${r.url ? ` (${r.url})` : ""}`);
    }
    if (!lines.length) return { text: `Nothing came back for "${q}" from news, YouTube or 抖音 just now. Try another name for it (English / Chinese / the project's full name), then answer from what you know, saying it is background.` };
    return { text: lines.join("\n") };
  }

  if (name === "trending_now") {
    const region = str(args.region, 2).toUpperCase() || "HK";
    /*
     * Hong Kong is what the collector stores, marked business / tech / other
     * row by row, so the agent reads the same focused lists the Research
     * page shows instead of Google's and YouTube's whole charts, which were
     * music videos, football and lotteries. Other markets are not collected
     * and keep the live read below.
     */
    if (region === "HK") {
      const everything = args.all === true || args.all === "true";
      const only = str(args.platform, 20);
      /* The studio's own beats (Research → 管理赛道): beat= takes any key
         switched on there, and rows under a beat it switched off are left
         out, as on the page. */
      const beats = (await readBeats(ctx.viewer.tenantId)).filter((b) => b.enabled);
      const keys = beats.map((b) => b.key);
      const asked = str(args.beat, 20).trim().toLowerCase();
      const beat: Beat | null = beats.find((b) => b.key === asked || b.zh === asked || b.en.toLowerCase() === asked)?.key ?? null;
      const beatName = (k: Beat) => beats.find((b) => b.key === k)?.zh ?? k;
      const beatNameEn = (k: Beat) => beats.find((b) => b.key === k)?.en ?? k;
      const stored = await storedAll();
      const lists = stored as Lists;
      const views = (x: BeatRow) => {
        const st = x.stats ?? {};
        if (st.change24h != null) return `${st.price != null ? `$${st.price >= 1 ? Math.round(st.price).toLocaleString("en-US") : st.price.toPrecision(3)} · ` : ""}24h ${st.change24h >= 0 ? "+" : ""}${st.change24h.toFixed(1)}%`;
        const bits = [
          st.views != null ? `${st.views.toLocaleString("en-US")} views` : st.likes != null ? `${st.likes.toLocaleString("en-US")} likes` : (x.heatLabel ?? (x.heat != null ? `heat ${x.heat.toLocaleString("en-US")}` : "")),
          st.views != null && st.likes != null ? `${st.likes.toLocaleString("en-US")} likes` : "",
          st.comments != null ? `${st.comments.toLocaleString("en-US")} comments` : "",
          st.fans != null ? `account ${st.fans.toLocaleString("en-US")} followers` : "",
          st.publishedAt ? `posted ${Math.max(1, Math.round((Date.now() - Date.parse(st.publishedAt)) / 3_600_000))}h ago` : "",
        ];
        return bits.filter(Boolean).join(" · ");
      };
      const line = (x: BeatRow, n: number) => {
        const where = x.chart ? `上榜 ${PLATFORMS.find((p) => p.key === x.chart!.list)?.zh ?? x.chart.list} #${x.chart.rank}${x.feedRank ? `, beats #${x.feedRank}` : ""}` : `#${n}`;
        const tag = x.mark && x.mark.t !== "other" ? ` [${relevanceLabel(x.mark, true, beats)}]` : x.beat ? ` [${beatName(x.beat)}]` : "";
        const nums = views(x);
        const link = x.url && !/\/search|[?&]q=|keyword=/.test(x.url) ? ` · ${x.url}` : "";
        return `- ${where} ${x.phrase.replace(/\s+/g, " ").slice(0, 90)}${tag}${x.extra ? ` (${x.extra.slice(0, 30)})` : ""}${nums ? ` · ${nums}` : ""}${link}`;
      };

      /* The raw charts, as the platforms ranked them: the old reading, for
         when the chart itself is the question. */
      if (everything) {
        const keys = isPlatformKey(only) ? [only] : PLATFORMS.filter((p) => !p.unavailable).map((p) => p.key);
        const out: string[] = [];
        for (const key of keys) {
          const hot = stored[key];
          if (!hot?.rows.length) continue;
          const meta = PLATFORMS.find((p) => p.key === key)!;
          out.push(`\n${meta.zh} (${meta.label}) chart, stored ${Math.max(1, Math.round((Date.now() - hot.fetchedAt) / 60_000))} min ago:`);
          hot.rows.slice(0, 15).forEach((r, i) => {
            const mark = hot.relevance?.[r.phrase] ?? null;
            out.push(`- #${i + 1} ${r.phrase.replace(/\s+/g, " ").slice(0, 90)}${mark && onFocus(mark, 1) ? ` [${relevanceLabel(mark, true, beats)}]` : ""}${r.stats?.views != null ? ` · ${r.stats.views.toLocaleString("en-US")} views` : r.heatLabel ? ` · ${r.heatLabel}` : r.heat != null ? ` · heat ${r.heat.toLocaleString("en-US")}` : ""}`);
          });
        }
        return { text: out.length ? ["The platforms' own charts, every row (the # is the rank on that chart):", ...out].join("\n") : "No stored charts yet; the hourly collector has not run." };
      }

      /* The beats, platform by platform: each tab's 上榜 rows, then its feed. */
      const tabs: BeatTab[] = (BEAT_TABS as readonly string[]).includes(only) ? [only as BeatTab] : [...BEAT_TABS];
      const out: string[] = [];
      if (tabs.length > 1) {
        const top = acrossPlatforms(lists, { beat, limit: 12, beats: keys });
        const allLine = stored.beat_all?.summary;
        if (top.length) {
          out.push(`\nAcross platforms${beat ? ` (${beatNameEn(beat)})` : ""}${allLine ? `. Researcher: ${allLine}` : ""}`);
          // Each with its platform, and its rank in that platform's feed.
          top.forEach((x) => out.push(`- ${feedOfTab(tabOf(x.from)).zh} ${line(x, x.feedRank ?? x.rank).slice(2)}`));
        }
      }
      for (const tab of tabs) {
        const { charted, feed } = tabRows(tab, lists, { beat, chartCap: 5, beats: keys });
        const rows = [...charted, ...feed].slice(0, tabs.length > 1 ? 8 : 25);
        if (!rows.length) continue;
        const meta = feedOfTab(tab);
        const f = stored[meta.key];
        const age = f ? Math.max(1, Math.round((Date.now() - f.fetchedAt) / 60_000)) : null;
        out.push(`\n${meta.zh} (${meta.label})${age ? `, collected ${age} min ago` : ""}${f?.summary ? `. Researcher: ${f.summary}` : ""}`);
        rows.forEach((x) => out.push(line(x, x.feedRank ?? x.rank)));
      }
      if (!out.length) {
        return {
          text: beat
            ? `Nothing stored on the ${beatNameEn(beat)} beat${tabs.length === 1 ? ` for ${feedOfTab(tabs[0]).zh}` : ""} right now (a beat just added fills at the next collection, every three hours). Try without beat=, or all=true for the raw charts.`
            : "No beat feeds stored yet (they are collected every three hours); all=true reads the platforms' raw charts.",
        };
      }
      return {
        text: [
          `What is doing well on the studio's beats (${beats.map((b) => `${b.key} = ${b.zh}${b.en !== b.zh ? ` / ${b.en}` : ""}`).join(", ")}${asked && !beat ? `; "${asked}" is not one of them, so every beat is shown` : ""}). # is the rank in that platform's beat feed (ranked by engagement and recency); 上榜 rows are also on the platform's own chart, with that rank.`,
          ...out,
        ].join("\n"),
      };
    }

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
      const found = await channelsForPhrase(subject, { days: 30 });
      const channels = found.channels;
      await audit(ctx.viewer, "agent.research.discover", {
        module: "research",
        meta: { subject, query: found.query, days: found.days, found: channels.length },
      });
      if (channels.length === 0) {
        return {
          text:
            `Nobody has posted about "${subject}" in the last ${found.days} days. ` +
            `I also tried shorter versions of it. Try two or three words rather than a sentence — ` +
            `"香港 Web3" finds channels where "香港 Web3 AI 创业投资" finds none.`,
        };
      }

      const widened =
        found.query !== subject.trim() || found.days !== 30
          ? ` (nothing came back for "${subject}", so this is "${found.query}" over ${found.days} days)`
          : "";

      const watching = new Set((await listCompetitors(ctx.viewer)).map((c) => c.externalId));
      return {
        text: [
          `Who is making videos about "${found.query}" (last ${found.days} days, by what those videos earned)${widened}:`,
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

    /* Asked first, because adding one already watched does nothing and
       still hands back a fresh id: a receipt for that would name a
       competitor that does not exist. */
    const already = (await listCompetitors(ctx.viewer)).some((c) => c.platform === "youtube" && c.externalId === channelId);
    const competitorId = await addCompetitor(ctx.viewer, {
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
      text: already
        ? `The studio already watches ${str(args.name, 200) || channelId}; nothing was added. Its numbers are on the Trends dashboard.`
        : `Watching ${str(args.name, 200) || channelId}. Its numbers appear on the Trends dashboard once they are read.`,
      changed: !already,
      ...(already ? {} : { artifacts: [{ kind: "competitor" as const, id: competitorId, title: str(args.name, 200) || channelId, action: "created" as const }] }),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

/* ------------------------------------------------------------ the backlog */

/**
 * The backlog board, by conversation: a card moved along its lanes, and the
 * fields an adopted topic needs before Script picks it up (who owns it, the
 * channel it is for, when it is due).
 *
 * Done as the person when there is one, through the same checks the board's
 * own actions make: the topic must be this studio's (`ownTopic`), the owner
 * a colleague in this studio, the stage one of the board's four lanes.
 */
const STAGES = ["adopted", "briefing", "scripting", "handed"] as const;
type Stage = (typeof STAGES)[number];

const planningDefs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "move_topic_stage",
      description:
        "Move a backlog topic to another lane of the backlog board. The lanes, in order: adopted (已采用, just taken into the backlog), briefing (写简报, the brief is being written), scripting (写脚本, the script is being written), handed (已交接, handed to production). Use list_topics or read_topic to find the topic.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The topic's id, or its words. Optional: the topic open on screen." },
          stage: { type: "string", enum: [...STAGES] },
        },
        required: ["stage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_topic",
      description:
        "Set a backlog topic's plan: who owns it (a colleague, by name or email), the channel it is meant for, and the due date. Only the fields given are changed.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The topic's id, or its words. Optional: the topic open on screen." },
          owner: { type: "string", description: "The colleague who owns it: name or email. Optional." },
          target_channel: { type: "string", description: "The channel or platform it is for, e.g. 视频号 or YouTube. Optional." },
          due_date: { type: "string", description: "YYYY-MM-DD. Optional." },
        },
        required: [],
      },
    },
  },
];

/** A topic of this studio, by id, by words, or the one on screen (ownTopic's test, then findTopic's). */
async function topicFor(ctx: ToolContext, raw: string) {
  const ref = raw || ctx.topicId || "";
  if (!ref) return null;
  if (/^top_[0-9a-z]{20,32}$/i.test(ref)) {
    const [row] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, ref.toLowerCase()), eq(topics.tenantId, ctx.viewer.tenantId)))
      .limit(1);
    return row ?? null;
  }
  return findTopic(ctx, ref);
}

async function runPlanning(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (ctx.readOnly) return { text: "This turn may only look things up; nothing was changed." };
  /* As the person when there is one, and only if they hold Research (the
     board's actions refuse anybody else); otherwise as the speaker. */
  const person = personOf(ctx);
  if (person && !person.modules.includes("research")) {
    return { text: "The person asking does not have the Research module, so the backlog cannot be changed for them. Nothing was changed." };
  }
  const actor = person ?? ctx.viewer;
  const topic = await topicFor(ctx, str(args.topic ?? args.phrase, 200));
  if (!topic || topic.tenantId !== actor.tenantId) return { text: "No such topic in this studio. Use list_topics to find it; nothing was changed." };

  if (name === "move_topic_stage") {
    const stage = str(args.stage, 20) as Stage;
    if (!STAGES.includes(stage)) return { text: `The stage has to be one of: ${STAGES.join(", ")}. Nothing was changed.` };
    if (topic.stage === stage) return { text: `"${topic.name}" is already in ${stage}.` };
    await moveTopicStage(actor, topic.id, stage);
    return {
      text: `Moved "${topic.name}" from ${topic.stage} to ${stage}.${topic.status !== "adopted" ? " (It is not adopted into the backlog yet, so the board does not show it until it is.)" : ""}`,
      changed: true,
      artifacts: [{ kind: "topic", id: topic.id, title: topic.name, action: "updated" }],
    };
  }

  if (name === "plan_topic") {
    const input: { ownerId?: string | null; targetChannel?: string | null; dueDate?: string | null } = {};
    const said: string[] = [];
    const ownerRaw = str(args.owner, 320);
    if (ownerRaw) {
      /* planAction's test: a colleague in this studio, never an account elsewhere. */
      const who = await findColleague(actor, ownerRaw);
      if (!("one" in who)) return { text: colleagueRefusal(ownerRaw, who) };
      input.ownerId = who.one.id;
      said.push(`owner ${who.one.name}`);
    }
    const channel = typeof args.target_channel === "string" ? args.target_channel.trim() : "";
    if (channel) {
      if (channel.length > 120) return { text: "That channel name is too long. Nothing was changed." };
      input.targetChannel = channel;
      said.push(`channel ${channel}`);
    }
    const due = str(args.due_date, 20);
    if (due) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) return { text: "A due date looks like 2026-10-30. Nothing was changed." };
      input.dueDate = due;
      said.push(`due ${due}`);
    }
    if (!said.length) return { text: "Say what to set: the owner, the channel or the due date." };
    await planTopic(actor, topic.id, input);
    return {
      text: `Planned "${topic.name}": ${said.join(", ")}.`,
      changed: true,
      artifacts: [{ kind: "topic", id: topic.id, title: topic.name, action: "updated" }],
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const researchPack: ToolPack = { module: "research", defs: [...defs, ...planningDefs], run };
