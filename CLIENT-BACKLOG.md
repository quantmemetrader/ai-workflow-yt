# 腾亚创变 工作台 — client backlog and handoff

Written 2026-09-23. Source: WhatsApp thread with **ryanchi** (the client-side
contact) on 2026-09-23. His words are quoted verbatim so intent is not lost in
paraphrase. The end client is **腾亚创变**, a Hong Kong video studio; the founder
is **谢亚芳** (English name Avon), YouTube `@yafanghk` / 谢亚芳-创变派.

Everything below is work that has *not* been done unless marked DONE.

---

## 0. How to work on this box

```bash
cd /home/ubuntu/projects/aiVideoFreeLance
npm run build          # next build + stages .next/standalone
pm2 reload aura        # zero-downtime reload of the 4 web instances
pm2 logs aura          # or logs/aura.err.log, logs/worker.log
```

- Live at **https://yt.okbro.xyz** (Caddy → `127.0.0.1:3300`).
- `output: standalone`, so **`next start` does not work**. pm2 runs
  `.next/standalone/server.js`. Always `npm run build` before `pm2 reload`.
- `remotion/` is a **separate npm package**; if a build fails with
  `Cannot find module 'remotion'`, run `npm ci` inside `remotion/` too.
- Database is Neon **Frankfurt** (~8ms). Never point it back at the old
  Singapore project — that cost 159ms *per query*.
- Secrets are in `.env.local` (mode 600, gitignored). Never commit or print them.

### Conventions that are not negotiable
- Commit as **quantmemetrader** (`git config user.name` is set locally; the PAT
  is in `~/.git-credentials`). The old `rahulsingh2312` account is deleted.
- **Never** add "Co-Authored-By: Claude" or "Generated with Claude Code" to any
  commit or PR. The user has asked for this explicitly.
- The repo `quantmemetrader/ai-workflow-yt` is **PUBLIC**. Check what you stage.

---

## DONE 2026-09-23

- **Hosting** — moved off Vercel + the old shared box onto this server. Caddy,
  HTTPS, pm2 (11 processes), boot persistence.
- **Chinese rendering** — `Inter` has no Han glyphs; 10 screens declared
  `font-family: Inter, system-ui` so each machine picked its own CJK fallback,
  often a Japanese face, which draws *wrong glyph forms for the same
  codepoints*. Every stack now names PingFang SC / Hiragino Sans GB /
  Microsoft YaHei / Noto Sans SC explicitly. Do not "simplify" these back.
  > ryanchi: "a lot of chinese charcter are wrong … when i copy and paste them
  > they are write, but the character shown on the paltform is very wrong"
- **Rebrand** to 腾亚创变, English name dropped. 19 files + the `tenants` row
  (`name`/`name_local`), which is what the sidebar actually renders. Also the
  AI system prompt, the 2FA issuer, and the video watermark spec.

---

## BLOCKER — ElevenLabs refuses this server (found 2026-09-23)

Every ElevenLabs request from this box (84.32.64.46, Cherry Servers,
Amsterdam) is redirected to their "restricted countries" help page, or a
Cloudflare 403. So **transcription and voice-over do not work here**, whether
started by hand or automatically; the last success was 2026-09-20, from the
old host. NL is not a restricted country, so this is ElevenLabs' view of the
IP range, not a code bug. Options: ask ElevenLabs support to clear the IP, or
route only ElevenLabs through another egress (`ELEVENLABS_BASE_URL` is already
configurable). Needs a decision from the owner.

## P1 — "most important" (the Friday ask)

ryanchi said this twice and called it "the key thing they want".

> "they want the agent to be more active - I.e it shouldn't just be promoting.
> Say i upload a new source file, agent should already start processing, every
> morning it will give a topic and item to discuss"
> "See how to make it automated"
> "AI can coordinate and corporate themselves in between (most important), some
> buttons and stuff AI can execute itself, less like a working platform with a
> AI, but more agentic and automatic"

Concretely:

1. **Auto-process on upload.** When a source file lands, enqueue work without a
   human pressing anything. The job types already exist in `scripts/worker.ts`:
   `video.transcribe`, `video.peaks`, `files.poster`, `video.autoedit`. The gap
   is the *trigger*, not the capability.
2. **Morning digest, 08:00 HKT.**
   > "like every mornig 8am HKT research agent will send a message on
   > yesterday's trend"
   HKT is UTC+8 and **pm2 cron times in `ecosystem.config.cjs` are UTC**, so
   08:00 HKT = `"0 0 * * *"`. Today `aura-research` runs `0 1,9,17 * * *` UTC.
   The digest should post *into a chat channel*, not just refresh data.
3. **Planning agent sends to-dos.**
   > "polanning agent will send out to dos"
4. **Agent-to-agent handoff.**
   > "say script agent can tag video agent once it finish work / and approved"
   Needs a notion of one agent addressing another, plus an approval gate.

Where to look: `lib/ai/agent.ts`, `lib/ai/tools/` (25+ tools already registered
— `decide_topic`, `first_cut`, `make_video`, `create_document`, …), and
`scripts/worker.ts` for the job runner. Much of the *capability* exists; what is
missing is autonomy and scheduling.

