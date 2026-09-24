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

## DONE 2026-09-24 — Simplified Chinese everywhere, and glyphs that cannot drift

> The client, 2026-09-24: 乱码、字体错误、使用人员名称错误 — "garbled text, font
> errors, and incorrect user name displays."

Four separate causes were behind one complaint. All four are closed.

**1. The screen asked the reader's own machine for a Chinese font.** The
2026-09-23 pass named PingFang SC and Microsoft YaHei in the stacks, but named
them *before* any webfont, and no webfont was shipped at all. On a Hong Kong
Mac that resolves to PingFang HK and on a Hong Kong PC to Microsoft JhengHei —
Traditional cuts, which draw a different glyph for the same codepoint. One
screen, the script detail view, asked for `'PingFang HK'` by name. The site now
ships **Noto Sans SC** from `public/fonts/noto-sans-sc/` (101 unicode-range
subsets, 4.6 MB on disk, ~150 KB over the wire per page) and names it first in
every one of the 16 stacks. Refetch with `scripts/fetch-cjk-font.sh`.

**2. The box picked its own CJK font for renders.** `Noto Sans CJK` ships SC,
TC, HK, JP and KR in one file and fontconfig took whichever came first when
nothing declared a language, so a burnt-in subtitle or a Remotion still could
come back in Japanese letterforms. `/etc/fonts/local.conf` now pins the
Simplified cut; the file is kept in the repo as `scripts/fonts-local.conf`.

**3. Whisper writes Traditional.** It always has — Cantonese especially, and a
good deal of Mandarin. Nothing converted it, and the caption track it landed in
was labelled `zh-HK`, which was the **default everywhere**: captions, exports,
the director's own language field, the transcribe UI. So the platform was
generating Traditional subtitles and calling that correct. Now:
`lib/text/simplified.ts` converts Traditional to Simplified at the two seams
where text arrives — the transcript, and the model's own output — and `zh-HK`
is gone from every default and from the language pickers.

**4. Traditional text was already in the repo and the database.** 358 runs
across 57 files, and 84 values in Postgres. Both swept. `npm run build` and
`scripts/simplify-existing.ts` are both idempotent; a second run finds nothing.

### Notes for whoever is next
- `lib/text/simplified.ts` is **generated** by `scripts/gen-simplified.py` from
  OpenCC's `t2s` tables. Edit the generator. It matches OpenCC byte for byte
  over a 356-line corpus that covers every character and phrase in the table.
- The generator **drops the 1,120 conversions whose Simplified form is above
  U+FFFF**, because neither the shipped webfont nor the Noto Sans CJK SC that
  ffmpeg burns subtitles with has a glyph for any of them. The one that occurs
  in real Cantonese is 嗰 → 𠮶; converting it would have replaced a readable
  character with an empty box, which is the complaint this work started from.
- `zh-HK` survives in the Postgres `locale` enum only because removing a value
  needs a table rewrite. Nothing offers it and nothing defaults to it.

### Still open from the same message
- **使用人员名称错误** — the top bar shows the login name (`admin`) rather than
  the person's name and role. Separate fix; see §4 of the agentic brief.
- The rest of the 2026-09-24 brief (sidebar labels, resizable panels, the
  agent team, the article page) is untouched.

---

## DONE 2026-09-24 (evening) — the agentic pass

### The five AI employees
研究员 · 策划 · 编剧 · 剪辑师 · 撰稿人, the names the client's table asked for.
Three existed under other names; 策划 and 撰稿人 are new. Every old name is
kept as an alias, and `ensureAgent` brings a renamed employee's user row back
in step with `lib/agents/catalog.ts` when it is next used.

### Cards with buttons
`lib/agents/cards.ts`. A `say` button posts a prepared line **as whoever
pressed it** — same `postMessage`, same tag dispatch, same permission checks a
typed message gets — and an `open` button is a link to the screen holding a
real gate. Nothing on a card can approve, publish or spend. The press is
written onto the message (`meta.done`), so the card records who decided and the
server refuses a second press.

### What runs on its own
| | when | who |
|---|---|---|
| 每日晨报 | 08:00 HKT | 研究员 |
| 每日待办 | 08:05 HKT, reads the digest | 策划 |
| 新素材自动分析 | when an upload has been transcribed | 策划 |

All three are switchable on **Settings → 自动化**, including the Hong Kong time
and which employee signs it. pm2 now wakes `aura-digest` and `aura-plan`
**hourly** and the scripts ask the setting (`dueNow`) — a cron line in
`ecosystem.config.cjs` cannot be edited from a browser, and the client asked
for a page that changes this. Three-hour catch-up window, so a deploy at eight
makes the brief late rather than losing it.

### 首页
`/home`, where signing in lands. Say what you want (posts to the team channel
and tags whoever you name), everything waiting on a decision with its buttons,
then the five employees with what each is on. No state of its own: running jobs
say who is busy, the last thing an employee said says where it got to, an
unpressed card is the studio's turn.

