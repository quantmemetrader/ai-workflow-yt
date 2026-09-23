import "server-only";

/**
 * Every secret the server reads, validated once at module load so a missing
 * key fails at boot with a readable message instead of at 3am inside a
 * request. Nothing here is ever sent to the client: this module is
 * server-only, and the Admin screens show key *references*, never values
 * (spec §8).
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

export const env = {
  databaseUrl: req("DATABASE_URL"),

  r2: {
    accountId: req("R2_ACCOUNT_ID"),
    bucket: req("R2_BUCKET"),
    accessKeyId: req("R2_ACCESS_KEY_ID"),
    secretAccessKey: req("R2_SECRET_ACCESS_KEY"),
    endpoint: opt("R2_ENDPOINT", `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`),
  },

  openrouter: {
    apiKey: req("OPENROUTER_API_KEY"),
    /** Used only if the primary key is rate-limited or out of credit. */
    backupKey: opt("OPENROUTER_API_KEY_BACKUP"),
    baseUrl: opt("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
  },

  /** Signs one-time links. Deliberately has no fallback: it used to fall back
   * to DATABASE_URL, which makes the database password double as a signing key,
   * so one leak becomes two. Read lazily rather than at module load so an
   * install that never signs anything still boots; the first caller that needs
   * it gets a readable error instead of a silently wrong secret. */
  get sessionSecret(): string {
    return req("SESSION_SECRET");
  },

  /**
   * The studio's own social accounts: read *and* write.
   *
   * Zernio (formerly getlate.dev) holds the OAuth grants the studio gave it —
   * YouTube with `youtube.force-ssl`, LinkedIn, and whatever else gets
   * connected — so this is the only credential we need in order to read
   * comments on our own posts, reply to them, hide them, and publish.
   *
   * Optional: without it the Comment inbox, Content performance and Publish
   * say plainly that no channel is connected rather than crashing the app.
   */
  /**
   * Which backend turns speech into text. Voice-over is not affected by this
   * and is always ElevenLabs.
   *
   *   local       the venv at /opt/whisper, and only that. A failure fails the
   *               job. This is the default.
   *   auto        local first, ElevenLabs if local fails.
   *   elevenlabs  ElevenLabs only — how it worked before local existed.
   *
   * `local` by default on purpose. ElevenLabs refuses this box's IP, so its
   * traffic only leaves through an SSH tunnel to the old host, and the account
   * is a free tier. A quiet fallback would go on spending that quota with
   * nobody noticing, which is the exact thing local transcription replaces; if
   * the local path breaks, the studio should be told so, not billed.
   *
   * An unrecognised value reads as `local` rather than throwing: a typo in this
   * variable must not stop the site booting.
   */
  transcribeBackend: ((v) => (v === "auto" || v === "elevenlabs" ? v : "local"))(
    opt("TRANSCRIBE_BACKEND", "local").trim().toLowerCase(),
  ) as "local" | "auto" | "elevenlabs",

  /**
   * ElevenLabs. Speech to text for video captions, and voice-over.
   *
   * The account is on the free tier: 10,000 text-to-speech characters a month
   * and transcription billed by audio length. The Video module states the
   * remaining quota on screen rather than discovering it halfway through a
   * two-hour master.
   */
  elevenlabs: {
    apiKey: opt("ELEVENLABS_API_KEY"),
    baseUrl: opt("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1"),
    get configured() {
      return Boolean(process.env.ELEVENLABS_API_KEY);
    },
  },

  zernio: {
    apiKey: opt("ZERNIO_API_KEY"),
    baseUrl: opt("ZERNIO_BASE_URL", "https://api.zernio.com/v1"),
    get configured() {
      return Boolean(process.env.ZERNIO_API_KEY);
    },
  },

  /**
   * Everybody else's accounts: read only.
   *
   * TikHub covers the platforms that have no public read API worth the name —
   * Douyin, Xiaohongshu, WeChat Channels, Bilibili — and is how Research sees
   * a competitor's numbers. It can only ever read, which is the right shape
   * for it: nothing we do to our own channels goes through here.
   */
  tikhub: {
    /** `TICKHUB_TOKEN` is how the client's credentials document spelled it;
     * both spellings are accepted so neither a corrected nor an uncorrected
     * environment silently turns the feature off. */
    token: opt("TIKHUB_TOKEN") || opt("TICKHUB_TOKEN"),
    baseUrl: opt("TIKHUB_BASE_URL", "https://api.tikhub.io"),
    get configured() {
      return Boolean(process.env.TIKHUB_TOKEN || process.env.TICKHUB_TOKEN);
    },
  },

  /**
   * DeepSeek, direct.
   *
   * A stopgap with a reason: the OpenRouter account has no credit, so every
   * call falls to a free endpoint, and the free endpoints here are reasoning
   * models that spend their whole token budget thinking before they answer.
   * DeepSeek's API is OpenAI-compatible, the studio has a key with money on
   * it, and it answers a request for JSON with JSON.
   *
   * `lib/ai/backend.ts` decides when to use it. Put credit on OpenRouter and
   * this goes quiet on its own.
   */
  deepseek: {
    apiKey: opt("DEEPSEEK_API_KEY"),
    baseUrl: opt("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
    get configured() {
      return Boolean(process.env.DEEPSEEK_API_KEY);
    },
  },

  /**
   * YouTube's own Data API.
   *
   * Separate from `tikhub` on purpose: TikHub is read-everything-else, this is
   * the platform speaking for itself. Trending by region and search by view
   * count come from here because TikHub's equivalents answer with empty lists.
   *
   * The free quota is 10,000 units a day and a search costs 100 of them, so
   * everything built on this caches.
   */
  youtube: {
    apiKey: opt("YOUTUBE_API_KEY"),
    get configured() {
      return Boolean(process.env.YOUTUBE_API_KEY);
    },
  },

  /**
   * Stock footage and photographs, from the two libraries that license them
   * for commercial use through an official API: Pexels (photos and video
   * clips, free, attribution welcome but not required) and Unsplash (photos,
   * free, credit required by their guidelines). Both keys are free to make.
   * Without them the director has the Creative Commons index and the
   * studio's own files; with them it can cut to a factory floor or a stock
   * chart the studio never shot.
   */
  pexels: {
    apiKey: opt("PEXELS_API_KEY"),
    get configured() {
      return Boolean(process.env.PEXELS_API_KEY);
    },
  },
  unsplash: {
    accessKey: opt("UNSPLASH_ACCESS_KEY"),
    get configured() {
      return Boolean(process.env.UNSPLASH_ACCESS_KEY);
    },
  },

  appUrl: opt("APP_URL", "http://localhost:3000"),

  /** Whether to mark the session cookie Secure. True in production unless
   * explicitly disabled for a plain-HTTP deployment. */
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",

  isProd: process.env.NODE_ENV === "production",
} as const;
