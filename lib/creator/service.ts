import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  captions,
  channels,
  creatorVideos,
  knowledge,
  knowledgeVersions,
  publishPosts,
  publishTargets,
  videoExports,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { servicePrincipalId } from "@/lib/authz/service-principal";
import { channelUploads } from "./youtube";

/**
 * Creator memory.
 *
 * The assistant used to know the studio's documents and nothing about the
 * studio's channel. So a script it wrote sounded like a script, and a cut it
 * designed looked like an edit, and neither sounded like the person whose face
 * is on the videos. This is the fix: every upload on the connected YouTube
 * channels is mirrored (`syncCreatorVideos`), and a model folds them into one
 * short "Creator voice" note (`writeCreatorVoice`) that `assemblePrompt`
 * carries into every turn, on every screen.
 *
 * The note is a `knowledge` row like any the admin writes by hand, so it is
 * visible, editable and switchable in Admin → Knowledge. Automatic does not
 * mean hidden.
 */

export const VOICE_TITLE_PREFIX = "Creator voice · ";

export type CreatorVideoRow = typeof creatorVideos.$inferSelect;

/** The YouTube channels the studio has connected. */
async function youtubeChannels(tenantId: string) {
  return db
    .select({ id: channels.id, platformUserId: channels.platformUserId, name: channels.displayName, username: channels.username })
    .from(channels)
    .where(and(eq(channels.tenantId, tenantId), eq(channels.platform, "youtube"), eq(channels.enabled, true)));
}

/**
 * Mirror the channel.
 *
 * Upserts on the platform's own id, so running it twice is one row per video
 * with fresher numbers, and a transcript already found is kept.
 */
export async function syncCreatorVideos(tenantId: string): Promise<{ channels: number; videos: number; transcripts: number; note?: string }> {
  if (!env.youtube.configured) return { channels: 0, videos: 0, transcripts: 0, note: "YOUTUBE_API_KEY is not set" };

  const list = await youtubeChannels(tenantId);
  if (!list.length) return { channels: 0, videos: 0, transcripts: 0, note: "no YouTube channel is connected" };

  let videos = 0;
  for (const ch of list) {
    if (!ch.platformUserId) continue;
    const uploads = await channelUploads(ch.platformUserId);
    for (const v of uploads) {
      const values = {
        tenantId,
        channelId: ch.id,
        platform: "youtube",
        externalId: v.externalId,
        title: v.title.slice(0, 300),
        description: v.description.slice(0, 5000),
        tags: v.tags,
        durationSec: v.durationSec,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        thumbnailUrl: v.thumbnailUrl,
        publishedAt: v.publishedAt,
        syncedAt: new Date(),
      };
      await db
        .insert(creatorVideos)
        .values({ id: newId("cv"), ...values })
        .onConflictDoUpdate({
          target: [creatorVideos.tenantId, creatorVideos.platform, creatorVideos.externalId],
          set: values,
        });
      videos++;
    }
  }

  const transcripts = await attachTranscripts(tenantId);
  return { channels: list.length, videos, transcripts };
}

/**
 * Transcripts for the videos that were cut here.
 *
 * A post published through this product points at the export it sent, the
 * export points at the project, and the project's captions are a transcript
 * with real timings. That is the only honest source this deployment has: the
 * platform's caption download needs an OAuth grant the product does not hold.
 */
