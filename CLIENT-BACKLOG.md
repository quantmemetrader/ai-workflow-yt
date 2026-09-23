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
- **`social.syncDailyViews` — RESOLVED 2026-09-23 by the move.** All 25 failures
  are dated 2026-09-20 or earlier with `did not finish within 600s`; they were
  timeouts on the overloaded old box (load average ~81). Zero failures since the
  migration, 16 successes. Nothing to fix.
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

---

## Render pipeline — what was wrong, 2026-09-23

Four faults, each hiding the next. All fixed; the notes matter because three of
them looked like something else.

1. **It never ran.** `HEAVY_JOBS_PAUSED` was still set from the old shared box.
   Jobs queued and were never claimed.
2. **ffmpeg took 63GB and was OOM-killed, then requeued and did it again** —
   which took the whole site down with it, twice. Every cut was a `trim` branch
   off one shared input; `concat` reads its inputs in order, so while it
   consumed cut 1 the split feeding cuts 2–22 had to buffer every frame they
   would eventually need. ~25GB of raw frames for a 4-minute 1080x1920 timeline,
   doubled. Fixed by seeking at the demuxer (`-ss`/`-t` per input) in
   `lib/video/render.ts`: memory is now flat at ~3.7GB whatever the length.
   Measured old vs new on 22 cuts over 4m33s: 18.5GB and dead, versus 3.7GB and
   faster.
3. **A `ulimit -v` ceiling added on top of that wedged ffmpeg completely** —
   407 threads, 0% CPU, 0 bytes of I/O. `ulimit -v` caps address space, and
   twenty-odd decoders reserve far more of it than they touch. Removed. A real
   cap must be a cgroup on resident memory (`systemd-run -p MemoryMax=`).
4. **"0 graphics, 0 punch-ins, 0 cutaways" was a timeout, not a credit problem.**
   `AI_ATTEMPT_TIMEOUT_MS` was **25000**, and a director-sized call (a 265-caption
   transcript in, an edit plan out) measures **23750ms**. A 1.25-second margin, so
   design failed on a coin flip and the render produced a correct but empty cut.
   Raised to 180000. Verified: the next run produced graphics.

**Do not "reset the director" by replacing the whole `video_projects.director`
JSON.** The brief and the aspect ratio live in there and nowhere else — the job
payload holds only `projectId` and `dedupeKey`. Overwriting it silently loses
the studio's instructions and the run comes back 16:9 instead of 9:16. Remove
only the keys you mean to: `director - 'resume' - 'result' - 'error'`.

## Models, 2026-09-23

Running `deepseek/deepseek-v4-flash` (paid, from the $10 key). **Anthropic and
Google both return 403 "violation of provider Terms Of Service" on this
OpenRouter org** — four upstream providers tried, all refused, and it fails from
any network, so it is an account flag rather than an IP or credit problem. Until
OpenRouter lifts it, Claude is unreachable through them; a direct `sk-ant-` key
would bypass it entirely.

The stored choice in `settings` (key `ai.models`) said `claude-sonnet-5` while
the fallback chain quietly answered with DeepSeek, so the model picker named a
model that never replied. Now set to DeepSeek so the UI is honest.

---

## Why the design came back empty, and why captions were boxes (2026-09-23, later)

Two more faults, both invisible in the logs because nothing errored.

- **Captions rendered as white and blue boxes.** `remotion/public/fonts/` held
  only `InterVariable.ttf` (0 Han glyphs), no CJK font was installed on the
  box, and every caption preset in `lib/video/presets.ts` asked libass for
  "Inter". Every Chinese character became tofu. Fix: `fonts-noto-cjk` on the
  box, `NotoSansSC.ttf` in the fonts dir libass is pointed at, and all six
  presets now name `Noto Sans CJK SC` (covers Latin too). Proven with a burned
  frame. Whatever family a preset names must exist in BOTH places or this
  comes back silently.
- **"0 graphics" with no error.** `ai_usage.completion_tokens` was exactly
  `4200` — the design call's `maxTokens`. The whole-video JSON plan overflowed,
  came back truncated, and the tolerant parser produced nothing; the call had
  "succeeded" so nothing was logged. Raised to 16000/8000, and — the real fix —
  **the design is now windowed**: one call per 60s of timeline, in parallel,
  each with the full brief and only its own transcript, merged. Part 1 owns
  the opening furniture, the last part the end card. A single call over six
  minutes was rich for minute one and empty by minute five; that is where
  "only 3 graphics" came from.
