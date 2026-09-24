# HANDOFF — 腾亚创变 / Tengya AI video platform

Written 2026-09-25 (HKT) at the end of a long session, for whoever picks this up next.
Everything here was verified in that session unless marked *unverified*.

## 1. What this is

- Internal platform for 腾亚创变 (Tengya), a Hong Kong finance/tech video studio. Live at https://tengya.media.
- Client contact: Ryan (WhatsApp +852 5167 6504). Studio staff seen in the DB: Catherine (admin), Avon, two accounts named Ryan, "Studio owner", "admin" (admin@okbro.xyz). **Real names / Chinese names for these accounts are still unknown — do not invent them.**
- Client brief (the spec everything follows): `~/Downloads/+852 5167 6504/tengya-agentic-prompt.md` on Rahul's Mac.
- The product idea in one line: five AI employees (研究员 research, 策划 planning, 编剧 script, 剪辑师 video, 撰稿人 article) that talk in chat channels, hand work to each other, and put buttons under what they say; a person says yes and moves on.

## 2. Server and repo

- Box: `ubuntu@84.32.64.46` (also `root@84.32.64.46`). Ryzen 7700X, 63 GB RAM, plenty of disk. Only `root` and `ubuntu` users — do not create personal users.
- Repo on the box: `/home/ubuntu/projects/aiVideoFreeLance`. GitHub: `quantmemetrader/ai-workflow-yt` (**public** — check what you stage; never commit `.env.local`).
- Commit identity: `git -c user.name=quantmemetrader -c user.email=quantmemetrader@users.noreply.github.com commit …`. Push uses a stored PAT already configured on the box. **No "Co-Authored-By: Claude" / "Generated with Claude Code" lines in commits** (owner's rule).
- Next.js 16 App Router, `output: standalone`. `npm run deploy` = typecheck → smoke → build → `pm2 reload` (rolling) → health check on :3300. A deploy causes a few seconds of 502 through Caddy; that is what "the site is down" was on 2026-09-24 evening — Caddy logs showed 5xx only at deploy times.
- pm2 apps: `aura` (4 cluster instances, port 3300), `aura-worker` (×2, job queue), cron-style: `aura-digest` (hourly, posts 08:00 HKT brief), `aura-plan` (hourly, 08:05 to-dos), `aura-research`, `aura-social`, `aura-social-daily`, `aura-sweep`, `aura-backup`. Config in `ecosystem.config.cjs`. Logs in `logs/`. `pm2 logs aura --lines 200 --nostream`.
- Caddy fronts it (`server.okbro.xyz` box; tengya.media site). Access log via `sudo journalctl -u caddy`.
- DB: Neon Postgres. Connection string in `/root/.neonuri` (root only): `ssh root@84.32.64.46 'psql "$(cat /root/.neonuri)" -c "…"'`. Schema in `lib/db/schema/*.ts` (drizzle). **Migrations only via `npx drizzle-kit generate`** — hand-written SQL got ignored once.
- Env: `.env.local` on the box (never print it). Keys that matter: OpenRouter, DeepSeek fallback, YouTube Data API, `TICKHUB_TOKEN` (TikHub; note the spelling, both `TIKHUB_TOKEN`/`TICKHUB_TOKEN` are accepted by `lib/env.ts`), R2 storage, Neon.
- Running a TS script on the box: `node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/<x>.ts` (must be run from the repo dir; tsx compiles to CJS, so **no top-level await** in ad-hoc scripts — wrap in `async function main()`).
- Verification pattern used all session: Playwright is installed on the box (`chromium` full build). Put a `.mjs` under `scripts/` (so `playwright` resolves), log in with the Catherine test account (default credentials live in `scripts/demo-video.mjs`), screenshot to `/tmp/boards/`, `scp` back. Chrome MCP from the Mac was flaky; prefer this.
- Whisper (local) is the transcription backend. ElevenLabs is disabled (`VOICEOVER_ENABLED` unset). Fonts: self-hosted Noto Sans SC; Simplified-only text everywhere (`lib/text/simplified.ts`, applied at Whisper/LLM seams).
- Design boards (Claude Design artifact, approved Home + Flow): https://claude.ai/artifact/RaTKRjVZ3KK5zF5f4Hh4rT — files under `project/*.dc.html`. The scratchpad generator (`gen2.py`) is ephemeral; the artifact holds the boards.

## 3. Architecture map (where things live)

- Rail/nav: `lib/nav.ts` (`NAV`, `parked: true` hides Articles for now), `components/canvas/Rail.tsx`, top bar `components/shell/TopBar.tsx`, pulse `components/shell/Pulse.tsx` + `lib/home/pulse.ts` (shows only running jobs and cards waiting on a person).
- Agents: `lib/agents/catalog.ts` (keys, labels, aliases, `AGENT_COLORS`, `agentKeyFromEmail`, `parseAgentMentions`), `lib/agents/index.ts` (agent user rows `<key>@agents.invalid`, `postAsAgent`, channels 研究日报/制作), `lib/agents/mentions.ts` (dispatch: `MAX_HOPS = 1`, `MAX_REPLIES = 3`, an agent's reply hands off to at most one colleague; the prompt rules forbid tagging when merely answering and forbid claiming work not done with a tool), `lib/agents/cards.ts` (buttons under messages), `lib/agents/handoff.ts` (script approved → 剪辑师), `lib/agents/footage.ts`, `lib/agents/narrate.ts`, `lib/agents/proposals.ts` (what each maker's page proposes: plan to-dos, researched backlog topics, viewer questions; never backlog for 剪辑师).
- AI: `lib/ai/agent.ts` (tool loop), `lib/ai/openrouter.ts` (`complete`, `streamChat`), `lib/ai/models.ts` (`modelFor.assistant/drafting/utility`, fallbacks), `lib/ai/prompt.ts` (base prompt + built-in VIDEO_CRAFT and RESEARCH_CRAFT — research must cite tool results for every figure).
- Chat: `lib/chat/service.ts` (`channelThread` now returns `authorEmail`), `app/(app)/chat/actions.ts` (`sendChannelMessage`, `pressCardAction`), `components/chat/ChannelSurface.tsx` (message list; scroll bug fixed — spacer instead of `justify-content: flex-end`; answered cards show a tick), `components/chat/MentionMenu.tsx` (`AgentMark` now delegates to `components/agents/AgentIcon.tsx`, one glyph+colour per employee).
- Home: `app/(app)/home/page.tsx`, `components/home/HomeScreen.tsx` (board look: dotted paper, square panels), `PipelineStrip.tsx`, `Echo.tsx`; data `lib/home/service.ts` (`readHome`, `JOB_OWNER`, `JOB_NAMES`) and `lib/home/pipeline.ts` (`pipelineToday`: 8 stages from digest/plan messages, scripts, approvals, video projects, jobs, publish posts, comments).
- Flow page: `app/(app)/flow/page.tsx`, `components/flow/FlowScreen.tsx` (12 nodes at the board's coordinates, SVG arrows, automation switches via `setAutomationAction`). Automations: `lib/automations/service.ts` (digest/plan/footage in `settings` kv; HKT; `dueNow` 3h catch-up).
- Research: `app/(app)/research/page.tsx`, `components/research/TrendsView.tsx` → `components/canvas/TrendsScreen.tsx` (old topic board; its StatusStrip removed), `components/research/LiveNow.tsx` (platform chips, picks card, hot-list table, side panel), `lib/research/platforms.ts` (`platformHot`, in-process 30-min cache), `lib/research/platform-catalog.ts`, `lib/social/tikhub.ts` (readers: 抖音 with covers, 微博, B站, 小红书 inspiration with covers, TikTok explore = global), `lib/research/youtube.ts`, `lib/research/judge.ts` (研究员 marks rows it can tie to channel data; `deepseek-v4-flash`; in-process cache), `app/api/research/hot/route.ts` (**GET**, not a server action — see §5), `lib/research/studio.ts` (`studioBrief` = the channel's own numbers), `app/api/img/route.ts` (picture proxy allowlist incl. xhscdn/ci.xiaohongshu/douyinpic/hdslb/sinaimg/tiktokcdn).
- Script: `app/(app)/script/[id]/page.tsx` → `components/script/DetailView.tsx` → `components/canvas/ScriptDetailScreen.tsx` (2.9k lines; right panel has a new first tab 流程 = `components/script/RunPanel.tsx`, data `lib/script/run.ts`).
- Video: `components/video/VideoScreen.tsx`, `lib/video/*` (autoedit, length budget, captions), `lib/video/service.ts` (`projectFromScript`, `requestAutoEdit`).
- Digest/plan scripts: `scripts/digest.ts`, `scripts/plan.ts` (also runs `ensureAllAgents`). Worker: `scripts/worker.ts`.
- Backlog of client asks with DONE sections: `CLIENT-BACKLOG.md`.

## 4. Commits from the 2026-09-24/25 session (newest last)

`4a94a35` Home shows the answer; answered cards; chat scroll; per-agent icons; /flow; pulse; Articles parked
`3b539d8` Trends table with 研究员 reading
`722659a` Script 流程 panel
`b4afbaa` Home waits only when an agent was tagged
`ab7e02b` Agents answer the person (hop/tag rules); Home stops dumping the channel
`b179d62` 研究员 sources every figure from tool results
`b6f6ae9` 抖音 covers, pick pictures (later removed), TikHub plain note, Undecided strip gone
`b43af7f` Home and Flow are the approved boards
`fb7246c` Research sidebar stops reporting plumbing; test phrases not proposals
`3a663dc` No pictures on picks
`ec63248` Hot list + 研究员 reading are GETs (navigation no longer blocks)

## 5. Lessons that cost time (do not repeat)

- **Never put a slow call in a Next server action.** The app router queues navigations behind in-flight actions. A 30 s model call in an action made the Home button dead on /research; the client thought the site was down. Long reads go through route handlers + `fetch`.
- In-process `Map` caches (`platforms.ts`, `judge.ts`) are per pm2 instance (4 of them) and die on deploy. If warm data matters, store it in the `settings` kv table (or a table) and warm it from a cron.
- React Compiler lint rules are on: no `setState` inside effects, no `Date.now()`/refs read during render. Derive state or move it server-side.
- Chinese literal text in patch scripts: write the Python file locally with real characters and `scp` it; `\uXXXX` escapes did not match.
- macOS `tar` adds `._*` AppleDouble files; delete them on the box after extracting (`find . -name "._*" -delete`).
- The Home/Flow "kit": there is no Frappe UI. Styling is inline + `app/canvas.css`. The client approved the *board* look (dotted paper, square corners, hairline panels, one colour per employee, black gradient / white hairline buttons, gradients only on borders and arrows).

## 6. Data: what is real, what is junk

Real: channel's own YouTube videos (`creator_videos`), comments (`comments`), competitors (Ricacorp, 香港華爾街, 吴说不加密播客 + posts), YouTube HK chart, Google HK trends, TikHub hot lists (抖音 51 rows, 小红书 20, 微博, B站, TikTok global), digest/plan messages with `meta.digest.date` / `meta.plan.{date,list}`.
Junk: watch-phrase topics typed as tests by the Studio owner (arsenal, goat, nvidia, blockchain, ai crypto, consumer, 谷爱凌) — they drive the 关注列表 and 搜索与对比 chart. Not deleted (client rows); the proposal shelves now ignore topics without a summary. A script titled "hi" is also a test.
Model output can still be wrong: `RESEARCH_CRAFT` demands sources, but re-verification after that rule was not done.

## 7. Open items (as of this handoff)

1. **Warm, shared hot lists**: move `platformHot`/`judgeHot` caches into the `settings` kv (keys like `hot:<platform>`, `hotjudge:<tenant>:<platform>`), add `scripts/warm-hot.ts` + a pm2 cron app every ~20 min, and have `/research` render with all platforms preloaded (pass `preloaded` into `LiveNow`). Client asked for this ("hot load all of it on server").
2. **Pictures on the picks**: client wants an image from the internet per pick (not a dot). Plan: YouTube `searchVideos` (exists in `lib/research/youtube.ts`) → first result thumbnail, cached ~6 h. Do not reuse the channel's own stills (that put the same face on every row).
3. **Rail**: client wants it "like before": bigger, with icons and badges (unread chat count, cards waiting). Badges are not implemented on the rail today.
4. **Backlog and Video screens** show "too much stuff" per client; simplify (the video project header block, the backlog kanban headers).
5. **Account names** — blocked on the client.
6. Test messages: Catherine's test question "这周香港有什么值得拍的…" and its answer are in #制作 (2026-09-24 20:31 UTC); older test presses by Catherine exist too. Delete only if asked.
7. Unverified since the change: an 08:00 HKT unattended digest/plan run with the new agent rules; 撰稿人 has never run.

## 8. Rules from the owner (Rahul)

- Simplified Chinese only in product text; English toggle exists (简/EN in chat sidebar). Chrome auto-translate confuses screenshots — ask which one they are looking at.
- Same API keys are fine; never print `.env.local`.
- Fix things end to end and verify with screenshots before saying done; he checks the live site immediately.
- He is resource-constrained locally (8 GB Mac) — do heavy work on the box.
