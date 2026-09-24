# Progress log — Aura Farmers video-agent platform

Read this file first, every session, before re-exploring the repo or the
server. It exists so we don't re-derive context (and burn tokens) each
time. Update it whenever a phase of work finishes — append, don't rewrite
history.

**Server:** `ssh root@the old shared box` (`endless-spaniel`). Repo at
`/home/ubuntu/aiVideoFreeLance`. Code-server (browser VS Code) at
`https://clickhouse-code-server.polyinsiders.com/?folder=/home/ubuntu/aiVideoFreeLance`.
Full connection details in `~/Desktop/server-84-guide.md` on the Mac.

**Shipped frontend (client-approved UI, do not redesign without reason):**
https://ai-workspace-video.vercel.app/ — Next.js 16 / React 19, scaffold
stage. All posting happens manually today; nothing is wired to a live
backend yet (no auth, no DB, no agent).

## What the product is

Internal work platform for Aura Farmers, Inc. — one AI agent per employee,
eleven module surfaces (Chat, Files, Market Research, Script, Video Edit,
Publish, Accounting, Finance, Legal, HR, Admin), permission-filtered
throughout (ReBAC, checked at query time not index time). Default locale
Traditional Chinese (HK), English toggle. Desktop only.

**Source of truth:** `01_Build-Spec 2.pdf` (v2.4, 15 Aug 2026) in the repo
root. Spec wins over code on any disagreement. Companion docs in the repo:
`README.md` (stack + status), `SETUP.md` (every external account/key
needed and who gets it), `design/product-brief.md` (per-screen product
requirements, no visual spec — that's deliberate, visuals come from the
design system).