### The rest of the P0 list
- **Sidebar labels** — the rail is a named list, open by default, collapsible,
  draggable, remembered.
- **Subtitles** — the gaps were `mapTime` returning null for an endpoint inside
  a trimmed silence, which threw away the whole line. Surviving words decide
  now. Lines are the aspect's own budget (16 Han for 9:16, 24 for 16:9), a
  sentence only breaks the line once it is worth reading, and Whisper gets an
  `initial_prompt` in punctuated Simplified so there is something to break at.
- **Script text** — beats are 16.5px on 1.8, up from 14px.
- **Chat file upload** — tested from a browser end to end: presign → PUT to R2 →
  complete, then two files attached and posted. It works. Multipart above
  64 MB is still only proven server-side.
- **Comments by platform** — already shipped; filter and group-by are both there.
- **添加选题** — already shipped (`components/canvas/AddTopicButton.tsx`).

### The research was the wrong research
This is the one worth reading twice. The morning brief was built from Google
Daily Search Trends, GDELT and Google News — what Hong Kong is *searching* —
so it came back about typhoons and football. Meanwhile 125 of the channel's own
videos, their view counts, their like rates and the questions its viewers typed
underneath them were in this database, read by nothing.

`lib/research/studio.ts` is the first half of every brief now: connected
accounts, the like-rate leaders (likes ÷ views, the only number that says
anything about the *subject* on a 253-subscriber channel), the view leaders,
and the audience's questions verbatim. Outside signals come second and are
labelled as outside. Same day, before and after: "谷爱凌 and a tropical cyclone"
became "21.7% like rate on the Nvidia power piece, 1,244 views and 8.1% on
香港五年规划, a viewer asking how RWA rental income is split" — with 庄太量
named and dropped as off-channel.

**Still thin, and worth doing next:** `competitors` is empty, so 对标账号 is a
screen with nothing on it. The TikHub key is set and `syncCompetitors` works,
but only for YouTube — the 抖音 / 小红书 / B站 / 微博 readers are not written.
That is the next real increase in research quality.

### Also done
- **@ picker** searches every name a colleague answers to (`@r`, `@研`, `@edit`,
  an email's local part), ranked rather than filtered, one shared hook for the
  chat and home boxes.
- **Access** — owner and admin hold owner on everything in their own studio
  (`runsTheStudio` in `lib/authz/rebac.ts`). Measured: owners and admins see all
  108 files; a member created from nothing sees 107, of which 102 are the stock
  library, which is deliberately shared.
- **Resizable panels** — audited: the rail, every module sidebar, the research
  sidebar, the agent dock, the files/script/trends/compare/inbox/backlog screens.
- **高级** — the video module's eight tabs are four, with the media bin, cut
  list, audio and graphics behind a fold.

### DONE later the same evening
- **对标账号 fills itself.** `who_makes_this` had been answering "nobody has
  posted about this" to every query because the model typed sentences and
  YouTube returns zero items for a narrow query with a recency window. It
  broadens until it answers and reports which query worked. A tagged employee
  now runs in its own trade rather than as "chat", so 研究员 gets six rounds
  instead of four — it was spending all four searching. And a turn that used
  tools and then produced no sentence reports what the tools found instead of
  "我暂时答不上来". Proven: pressed the brief's button, 研究员 found three HK
  channels on real view counts, added all three itself, and tagged 策划
  unprompted. 77 competitor videos synced.
- **The first pass reads the brief's length.** `lib/video/length.ts`: 45–58 秒,
  2 分钟, 2-3 minutes, 90 seconds, both languages, upper bound. Ten forms
  tested. The model is told the target and the arithmetic, and a backstop cuts
  to time the way a person does — opening stays, ending stays, middle gives
  way. A 2:53 plan against 58s comes out at 0:45.
- **Voice-over refuses up front** with the reason, instead of queueing a job
  that fails in the worker twenty minutes later and leaves a track pending for
  ever. `VOICEOVER_ENABLED=1` re-enables it without a deploy.
- **Uploads over 64 MB are proven from a browser.** A 570 MB file went up on
  2026-09-23 and is still in the store. Closing that as done.

### On ElevenLabs and Whisper
They do two different jobs and only one of them is replaced.
- **Speech to text**: Whisper on this box has fully replaced ElevenLabs Scribe.
  It is better here — no IP block, no per-minute cost, `large-v3-turbo` at
  ~3x realtime, and `TRANSCRIBE_BACKEND=local` does not fall back.
- **Speech out (voice-over)**: Whisper cannot do this. It is a transcriber; TTS
  is a different model. If the studio ever wants narration in a voice that is
  not 谢亚芳's, that needs a provider this server's egress can reach.
  `audio_tracks` is empty — nobody has ever used it — so this is a capability
  nobody currently misses.

### The demo video
`scripts/demo-video.mjs` drives the real site in a real browser, captions each
scene into the page so the recorder picks it up, and encodes an mp4. Nothing in
it is staged: it signs in as a real person, the numbers are the studio's own,
and the button it presses really does hand work to 编剧, who really does answer
while the tour is elsewhere. Re-run it after a change and the film is current.

    node --env-file=.env.local scripts/demo-video.mjs
    # -> docs/demo/tengya-demo.mp4

Two things the first take exposed and fixed: #制作's own description still said
"脚本助理 hands it to 视频助理", two colleagues who no longer exist by those
names, and a QA invite of mine was on screen in Settings. Channel descriptions
now follow the catalog the same way the agent rows do.

### DONE 2026-09-25 (early) — Ryan's "interconnected everywhere" list
> "When I enter article page I can already see ideas proposed. Same for
> script. And script can send to ai directly to start processing video. Also
> for trend page see if can select platform — TikTok, rednote, WeChat,
> YouTube, Weibo etc."

- **Proposals on every maker's page.** `lib/agents/proposals.ts` +
  `components/agents/ProposalsStrip.tsx`. Script, Articles and Video each open
  on a shelf from their own employee with 3–4 things to make and one button.
  Sources in order: this morning's plan (策划's to-dos addressed to that
  employee — `plan.ts` now stores the list in `meta.plan.list`), the topic
  backlog, a viewer's own question. The button is `startProposalAction`, which
  posts `@编剧 …` into #制作 as the person and dispatches — the same door as
  typing it.