async function attachTranscripts(tenantId: string): Promise<number> {
  const rows = await db
    .select({
      videoId: creatorVideos.id,
      externalId: creatorVideos.externalId,
      projectId: videoExports.projectId,
    })
    .from(creatorVideos)
    .innerJoin(publishTargets, eq(publishTargets.platformPostId, creatorVideos.externalId))
    .innerJoin(publishPosts, eq(publishPosts.id, publishTargets.postId))
    .innerJoin(videoExports, eq(videoExports.fileId, publishPosts.fileId))
    .where(and(eq(creatorVideos.tenantId, tenantId), sql`${creatorVideos.transcript} is null`));

  let n = 0;
  for (const r of rows) {
    const cues = await db
      .select({ text: captions.text, language: captions.language })
      .from(captions)
      .where(eq(captions.projectId, r.projectId))
      .orderBy(asc(captions.startMs));
    if (!cues.length) continue;
    const language = cues[0].language;
    const text = cues
      .filter((c) => c.language === language)
      .map((c) => c.text)
      .join(/^zh/.test(language) ? "" : " ")
      .slice(0, 60_000);
    await db
      .update(creatorVideos)
      .set({ transcript: text, transcriptSource: "captions" })
      .where(eq(creatorVideos.id, r.videoId));
    n++;
  }
  return n;
}

/** Somebody has the words: a transcript pasted or uploaded by hand. */
export async function setTranscript(tenantId: string, videoId: string, text: string) {
  await db
    .update(creatorVideos)
    .set({ transcript: text.slice(0, 60_000), transcriptSource: "upload" })
    .where(and(eq(creatorVideos.id, videoId), eq(creatorVideos.tenantId, tenantId)));
}

export async function listCreatorVideos(
  tenantId: string,
  opts: { query?: string; sort?: "views" | "recent"; limit?: number } = {},
): Promise<CreatorVideoRow[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 40));
  const q = opts.query?.trim();
  return db
    .select()
    .from(creatorVideos)
    .where(
      and(
        eq(creatorVideos.tenantId, tenantId),
        q ? sql`(${creatorVideos.title} ilike ${`%${q}%`} or ${creatorVideos.description} ilike ${`%${q}%`} or ${q} = any(${creatorVideos.tags}))` : undefined,
      ),
    )
    .orderBy(opts.sort === "recent" ? desc(creatorVideos.publishedAt) : desc(creatorVideos.views))
    .limit(limit);
}

export async function creatorVideoById(tenantId: string, id: string): Promise<CreatorVideoRow | null> {
  const [row] = await db
    .select()
    .from(creatorVideos)
    .where(and(eq(creatorVideos.tenantId, tenantId), eq(creatorVideos.id, id)))
    .limit(1);
  return row ?? null;
}

export type CreatorMemoryState = {
  channels: { id: string; name: string; username: string | null }[];
  videos: number;
  transcripts: number;
  totalViews: number;
  lastSyncedAt: Date | null;
  top: { id: string; externalId: string; title: string; views: number; durationSec: number | null; publishedAt: Date | null; thumbnailUrl: string | null }[];
  voice: { id: string; title: string; version: number; active: boolean; updatedAt: Date; body: string } | null;
};

/** What the Research screen shows about the channel as memory. */
export async function creatorMemoryState(tenantId: string): Promise<CreatorMemoryState> {
  const [list, [agg], top, voice] = await Promise.all([
    youtubeChannels(tenantId),
    db
      .select({
        n: sql<number>`count(*)::int`,
        transcripts: sql<number>`count(${creatorVideos.transcript})::int`,
        views: sql<number>`coalesce(sum(${creatorVideos.views}),0)::bigint`,
        last: sql<Date | null>`max(${creatorVideos.syncedAt})`,
      })
      .from(creatorVideos)
      .where(eq(creatorVideos.tenantId, tenantId)),
    db
      .select({
        id: creatorVideos.id,
        externalId: creatorVideos.externalId,
        title: creatorVideos.title,
        views: creatorVideos.views,
        durationSec: creatorVideos.durationSec,
        publishedAt: creatorVideos.publishedAt,
        thumbnailUrl: creatorVideos.thumbnailUrl,
      })
      .from(creatorVideos)
      .where(eq(creatorVideos.tenantId, tenantId))
      .orderBy(desc(creatorVideos.views))
      .limit(6),
    voiceRow(tenantId),
  ]);

  return {
    channels: list.map((c) => ({ id: c.id, name: c.name ?? c.username ?? "YouTube", username: c.username })),
    videos: Number(agg?.n ?? 0),
    transcripts: Number(agg?.transcripts ?? 0),
    totalViews: Number(agg?.views ?? 0),
    lastSyncedAt: agg?.last ? new Date(agg.last as unknown as string) : null,
    top,
    voice: voice
      ? { id: voice.id, title: voice.title, version: voice.version, active: voice.active, updatedAt: voice.updatedAt, body: voice.body }
      : null,
  };
}