**Design canvas:** `design/canvas/*.dc.html` — every screen already
designed (hand-authored via `.mjs` generator scripts per module, e.g.
`publish-screens.mjs`, `research-screens.mjs`). These are the actual
approved designs; `app/(workspace)/*` in Next.js is currently just stub
pages per route with no logic behind them yet (per README "Status:
Scaffold stage").

## Publish module — what's already decided (from spec + design)

Channel board · Composer (per-channel caption/title/tags/thumbnail/
schedule with a master + overrides, character limits enforced per
platform) · Approval queue (nothing transmits without a named approver) ·
Publish log (per-transmission: what, when, who approved, platform
response, resulting URL, retry-safety on failure).

**Per-channel status, already locked in by the spec (do not re-litigate,
just build against it):**

| Channel | Publish | Notes |
|---|---|---|
| YouTube | Official API | Ships in **draft/private mode** until client's compliance audit passes |
| Instagram + Facebook | Official (Meta Graph API) | Client owns the Page/Business account |
| LinkedIn | Official | Marketing/Community Management API needs approval |
| X | Official | Client-owned developer account, explicit contract dependency |
| TikTok | Official | **Upload-to-inbox only** until client's compliance audit passes; TikTok exposes **no comment API at all** |
| WeChat Official Account | Official | Client-owned, needs a China-registered entity; comment sync supported |
| Xiaohongshu (RedNote) | **No official publish API** | Exported asset pack, manual posting |
| WeChat Channels (视频号) | **No official publish API** | Exported asset pack, manual posting |
| Bilibili | **No official publish API** | Exported asset pack, manual posting |
| Douyin | Out of scope | Requires a mainland China entity |
| Weibo | **Confirmed dead end, do not pursue** | One open write endpoint takes text+image only, needs a domain registered to a mainland business licence; video upload is a non-public interface granted case-by-case to verified institutional accounts; comment endpoint only returns comments from users who authorised the app; developer registration needs a mainland business licence + ICP filing. Reasoning lives in `02_Integration-Reference.md` §4.1 (referenced by the spec; check if that file exists in the repo — wasn't found in the initial file listing, may need to be requested from the client or is still to be written) |

Comment sync (spec-confirmed): YouTube, Instagram, WeChat Official Account
only. Everything else either has no comment interface (TikTok) or is out
(Weibo, Xiaohongshu, WeChat Channels, Bilibili — no official API at all).

**Contractual constraint (Schedule A3(1)):** no scraping, no unofficial
interfaces, no circumventing platform protections. This rules out
pytrends-style scrapers and unofficial TikTok/Xiaohongshu automation tools
as a *default* — any third-party tool we adopt needs to be checked against
this clause before use, not just against feature coverage.

## Research module — what's already decided (from spec)

Four screens: Trends dashboard, Search & compare, Content performance,
Comment inbox, Topic backlog (five, one screen count off in spec prose,
ignore — five screens exist in the design canvas: `Res-Trends`,
`Res-Compare`, `Res-Perf`, `Res-Inbox`, `Res-Backlog`).

- **Content performance**: own published videos only, filters by channel/
  date/campaign, table with views/watch-through/engagement/comment volume,
  time-series per video, per-channel breakdown, top/bottom performers.
  Loads without a chat prompt, defaults to last 28 days.
- **Comment inbox**: comments grouped by video, sentiment/language/
  flagged-keyword/business-lead filters, AI-drafted replies that **require
  human approval before sending** (never mistakable for sent), bulk hide/
  spam where the platform supports it.
- Trends sourcing (spec default): GDELT (public, commercial-use OK),
  YouTube `mostPopular`, Google Trends API — **but there is no official
  public Google Trends API**, and the spec explicitly bans scrapers
  including `pytrends`. This is a flagged open item in `SETUP.md` §8:
  confirm with the client what access they actually mean (paid/partner
  feed, BigQuery's public Trends dataset, or something else) before
  building against it.

## Current task (in progress)

User wants to "research the whole internet" before finalizing the detailed
build flow, specifically:
1. Third-party APIs that help post to Chinese socials (WeChat, Xiaohongshu/
   RedNote, Weibo) plus the Western ones, beyond what's officially available.
2. Build out the **reaction analysis page** properly (comment/engagement
   analytics across all channels).
3. "Feature the video" throughout — video-forward UI everywhere, not just
   in Video Edit.
4. General goal: make the frontend UI "really perfect" — study best-in-
   class publishing tools for compose/preview/approval/calendar patterns.

**Research agents launched this session (all failed — hit the Claude
session rate limit, resets 11:10pm Asia/Calcutta / IST):**
- Multi-social posting APIs (Ayrshare, Late, Post Bridge, Blotato,
  Upload-Post, Publer, Buffer, Hootsuite, Chinese aggregators 蚁小二/易媒
  助手/融媒宝/新榜/微小宝/壹伴/微盟, official Weibo/Xiaohongshu/WeChat/
  Douyin/Bilibili APIs)
- Reaction/comment analytics APIs (per-platform official analytics APIs,
  Ayrshare/Phyllo/Late analytics, listening tools, Apify/Bright Data/
  scraping providers + legality notes, LLM sentiment/theme clustering
  patterns)
- Best-in-class publishing UX patterns (Buffer/Later/Planable/Hootsuite/
  Sprout/Vista Social/Publer/Metricool/Loomly/Kontentino/Gain, video tools
  CapCut/Opus Clip/Descript/Submagic, Chinese tools 蚁小二/剪映专业版/
  新榜) — compose flow, per-platform live preview, approval workflows,
  content calendar, manual-publish assist pattern, post-publish analytics
  dashboards, video-forward UI (hover-to-play, scrub preview, cover-frame
  picker), plus a 2026 platform limits table (caption length, hashtag
  limits, video length/size/aspect per platform).
- Chinese platform official APIs deep-dive (WeChat OA vs Channels,
  Xiaohongshu open platform status, Weibo, Douyin, Bilibili, Kuaishou —
  exact API names/docs, HK-entity eligibility, review time, quotas) plus
  Chinese third-party aggregation/SaaS tools and listening tools (新榜/
  蝉妈妈/飞瓜/灰豚/清博/千瓜) with pricing.

**Next step: relaunch these four research agents after the rate limit
resets, then compile findings into a recommendation doc + update the
Publish/Research module specs and, if warranted, the design canvas.**

## Screenshots reviewed this session
- Client's own screenshot (`image.png` on server) turned out to be an
  unrelated Telegram bot screenshot (Blackhole Bot, LP autopilot) — not
  relevant to this project, likely attached by mistake. Ignore it.
- `Screenshot 2026-09-11 at 5.39.11 PM.png` and `image copy.png` referenced
  earlier were not actually present on the server when checked (scp
  failed, no such file) — don't assume they exist; re-verify with `ls` if
  needed.

## Token-saving convention going forward
- Read this file (`PROGRESS.md`) at the start of a session on this project
  instead of re-reading `SETUP.md`, `product-brief.md`, the spec PDF, and
  the design `.mjs` files from scratch.
- Append a dated entry below when a research phase, design change, or
  build milestone completes. Keep it terse — links and decisions, not
  narrative.
- Only re-read the underlying source docs when this file's summary is
  insufficient for the task at hand, or when it explicitly says "check
  source" on an open item.

---

### Log

**2026-09-13** — Read server guide, repo structure, spec, SETUP.md,
product-brief.md, publish-screens.mjs and research-screens.mjs in full.
Confirmed shipped-design state for Publish and Research modules. Launched
4 research agents on third-party social APIs / analytics APIs / UX
patterns / Chinese platform APIs — all failed on session rate limit before
producing output. Created this progress doc.

**2026-09-13 (later)** — All 4 research agents completed (rate limit had
reset). Wrote \`02_Integration-Reference.md\` — the file the spec already
references for endpoints/auth/limits but which didn't exist. Key findings:
- **Western publish: use Ayrshare** as the aggregator for IG/FB/TikTok/
  YouTube/LinkedIn/X/Threads instead of 7 direct integrations.
- **Chinese publish: no aggregator covers any of it.** WeChat Official
  Account (服务号) is the only Chinese channel with a real, HK-entity-
  eligible API — build that one directly. Xiaohongshu and WeChat Channels
  confirmed to have **no publish API for anyone**, not just HK entities.
  Bilibili HK-eligibility is unconfirmed (open item: email Bilibili
  directly). Weibo video and Douyin enterprise features confirmed dead
  ends without a mainland entity, matching the spec.
- **Reaction analysis**: full per-platform metric availability matrix
  done. Biggest blocker: TikTok comment text has no legal commercial API
  (Research API is academic-only) — recommend leaving TikTok's comment
  inbox empty by default (matches spec's own "TikTok exposes no comment
  interface" line) rather than adding a scraper. X reads are now metered
  ($0.005/read) — needs a budget gate like the token ledger.
- **UX research**: compiled a platform-limits table (caption/video/aspect/
  size per platform) for the composer's inline linter, and a prioritized
  feature list (live per-platform preview with no separate preview mode,
  closed-loop manual-publish assist ending in "mark as posted + paste back
  URL", cover-frame picker) — full detail in \`02_Integration-Reference.md\`.

Updated \`SETUP.md\` §9 to point at the new reference doc and reflect the
Ayrshare decision. 4 open items logged at the end of
\`02_Integration-Reference.md\` needing a client answer before building
(Google Trends source, Bilibili eligibility, TikTok comment inbox
acceptance, whether a minimal Weibo text presence is wanted).

**Next step:** decide whether to update the Publish/Research design canvas
(\`design/canvas/publish-screens.mjs\`, \`research-screens.mjs\`) to reflect
the Ayrshare-backed channel list and the reaction-analysis page structure,
or leave the design as-is until the client confirms the open items above.