## P2 — multi-agent chat

> "more agents in the chattiing interface (i.e can tag video agent, article
> agent, reserach agent, between agengts they can also collab)"
> "i think they just want like AI employees they can tag"
> "so i think just make each role clearer in the chat"

`lib/db/schema/agent.ts` already has `agentRoleEnum` = user/assistant/system/tool,
but that is message authorship, not distinct addressable agents. Needs named
agents with visible roles, `@`-mention routing, and inter-agent messages.

Also in this bucket, and a straightforward bug:
> "the current AI you can not update file in the chat box, also need fix that"
(i.e. you cannot upload a file into the chat composer.)

## P3 — article generation

> "the article generation page apart from the video page"
> "also need a article function, they publishing logs and stuff"

A sibling to the video pipeline. `create_document` exists as a tool; there is no
article *page*.

## P4 — UI

> "Create a better UI" / "General style" / "need to show what every page is
> doing at once" / "less like video editor, more like ai prompt stuff"

Reference he liked: **https://ai-agent-tau-two.vercel.app/**

- Logo top-left: **DONE 2026-09-23.** The word 腾亚 as a white label with heavy
  black type and a sparkle, on the gold-to-steel light of their YouTube picture
  (`lib/brand/mark.ts`) — the picture's look, never the founder's face. Used in
  the rail, on the login screen, as the favicon and the home-screen icon. If
  ryanchi supplies a real logo, swap it in there.
- Show the user's role in the top bar:
  > "better show the character - so we can see users' role on the up part"
- Resizable panels:
  > "see if there is a way for users to adjust the size of different panel with mous"
- Some text is too small (he sent a screenshot; the user agreed "too small").

## P5 — smaller reported items

- **Comments by platform.**
  > "for analysis -> comment part, will need to differentiate by platform"
- **Potential topics — no way to add.**
  > "and for potential topics, cant find where to add"
- **Video loads forever.** He assumed it was the server. Worth re-testing now
  that hosting moved and the DB is 20x closer; if it persists it is likely R2
  range-request or player behaviour, not the host.
- **Translations / wording.**
  > "they complaint a bit on words and stuff" → confirmed to mean translations.
  `lib/i18n.ts` holds the map.
- **`social.syncDailyViews` times out.** *Logged 2026-09-23, not fixed.* 25
  failures vs 13 successes in `jobs`; 24 of the 25 are `did not finish within
  600s` (the worker's default `JOB_TIMEOUT_MS`), the last on 2026-09-20, and
  it has succeeded since. It is one YouTube Analytics request per recent post
  in sequence, so it scales with the post count. Likely fix: batch or bound the
  posts per run, or give it a `TIMEOUT_BY_TYPE` entry — after finding out why
  one run takes ten minutes.

---

## Access model (confirmed by ryanchi, already the intended design)

> "Just them, but they can set access / So each owner can set access / And there
> are the master admin / Who can set access for everything"

Uploads are private to the uploader by default; owners grant access per item;
admins can set access for everything. Current users: `admin@okbro.xyz`,
`ryan@okbro.xyz`, `xyz@okbro.xyz` (admin), owner `rahulsinghhh2312@gmail.com`.

---

## Raw source

The full WhatsApp export this backlog was written from is at
`/home/ubuntu/client-refs/whatsapp-ryanchi-2026-09-23.md` — deliberately
**outside the repo**, because `quantmemetrader/ai-workflow-yt` is public and the
thread contains an invite link, client names and commercial detail. Read it
there when you need the exact wording; do not copy it into the repo.

---

## ElevenLabs egress workaround (2026-09-23) — TEMPORARY

ElevenLabs refuses this host's IP: API calls from `84.32.64.46` 302-redirect to
their "do you restrict access by country" article, with and without an API key,
so it is IP-based, not auth. The **old box `84.32.176.16` is accepted** — same
provider, same city, same AS — so it is that one address, not Cherry Servers
or NL.

Until support clears it, ElevenLabs traffic is relayed:

- Old box: nginx site `elevenlabs-egress`, listening on **127.0.0.1:4700 only**,
  `proxy_pass https://api.elevenlabs.io`.
- New box: `elevenlabs-tunnel.service` (autossh) holds an SSH tunnel
  `127.0.0.1:4700 -> 84.32.176.16:127.0.0.1:4700`, so the API key never crosses
  the public internet in clear. The key it uses
  (`/root/.ssh/el_tunnel`) is restricted on the old box to user `eltunnel` with
  `restrict,port-forwarding,permitopen="127.0.0.1:4700",command="/bin/false"` —
  it can forward that one port and nothing else.
- `ELEVENLABS_BASE_URL="http://127.0.0.1:4700/v1"` in `.env.local`.

**To undo once the IP is cleared:** set `ELEVENLABS_BASE_URL` back to
`https://api.elevenlabs.io/v1`, `pm2 restart all --update-env`, then
`systemctl disable --now elevenlabs-tunnel` and remove the nginx site.

Note: the ElevenLabs account is on the **free tier, 4,606 of 10,000 characters
used**. Voice-over will exhaust that quickly — worth upgrading before a demo
that generates audio.