async function voiceRow(tenantId: string) {
  const [row] = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.tenantId, tenantId), sql`${knowledge.title} like ${VOICE_TITLE_PREFIX + "%"}`))
    .orderBy(desc(knowledge.updatedAt))
    .limit(1);
  return row ?? null;
}

/** The creator voice note as text, for prompts assembled outside the agent. */
export async function creatorVoiceText(tenantId: string): Promise<string> {
  const row = await voiceRow(tenantId);
  return row && row.active ? row.body : "";
}

const VOICE_PROMPT = `You are writing a style memory for an AI assistant that writes scripts and cuts videos for a creator's YouTube channel.

You are given the channel's uploads: titles, lengths, view counts, descriptions, tags, and where available the spoken transcript. Read them the way an editor who has worked with this creator for a year would, and write down what makes their videos theirs.

Answer with a single JSON object and nothing else. The first character of your answer must be an opening brace.

{
  "voice": "3-5 sentences on how the creator speaks and to whom: register, language mix, pace, humour, what they never do",
  "formats": ["the recurring video formats, each under 12 words, with typical length"],
  "titles": ["4-6 rules the titles follow, each under 14 words, with one real example each"],
  "hooks": ["3-5 ways their videos open, each under 16 words"],
  "structure": "2-3 sentences on how a typical video is built: sections, pacing, where numbers and examples land",
  "topics": ["the subjects they keep returning to, each under 8 words"],
  "works": ["3-5 things the best-performing videos have in common, each under 16 words, citing the numbers"],
  "avoid": ["3-5 things the creator does not do, each under 12 words"]
}

Rules:
 - Everything must be grounded in the uploads you were given. Quote real titles. Do not invent a fact, a number or a habit.
 - Write in the language the channel publishes in. If the titles are Chinese, write in Chinese, keeping proper nouns as they appear.
 - Be specific and short. This goes in front of every prompt, so every sentence has to earn its place.`;

/**
 * Fold the channel into one note the prompt carries.
 *
 * Charged to the service principal, because this is scheduled work; the
 * Admin token screen shows it as such rather than as a person's spend.
 */
