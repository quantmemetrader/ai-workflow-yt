# Ship plan — every module, in order

Written 18 Sep 2026. This is the working plan; `LAUNCH.md` stays the
pre-flight checklist and `README.md` stays the description of what runs.

---

## 1. What changed today

Your credentials document had two keys I had never identified, sitting unused
in `.env.local`. I checked both against your live accounts. They are not
spare parts — between them they unblock **three** things I had written off as
"waiting on the client".

### `ZERNIO_API_KEY` — your own accounts (read **and** write)

[Zernio](https://zernio.com) (formerly getlate.dev), 502 endpoints. Key is
live. Already connected to it:

| Platform | Account | Followers | Token | Can post | Can read analytics |
|---|---|---|---|---|---|
| YouTube | `@yafanghk` (谢亚芳-创变派) | 248 | valid | yes | yes |
| LinkedIn | 亚芳 谢 | 79 | valid | yes | yes |

It is already holding **58 published posts** with per-post analytics
(views, likes, comments, engagement rate, thumbnail, permalink), synced
today. The YouTube OAuth grant includes `youtube.force-ssl` and
`yt-analytics.readonly`, so replies and retention data are both in scope.

Endpoints that matter to us:

- `GET /v1/inbox/comments`, `…/{postId}` — comments on our own posts
- `POST …/{commentId}/reply`, `/hide`, `/moderation`, `/pin`, `/private-reply`
- `GET /v1/analytics` + `/analytics/youtube/{channel-insights,daily-views,demographics,video-retention}`
- `POST /v1/posts` (schedule/publish), `/posts/{id}/retry`, `/unpublish`
- `GET /v1/accounts/health` — connection state, scopes, token expiry, issues
- `POST /v1/tools/validate/post`, `/validate/post-length` — real platform limits
- `GET /v1/connect/{platform}` — one-click connect for Instagram, TikTok,
  WeChat Channels, Xiaohongshu, Threads, X, Facebook, Pinterest, Reddit…
- `POST /v1/media/presign` — push a finished render straight from R2
- `POST /v1/webhooks/settings` — publish-result callbacks

### `TICKHUB_TOKEN` — the outside world (read only)

[TikHub](https://tikhub.io), 1047 endpoints, 70 scopes, no expiry. Key is
live and covers YouTube, Instagram, TikTok, Douyin, Xiaohongshu, WeChat
Channels + MP, Bilibili, Weibo, Threads, X, Reddit, Kuaishou, Zhihu, Lemon8.

This is the half Zernio cannot do: **anyone's** channel, not just ours.
Competitor video lists, view counts, comments, hashtag and keyword search,
trending boards. Verified against our own channel — it returned all 30
videos and their real comments.

### What that unlocks

| Was blocked on | Actually have |
|---|---|
| "YouTube comment API, authorised on the studio's channel" | Zernio holds exactly that grant. Read, reply, hide, mark spam. |
| "Instagram and WeChat comment permissions" | One `GET /v1/connect/{platform}` each. No new key. |
| "TikTok has no commercial comment API" | True of TikTok's official API. TikHub reads them anyway; Zernio posts to TikTok. So the column is **not** empty by design. That claim in `NotConnected` is wrong and comes out. |
| Content performance — "no analytics source" | 58 posts of real analytics, plus YouTube retention and demographics. |
| Publish module — "no channels connected" | Two connected and healthy today; the rest are a click. |

**Cost note.** Both vendors meter per request. TikHub charges per call
("This request will incur a charge"); Zernio is usage-based billing. So
every call from our side goes through the job queue and `series_cache`-style
caching, never straight off a page render. Same discipline as GDELT.

---

## 2. Where we actually are

Honest count, not flattering:

- **125 artboards** in `design/canvas/` (111 placed on the canvas), covering
  11 modules, desktop **and** phone.
- **~9 of them are live**: Login, Chat conversation, Chat channel, Files,
  Research Trends, Search & compare, Topic backlog, Search, Settings.
- **0 phone routes exist.** Every phone artboard is unshipped.
- 36 tables exist. Chat, Files, ReBAC, agent, ledger, knowledge, jobs and
  Research are modelled. There is **no** table yet for publishing, channels,
  scripts, video projects, renders, ledger documents, contracts, leave,
  requisitions or spend requests.
- 8 modules render `<DesignPreview>` (an iframe of the artboard). 2 Research
  screens render `<NotConnected>`.

So: the foundation is real and the shell is real. The modules are not.

---

## 3. What "perfect" means — the gate every module passes

No module is called done until all nine hold. I will run these, not claim them.

1. **Every artboard in the module has a real route.** Desktop and phone. No
   iframe, no `DesignPreview`, no `NotConnected`.
2. **Pixel-faithful.** The screen is a transcription of the `.dc.html`, same
   as `TrendsScreen`/`FilesScreen` are. If the design needs to change, the
   artboard changes first and the component follows.
3. **Every control does something.** A button that cannot work yet is not
   shown greyed — it is not shown. No hint rings, no sample rows, no number
   on screen that did not come from Postgres or a named API response.
4. **Permission-filtered in SQL, not in the page.** Every list query carries
   the ReBAC predicate. `scripts/permissions-ui.mjs` grows a case for the
   module proving a member and a guest see different things.
5. **Proven front-to-back.** `scripts/wiring.mjs` grows a check per writing
   action: do it in the browser, find the row in Postgres / the object in R2 /
   the record at the vendor, then clean up after itself.
6. **Every external call is a job.** Queued, retried with backoff,
   idempotency key, cost recorded, provider error preserved. Nothing hits a
   vendor from a page render.
7. **Three languages.** zh-CN, zh-HK, en. Nothing hardcoded English.
8. **Clean.** `npm run typecheck`, `npm run lint`, `npm run build` — zero.
9. **Traceable to the spec.** Each screen names its §-reference from
   `01_Build-Spec 2.pdf` in a comment, and anything the spec asks for that we
   deliberately are not doing is written down here, not silently dropped.

---

## 4. The order

Reasoning: finish what is half-built, then take the modules whose data we
already hold, then the ones needing credentials we do not have yet — so the
waiting happens in parallel with work rather than instead of it.

### Stage 1 — Finish Market Research  ·  **done**

All five screens are live. Built 18 Sep 2026.

What landed: `lib/social/zernio.ts` and `lib/social/tikhub.ts` (the two vendor
clients, with the read/write split held apart on purpose), migration `0006`
(`channels`, `channel_posts`, `post_metrics`, `comments`, `comment_drafts`)
and `0007` (views per day), `lib/social/ingest.ts` (five jobs), and
`lib/social/service.ts` (what the screens read). `aura-social` runs hourly,
`aura-social-daily` at 20:40 UTC.

Real numbers on the box today: 2 channels, 60 posts, 1,412 daily-view points,
9 comments read and classified, 7 replies drafted and waiting for a person.

Three things worth remembering from building it:

- **Zernio's comment envelope is inconsistent.** The list of posts comes back
  under `data`, the comments on one post under `comments`. Reading the wrong
  one is a silently empty inbox, not an error.
- **Zernio reports 0 for metrics the platform did not send.** A table of
  "0.0%" watch-through down every row is precisely the invented number the
  brief forbids, so zero becomes null in `ingest.ts` and the screen says "not
  reported". The real figure comes from YouTube Analytics' own
  `averageViewPercentage`.
- **Cumulative and per-day views are different quantities.** Summing the
  cumulative one across a window counts every view once per day the post has
  existed. They are two columns (`views`, `views_day`), and the chart uses the
  second.

Still to do here: Trends does not yet show TikHub competitor rows, and the
Agent panel is now a shared component (`ResearchAgentPanel`) used by the two
new screens while Trends and Backlog still carry their own inline copies.
Fold those two in when either is next touched.

- **Content performance** (`Res-Perf`, `Res-Perf-Phone`) — Zernio
  `/v1/analytics` for the post table; `/analytics/youtube/daily-views` and
  `/video-retention` for the time series and watch-through; per-channel split
  once more accounts connect. Defaults to last 28 days per spec §4.3.
- **Comment inbox** (`Res-Inbox`, `Res-Inbox-Phone`) — Zernio
  `/v1/inbox/comments` grouped by post. Sentiment / language / flagged /
  lead classification by the agent, written to the row, not computed on
  render. Reply drafts are drafts: a row with `approved_by` null, visually
  unmistakable, and `POST …/reply` only fires after a named human approves.
  Bulk hide and spam via `/hide` and `/moderation`.
- New tables: `channels` (our connected accounts, mirrored from Zernio),
  `channel_posts`, `post_metrics`, `comments`, `comment_drafts`.
- New jobs: `zernio.sync-accounts`, `zernio.sync-analytics`,
  `zernio.sync-comments` (worker, on a schedule via `aura-research`).
- Also: delete the TikTok "no commercial API" claim — it is no longer true
  for us.
- Also: TikHub-backed competitor rows on the Trends screen, since that is
  what the outside-world key is for.

### Stage 2 — Script  ·  size M  ·  nothing blocked

You asked for this one directly. Pure internal — agent, retrieval, versions.
No vendor.

Artboards: `Script-Library`, `Script-Brief`, `Script-Editor`,
`Script-Versions`, `Script-Lock`, `Script-Locked` + 7 phone.

- Library with the folder rail, counts per stage (Briefs / Drafting /
  Awaiting approval / Locked), sort, filtered to scripts you can read.
- Brief intake form → creates the script, carries the topic across from
  Research backlog hand-off (the backlog already marks "ready", this is the
  other end of that wire).
- Split editor: document on the left, house-style conformance on the right —
  flagged terms, spoken duration, reading level, per-suggestion accept/reject,
  natural-language rewrite on a selection. House style comes from the
  `knowledge` table through `lib/ai/prompt.ts`, retrieval over approved
  reference docs. No fine-tuning (spec §4.4).
- Version history with a real diff.
- Approve-and-lock: one authorised version, an approval record with a named
  approver, and the locked version is what Video receives.
- New tables: `scripts`, `script_versions`, `script_suggestions`,
  `approvals` (generic — Publish reuses it).

### Stage 3 — Publish  ·  size M  ·  nothing blocked

Zernio covers the whole of spec §4.6, and the studio has live channels.

Artboards: `Pub-Channels`, `Pub-Composer`, `Pub-Approvals`, `Pub-Log` + 4 phone.

- **Channel board** — `/v1/accounts/health` gives connection state, scopes,
  token expiry, issues, quota. Connect more via `/v1/connect/{platform}`.
- **Composer** — master version + per-channel overrides, limits enforced by
  `/v1/tools/validate/post` rather than by numbers we invented.
- **Approval queue** — nothing leaves without an approval record naming a
  person. This is ours, not Zernio's.
- **Publish log** — `POST /v1/posts` on approval; platform response, URL and
  error stored verbatim; `/posts/{id}/retry` is safe because the job carries
  an idempotency key.
- Webhook receiver at `/api/webhooks/zernio` for publish results.
- Reuses `channels` / `channel_posts` from Stage 1. New: `publish_items`,
  `publish_overrides`, `publish_log`.

### Stage 4 — Admin  ·  size M  ·  nothing blocked

Almost entirely screens over tables that already exist — the cheapest large
win, and it ends the era of adding people with a shell script.

Artboards: `Adm-People`, `Adm-Ent`, `Adm-Tokens`, `Adm-Budgets`,
`Adm-Channels`, `Adm-Audit`, `Adm-Know` + 7 phone.

- People (`users`), entitlements matrix (`entitlements`, editable in place),
  token dashboard (`ai_usage` — by module, by employee, by model, CSV,
  stated lag), budgets (`budgets` — already enforced by `lib/ai/ledger.ts`),
  channels & credentials (Zernio health + our own key inventory; **keys
  referenced, never displayed** per spec §8), audit log (`audit_log`,
  filterable, admin file access included), knowledge & skills (`knowledge` /
  `knowledge_versions` — four kinds, three scopes, diff, rollback, active
  toggle).
- Builds the **assembled-prompt preview**, currently a known gap:
  `lib/ai/prompt.ts` already assembles it, nothing shows it.
- New tables: `invites` exists but is unused — wire it, and add
  `spend_requests`? no, that is Finance.

### Stage 5 — Video Edit  ·  size L  ·  **blocked on credentials**

The heaviest module and the only one with hard external dependencies we do
not hold. Flagged now so the waiting overlaps stages 1–4.

Artboards: `Video-Library`, `Video-Project`, `Video-Bin`, `Video-Queue`,
`Video-Preview`, `Video-Audio`, `Video-Export` + 7 phone.

Needs from you (spec §7):
- Google Cloud **Vertex AI** service-account JSON with Veo 3.1 enabled, and
  the project/region
- **ElevenLabs** API key (Music)
- **Azure Speech** key + region, zh-HK voice
- FFmpeg we run ourselves on the box — no key needed

What I build regardless: project workspace against a locked script, shot
cards per beat, media bin filtered by ReBAC, render queue with
state/progress/provider/attempts/cost rolled to the project, preview with
16:9 / 9:16 / 1:1 and version compare, audio panel, multi-format export with
subtitles and cover archived to R2.

New tables: `video_projects`, `shots`, `renders`, `audio_takes`, `exports`.
New job types: `veo.render`, `speech.synthesize`, `music.generate`,
`ffmpeg.assemble`. Provider outputs copied to **our** R2 immediately (§6).

### Stage 6 — Finance  ·  size M  ·  needs your chart of accounts

Artboards: `Fin-Budget`, `Fin-Cash`, `Fin-Cost`, `Fin-Spend`, `Fin-Reports`
+ 5 phone.

The cost dashboard is nearly free — `ai_usage` is already the token ledger
the spec asks it to include. The rest needs your numbers: departments,
projects, periods, and the approval thresholds that decide who signs a spend
request.

New tables: `budget_lines`, `actuals`, `spend_requests`,
`approval_chains`, `finance_reports`.

### Stage 7 — Accounting  ·  size M  ·  **blocked on an OCR provider**

Artboards: `Acc-Inbox`, `Acc-Drafts`, `Acc-Period`, `Acc-Export` + 4 phone.

Needs from you: an extraction provider (Azure Document Intelligence or
Google Document AI — either is fine, pick one), your chart of accounts, and
which system the export targets (Xero / QuickBooks / MYOB / CSV).

Drafts only — nothing posts without a confirmation, per spec §4.7. Export
goes behind a pluggable interface so the target can change.

New tables: `documents`, `extractions`, `journal_drafts`, `journal_lines`,
`accounts`.

### Stage 8 — Legal  ·  size M  ·  needs your templates

Artboards: `Legal-Draft`, `Legal-Clause`, `Legal-Repo`, `Legal-Compliance`
+ 4 phone.

Agent-driven; no vendor. Needs your own contract templates and merge fields.
Clause review marks departures with explanations and never renders a verdict;
the non-advice disclaimer (contract Clause 8.4) is standing on every screen.

New tables: `templates`, `contracts`, `clause_findings`,
`compliance_checklists`, `checklist_runs`.

### Stage 9 — Human Resources  ·  size M  ·  needs your policy

Artboards: `Hr-Gate`, `Hr-Leave`, `Hr-Recruit`, `Hr-Candidates`,
`Hr-Employees` + 5 phone.

Needs from you: HK leave entitlement policy, the approval routing, and which
job channels you hold accounts on. Candidate records carry consent and
retention dates, and there is **no** external sourcing or scraping —
Schedule A3(8). The `hr` scope gates every screen, including from the agent.

New tables: `leave_requests`, `leave_balances`, `requisitions`,
`candidates`, `applications`, `interviews`, `employee_records`,
`onboarding_tasks`.

---

## 5. Cross-cutting, after the modules

### Phone layer — size L
Every module above ships its phone artboards in its own stage, not in a
catch-up sprint at the end. Listed here only because it is the single
largest quantity of unshipped design: ~55 phone artboards. The navigation
pattern is already decided (`Nav-Idea-A-Phone`, bar + briefcase).

### Chat gaps — size S
Announcements channel (`Chat-Announce`) has an artboard and no route.
Two-step sign-in (`Login-Totp`) likewise.

### Files gaps — size S
Grid and gallery views exist in `FilesDesktop.dc.html`; only List is shipped.
Folder deletion is unimplemented. The Access badge is derived from
folder-level `canEdit` rather than the per-file relation — wrong in a case
that matters.

### Known defects to clear before launch
- An abandoned agent turn can leave a message spinning forever.
- OpenRouter credit is not topped up.
- No TLS on the box (IP:port only, your call for now).
- No scheduled backups.
- 155 files uncommitted, no git history. **The box is the only copy of this
  work.** This should stop being true today.

---

## 6. What I need from you

Nothing for stages 1–4. Those start now.

To keep stage 5 from stalling, these three, in rough order of lead time:

1. **Google Cloud Vertex AI** service-account JSON, project id, region, Veo
   3.1 access enabled
2. **ElevenLabs** API key
3. **Azure Speech** key + region

Then, when their stages come up: an OCR provider choice (7), your chart of
accounts (6, 7), contract templates (8), leave policy (9).

One free win any time you like: open Zernio and connect Instagram, TikTok,
WeChat Channels and Xiaohongshu. No new credentials, and every one of them
immediately appears in the Comment inbox, Content performance and the
Publish channel board.
