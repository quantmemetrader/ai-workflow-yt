# Launch checklist

State as of 18 September 2026. The demo studio has been wiped: the database
holds one owner account and nothing else.

**Two deployments, one database.** The box (`http://84.32.176.16:3300`, pm2)
and an HTTPS copy (`https://ai-workspace-video.vercel.app`). Both are current
and both pass the full suite; the HTTPS one is the only one safe for real
passwords today.

## Blocking — the product is not trustworthy in front of staff until these are done

| | What | Who | Why it blocks |
|---|---|---|---|
| ☐ | **TLS in front of the box** | us, once a hostname exists | `http://84.32.176.16:3300` sends passwords and session cookies in the clear, and `COOKIE_SECURE=false` is set because a Secure cookie would be dropped over HTTP. **In the meantime there is an HTTPS copy of exactly the same product, on the same database, at https://ai-workspace-video.vercel.app — use that with real accounts until the box has a certificate.** Both pass the same 19 wiring checks. Point a DNS A record at the box and the four steps in `DEPLOYMENT.md` take ten minutes. |
| ☐ | **Credit on the OpenRouter account** | client | The account has zero balance. The assistant runs on free models that are rate-limited upstream and refuse under load, so roughly half of turns fail with "the provider is rate-limiting this account". Add US$20 and delete `AI_MODEL_ASSISTANT` and `AI_MODEL_FALLBACKS` from `.env.local`; it returns to Claude Sonnet 5 and answers in seconds. |
| ☐ | **Real accounts for the studio** | client supplies names, we create | One owner account exists. Everyone else is created with `npm run db:add-user` until the Admin module ships. |
| ☐ | **Someone changes the owner password** | client | It was generated at wipe time and printed to a terminal. |

## Should be done in the first week

| | What | Note |
|---|---|---|
| ☐ | **Move Postgres to Europe** | The app is in Amsterdam, Neon is in Singapore: every query costs ~250 ms and a page ~550 ms. Self-hosting Postgres on this box, or a Neon project in `eu-central-1`, takes a page under 100 ms. Migration is minutes; the dataset is small. |
| ☐ | **Back up on a schedule** | `npm run db:backup` exists and writes to `backups/`. Nothing runs it automatically yet, and Neon's own retention is the only safety net today. |
| ☐ | **Decide what the studio watches** | Research starts empty by design. Add beats on the Trends dashboard ("Watch a topic"). |
| ☐ | **Connect the remaining channels** | YouTube (`@yafanghk`) and LinkedIn are connected and live. Instagram, TikTok, WeChat Channels and Xiaohongshu each take one click in Zernio, need no new credential, and appear in Content performance, the Comment inbox and the Publish channel board as soon as they are connected. |

## What is live

| Module | State |
|---|---|
| Sign-in, sessions, permissions | Live. `npm run smoke` asserts the spec's §9 cases against the real database. |
| Chat | Live: channels, direct messages, unread counts, channel creation. |
| Files | Live: folders, versions, sharing with a ceiling, soft delete with a 30-day window, uploads straight to R2, recent/shared/trash, search. |
| The agent | Live: streaming, tools, citations filtered by the reader's own access, token ledger, budget stop. Quality is capped by the OpenRouter balance above. |
| Market Research | Live, all five screens. Trends, Search & compare and Topic backlog on GDELT / Hacker News / Google News / direct RSS. Content performance and Comment inbox on the studio's own connected channels through Zernio, refreshed hourly by `aura-social`. |
| Script, Video, Publish, Accounting, Finance, Legal, HR, Admin | Approved design screens, not yet wired to data. The rail takes you to them; they are honest about being designs. |

## Operating it

```bash
npm run deploy                     # typecheck, permission tests, build, zero-downtime reload
npm run db:backup                  # before anything destructive
npm run smoke                      # permission rules, in a scratch tenant
node scripts/wiring.mjs            # front-to-back: 19 checks against Postgres and R2
node scripts/permissions-ui.mjs    # what each role actually sees on screen
pm2 logs aura                      # the app
pm2 logs aura-worker               # research ingestion and other jobs
```

Every check above runs against whichever deployment `BASE` names, so the same
suite proves the box and the HTTPS copy:
`BASE=https://ai-workspace-video.vercel.app node scripts/wiring.mjs`.

`pm2` runs six processes: four app instances, one worker, plus three cron-style
jobs (`aura-sweep` nightly, `aura-research` three times a day, `aura-social`
hourly). They come back after a reboot.

## Decisions the client has to make before handover

- **Free model variants are on the chat path.** §5 of the spec says `:free`
  variants carry separate training-policy settings and should be kept off any
  path touching client data. They are there today only because the account has
  no credit. Adding credit and deleting the two `AI_MODEL_*` pins resolves it.
- **Zero data retention is off.** `AI_ZERO_DATA_RETENTION=true` exists and is
  ready, but OpenRouter refuses every currently-pinned free model under a ZDR
  policy ("No endpoints found matching your data policy"). Turn it on with the
  same edit that removes the free-model pins, and set it at account level too.
- **The agent tells the model how many matches were withheld.** The brief says
  a person should know an answer is partial "without learning what was
  withheld"; a count sits on the line. It is consistent with what `/search`
  shows, so it was left alone — but it is a judgement worth confirming.

## Known gaps, written down rather than hidden

- **Admin's "assembled prompt preview" does not exist.** §9 has an acceptance
  criterion for it ("upload a style file scoped to Script, the preview shows
  it"), which cannot pass until the Admin module is built. The function it
  needs (`lib/ai/prompt.ts assemblePrompt`) is already the one the agent uses,
  so the screen is the only missing piece.
- **An abandoned agent turn can leave a message spinning.** A turn healed the
  next time the conversation is opened; a thread nobody returns to stays that
  way until the nightly sweep is taught to close them.

## Deliberately not done

- **No data is invented anywhere.** A screen with no source connected says what
  it needs and who has to get it. This is why parts of Research look empty.
- **No scrapers.** Schedule A3(1) forbids them, so Bloomberg, Reuters, Nikkei
  and Google Trends are listed as unconfigured with the reason rather than
  scraped.
- **TikTok comments will stay empty** whatever credentials arrive: there is no
  commercial comment API.
