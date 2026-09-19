# Video Agent Platform

Internal work platform for Aura Farmers, Inc. — an AI agent per employee,
eleven module surfaces, a shared media/document database with per-file
permissions, and an admin panel for accounts, spend and agent tuning.

**Source of truth: [`01_Build-Spec 2.pdf`](./01_Build-Spec%202.pdf) (v2.4,
15 Aug 2026).** Every module, permission rule and acceptance criterion should
trace back to that document. If code and spec disagree, the spec wins — raise
the discrepancy rather than resolving it silently in code.

**Design source of truth: `design/canvas/*.dc.html`.** The shipped screens are
transcriptions of those artboards (`components/canvas/*`), not
re-interpretations of them. When a screen changes, change the artboard and the
component together.

## What runs today

| Area | State |
|---|---|
| Sign-in, sessions, roles | Live — scrypt passwords, database-backed sessions, httpOnly cookies |
| Permissions (ReBAC) | Live — relation tuples, checked in SQL at query time; `npm run smoke` proves the spec's §9 cases |
| Files / database | Live — folders, versions, sharing with a ceiling, soft delete, direct-to-R2 uploads |
| Chat | Live — channels, direct messages, unread counts |
| The agent | Live — streaming answers, tool calls, citations filtered by the reader's own access, token ledger, budget stop |
| Market Research | Live, all five screens. Trends, Search & compare and Topic backlog on GDELT / Hacker News / Google News / RSS; Content performance and Comment inbox on the studio's own channels through Zernio |
| Script | Live — brief, split editor with house-style conformance, version history with checksums, approve-and-lock |
| Video, Publish, Accounting, Finance, Legal, HR, Admin | Approved designs served from the canvas; not yet wired to data |

The unbuilt modules open their approved screen rather than a dead end, and the
whole canvas stays browsable at `/demo`.

## Stack

Next.js 16 (App Router, Node runtime) · React 19 · Postgres 16 on Neon
(Drizzle, migrations in `drizzle/`) · Cloudflare R2 for objects · OpenRouter
for models · pm2 on the studio's own box, with a Vercel copy over HTTPS.

Two social vendors, and the split between them is deliberate:
**Zernio** holds the OAuth grants the studio gave it, so it is the only thing
that reads and writes the studio's *own* channels (comments, replies,
analytics, publishing). **TikHub** reads public numbers on *anyone's* channel
and can only ever read. Nothing that touches the studio's own accounts goes
through TikHub, and there is no write surface in `lib/social/tikhub.ts`.

No Redis: the job queue is Postgres with `FOR UPDATE SKIP LOCKED`, which gives
the spec's §6 semantics with one less service to run. No OpenFGA server yet:
tuples are stored and checked in Postgres in OpenFGA's own shape, so the
checker can be swapped for OpenFGA — whose datastore is already provisioned —
without touching a caller.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in; see SETUP.md
npm run db:migrate             # apply migrations
npm run dev                    # http://localhost:3000
```

**Setting up a studio.** `npm run db:reset` empties the database and leaves one
owner account (it refuses without `CONFIRM=wipe`, and prints what it is about
to destroy). Everyone else is added with `npm run db:add-user` until the Admin
module ships:

```bash
CONFIRM=wipe OWNER_EMAIL=you@studio.hk OWNER_NAME="Your Name" npm run db:reset
EMAIL=amy@studio.hk NAME="Amy Wong" MODULES=chat,files,research npm run db:add-user
```

`npm run db:seed` exists but writes **demo** people and documents, and refuses
to run unless `SEED_DEMO=yes` and the database holds nothing but its own
invented accounts. It is for looking at the product with content in it, never
for a real studio.

## Checks

```bash
npm run smoke        # permission acceptance tests, in a scratch tenant
node scripts/wiring.mjs   # front-to-back: every live surface, verified in Postgres and R2
npm run typecheck
npm run build
```

`npm run smoke` is the one that matters. It asserts the spec's §9 cases: a
producer cannot see the board folder, the agent cannot retrieve or cite it,
sharing above your own relation is refused, and a guest reaches only what was
named to them.

## Layout

```
app/(app)/            signed-in product: chat, files, settings
app/login/            sign-in
app/api/              agent stream (SSE), file presign/complete/download, health
components/canvas/    transcriptions of the design artboards
lib/db/               schema + migrations (Drizzle)
lib/auth/             passwords, sessions, the data access layer
lib/authz/            ReBAC: tuples, the query-time filter, the share ceiling
lib/ai/               OpenRouter client, agent loop, tools, retrieval, ledger
lib/files/            the file service the screens and the agent both call
scripts/              seed, smoke, R2 setup
design/canvas/        the artboards, and the generators that build them
```

## Deploying

```bash
npm run build
npx vercel deploy --prod --yes
```

Environment variables live in the Vercel project, not in the repo. `.env*` is
gitignored and `.vercelignore`d; keys are referenced, never displayed (spec §8).
