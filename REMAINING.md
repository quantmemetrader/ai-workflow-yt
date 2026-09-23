# What is left

Rewritten 19 Sep 2026, after the build described below. `PLAN.md` is the
strategy, `LAUNCH.md` the pre-flight checklist, `REVIEW.md` the defect list for
Market Research. This is the honest state of each module.

**Every module now renders its own screen from the database.** There is no
`DesignPreview` and no iframe anywhere in the product. `node scripts/wiring.mjs`
asserts that front to back: 46 checks, all passing.

---

## Where each module stands

| Module | State |
|---|---|
| Sign-in, sessions, permissions | Live. 12 interface permission checks pass. |
| Chat | Live. Channels, private groups, membership, DMs, unread counts, invites. |
| Files | Live. List / Grid / Gallery, thumbnails, folders, versions, sharing, trash, uploads to R2. |
| Market Research | Live, five screens. Known defects in `REVIEW.md`. |
| Script | Library, brief composer and detail live. Split editor and versions still to come. |
| Publish | **Live.** Channel board, caption with per-channel overrides, approval queue, publish log. |
| Admin | **Live.** People and entitlements, tokens, budgets, credentials, audit, knowledge, assembled prompt. |
| Finance | **Live.** Budget, cash, cost, spend requests with editable thresholds. |
| Accounting | **Live.** Manual: documents, balanced double entry, period close, CSV export. |
| Legal | **Live.** Templates, drafting, clause review, repository, compliance runs. |
| HR | **Live.** Leave, roles, candidates with consent and retention, employees and onboarding. |
| Video Edit | **Live.** Media bin, timeline, captions, FFmpeg render to 16:9 / 9:16 / 1:1. |

---

## 1. Shell and cross-module

Done on 19 September:

- [x] The nested-iframe spiral. `DesignPreview` deleted, `site-runtime.js`
      keeps navigation inside `/demo`, and the canvas breaks out of a frame
      rather than nesting in one.
- [x] A Spotlight-shaped command palette on ⌘K: places and permission-filtered
      file search, over the page, dismissed by Escape or a click outside.
- [x] Background collection survives leaving the page, with a toast that
      carries the source's own error.
- [x] The agent answers **inside** every module instead of navigating to Chat.
- [x] No browser `prompt`, `alert` or `confirm` anywhere. Real dialogs and a
      toaster.
- [x] Drag-resizable sidebars and agent panels, remembered per person.
- [x] Bold and italic show their result in the composer as you type.

Still open:

- [ ] **Phone.** Zero phone routes exist; ~55 phone artboards are drawn. The
      navigation pattern is decided (`Nav-Idea-A-Phone`). This is the single
      largest quantity of unbuilt design in the repo.
- [ ] Announcements channel (`Chat-Announce`) and two-step sign-in
      (`Login-Totp`) have artboards and no routes.
- [ ] Files: folder deletion is unimplemented, and the Access badge reads
      folder-level `canEdit` rather than the per-file relation.

## 2. Market Research

The five screens are live and **all fifteen defects in `REVIEW.md` are fixed**:
the atomic claim on a comment draft, Zernio's `200 {"success": false}`, the
sentiment 500, the competitor rows, the watch-through percentage, all of it.

Added since:

- [x] **Topics are filed into beats.** `guessBeat` classifies on create, and
      `scripts/backfill-beats.ts` filed the ones that predate it. Unfiled
      topics get their own row in the beats panel rather than disappearing
      from every filter.
- [x] **Suggested angles are real.** `lib/research/angles.ts` reads the
      headlines already collected and writes `topics.angles`, which was a
      column nothing had ever written. The pane said "ask your agent" and had
      no agent on it; now it has both.
- [x] **Google Trends**, through Google's own Daily Search Trends RSS — a
      feed, not the scraper the contract forbids. It is what the topic picker
      suggests from, in both Trends and Search & compare.
- [x] **YouTube's own Data API**: `mostPopular` by region, and search by view
      count. "Who is making this" ranks the channels making videos on a
      subject by what those videos earned, and watching one is a single press.
      TikHub stays for the platforms that have no public API; its YouTube
      discovery endpoints answer with empty lists, which is why this exists.
- [x] The agent is on **every** screen, Trends and Admin and Search and
      Settings included.

Still open:

- [ ] Heat is still article counts from Hacker News and Google News, because
      GDELT rate-limits this address. The YouTube key is now the better signal
      and is not yet wired into `heat`.

## 3. Script

- [ ] Split editor (`Script-Editor`): document left, house-style conformance
      right. This is the module and it has no route.
- [ ] Version history with a real diff (`Script-Versions`).
- [ ] Approve and lock (`Script-Lock`, `Script-Locked`).
- [ ] "Shared with me" returns nothing by construction: per-script ReBAC is
      not wired.