export async function writeCreatorVoice(tenantId: string): Promise<{ ok: true; title: string; version: number } | { ok: false; error: string }> {
  const list = await youtubeChannels(tenantId);
  const rows = await db
    .select()
    .from(creatorVideos)
    .where(eq(creatorVideos.tenantId, tenantId))
    .orderBy(desc(creatorVideos.views))
    .limit(60);
  if (rows.length < 3) return { ok: false, error: "Fewer than three videos are synced, which is not enough to say anything true about the channel." };

  const recent = [...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).slice(0, 15);
  const chosen = new Map<string, CreatorVideoRow>();
  for (const r of [...rows.slice(0, 30), ...recent]) chosen.set(r.id, r);

  const lines = [...chosen.values()].map((v, i) => {
    const mins = v.durationSec ? `${Math.round(v.durationSec / 60)} min` : "?";
    const head = `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views, ${mins}, ${v.publishedAt?.toISOString().slice(0, 10) ?? "?"}`;
    const desc = v.description.replace(/\s+/g, " ").slice(0, 260);
    const tags = v.tags.length ? ` tags: ${v.tags.slice(0, 8).join(", ")}` : "";
    const words = v.transcript ? `\n   opening words: ${v.transcript.replace(/\s+/g, " ").slice(0, 400)}` : "";
    return `${head}\n   ${desc}${tags}${words}`;
  });

  const channelName = list[0]?.name ?? list[0]?.username ?? "the channel";
  const out = await complete({
    model: modelFor.assistant(),
    temperature: 0.3,
    maxTokens: 2600,
    messages: [
      { role: "system", content: VOICE_PROMPT },
      { role: "user", content: `Channel: ${channelName}\nUploads (${rows.length} synced, the best and the latest shown):\n\n${lines.join("\n")}` },
    ],
  });

  const actor = await servicePrincipalId(tenantId);
  await recordUsage({
    viewer: { id: actor, tenantId },
    module: "research",
    provider: out.provider ?? "openrouter",
    model: out.model,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    costMicros: out.costMicros,
    requestId: out.requestId,
  });

  const parsed = parseVoice(out.text);
  if (!parsed) return { ok: false, error: "The model did not answer in a shape we could read." };

  const body = renderVoice(parsed, { channel: channelName, videos: rows.length });
  const title = `${VOICE_TITLE_PREFIX}${channelName}`.slice(0, 200);
  const existing = await voiceRow(tenantId);

  if (existing) {
    const version = existing.version + 1;
    await db
      .update(knowledge)
      .set({ title, body, version, updatedAt: new Date(), updatedBy: actor })
      .where(eq(knowledge.id, existing.id));
    await db.insert(knowledgeVersions).values({
      id: newId("kn"),
      knowledgeId: existing.id,
      version,
      body,
      note: `rewritten from ${rows.length} uploads`,
      authorId: actor,
    });
    return { ok: true, title, version };
  }

  const id = newId("kn");
  await db.insert(knowledge).values({
    id,
    tenantId,
    kind: "style",
    scope: "tenant",
    title,
    body,
    version: 1,
    active: true,
    updatedBy: actor,
  });
  await db.insert(knowledgeVersions).values({
    id: newId("kn"),
    knowledgeId: id,
    version: 1,
    body,
    note: `written from ${rows.length} uploads`,
    authorId: actor,
  });
  return { ok: true, title, version: 1 };
}

type Voice = {
  voice: string;
  formats: string[];
  titles: string[];
  hooks: string[];
  structure: string;
  topics: string[];
  works: string[];
  avoid: string[];
};

function parseVoice(text: string): Voice | null {
  const body = text.replace(/<\/?think(?:ing)?>/gi, "\n");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  const src = fenced ? fenced[1] : body;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(src.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const list = (v: unknown, max = 8) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim().slice(0, 240)).slice(0, max) : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 1200) : "");
  const out: Voice = {
    voice: str(raw.voice),
    formats: list(raw.formats),
    titles: list(raw.titles),
    hooks: list(raw.hooks),
    structure: str(raw.structure),
    topics: list(raw.topics, 12),
    works: list(raw.works),
    avoid: list(raw.avoid),
  };
  return out.voice || out.titles.length ? out : null;
}

function renderVoice(v: Voice, meta: { channel: string; videos: number }): string {
  const section = (title: string, items: string[]) => (items.length ? `## ${title}\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
  return [
    `_Written automatically from ${meta.videos} uploads on ${meta.channel}, ${new Date().toISOString().slice(0, 10)}. Edit it, or switch it off, in Admin → Knowledge. It is rewritten when the channel is re-synced._`,
    "",
    v.voice ? `## Voice\n${v.voice}\n` : "",
    section("Formats", v.formats),
    section("Titles", v.titles),
    section("How videos open", v.hooks),
    v.structure ? `## Structure\n${v.structure}\n` : "",
    section("Subjects", v.topics),
    section("What the best ones share", v.works),
    section("Never", v.avoid),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Sync, then rewrite the voice. The one job the scheduler and the button run. */
export async function refreshCreatorMemory(tenantId: string) {
  const synced = await syncCreatorVideos(tenantId);
  if (synced.videos === 0) return { ...synced, voice: null as null | string };
  const voice = await writeCreatorVoice(tenantId);
  return { ...synced, voice: voice.ok ? `${voice.title} v${voice.version}` : voice.error };
}