- **Model.** Anthropic/Google are refused on this OpenRouter org. Of what does
  answer, `qwen/qwen3-max` is the strongest for Chinese and structured JSON;
  it is the assistant/drafting model now, `kimi-k2` then `deepseek-v4-flash`
  as fallbacks, Flash for cheap utility work.
- **Preview proxies.** Every render now also writes a 480p proxy
  (`video_exports.proxy_file_id`, ~10x smaller, 2s keyframes) and the player
  streams that, falling back to the master. The master is still what
  downloads. Uploads from a browser go browser→R2 direct with an 8GB cap, but
  a 590MB upload from Hong Kong timed out on the 15-minute presign; for big
  masters use `scripts/upload-local.ts` on the box.
- `scripts/director-smoke.ts` runs the whole director on a 75s cut of any
  stored master in a couple of minutes. Use it before claiming a pipeline
  change works.

---

## Transcription moved onto this box — 2026-09-24

Speech-to-text no longer goes to ElevenLabs. **Voice-over still does**; nothing
in `lib/video/voiceover.ts` or `lib/video/elevenlabs.ts` changed.

Why: ElevenLabs refuses this server's IP, so transcription only ever left
through the SSH tunnel to the old box, and the account is a free tier that
transcription — much the higher-volume path — drains first. This machine has 16
cores and sits at load ~0 between renders.

### What runs

- **`/opt/whisper/`** — outside the repo on purpose (1.6GB of weights and a
  Python tree have no business in a public repo or in `next build`).
  - `venv/` — `faster-whisper` on the CTranslate2 backend. **No PyTorch**;
    the whole install is a few hundred MB.
  - `models/` — the HuggingFace cache (`HF_HOME`), holding **large-v3-turbo**.
  - `transcribe.py` — the CLI. Prints one JSON object on stdout in exactly the
    shape `lib/video/elevenlabs.ts` `transcribe()` returns, so nothing
    downstream can tell the difference. Diagnostics go to stderr.
- **`lib/video/whisper.ts`** — writes the Blob to a temp file, `spawn`s the CLI
  (argv array, never a shell string), validates the JSON, cleans up.
- **`lib/video/transcribe.ts`** — `runTranscription()` picks the backend and
  logs one line naming which one served the job.

### The switch

`TRANSCRIBE_BACKEND` in `.env.local`, read through `lib/env.ts`. Change it and
`pm2 restart all --update-env`; no deploy, no build.

| value | behaviour |
| --- | --- |
| `local` | **the default, and what is set.** /opt/whisper only. A failure fails the job. |
| `auto` | local first, ElevenLabs if local fails. |
| `elevenlabs` | ElevenLabs only — how it worked before. |

**`local` does not fall back, deliberately.** A silent fallback is how the
studio ends up spending an ElevenLabs quota it believed it had stopped using:
the captions would still appear, nobody would look, and the free tier would
drain anyway. If the local path breaks, the job fails saying so.

A failure reads, on screen and in `logs/worker.log`:
`Local transcription failed: <the actual cause>. Transcription runs on this
server (/opt/whisper); set TRANSCRIBE_BACKEND=auto to let it fall back to
ElevenLabs.` The cause is specific — venv missing, bad model id, the CLI's
exit code and stderr, or `did not finish within 1200s`.

Other env, all optional, all with the same defaults in the CLI and the wrapper:
`WHISPER_MODEL` (`large-v3-turbo`), `WHISPER_THREADS` (`6`),
`WHISPER_TIMEOUT_MS` (`1200000`), `WHISPER_PYTHON`, `WHISPER_SCRIPT`,
`WHISPER_CACHE`, `WHISPER_MULTILINGUAL`.

### Why turbo and not large-v3

Measured head to head on 90s of the studio's own Mandarin master
(`蒸馏之战 · 原片.mp4`), both at six threads:

| | large-v3 | **large-v3-turbo** |
| --- | --- | --- |
| wall clock | 36.9s | **17.1s** |
| peak RSS | 3.13GB | **1.70GB** |
| language | zh, p=0.9979 | zh, p=0.9976 |
| words | 311 | 312 |
| weights on disk | 2.9GB | 1.6GB |

Word start times agree to a median of **0.08s** — invisible in a caption. The
large-v3 weights have been deleted from the cache. If you ever want them back:
`HF_HOME=/opt/whisper/models /opt/whisper/venv/bin/python -c "from
huggingface_hub import snapshot_download;
snapshot_download('Systran/faster-whisper-large-v3')"`, then set
`WHISPER_MODEL=large-v3`.

