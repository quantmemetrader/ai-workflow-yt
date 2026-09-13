# Integration reference — endpoints, auth, limits

This is the file `01_Build-Spec 2.pdf` §7 and §4.6 point to for "endpoints,
auth and limits" on every integration, and the file §4.1 of this document
cites for why Weibo is out. It didn't exist before 2026-09-13 — this fills
that gap from a full internet research pass (4 parallel research agents,
logged in `PROGRESS.md`). Treat vendor pricing/availability as
September-2026 snapshots; re-verify before committing spend.

**Rule that shaped every recommendation below:** Schedule A3(1) bans
scraping, unofficial interfaces, and circumventing platform protections.
Anything marked "scrape" or "RPA" here is flagged as a **contract risk**,
not offered as a default — it's documented so the client can make an
informed exception, not so we reach for it first.

---

## 1. Publish — Western platforms: use an aggregator, don't hand-roll seven integrations

No aggregator covers both Western and Chinese platforms — that split is
structural, not a vendor gap. For the seven Western channels
(Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Threads), build
against one aggregator instead of seven direct integrations.

**Recommendation: [Ayrshare](https://www.ayrshare.com/)** — API-first,
most mature, real analytics + comment read/reply on all seven, flat
pricing. Business tier (30 profiles) ~US$599/mo; Launch (10 profiles)
~US$299/mo. Fallback/cheaper option: **[Blotato](https://www.blotato.com/)**
(flat pricing, official APIs, but comment read/reply limited to
Instagram+Facebook only, no LinkedIn metrics).

Do **not** use: Buffer's new API (third-party OAuth not enabled yet,
beta-only), Sprout Social's API (reporting-only, no publish), Zapier/Make
(no Chinese platform connectors exist, and Western coverage still needs
per-post customization Zapier doesn't give you).

### Per-platform status (confirmed against the spec's own constraints)

| Platform | Aggregator support | Contract-specific gate |
|---|---|---|
| Instagram + Facebook | Ayrshare: post + read | Client's Business/Page account, App Review pending |
| YouTube | Ayrshare: post + read | **Ships in draft/private mode** until client's compliance audit passes (spec §7) |
| LinkedIn | Ayrshare: post + read | Marketing/Community Management API needs approval |
| X | Ayrshare: post + read | Client-owned developer account (explicit §11 dependency); reads are now pay-per-use, see §3 below |
| TikTok | Ayrshare: post; comments **not exposed by TikTok at all** (confirmed both by spec and by this research) | **Upload-to-inbox only** until audit passes; unaudited apps also cap at 5 users/24h and SELF_ONLY visibility |
| Threads | Ayrshare: post + read | Not in original scope but effectively free if using Ayrshare for the others |

## 2. Publish — Chinese platforms: no aggregator shortcut, plan channel-by-channel

This confirms and sharpens the spec's existing table — it was already
mostly right, this adds the *why* and the entity requirements.

| Channel | Official API | HK-entity eligible? | Verdict |
|---|---|---|---|
| **WeChat Official Account** (服务号 only, not 订阅号) | Real: `draft/add`, `freepublish/submit`, `material/add_material`, `media/uploadvideo` — [docs](https://developers.weixin.qq.com/doc/service/api/) | **Yes** — register directly as an overseas entity, ~US$99/yr verification, 2-4 weeks, needs a mainland mobile number for the admin | **Build this one directly.** Only Chinese channel with a genuinely usable API for a pure-HK entity. As of Jul 2025, only certified (认证) accounts can call draft/freepublish — factor the verification step into the timeline. |
| **WeChat Channels (视频号)** | Exists (视频号助手 Open API) but gated to an authorized 服务商 relationship, not self-serve | **No** — WeChat's own developer community confirms non-mainland entities are currently blocked from Channels business certification | **Manual only**, via the 视频号助手 web console. Matches the spec's "export an asset pack" plan. |
| **Xiaohongshu (小红书)** | **No general content-post API exists**, for anyone — open platform is merchant/e-commerce only; 蒲公英 is a KOL marketplace, not a publish API | 企业号 (verified business account) is HK-eligible with BR+CR docs, but that doesn't unlock a publish API — it doesn't exist | **Manual only.** Matches spec. Third-party "多平台一键发布" tools (蚁小二, 易媒助手, 融媒宝) automate this via browser/app RPA, not an official API — **this is the Schedule A3(1) scraping/unofficial-interface line**; flag to the client as a knowing exception if they want speed over compliance, don't adopt by default. |
| **Bilibili** | Institutional/MCN-oriented open platform exists; HK eligibility for the license requirement is **unconfirmed** — no explicit exclusion found, but practice defaults to mainland business licenses | Unconfirmed — verify directly with `openplatform-feedback@bilibili.com` before assuming either way | **Manual for now**, matches spec. Worth a direct email to Bilibili before ruling out an MCN partnership route later. |
| **Douyin** | Real API (`video.create`), but enterprise features (蓝V) require a mainland business licence **or** a mainland representative office | **No**, unless the client sets up a mainland rep office | **Out of scope, confirmed** — matches spec exactly. Only path in is a mainland entity or routing through a mainland MCN/agency that already holds the credential. |
| **Weibo** | `statuses/share` (text+image) is real and usable; video upload and the comments API require a separate "高级权限" approval that in practice needs direct outreach to Weibo's business team, with no documented overseas-specific path | Practically closed for video without a mainland business licence / direct Weibo relationship | **Confirmed dead end, as spec already states.** The one addition: basic text+image posting via `statuses/share` is technically usable if the client ever wants a minimal Weibo presence — but video (the actual use case here) is not. |
| **Kuaishou** | Real video-publish + stats API exists but the whole open platform is in **closed beta**, gated behind a partnership contact, not self-serve signup | Undocumented, but the closed-beta gate makes it moot short-term | **Not pursued** — wasn't in the original spec list either; no reason to add it now. |

**Recommendation for the client conversation:** WeChat Official Account is
the one channel worth engineering a real integration for. Everything else
Chinese either needs a mainland entity the client doesn't have, or has no
API at all. The "export an asset pack for manual posting" pattern already
in the spec is the right call for Xiaohongshu, WeChat Channels, and
Bilibili — build that flow well (see §4 below) rather than chasing
RPA tools that risk the client's accounts and the contract's no-scraping
clause.

## 3. Reaction analysis — what's actually readable per platform

Canonical schema to normalize into (map every platform's field names to
this at ingestion, don't let 12 platforms' native field names leak into
the UI or the database):

```
views, likes, shares, saves, comment_count, watch_time_sec,
retention_curve[], demographics{ age, gender, geo }
```

| Platform | Views/likes/shares | Comments (text) | Retention | Demographics |
|---|---|---|---|---|
| Instagram | Official (Graph API insights) | Official | Reels only | Official (account-level, 100+ followers) |
| Facebook | Official — **renaming Jun 2026**: Reach/Impressions → Views/Viewers, update the ingestion mapping before then | Official | Official (video) | Official |
| YouTube | Official (Analytics API) | Official (Data API v3, separate quota) | Official (`audienceWatchRatio`) | Official |
| LinkedIn | Official, **org pages only**, Marketing Developer Platform approval required | Official (approval-gated) | None | Follower-level only, not per-post |
| X | Official but **pay-per-use since Feb 2026**: $0.005/read, $0.015/post created | Official, same pay-per-use — no dedicated comments endpoint, uses a search-by-conversation-id workaround | None (ads only) | None |
| Threads | Official | Official | N/A | Account-level |
| TikTok | Business API only (own account, data lags 7 days, expires after 365 days) | **Not commercially available.** The only comment-text API is the Research API, restricted to verified academic institutions and explicitly bans commercial use | Business API (`full_video_watched_rate`) | Business API only |
| WeChat OA | Official (DataCube: `getarticletotal`, share_count) | Official, own account only | N/A | **Not exposed at all** — WeChat treats this as privacy-sensitive |
| Xiaohongshu | **No public API** — scrape/aggregator only | Same | None | Same |
| Weibo | Official but access-restricted since ~2012 (~150 reads/day on a default app) | Same restriction | N/A | Own-account only |
| Douyin | Official for own content | Official for own content | None | Xingtu/云图, enterprise-gated |
| Bilibili | **No public API** — scrape/partner only | Same | None | Same |

**The one hard blocker to flag now:** TikTok comment text has no legal
commercial API path. Either accept TikTok's comment inbox stays empty in
the product (defensible — TikTok itself exposes no comment interface,
which the spec already documents), or use a paid vendor (Ayrshare's
`getComments`, or a scraping provider) with an explicit legal sign-off
gate before shipping it. Recommend the former as the default, matching
the spec's existing "TikTok exposes no comment interface at all" line —
don't quietly add a scraper to fill this in.

**X reads are now metered.** A comment-heavy post is the most expensive
row in this whole matrix at $0.005/read. Cap comment ingestion depth
(top-N by engagement) rather than full-thread crawls, and consider gating
deep X comment sync behind a budget check the same way the token ledger
gates LLM spend.

### Recommended reaction-analysis page structure

1. Cross-platform summary strip (views/likes/shares/saves/comments,
   blended engagement rate) — grey out metrics a platform doesn't support,
   never show a false zero.
2. Per-platform cards showing only what that platform actually exposes.
3. Time-series per metric, with an explicit "data available after N days"
   caveat where a platform delays it (TikTok: 7 days; Instagram: 90-day
   window).
4. Retention/watch-time curve (YouTube, Reels, Facebook video only).
5. Demographics (Instagram, YouTube, Threads, LinkedIn-follower-level
   only — label the rest "not available" rather than omitting silently).
6. Sentiment over time, per platform per day.
7. Theme clusters (LLM-derived, cheap-first pipeline: rules → small
   classifier for full volume → LLM only for a sample, per the spec's own
   cost-consciousness principle in §5).
8. Emoji/keyword breakdown.
9. Reply-worthy/flagged-comment queue — this is the spec's existing
   Comment Inbox screen; the two should share a data model.
10. Raw comment explorer with a `source` tag (`official` / `aggregator` /
    `scrape`) — surfacing provenance matters given how uneven coverage is.
11. Data-freshness footer per platform.

## 4. Publish UX — what "perfect" looks like, and the platform limits to enforce

Full research is in the session log; the actionable subset:

- **No separate preview mode.** The composer should render each
  platform's live look as you type (Planable's model) — this is the
  single biggest trust-builder for the non-technical approver persona the
  spec's Publish module is built around.
- **Inline spec linting before scheduling**, not after a failed publish:
  caption-too-long, hashtag-count, aspect-ratio mismatch, file-size-over-
  limit. Table below is what to lint against.
- **Manual-publish assist, closed-loop**, for Xiaohongshu/WeChat Channels/
  Bilibili: auto-download the export, auto-copy the caption, deep-link/QR
  to open the native app, then a **"mark as posted + paste back the live
  URL"** step that feeds the reaction-analysis page. This closing step is
  under-built industry-wide (even Metricool, the best reference
  implementation, stops at "open the app") — building it well is a real
  differentiator, not just spec compliance.
- **Cover-frame picker** (scrubber under the video, click a frame to set
  it) is now table stakes — Vista Social, Planable, Metricool all do this.
- Approval should support **comment-on-the-exact-frame**, full version
  history with restore, and — per the spec's own "nothing leaves without
  an approval record" rule — the platform response and resulting URL
  logged right on the approved item, not just in a separate log screen.

### Platform limits to enforce in the linter (2026 snapshot — re-verify before hard-blocking, especially the Chinese platforms, which change by account tier)

| Platform | Caption limit | Video length | Aspect ratio | File size |
|---|---|---|---|---|
| Instagram Reels | 2,200 chars (feed truncates ~125) | 3–90 sec | 9:16, 1080×1920 | <1 GB |
| TikTok | 2,200 chars (API cap) | up to 10 min | 9:16, 1080×1920 | 287.6 MB |
| YouTube Shorts | Title 100 / description 5,000 | up to 180 sec | 9:16, 1080×1920 | very large |
| Xiaohongshu | ~1,000 Chinese chars body, ~20-30 title | app-record 60 sec, upload up to 5-15 min | 9:16 or 3:4 | not published |
| Weibo | 5,000 chars post, 140 comment | historically 15 min for unverified | not published, 720p-1080p typical | ~4 GB |
| WeChat Channels | ~1,000 chars caption | mobile 3 sec–60 min | 16:9 or 6:7 portrait | up to 2 GB |
| Douyin | title ~60 chars | 15–60 sec typical, up to 30 min under 中视频计划 | 9:16, safe zone 1080×1350 | platform-managed |
| Bilibili | not officially published | no hard cap, multi-part supported | 16:9, cover ≥1280×720 | ~4 GB |

---

## Open items still needing a client answer (unblock before building against these)

1. **Google Trends** — spec bans scrapers (`pytrends` named explicitly)
   and there is no official public Trends API. Confirm with the client
   whether they mean a paid/partner feed or BigQuery's public Trends
   dataset (already flagged in `SETUP.md` §8, restated here because it
   blocks Research module build order).
2. **Bilibili HK-entity eligibility** — no confirmed public answer either
   way; email `openplatform-feedback@bilibili.com` directly before
   deciding whether to attempt a direct integration or default to manual.
3. **TikTok comment inbox** — confirm with the client that "TikTok shows
   no comments in the inbox" (matching what the platform itself exposes)
   is acceptable, rather than assuming a paid workaround is wanted.
4. **Weibo** — confirm the client doesn't actually want the achievable
   text+image-only presence via `statuses/share` before writing it off
   entirely; the spec's "doesn't work" verdict is correct for video, not
   for a minimal text posting use case, if that's ever wanted.

## Sources

Full source lists (60+ URLs across vendor docs, official platform
developer portals, and Chinese-language sources) are preserved in the
four research-agent transcripts from the 2026-09-13 session. Ask for the
specific vendor's sources if you need to re-verify a claim — this file
keeps the conclusions, not the full citation list, to stay usable as a
working reference rather than a literature review.
