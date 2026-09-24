# Deployment notes

The product runs on the Cherry Servers box under pm2. Vercel still holds a
working copy of the same app against the same database, kept as a fallback.

## The pm2 deployment (primary)

```bash
npm run deploy          # typecheck, smoke tests, build, stage, zero-downtime reload
pm2 logs aura           # follow
pm2 monit               # live process view
pm2 describe aura       # state, restarts, memory
```

- **Where:** this machine, `the old shared box`, 32 cores / 186 GB, Amsterdam.
- **Port:** 3300, bound on `0.0.0.0`, so `http://the old shared box:3300`.
- **Processes:** four clustered instances of `.next/standalone/server.js`, plus
  `aura-sweep`, a once-a-day housekeeping run (19:00 UTC / 03:00 HK) that pm2
  triggers by restarting a process that exits.
- **Boot:** `pm2 save` is done and the `pm2-ubuntu2` systemd unit is enabled, so
  the app comes back after a reboot.
- **Secrets:** `.env.local`, read by Node itself via `--env-file`. pm2 never
  stores them in its config or its dump.

`next build` with `output: "standalone"` produces a self-contained server. The
two things Next deliberately leaves out — `.next/static` and `public/` — are
copied into the standalone tree by `scripts/deploy.sh`. Skipping that step is
why a self-hosted Next app loads with no CSS.

### No TLS yet

The app is served over plain HTTP by IP and port, so `COOKIE_SECURE=false` in
`.env.local` — a Secure cookie is dropped by the browser over HTTP and sign-in
would silently fail. **Passwords and session tokens therefore cross the network
in the clear.** The moment a hostname and certificate are in front of it:

1. point a DNS A record at `the old shared box`,
2. add an nginx server block proxying to `127.0.0.1:3300` (nginx already
   terminates TLS for a dozen hosts here) and run certbot,
3. set `COOKIE_SECURE=true` and `APP_URL=https://<host>` in `.env.local`,
4. `npm run deploy`.

## Latency: where things are

| | |
|---|---|
| App | Amsterdam (this box) |
| Database | Neon, Singapore (`ap-southeast-1`) |
| One database round trip | **~250 ms** |
| Warm page (measured on the box) | `/login` 275 ms · `/chat` 550 ms · `/files` 570 ms · channel 520 ms |

A page costs roughly two round trips, so most of that half-second is the
Amsterdam-to-Singapore distance, not the app. Someone in Hong Kong pays their
own hop to Amsterdam (~180 ms) on top.

What has been done about it without moving anything:

- session, person, entitlements and teams resolve in **one** query, cached per
  request (`lib/auth/dal.ts`);
- the channel page reads the channel and its messages in one statement;
- the channel poll (`/api/chat/pulse`) is a single query, and only triggers a
  re-render when the newest message id changes;
- each pm2 instance opens connections at boot, so no request pays for a TLS
  handshake to Singapore;
- "last active" and "mark read" are written with `after()`, behind the response.

The remaining fix is geography: putting Postgres in Europe (self-hosted here, or
a Neon project in `eu-central-1`) takes a round trip from 250 ms to single
digits and pages to well under 100 ms. Moving the *app* to Asia instead would
suit Hong Kong users better still. Either is a migration of a few minutes —
the dataset is small — but it is a decision about money and about who watches
the backups, so it stays open deliberately.

## The Vercel copy (fallback)

`npx vercel deploy --prod --yes` still works and serves the same database at
https://ai-workspace-video.vercel.app, with functions pinned to `sin1` next to
the database (`vercel.json`). It exists so there is somewhere to fail over to;
it is not where the studio should be pointed.

## Environment

In `.env.local` here, and in the Vercel project for the fallback:
`DATABASE_URL`, `R2_*`, `OPENROUTER_*`, `SESSION_SECRET`, `APP_URL`,
`COOKIE_SECURE`, `PORT`, and the `AI_MODEL_*` overrides. `.env*` and
`*_API.docx` are gitignored and vercelignored.

While the OpenRouter account has no credit, `AI_MODEL_ASSISTANT` and
`AI_MODEL_FALLBACKS` pin the assistant to free models. **Delete both once the
account is funded** and it returns to Claude Sonnet 5 (`lib/ai/models.ts`).
