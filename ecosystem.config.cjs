/**
 * pm2 process definition for the Cherry box.
 *
 * `next build` with `output: "standalone"` produces .next/standalone/server.js:
 * a plain Node HTTP server with its own minimal node_modules. pm2 keeps four
 * of them alive in cluster mode, load-balanced across the machine's cores.
 *
 * Four, not thirty-two: each instance holds its own Postgres pool, and the
 * useful limit here is database connections and memory, not CPU — this app
 * spends its time waiting on Singapore, not computing. Raise `instances` only
 * if CPU actually saturates.
 *
 *   npm run deploy        build, stage and reload with zero downtime
 *   pm2 logs aura         follow the logs
 *   pm2 monit             live process view
 *   pm2 save              persist the process list across reboots
 */
const path = require("node:path");

const root = __dirname;
const envFile = path.join(root, ".env.local");

/**
 * Neon publishes AAAA records and this machine has no IPv6 route, so Node's
 * happy-eyeballs spent the whole connect timeout on an unreachable address
 * before falling back — about one connection in twelve failed outright, which
 * surfaced as a sign-in that silently did nothing. Resolve IPv4 first.
 */
const DNS_IPV4 = "--dns-result-order=ipv4first";

/** node, with the flags the TypeScript scripts need, as one argv. pm2's
 * `interpreter_args` does not survive multiple flags reliably. */
const runTs = (script) => ({
  script: process.execPath,
  args: `--env-file=${envFile} ${DNS_IPV4} --conditions=react-server --import tsx ${path.join(root, script)}`,
});

module.exports = {
  apps: [
    {
      name: "aura",
      script: path.join(root, ".next/standalone/server.js"),
      cwd: root,
      instances: 4,
      exec_mode: "cluster",

      // Secrets stay in .env.local, read by Node itself at boot; pm2 never
      // holds them in its config or its dump file.
      node_args: `--env-file=${envFile} ${DNS_IPV4}`,

      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3300,
        HOSTNAME: "0.0.0.0",
      },

      max_memory_restart: "700M",
      // A crash loop should back off rather than hammer the database.
      exp_backoff_restart_delay: 200,
      // A reload is rolling: the new instance must be listening before the
      // old one goes, and the old one gets long enough to finish whatever
      // request it has (a video page opened during a deploy used to hang).
      kill_timeout: 30_000,
      wait_ready: false,
      listen_timeout: 60_000,

      out_file: path.join(root, "logs/aura.out.log"),
      error_file: path.join(root, "logs/aura.err.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * The job worker (spec §6). One process, claiming jobs with SKIP LOCKED.
       * A second copy can be started safely if research ingestion ever needs
       * the throughput — the claim query is what makes that safe — but one is
       * plenty while the limiting factor is other people's rate limits.
       */
      name: "aura-worker",
      ...runTs("scripts/worker.ts"),
      cwd: root,
      // Two, so a render that takes minutes never holds up the small jobs
      // behind it (a poster, a sync); the claim query keeps them apart.
      instances: 2,
      // A 16:9 render holds the master, the stills and Chrome; half a gig
      // was the ceiling pm2 killed a worker at, mid-render, with no cleanup.
      max_memory_restart: "3G",
      exp_backoff_restart_delay: 500,
      kill_timeout: 30_000,
      out_file: path.join(root, "logs/worker.log"),
      error_file: path.join(root, "logs/worker.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * Queues the daily research refresh: every stale topic, and the source
       * feeds. Three times a day, because a trends dashboard that is a day old
       * is not a trends dashboard — and a fourth at 23:00 UTC, so what the
       * morning digest reads an hour later is fresh rather than six hours old.
       */
      name: "aura-research",
      ...runTs("scripts/refresh-research.ts"),
      cwd: root,
      autorestart: false,
      cron_restart: "0 1,9,17,23 * * *",
      out_file: path.join(root, "logs/research.log"),
      error_file: path.join(root, "logs/research.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * The Research agent's morning digest, into #研究日报 (scripts/digest.ts).
       *
       * pm2 cron is UTC: "0 0 * * *" is 08:00 in Hong Kong, which is when the
       * client asked for it. pm2 also runs it once whenever it is (re)started;
       * the script posts at most once per Hong Kong day, so that is harmless.
       */
      name: "aura-digest",
      ...runTs("scripts/digest.ts"),
      cwd: root,
      autorestart: false,
      cron_restart: "0 0 * * *",
      out_file: path.join(root, "logs/digest.log"),
      error_file: path.join(root, "logs/digest.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * Queues the social sync: the studio's own channels, their posts and
       * numbers, the comments on them, and the reading of those comments.
       *
       * Hourly, offset from the research refresh so the two are not competing
       * for the single worker. A comment is somebody waiting for an answer,
       * so the useful latency here is shorter than for a trend line; the cost
       * stays small because `minComments` means we only pay for the posts that
       * have something new on them.
       */
      name: "aura-social",
      ...runTs("scripts/refresh-social.ts"),
      cwd: root,
      autorestart: false,
      cron_restart: "20 * * * *",
      out_file: path.join(root, "logs/social.log"),
      error_file: path.join(root, "logs/social.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * Views gained per day, and the real watch-through.
       *
       * Separate from the hourly round because YouTube Analytics is addressed
       * per video: this is one request per recent post, where the hourly sync
       * is a handful in total. Daily is also as often as the numbers change —
       * YouTube's own figures run two to three days behind.
       */
      name: "aura-social-daily",
      ...runTs("scripts/refresh-social.ts --daily"),
      cwd: root,
      autorestart: false,
      cron_restart: "40 20 * * *",
      out_file: path.join(root, "logs/social.log"),
      error_file: path.join(root, "logs/social.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * Housekeeping. pm2 runs periodic work by restarting a process that
       * exits: `autorestart: false` plus `cron_restart` means "run this at
       * 19:00 UTC and not otherwise" — 03:00 in Hong Kong, when nobody is
       * waiting on the studio's files.
       */
      name: "aura-sweep",
      ...runTs("scripts/sweep.ts"),
      cwd: root,
      autorestart: false,
      cron_restart: "0 19 * * *",
      out_file: path.join(root, "logs/sweep.log"),
      error_file: path.join(root, "logs/sweep.log"),
      merge_logs: true,
      time: true,
    },

    {
      /**
       * A copy of the database, somewhere that is not the database.
       *
       * Neon takes its own snapshots and they live in the account that holds
       * the only copy of the data. This one goes to R2 — a different company —
       * so that losing the account, or a `drop table` nobody notices for a
       * week, is survivable.
       *
       * 18:30 UTC, 02:30 in Hong Kong: before the sweep, so a dump is taken of
       * the state that housekeeping is about to change.
       */
      name: "aura-backup",
      script: "bash",
      args: ["scripts/backup-db.sh"],
      cwd: root,
      autorestart: false,
      cron_restart: "30 18 * * *",
      out_file: path.join(root, "logs/backup.log"),
      error_file: path.join(root, "logs/backup.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