- **Script → 剪辑师.** The make-video button now also tells 剪辑师 in #制作
  with the links (`sendScriptToVideoAction`), so the hand-off happens in one
  press instead of make-project-then-go-and-ask.
- **Platform switch on Trends.** `lib/research/platform-catalog.ts` (client
  safe) + `lib/research/platforms.ts` (server) + five TikHub readers in
  `lib/social/tikhub.ts`. Tabs: 此刻 (Google + YouTube HK, free, on page load),
  then 抖音 / 小红书 / 微博 / B站 / TikTok, each the platform's own hot list,
  fetched only when picked and cached 30 min. WeChat says it has no public
  list. Measured through the app's own readers: 抖音 51, 微博 85, B站 30,
  小红书 20, TikTok 15 rows. TikTok's explore endpoint takes no region, so that
  tab is global — the strip labels it as "what it is pushing", not Hong Kong.

### DONE 2026-09-25 (early) — "more agentic vibe"
Ryan looked and said the product still did not *feel* like employees at work.
Three things, all reading state that already exists:
- **The employees narrate their jobs.** `lib/agents/narrate.ts`, called from
  the worker loop. 剪辑师 says in #制作 when a render or a whole-video job
  starts, what came out when it finishes (cuts, length, target) and why when it
  fails. Only `video.export`, `video.direct`, `video.autoedit`; the plumbing
  (posters, proxies, peaks, feeds) stays quiet or the channel becomes a log.
  Retries do not say "starting" twice.
- **A pulse in the top bar, on every page.** `lib/home/pulse.ts` →
  `/api/pulse` → `components/shell/Pulse.tsx`. One rotating line: a running job
  with its percentage (green dot), or the last thing each employee said with
  the time. Polled every 20s; two indexed reads.
- **研究员's pick on Trends.** `components/research/ResearcherNote.tsx` reads
  the morning brief's 今天讨论 line back onto the Trends page with 加入关注 and
  让编剧写脚本, so the brief and the board are the same product.

### Still open
- **使用人员名称错误.** The top bar shows name and role correctly; the *data* is
  wrong. `admin@okbro.xyz` is called "admin", the owner account is called
  "Studio owner", there are two Ryans, and only 谢亚芳 has a Chinese name. This
  needs the studio to say what each person should be called — **do not invent
  Chinese names for them.** The suspended service principal no longer appears
  as a colleague called 定时任务, which was probably the half of this complaint
  that was ours.
- **Competitor readers** for the Chinese platforms (above).
- **Multipart upload from a browser** is still only proven server-side; the
  single-PUT path is proven end to end from Chrome.

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
so it is IP-based, not auth. The **old box `the old shared box` is accepted** — same
provider, same city, same AS — so it is that one address, not Cherry Servers
or NL.

Until support clears it, ElevenLabs traffic is relayed:

- Old box: nginx site `elevenlabs-egress`, listening on **127.0.0.1:4700 only**,
  `proxy_pass https://api.elevenlabs.io`.
- New box: `elevenlabs-tunnel.service` (autossh) holds an SSH tunnel
  `127.0.0.1:4700 -> the old shared box:127.0.0.1:4700`, so the API key never crosses
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

**Domain cutover done 2026-09-24:** the site is `https://tengya.media` (Cloudflare, orange, SSL Full strict). `APP_URL` flipped; `yt.okbro.xyz` 301s to it (kept on purpose — old links and cached chat previews still land). `server.okbro.xyz` (code-server) untouched. Rollback is one line, printed by `/root/cutover-tengya.sh`. Pending on the studio: an A record for `www` (→ 84.32.64.46, proxied). Sessions are per-host, so everyone signs in once more on the new domain.