## 4. Publish

Live. What it does not do yet:

- [ ] Per-platform extras in the composer (YouTube category, Instagram first
      comment, LinkedIn visibility). The column exists; the controls do not.
- [ ] `/v1/tools/validate/post` is not called, so limits are not enforced
      before a send.
- [ ] No webhook receiver at `/api/webhooks/zernio`, so a publish result that
      arrives late is only seen on the next sync.

## 5. Video Edit

Live, and reshaped: the client's reference is one of their own interviews, so
this cuts real footage. Nothing here generates video and nothing here will.

Added 20 September:

- [x] **Make the video.** One brief, one button (or "make the video" to the
      assistant): footage on, transcribe, cut, design, render, in one job with
      each step on screen. `lib/video/director.ts`, `components/video/Director.tsx`.
- [x] **Punch-ins, cutaways, arrivals, punch captions** in the render, and
      as agent tools (`punch_in`, `add_broll`, `set_enter`, `make_video`).
- [x] **The creator's channel as memory**: `creator_videos`, the auto-written
      "Creator voice" knowledge row, the panel on Research, the daily re-sync.
- [x] **Research → script in one press** ("Write the script" on a topic, or
      `write_script` to the assistant), with the collected headlines as facts.
- [x] Script → video: "Make the video" on a script opens its cut.
- [x] The assistant's tool trace shows inline while it works; the editing
      modules get more tool rounds per turn.

- [x] **Speech to text**, through ElevenLabs Scribe, with word-level timings
      kept rather than discarded.
- [x] **Music and voice-over tracks**, mixed against the timeline, with
      ducking under speech.
- [x] **The house rules**, distilled from the studio's own reference work in
      `~/videoediting` into `lib/video/craft.ts` and built into the agent's
      prompt for this module. Mostly a list of things not to do, which is the
      part of a prompt that must not go missing.
- [x] **Captions with real presets.** Four of them — clean, spoken,
      broadcast, statement — drawn by libass from an ASS file the product
      writes, with one treatment each and word-by-word highlighting that runs
      off measured timings or not at all.
- [x] **Graphics**: titles, lower thirds, statements, chapter marks and end
      cards, designed in Remotion and composited by FFmpeg.

Worth knowing about the render architecture: the first version drew the whole
timeline through Chrome and cost **thirteen seconds a frame** on this box,
because the machine shares its 32 cores with a ClickHouse server and a BSC
node. Each graphic is now rendered once as a transparent still (~11s) and
FFmpeg does the fade and the slide; captions never touch Chrome at all.

What it does not do yet:

- [ ] No waveform, no scrubbing preview: trimming is by timecode. This is the
      largest remaining gap against CapCut or VN.
- [ ] Transitions between cuts are hard cuts only.
- [ ] The graphic presets are five. The hook catalog in `~/videoediting/HOOKS.md`
      describes thirteen, and the good ones are animated rather than still.

## 6. Finance, Accounting, Legal, HR

All four live, built on defaults rather than on a wait, at the client's own
direction on 19 September.

- [ ] Finance: no reports screen beyond the period figures; team-scoped budget
      caps show a cap and no spend, because `ai_usage` records a person and a
      module, not a team.
- [ ] Accounting: no bank reconciliation, and the export is CSV only.
- [ ] Legal: clause review compares numbered clauses textually. It is
      deliberately mechanical and says so.
- [ ] HR: no payroll, and leave does not check a request against the balance
      before approving it, only after.

## 7. Operational, before anyone outside the team uses it

- [ ] **TLS on the box.** `http://84.32.176.16:3300` sends passwords in the
      clear and `COOKIE_SECURE=false` is set because of it.
- [ ] **OpenRouter has no credit.** The assistant runs on rate-limited free
      models. US$20 and deleting the two `AI_MODEL_*` pins fixes it.
- [ ] **GDELT rate-limits this address.** Its error is now on the Compare
      screen instead of hidden in a tooltip, and a degraded series is
      re-collected after an hour rather than cached for twelve. More sources
      would be a better fix than more retries.
- [ ] **Postgres is in Singapore, the app is in Amsterdam.** ~250 ms a query.
- [ ] **No scheduled backups.** `npm run db:backup` exists; nothing runs it.
- [ ] The Vercel copy is behind the box and needs a redeploy.
- [ ] An abandoned agent turn can still spin until the nightly sweep runs.

---

## Proving it

```bash
node scripts/wiring.mjs          # 46 checks, front to back, against Postgres and R2
node scripts/permissions-ui.mjs  # 12 checks: what each role actually sees
npm run smoke                    # the spec's §9 permission cases
npm run deploy                   # typecheck, smoke, build, zero-downtime reload
```