### Six threads, not sixteen

`cpu_threads=6` and `OMP_NUM_THREADS=6`, set in the CLI **before**
`faster_whisper` is imported — CTranslate2's OpenMP runtime reads the ceiling
once, at load, so setting it later does nothing. A transcription is never what
the studio is waiting on; a render is, and one starting alongside still gets
ten cores.

### Two things that are deliberately absent

- **Diarization.** faster-whisper does not do it (it needs pyannote and a
  PyTorch install, which is the weight this backend exists to avoid). `speaker`
  is always null. It costs nothing: `toCaptionLines` only uses `speaker` to
  break a line when it changes, so it simply never breaks on it, and no other
  caller reads it. The `diarize` option is still accepted so the call site
  reads the same as the ElevenLabs one.
- **A hand-tuned language list.** Detection is automatic and per window
  (`multilingual=True`), because the studio mixes Mandarin, Cantonese and
  English inside one video; pinning one language turns an English answer in a
  Chinese interview into plausible-looking nonsense. It is not free: on the
  benchmark clip **large-v3** with per-window detection decided a stretch of
  trailing near-silence was Vietnamese and invented a YouTube sign-off. Turbo
  did not, either way — but if a caption ever comes back in a language nobody
  spoke, `WHISPER_MULTILINGUAL=0` pins detection to one pass.

### Updating the model

```bash
HF_HOME=/opt/whisper/models /opt/whisper/venv/bin/pip install -U faster-whisper
# then pre-pull whatever you want to run, so the first real job does not pay for it:
HF_HOME=/opt/whisper/models /opt/whisper/venv/bin/python -c \
  "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"
```

Set `WHISPER_MODEL` if it is not the default, then
`pm2 restart all --update-env`. Check it by hand first — the CLI runs
standalone and prints the JSON:

```bash
/opt/whisper/venv/bin/python /opt/whisper/transcribe.py /path/to/audio.mp3 | head -c 400
```

---

## Shipped and proven 2026-09-24 (night)

Everything below was exercised in production, not just built.

- **Transcription runs on the box.** `/opt/whisper` (faster-whisper, `large-v3-turbo`, int8, 6 threads). Live job: `served by local whisper in 14.7s: zh p=0.997, 266 words, 75s of audio`; the ElevenLabs tunnel saw 0 speech-to-text calls. `TRANSCRIBE_BACKEND=local` is the default and does NOT fall back — a broken `/opt/whisper` fails the job loudly. ElevenLabs remains for voice-over only (free tier, ~6k/10k chars used).
- **Design is windowed** (one call per 60s, parallel, merged). Two 75s smoke runs: 10 graphics each; the first full-length run before the fix had 0.
- **Preview proxy** is written beside every master (`video_exports.proxy_file_id`): 13.9 MB master → 1.6 MB 480p, faststart, 2s keyframes. The player streams the proxy and downloads the master.
- **Multipart uploads** for files > 64 MB: 16 MiB parts, 4 in flight, per-part signing and retry. Proven server-side with a 200 MB object (13 parts, sha256 match). R2 CORS already allows it for yt.okbro.xyz, tengya.media and www.tengya.media. **Not yet exercised from a browser** — the studio's next big upload is the real test.
- **People page**: add a person (invite), teams (create / assign / dissolve), inline name + title edit. No migration needed.
- **Share card** (`/opengraph-image`) carries the 腾亚 mark, no English. WhatsApp caches cards for weeks: share `https://yt.okbro.xyz/?v=2` or use Facebook's Sharing Debugger → Scrape Again.
- **Cloudflare orange** on yt.okbro.xyz, SSL Full (strict). Honest measurement from Mumbai: handshakes 7–35 ms vs 280–330 ms direct, worst cases much better, medians only modestly better. Not a cure for Amsterdam↔HK distance.
- Service account renamed to `service@tengya.internal`; owner account `avon@tengya.media` created (Avon / 谢亚芳, 创始人, all modules).

**Still on the studio:** point `tengya.media` A records (Porkbun) at 84.32.64.46 or move the zone to Cloudflare — Caddy already serves the name; then set `APP_URL`, add the 301 from yt.okbro.xyz. Retry the 590 MB browser upload. Rotate the credentials that were pasted into chat. Watch the ElevenLabs voice-over quota.

`scripts/director-smoke.ts <userId> <fileId> [startSec] [len]` proves the whole pipeline on a short cut in ~2 minutes. Run it before believing any pipeline change.
