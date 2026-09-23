import "server-only";
import { env } from "@/lib/env";

/**
 * TikHub — everybody else's accounts, read only.
 *
 * The division of labour with `zernio.ts` is deliberate and worth stating,
 * because getting it wrong would be a privacy problem rather than a bug:
 *
 *   Zernio  → our own channels. Authorised by the studio. Reads *and* writes.
 *   TikHub  → public numbers on anyone's channel. Reads, and only reads.
 *
 * So competitor research comes from here, and nothing that touches the
 * studio's own accounts ever does. There is no write surface in this file and
 * there should never be one.
 *
 * TikHub bills per request and every response is explicit about it
 * ("This request will incur a charge"), so callers are jobs, results are
 * cached, and a screen never reaches this module directly.
 */

export class TikHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TikHubError";
  }
}

export class TikHubUnconfigured extends Error {
  constructor() {
    super("No TIKHUB_TOKEN is set, so outside-platform research is unavailable.");
    this.name = "TikHubUnconfigured";
  }
}

const TIMEOUT_MS = Number(process.env.TIKHUB_TIMEOUT_MS ?? 30_000);

type Query = Record<string, string | number | boolean | undefined | null>;

async function get<T>(path: string, query: Query = {}): Promise<T> {
  if (!env.tikhub.configured) throw new TikHubUnconfigured();

  const url = new URL(env.tikhub.baseUrl + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${env.tikhub.token}`, accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? `did not answer within ${TIMEOUT_MS}ms` : String(err);
    throw new TikHubError(`TikHub GET ${path} ${why}`, 0);
  }

  const text = await res.text();
  let parsed: { code?: number; data?: unknown; detail?: unknown };
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new TikHubError(`TikHub GET ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  // TikHub answers 200 with a non-200 `code` for application-level failures,
  // so the HTTP status alone is not the outcome.
  if (!res.ok || (parsed.code !== undefined && parsed.code !== 200)) {
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail ?? {}).slice(0, 200);
    throw new TikHubError(`TikHub GET ${path} failed (${res.status}/${parsed.code ?? "?"}): ${detail}`, res.status);
  }

  return (parsed.data ?? parsed) as T;
}

/** Whoever the key belongs to, and what it is allowed to reach. Used by the
 * Admin "channels & credentials" screen to show a key's state without ever
 * showing the key. */
export const keyInfo = () =>
  get<never>("/api/v1/tikhub/user/get_user_info").catch((err) => {
    throw err;
  });

// ------------------------------------------------------------------ YouTube

export type TikHubYouTubeVideo = {
  video_id: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  duration?: string | null;
  published_time?: string | null;
  view_count?: string | null;
  short_view_count?: string | null;
};

export const youtubeChannelVideos = (channelId: string) =>
  get<{ videos?: TikHubYouTubeVideo[] }>("/api/v1/youtube/web_v2/get_channel_videos", { channel_id: channelId });

/**
 * A handle or a URL into the channel id everything else needs.
 *
 * `get_channel_videos` takes a `UC…` id and returns an empty list for anything
 * else — no error, just nothing, which is the worst way for this to fail. So a
 * competitor entered as `@handle` or as a URL is resolved here first, and
 * `UC…` is passed straight through rather than spending a metered request on
 * something that is already an id.
 */
export async function resolveYouTubeChannel(input: string): Promise<string | null> {
  const value = input.trim();
  if (/^UC[\w-]{20,}$/.test(value)) return value;

  const url = value.startsWith("http")
    ? value
    : `https://www.youtube.com/${value.startsWith("@") ? value : `@${value}`}`;

  const res = await get<{ channel_id?: string | null }>("/api/v1/youtube/web_v2/get_channel_id", {
    channel_url: url,
  });
  return res.channel_id ?? null;
}
