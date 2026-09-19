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

  appUrl: opt("APP_URL", "http://localhost:3000"),

  /** Whether to mark the session cookie Secure. True in production unless
   * explicitly disabled for a plain-HTTP deployment. */
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",

  isProd: process.env.NODE_ENV === "production",
} as const;
